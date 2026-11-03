"""Carga de audio a 16k mono y log de peticiones."""
import json

import numpy as np
import soundfile as sf
from fastapi import HTTPException

from .config import LOG_DIR
from .security import _check_audio_path

def load_audio_16k_mono(path: str) -> np.ndarray:
    p = _check_audio_path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"audio no encontrado: {path}")
    audio, sr = sf.read(str(p), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != 16000:
        # resample lineal (el backend ya entrega 16k; esto es defensivo)
        n_out = int(round(len(audio) * 16000 / sr))
        if n_out > 1:
            x = np.linspace(0, len(audio) - 1, n_out)
            audio = np.interp(x, np.arange(len(audio)), audio).astype(np.float32)
    return np.ascontiguousarray(audio, dtype=np.float32)


def _log(record: dict) -> None:
    try:
        with open(LOG_DIR / "asr_requests.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass
