"""Comandos agénticos por voz: audio corto -> ASR local -> texto de comando.

No usa servicios del navegador ni nube. Si MEGI_REAL_ASR=false, la ruta falla
cerrada (503) para mantener la garantía de privacidad: el fallback es escribir el
comando en la barra.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ..audio_meta import audit_meta
from ..config import REAL_ASR, SESSIONS_DIR, STATE_DIR
from ..db import db
from ..security import require_user
from ..services import asr_client, speaker_profile
from ..services.wake_scrub import extract_wake_command
from .audio import _to_wav16k, _wav_duration_ms
from .users import verify_user

router = APIRouter()

# Un comando hablado dura segundos; 2 MB de webm/opus alcanzan de sobra.
# Evita que un upload arbitrario llene disco (los audios se guardan como traza).
MAX_COMMAND_AUDIO_BYTES = 2 * 1024 * 1024


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/voice/command/transcribe")
async def transcribe_voice_command(
    file: UploadFile = File(...),
    consultation_id: Optional[str] = Form(None),
    user: dict = Depends(require_user),
):
    """Transcribe un comando hablado corto usando el ASR local configurado.

    La ruta solo devuelve texto. El frontend decide si el texto se convierte en
    comando válido mediante el registro/política de comandos.
    """
    raw = await file.read()
    if len(raw) > MAX_COMMAND_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="El audio del comando es demasiado largo (máx. 2 MB).")

    if not REAL_ASR:
        raise HTTPException(
            status_code=503,
            detail="ASR local de comandos no configurado (MEGI_REAL_ASR=false). Escribe el comando.",
        )

    if consultation_id:
        with db() as conn:
            exists = conn.execute("SELECT 1 FROM consultations WHERE id = ?", (consultation_id,)).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="consulta no encontrada")

    t_start = time.time()
    audio_id = "VC-" + uuid.uuid4().hex[:8]
    dest_dir = SESSIONS_DIR / "_voice_commands" / audio_id
    dest_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename or "voice-command.webm").suffix or ".webm"
    original = dest_dir / f"original{ext}"
    original.write_bytes(raw)
    sha = hashlib.sha256(raw).hexdigest()

    wav = dest_dir / "asr_16k.wav"
    t_conv = time.time()
    _to_wav16k(original, wav)
    convert_ms = int((time.time() - t_conv) * 1000)
    duration_ms = _wav_duration_ms(wav)

    t_asr = time.time()
    try:
        r = asr_client.transcribe_file(str(wav), consultation_id or "voice_command", route="voice_command")
        transcript = (r.get("normalized_text") or r.get("transcript") or "").strip()
        model = r.get("model")
        status = "done"
    except Exception as e:
        r = {"error": str(e)}
        transcript = ""
        model = None
        status = "error"
    asr_ms = int((time.time() - t_asr) * 1000)
    timing = {"convert_ms": convert_ms, "asr_ms": asr_ms, "total_ms": int((time.time() - t_start) * 1000)}

    classification = audit_meta("voice_command", uploaded_by=user.get("username"))
    meta = {
        "audio_id": audio_id,
        "consultation_id": consultation_id,
        **classification,
        "original_path": str(original),
        "asr_wav_path": str(wav),
        "duration_ms": duration_ms,
        "sha256": sha,
        "asr_mode": "real",
        "model": model,
        "transcription_status": status,
        "timing": timing,
        "created_at": _now(),
    }
    (dest_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    with db() as conn:
        conn.execute(
            """INSERT INTO audio
               (id, consultation_id, audio_kind, entity_type, slot_id, original_path,
                asr_wav_path, duration_ms, sha256, transcription_status, transcript, resolved,
                model, asr_mode, timing, created_at, uploaded_by, purpose, retention)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                audio_id, consultation_id, "voice_command", None, None, str(original),
                str(wav), duration_ms, sha, status, transcript, None,
                model, "real", json.dumps(timing), _now(),
                classification["uploaded_by"], classification["purpose"], classification["retention"],
            ),
        )

    if status != "done":
        raise HTTPException(status_code=502, detail=f"ASR local no pudo transcribir el comando: {r.get('error')}")

    return {
        "audio_id": audio_id,
        "consultation_id": consultation_id,
        "audio_kind": "voice_command",
        "duration_ms": duration_ms,
        "sha256": sha,
        "asr_mode": "real",
        "model": model,
        "transcription_status": status,
        "timing": timing,
        "transcript": transcript,
    }


# Manos libres sondea enunciados CORTOS (≤ ~5s); 512 KB de wav16k ≈ 16s de sobra.
MAX_PROBE_AUDIO_BYTES = 512 * 1024


@router.post("/voice/wake/probe")
async def probe_wake_command(
    file: UploadFile = File(...),
    consultation_id: Optional[str] = Form(None),
    user: dict = Depends(require_user),
):
    """Fase 8 (manos libres): sondea si un enunciado corto contiene la palabra
    de activación "MEGI".

    Contrato de privacidad: si NO hay wake word, el audio del sondeo se DESCARTA
    (ese habla clínica ya se retiene por el flujo de chunks) y la respuesta NO
    incluye el texto transcrito — el habla del paciente/médico nunca sale por el
    canal de comandos. Solo con wake word se retiene como voice_command (con la
    misma clasificación auditable) y se devuelve el COMANDO detectado.
    """
    raw = await file.read()
    if len(raw) > MAX_PROBE_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="El sondeo de manos libres solo acepta enunciados cortos (máx. 512 KB).")

    if not REAL_ASR:
        raise HTTPException(
            status_code=503,
            detail="ASR local no configurado (MEGI_REAL_ASR=false); el modo manos libres no está disponible.",
        )

    if consultation_id:
        with db() as conn:
            exists = conn.execute("SELECT 1 FROM consultations WHERE id = ?", (consultation_id,)).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="consulta no encontrada")

    t_start = time.time()
    audio_id = "VC-" + uuid.uuid4().hex[:8]
    dest_dir = SESSIONS_DIR / "_voice_commands" / audio_id
    dest_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename or "wake-probe.wav").suffix or ".wav"
    original = dest_dir / f"original{ext}"
    original.write_bytes(raw)
    sha = hashlib.sha256(raw).hexdigest()

    wav = dest_dir / "asr_16k.wav"
    try:
        _to_wav16k(original, wav)
        duration_ms = _wav_duration_ms(wav)
        r = asr_client.transcribe_file(str(wav), consultation_id or "wake_probe", route="voice_command")
        transcript = (r.get("normalized_text") or r.get("transcript") or "").strip()
        model = r.get("model")
    except Exception:
        shutil.rmtree(dest_dir, ignore_errors=True)
        return {"wake_word_detected": False}

    command_text = extract_wake_command(transcript)
    if not command_text:
        # Sin wake word: descartar el sondeo. No devolver el transcript (es
        # habla clínica; ya está retenida por el flujo de chunks).
        shutil.rmtree(dest_dir, ignore_errors=True)
        return {"wake_word_detected": False}

    # Fase 10 — verificación del hablante: ¿esta voz es la del médico enrolado?
    # Si el verificador falla, se reporta 'sin_verificar' (el frontend NO ejecuta:
    # fail-closed). Sin perfil enrolado -> 'sin_enrolar' (comportamiento previo).
    verdict = {"speaker": "sin_verificar", "score": None, "threshold": None}
    try:
        emb = asr_client.speaker_embed(str(wav))
        if emb.get("status") == "done":
            verdict = speaker_profile.verify(user.get("username"), emb["embedding"])
    except Exception:
        pass

    timing = {"total_ms": int((time.time() - t_start) * 1000)}
    classification = audit_meta("voice_command", uploaded_by=user.get("username"))
    meta = {
        "audio_id": audio_id,
        "consultation_id": consultation_id,
        **classification,
        "capture_mode": "hands_free",
        "speaker": verdict["speaker"],
        "speaker_score": verdict["score"],
        "original_path": str(original),
        "asr_wav_path": str(wav),
        "duration_ms": duration_ms,
        "sha256": sha,
        "asr_mode": "real",
        "model": model,
        "transcription_status": "done",
        "timing": timing,
        "created_at": _now(),
    }
    (dest_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    with db() as conn:
        conn.execute(
            """INSERT INTO audio
               (id, consultation_id, audio_kind, entity_type, slot_id, original_path,
                asr_wav_path, duration_ms, sha256, transcription_status, transcript, resolved,
                model, asr_mode, timing, created_at, uploaded_by, purpose, retention)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                audio_id, consultation_id, "voice_command", None, None, str(original),
                str(wav), duration_ms, sha, "done", transcript, None,
                model, "real", json.dumps(timing), _now(),
                classification["uploaded_by"], classification["purpose"], classification["retention"],
            ),
        )

    return {
        "wake_word_detected": True,
        "audio_id": audio_id,
        "command_text": command_text,
        "duration_ms": duration_ms,
        "timing": timing,
        "speaker": verdict["speaker"],
        "speaker_score": verdict["score"],
    }


# ---------------------------------------------------------------- Fase 10: enrolamiento de voz
# Se persiste SOLO la huella vocal (embedding), nunca el audio crudo del
# enrolamiento. El enrolamiento debe grabarse con el micrófono y en el entorno
# reales del consultorio (SDSV: enrolamiento largo text-independent).
MAX_ENROLL_AUDIO_BYTES = 6 * 1024 * 1024


@router.post("/voice/speaker/enroll")
async def enroll_speaker(
    file: UploadFile = File(...),
    password: Optional[str] = Form(None),
    user: dict = Depends(require_user),
):
    raw = await file.read()
    if len(raw) > MAX_ENROLL_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio de enrolamiento demasiado grande (máx. 6 MB).")

    # REGRABAR una huella existente exige re-autenticación con contraseña: una
    # sesión abierta no basta para REEMPLAZAR el biométrico del médico (alguien
    # frente a la pantalla podría suplantar la voz autorizada).
    if speaker_profile.load_profile(user.get("username")):
        if not password or not verify_user(user.get("username"), password):
            raise HTTPException(
                status_code=403,
                detail="Para regrabar tu huella vocal escribe tu contraseña (re-autenticación requerida).",
            )

    if not REAL_ASR:
        raise HTTPException(status_code=503, detail="Verificación de voz no disponible (MEGI_REAL_ASR=false).")

    tmp_dir = SESSIONS_DIR / "_speaker_enroll" / uuid.uuid4().hex[:8]
    tmp_dir.mkdir(parents=True, exist_ok=True)
    try:
        ext = Path(file.filename or "enroll.wav").suffix or ".wav"
        original = tmp_dir / f"original{ext}"
        original.write_bytes(raw)
        wav = tmp_dir / "enroll_16k.wav"
        _to_wav16k(original, wav)
        duration_ms = _wav_duration_ms(wav)
        if duration_ms < speaker_profile.MIN_ENROLL_MS:
            raise HTTPException(
                status_code=422,
                detail=f"El enrolamiento necesita al menos {speaker_profile.MIN_ENROLL_MS // 1000}s de voz (recibí {duration_ms // 1000}s).",
            )
        r = asr_client.speaker_embed(str(wav))
        if r.get("status") != "done":
            raise HTTPException(status_code=502, detail=f"No se pudo calcular la huella vocal: {r.get('error')}")
        profile = speaker_profile.save_profile(
            user.get("username"), r["embedding"], r.get("model", ""), duration_ms,
        )
    finally:
        # El audio crudo del enrolamiento NUNCA se retiene (solo el embedding).
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return {
        "enrolled": True,
        "username": profile["username"],
        "dim": profile["dim"],
        "duration_ms": duration_ms,
        "threshold": profile["threshold"],
        "created_at": profile["created_at"],
    }


@router.get("/voice/speaker/status")
def speaker_status(user: dict = Depends(require_user)):
    p = speaker_profile.load_profile(user.get("username"))
    if not p:
        return {"enrolled": False}
    return {
        "enrolled": True,
        "created_at": p.get("created_at"),
        "threshold": p.get("threshold"),
        "enroll_duration_ms": p.get("enroll_duration_ms"),
    }


# ---------------------------------------------------------------- Fase 9B: shadow mode
# Los comandos que el clasificador de reglas NO entendió se mandan al parser LLM
# (gemma en el servicio ASR) SOLO para registrar qué habría propuesto. Nada se
# ejecuta desde aquí: es evidencia para decidir cuándo darle autoridad real.
SHADOW_LOG = STATE_DIR / "voice_shadow.jsonl"


class ShadowParseReq(BaseModel):
    text: str
    regex_intent: Optional[str] = None   # lo que dijo el clasificador de reglas
    source: Optional[str] = None         # global_bar | consulta | revision
    context: Optional[dict] = None


@router.post("/voice/command/parse")
def parse_command_shadow(body: ShadowParseReq, user: dict = Depends(require_user)):
    if not REAL_ASR:
        raise HTTPException(status_code=503, detail="Parser de comandos no disponible (MEGI_REAL_ASR=false).")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="texto vacío")

    t0 = time.time()
    try:
        r = asr_client.parse_command(text, body.context)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"parser no disponible: {e}")
    if r.get("status") != "done":
        raise HTTPException(status_code=502, detail=f"parser no disponible: {r.get('error')}")

    parse = r.get("parse") or {}
    record = {
        "ts": _now(),
        "mode": "shadow",
        "user": user.get("username"),
        "source": body.source,
        "text": text,
        "regex_intent": body.regex_intent,
        "llm_intent": parse.get("intent"),
        "llm": parse,
        "latency_ms": int((time.time() - t0) * 1000),
    }
    try:
        with SHADOW_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass  # el registro shadow nunca debe romper el flujo

    return {"mode": "shadow", "parse": parse, "latency_ms": record["latency_ms"]}
