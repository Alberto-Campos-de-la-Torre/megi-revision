"""Transcripción: ruta general, ruta de identificadores y shadow batch/stream."""
import sys
import time
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..audio import _log, load_audio_16k_mono
from ..config import (
    GENERAL_MODEL,
    IDENTIFIER_MODEL,
    IDENTIFIER_PROMPT,
    VOICE_COMMAND_PROMPT,
)
from ..engine import (
    StreamingEngine,
    _transcribe,
    difflib,
    make_stream_engine,
    normalize_text,
    resolve_text,
    stream_postroll,
    stream_warmup,
)
from ..speaker import _get_speaker_extractor

router = APIRouter()

class FileReq(BaseModel):
    audio_path: str
    route: str = "general_consultation"
    consultation_id: str | None = None
    # Fase 10B: huella del médico (embedding). Si viene, cada segmento de whisper
    # se puntúa contra ella (coseno) y se devuelve en `segments`. La DECISIÓN
    # (etiqueta/umbral) vive en el backend MEGI.
    speaker_ref: list[float] | None = None


class IdentifierReq(BaseModel):
    audio_path: str
    entity_type: str
    consultation_id: str | None = None
    slot_id: str | None = None

@router.post("/v1/transcribe/file")
def transcribe_file(req: FileReq):
    t0 = time.time()
    audio = load_audio_16k_mono(req.audio_path)
    # Comandos de voz: prompt que enseña la palabra "MEGI" y el vocabulario de
    # comandos (whisper la escribe "Meji/Megui" sin este sesgo).
    prompt = VOICE_COMMAND_PROMPT if req.route == "voice_command" else None
    result = _transcribe(audio, GENERAL_MODEL, initial_prompt=prompt)
    raw = (result.get("text") or "").strip()
    normalized = raw
    if normalize_text:
        try:
            normalized = normalize_text(raw).normalized
        except Exception as e:
            print(f"[asr] normalizer fallo: {e}", file=sys.stderr)
    # Fase 10B: puntuar cada segmento contra la huella del médico. Segmentos
    # <1.5s no se puntúan (SDSV: embeddings poco confiables en audio diminuto).
    segments_out = None
    if req.speaker_ref:
        segments_out = []
        spk = _get_speaker_extractor()
        ref = np.array(req.speaker_ref, dtype=np.float32)
        refn = ref / (np.linalg.norm(ref) or 1.0)
        for seg in result.get("segments") or []:
            s, e = float(seg.get("start", 0)), float(seg.get("end", 0))
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            score = None
            if not spk["error"] and (e - s) >= 1.5:
                piece = audio[int(s * 16000):int(e * 16000)]
                if len(piece) >= 16000:
                    st_ = spk["extractor"].create_stream()
                    st_.accept_waveform(16000, piece)
                    st_.input_finished()
                    emb = np.array(spk["extractor"].compute(st_), dtype=np.float32)
                    embn = emb / (np.linalg.norm(emb) or 1.0)
                    score = round(float(np.dot(embn, refn)), 4)
            segments_out.append({"start": round(s, 2), "end": round(e, 2), "text": text, "speaker_score": score})

    out = {
        "status": "done",
        "route": req.route,
        "model": Path(GENERAL_MODEL).name,
        "transcript": raw,
        "normalized_text": normalized,
        "segments": segments_out,
        "duration_s": round(len(audio) / 16000, 2),
        "latency_ms": int((time.time() - t0) * 1000),
    }
    _log({"kind": "file", "consultation_id": req.consultation_id, **{k: out[k] for k in ("model", "duration_s", "latency_ms")}, "chars": len(raw),
          "labeled_segments": len(segments_out) if segments_out is not None else None})
    return out


@router.post("/v1/transcribe/identifier")
def transcribe_identifier(req: IdentifierReq):
    t0 = time.time()
    audio = load_audio_16k_mono(req.audio_path)
    result = _transcribe(audio, IDENTIFIER_MODEL, initial_prompt=IDENTIFIER_PROMPT)
    raw = (result.get("text") or "").strip()
    entity = (req.entity_type or "").upper()

    res = resolve_text(raw, entity)
    resolved = {
        "status": res.status.value,
        "value": res.value,
        "candidates": list(res.candidates),
        "requires_confirmation": bool(res.requires_confirmation),
        "is_valid": bool(res.is_valid),
        "validation_errors": list(res.validation_errors),
        "acoustic_evidence": bool(res.acoustic_evidence),
    }
    out = {
        "status": "done",
        "route": "identifier_slot",
        "model": Path(IDENTIFIER_MODEL).name,
        "entity_type": entity,
        "slot_id": req.slot_id,
        "raw_transcript": raw,
        "candidate_base": res.value,  # RAW y RESOLVED parten del mismo candidate_base
        "resolved": resolved,
        "duration_s": round(len(audio) / 16000, 2),
        "latency_ms": int((time.time() - t0) * 1000),
    }
    _log({"kind": "identifier", "consultation_id": req.consultation_id, "entity": entity,
          "raw": raw, "resolved_status": resolved["status"], "value": resolved["value"],
          "latency_ms": out["latency_ms"]})
    return out


class ShadowReq(BaseModel):
    audio_path: str
    consultation_id: str | None = None
    chunk_ms: int = 250


@router.post("/v1/shadow/compare")
def shadow_compare(req: ShadowReq):
    """Mismo audio por BATCH (archivo completo) y por STREAMING (StreamingEngine en
    chunks), para localizar si una diferencia viene del modelo o del mecanismo de
    streaming (chunking/VAD/commit). Ambos usan el modelo general v1.5."""
    if StreamingEngine is None:
        raise HTTPException(status_code=503, detail="StreamingEngine no disponible")
    audio = load_audio_16k_mono(req.audio_path)

    # --- batch (referencia) ---
    tb = time.time()
    rb = _transcribe(audio, GENERAL_MODEL)
    batch_raw = (rb.get("text") or "").strip()
    batch_ms = int((time.time() - tb) * 1000)
    batch_norm = normalize_text(batch_raw).normalized if normalize_text else batch_raw

    # --- streaming (mismo modelo, alimentado en chunks) ---
    ts = time.time()
    eng = make_stream_engine()
    stream_warmup(eng)  # evita perder el inicio
    step = max(1600, int(16000 * req.chunk_ms / 1000))
    first_commit_ms = None
    for i in range(0, len(audio), step):
        eng.push_audio(audio[i:i + step])
        if first_commit_ms is None and eng.get_raw_text().strip():
            first_commit_ms = int((time.time() - ts) * 1000)
    stream_postroll(eng)  # gatilla speech_end -> commit del final
    stream_raw = eng.get_raw_text().strip()
    stream_norm = eng.get_normalized_text().strip()
    try:
        st = eng.stats()
    except Exception:
        st = {}
    n_commits = sum(1 for e in getattr(eng, "events", []) if e.get("type") == "commit")
    eng.close()
    stream_ms = int((time.time() - ts) * 1000)

    # similitud con formato (texto normalizado) y de CONTENIDO (sin puntuación/acentos)
    raw_sim = difflib.SequenceMatcher(a=batch_norm.split(), b=stream_norm.split()).ratio()
    bc, sc = _clean_for_compare(batch_norm), _clean_for_compare(stream_norm)
    content_sim = difflib.SequenceMatcher(a=bc.split(), b=sc.split()).ratio()
    out = {
        "model": Path(GENERAL_MODEL).name,
        "duration_s": round(len(audio) / 16000, 2),
        "batch": {"raw": batch_raw, "normalized": batch_norm, "latency_ms": batch_ms,
                  "words": len(batch_norm.split()), "tail": " ".join(batch_norm.split()[-12:])},
        "streaming": {"raw": stream_raw, "normalized": stream_norm, "latency_ms": stream_ms,
                      "first_text_ms": first_commit_ms, "words": len(stream_norm.split()),
                      "n_commits": n_commits, "rtf": st.get("rtf"),
                      "tail": " ".join(stream_norm.split()[-12:])},
        "compare": {
            "similarity": round(raw_sim, 4),            # incluye puntuación/formato
            "content_similarity": round(content_sim, 4),  # solo contenido (lo que importa)
            "content_word_diff": _word_diff(bc, sc),    # pérdida real por chunking/VAD/commit
        },
    }
    _log({"kind": "shadow", "consultation_id": req.consultation_id,
          "similarity": out["compare"]["similarity"],
          "content_similarity": out["compare"]["content_similarity"],
          "batch_ms": batch_ms, "stream_ms": stream_ms})
    return out


def _clean_for_compare(t: str) -> str:
    import re
    import unicodedata
    t = unicodedata.normalize("NFKD", (t or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _word_diff(a: str, b: str, limit: int = 40) -> list:
    """Diferencias palabra a palabra (batch vs streaming) para auditar pérdida real."""
    diffs = []
    sm = difflib.SequenceMatcher(a=a.split(), b=b.split())
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        diffs.append({"op": tag, "batch": " ".join(a.split()[i1:i2]),
                      "streaming": " ".join(b.split()[j1:j2])})
        if len(diffs) >= limit:
            break
    return diffs
