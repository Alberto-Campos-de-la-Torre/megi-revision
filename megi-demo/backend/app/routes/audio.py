"""Captura de audio real: upload -> storage -> (ffmpeg) wav16k -> ASR (real|mock)."""
from __future__ import annotations

import hashlib
import json
import subprocess
import time
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..audio_meta import audit_meta
from ..config import REAL_ASR, load_seed
from ..db import db
from ..ownership import owned_consultation
from ..security import require_user
from ..services import asr_client, audit_log, mock_resolver
from ..uploads import (
    MAX_CONSULTATION_AUDIO_BYTES,
    read_capped,
    safe_session_dir,
    safe_suffix,
)

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _wav_duration_ms(path: Path) -> int:
    try:
        with wave.open(str(path), "rb") as w:
            return int(round(w.getnframes() / float(w.getframerate()) * 1000))
    except Exception:
        return 0


def _to_wav16k(src: Path, dst: Path) -> None:
    """Convierte cualquier formato del navegador (webm/opus) a WAV mono 16k con ffmpeg."""
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-ar", "16000", "-ac", "1", str(dst)],
        capture_output=True,
    )
    if proc.returncode != 0 or not dst.exists():
        raise HTTPException(status_code=500, detail=f"ffmpeg fallo: {proc.stderr.decode()[-300:]}")


def _mock_transcription(audio_kind: str, entity_type: str | None) -> dict:
    """Transcript mock con la MISMA forma que el servicio real (modo local_mock)."""
    seed = load_seed()
    if audio_kind == "identifier_slot":
        field = "curp" if (entity_type or "").upper() == "CURP" else "nss"
        res = mock_resolver.resolve(field, "(mock)")
        return {"transcription_status": "mock", "transcript": "(mock identifier)",
                "resolved": res}
    text = " ".join(l["text"] for l in seed["TRANSCRIPT"] if l["s"] == "PAC")
    return {"transcription_status": "mock", "transcript": text, "resolved": None}


@router.post("/audio/upload")
async def upload_audio(
    file: UploadFile = File(...),
    consultation_id: str = Form(...),
    audio_kind: str = Form("general_consultation"),
    entity_type: str = Form(None),
    slot_id: str = Form(None),
    user: dict = Depends(require_user),
):
    with db() as conn:
        owned_consultation(conn, consultation_id, user)   # no se sube a consulta ajena
    t_start = time.time()
    audio_id = "A-" + uuid.uuid4().hex[:8]
    # El id lo elige el cliente: validado y contenido en SESSIONS_DIR (ver uploads.py).
    dest_dir = safe_session_dir(consultation_id, "audio", audio_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    ext = safe_suffix(file.filename)
    original = dest_dir / f"original{ext}"
    raw_bytes = await read_capped(file, MAX_CONSULTATION_AUDIO_BYTES, "El audio de la consulta")
    original.write_bytes(raw_bytes)
    sha = hashlib.sha256(raw_bytes).hexdigest()

    wav = dest_dir / "asr_16k.wav"
    t_conv = time.time()
    _to_wav16k(original, wav)
    convert_ms = int((time.time() - t_conv) * 1000)
    duration_ms = _wav_duration_ms(wav)

    asr_mode = "real" if REAL_ASR else "mock"
    model = None
    t_asr = time.time()
    # transcripción: real (microservicio) o mock
    if REAL_ASR:
        try:
            if audio_kind == "identifier_slot":
                r = asr_client.transcribe_identifier(str(wav), entity_type or "CURP",
                                                     consultation_id, slot_id)
                transcript = r.get("raw_transcript", "")
                resolved = r.get("resolved")
            else:
                r = asr_client.transcribe_file(str(wav), consultation_id)
                transcript = r.get("normalized_text") or r.get("transcript", "")
                resolved = None
            model = r.get("model")
            status = "done"
        except Exception as e:
            transcript, resolved, status = "", None, "error"
            r = {"error": str(e)}
    else:
        m = _mock_transcription(audio_kind, entity_type)
        transcript, resolved, status = m["transcript"], m["resolved"], m["transcription_status"]
        model = "mock"
        r = m
    asr_ms = int((time.time() - t_asr) * 1000)
    timing = {"convert_ms": convert_ms, "asr_ms": asr_ms,
              "total_ms": int((time.time() - t_start) * 1000)}

    # meta.json junto al audio (auditoría): clasificación central en audio_meta.py
    classification = audit_meta(audio_kind, uploaded_by=user.get("username"))
    meta = {
        "audio_id": audio_id, "consultation_id": consultation_id,
        **classification, "entity_type": entity_type, "slot_id": slot_id,
        "original_path": str(original), "asr_wav_path": str(wav),
        "duration_ms": duration_ms, "sha256": sha,
        "asr_mode": asr_mode, "model": model,
        "transcription_status": status, "timing": timing, "created_at": _now(),
    }
    (dest_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    with db() as conn:
        conn.execute(
            """INSERT INTO audio
               (id, consultation_id, audio_kind, entity_type, slot_id, original_path,
                asr_wav_path, duration_ms, sha256, transcription_status, transcript, resolved,
                model, asr_mode, timing, created_at, uploaded_by, purpose, retention)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (audio_id, consultation_id, audio_kind, entity_type, slot_id, str(original),
             str(wav), duration_ms, sha, status, transcript,
             json.dumps(resolved, ensure_ascii=False) if resolved else None,
             model, asr_mode, json.dumps(timing), _now(),
             classification["uploaded_by"], classification["purpose"], classification["retention"]),
        )
        # registrar identificador en su tabla para trazabilidad
        if audio_kind == "identifier_slot" and resolved:
            audit_log.log_identifier_result(conn, consultation_id, {
                "field": (entity_type or "").lower(),
                "raw_value": transcript,
                "state": resolved.get("status"),
                "value": resolved.get("value"),
                "candidates": resolved.get("candidates"),
                "requires_confirmation": resolved.get("requires_confirmation"),
            })

    return {
        "audio_id": audio_id,
        "consultation_id": consultation_id,
        "audio_kind": audio_kind,
        "entity_type": entity_type,
        "duration_ms": duration_ms,
        "sha256": sha,
        "asr_mode": asr_mode,
        "model": model,
        "transcription_status": status,
        "timing": timing,
        "transcript": transcript,
        "resolved": resolved,
        "asr": r,
    }


@router.get("/audio/{audio_id}")
def get_audio(audio_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        row = conn.execute("SELECT * FROM audio WHERE id = ?", (audio_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="audio no encontrado")
        # El audio es el dato más sensible: se comprueba contra el dueño de su
        # consulta, no basta con estar autenticado.
        if row["consultation_id"]:
            owned_consultation(conn, row["consultation_id"], user)
    d = dict(row)
    if d.get("resolved"):
        d["resolved"] = json.loads(d["resolved"])
    return d
