"""Interfaz ASR + resolución desde el registro de modelos.

Sprint 1 liga ambas rutas a implementaciones mock. Para conectar inferencia real
(MLX) más adelante basta inyectar una implementación que cumpla ASRService y
mapearla en `get_asr`, SIN tocar las rutas.
"""
from typing import Protocol

from ..config import MODEL_REGISTRY, REAL_INFERENCE
from . import mock_asr


class ASRService(Protocol):
    route: str
    model_id: str

    def transcribe(self, *, audio_ref=None, asr_text=None) -> dict:
        ...


_GENERAL = mock_asr.MockGeneralASR(MODEL_REGISTRY["asr"]["general"]["id"])
_IDENTIFIER = mock_asr.MockIdentifierASR(MODEL_REGISTRY["asr"]["identifier"]["id"])


def get_asr(route: str) -> ASRService:
    if route == "identifier":
        return _IDENTIFIER
    return _GENERAL


def is_ready(route: str) -> bool:
    """En Sprint 1 ningún modelo real está cargado."""
    return REAL_INFERENCE
