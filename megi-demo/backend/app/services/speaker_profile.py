"""Perfiles de voz del médico (Fase 10 — verificación del hablante).

Se persiste SOLO el embedding (huella vocal) y metadatos de calibración — nunca
el audio crudo del enrolamiento (NIST 800-63B: comparación local, mínimo dato
biométrico). El umbral por defecto es conservador (menor falsa aceptación: que
otra voz active un comando pesa más que rechazarte cuando estás ronco) y puede
recalibrarse por perfil con `scripts/speaker_calibrate.py`.
"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..config import STATE_DIR

PROFILES_DIR = STATE_DIR / "speaker_profiles"

# Umbral de similitud de coseno (embeddings WeSpeaker CAM++_LM). Se calibra con
# audios propios; este default se eligió sesgado a pocas falsas aceptaciones.
DEFAULT_THRESHOLD = float(os.environ.get("MEGI_SPEAKER_THRESHOLD", "0.45"))

# Enrolamiento text-independent largo (SDSV 2026: más estable para comandos cortos).
MIN_ENROLL_MS = 10_000


def cosine(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _path(username: str) -> Path:
    safe = "".join(ch for ch in username if ch.isalnum() or ch in "-_.")
    return PROFILES_DIR / f"{safe}.json"


def save_profile(username: str, embedding: list, model: str, duration_ms: int) -> dict:
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    profile = {
        "username": username,
        "embedding": embedding,
        "dim": len(embedding),
        "model": model,
        "enroll_duration_ms": duration_ms,
        "threshold": DEFAULT_THRESHOLD,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _path(username).write_text(json.dumps(profile), encoding="utf-8")
    return profile


def load_profile(username: str) -> Optional[dict]:
    p = _path(username)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


# Margen extra para AFIRMAR "medico" en el etiquetado: equivocarse afirmando el
# rol pesa más que dejar "desconocido" (la banda [thr, thr+margen) queda gris).
# 0.12 medido: deja a las voces TTS límite (~0.46) en la zona gris; los segmentos
# clínicos largos del médico real puntúan por encima con holgura.
LABEL_MEDICO_MARGIN = 0.12


def label_for_score(profile: dict, score) -> str:
    """Fase 10B: etiqueta de rol para un segmento del transcript.

    medico | otro | desconocido. Banda de ambigüedad: score None (segmento
    corto) o en la zona gris = desconocido — mejor no afirmar que equivocarse.
    'otro' se muestra como PACIENTE en la UI, pero se persiste neutro: puede
    ser asistente, familiar o intérprete.
    """
    if score is None:
        return "desconocido"
    thr = float(profile.get("threshold") or DEFAULT_THRESHOLD)
    if score >= thr + LABEL_MEDICO_MARGIN:
        return "medico"
    if score < thr:
        return "otro"
    return "desconocido"


def verify(username: str, embedding: list) -> dict:
    """Compara un embedding contra el perfil enrolado del usuario.

    speaker: medico | desconocido | sin_enrolar. La política la aplica quien
    llama (manos libres exige 'medico'; push-to-command/texto no verifican:
    ahí la activación ya es un gesto deliberado del usuario autenticado).
    """
    profile = load_profile(username)
    if not profile:
        return {"speaker": "sin_enrolar", "score": None, "threshold": None}
    score = round(cosine(embedding, profile["embedding"]), 4)
    threshold = float(profile.get("threshold") or DEFAULT_THRESHOLD)
    return {
        "speaker": "medico" if score >= threshold else "desconocido",
        "score": score,
        "threshold": threshold,
    }
