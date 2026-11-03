"""Embedding de hablante: el servicio solo calcula, el backend decide."""
import time
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from ..audio import _log, load_audio_16k_mono
from ..speaker import SPEAKER_MODEL, _get_speaker_extractor

router = APIRouter()

class SpeakerEmbedReq(BaseModel):
    audio_path: str


@router.post("/v1/speaker/embed")
def speaker_embed(req: SpeakerEmbedReq):
    t0 = time.time()
    spk = _get_speaker_extractor()
    if spk["error"]:
        return {"status": "error", "error": f"speaker_model_no_disponible: {spk['error']}"}
    audio = load_audio_16k_mono(req.audio_path)
    stream = spk["extractor"].create_stream()
    stream.accept_waveform(16000, audio)
    stream.input_finished()
    emb = list(spk["extractor"].compute(stream))
    out = {"status": "done", "embedding": emb, "dim": len(emb),
           "model": Path(SPEAKER_MODEL).name,
           "duration_s": round(len(audio) / 16000, 2),
           "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "speaker_embed", "duration_s": out["duration_s"], "latency_ms": out["latency_ms"]})
    return out
