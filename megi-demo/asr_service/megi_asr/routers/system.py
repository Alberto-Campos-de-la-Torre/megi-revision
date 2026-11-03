"""Salud del servicio: lo que el health-check activo del backend (§4) lee."""
import sys
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from rag.contra_checker import contra
from rag.rag_service import rag as rag_index
from rag.rag_service import rag_fda

from ..config import ENGINE_DIR, GENERAL_MODEL, IDENTIFIER_MODEL
from ..engine import StreamingEngine, normalize_text
from ..llm import complete, status
from ..security import _check_audio_path

router = APIRouter()

@router.get("/health")
def health():
    """Health barato (no carga modelos): lo consulta el backend para saber si
    puede transcribir de verdad o estaría documentando con mock."""
    return {
        "status": "ok",
        "runtime": f"python{sys.version_info.major}.{sys.version_info.minor}",
        "mlx": True,
        "engine_dir": ENGINE_DIR,
        "models": {
            "general": GENERAL_MODEL if Path(GENERAL_MODEL).exists() else "missing",
            "identifier": IDENTIFIER_MODEL if Path(IDENTIFIER_MODEL).exists() else "missing",
        },
        "normalizer": bool(normalize_text),
        "streaming": StreamingEngine is not None,
        "llm": status(),
        # `rag` conserva EXACTAMENTE las tres claves que lee el backend
        # (health_probe.py); lo nuevo va aparte para no mover ese contrato.
        "rag": {k: rag_index.status().get(k) for k in ("index_present", "loaded", "error")},
        # Paquete FDA_movil: índice FDA (búsqueda semántica) y tabla de
        # contraindicaciones (verificador). Ninguno se carga aquí.
        "fda": {"index": rag_fda.status(), "contra": contra.status()},
    }

@router.get("/v1/llm/health")
def llm_health():
    return status()


class CompleteReq(BaseModel):
    """Generación cruda. La sirve el proceso dedicado al LLM (§4): el ASR delega
    aquí vía `MEGI_LLM_SERVICE_URL` y así nunca carga gemma en su propio proceso.
    `images`: rutas de imagen (PNG/JPG) para el último mensaje; se validan contra
    el mismo allowlist que `audio_path`, porque es el otro proceso quien las lee."""
    messages: list
    max_tokens: int = 512
    images: list[str] = []


@router.post("/v1/llm/complete")
def llm_complete(req: CompleteReq):
    images = [str(_check_audio_path(p)) for p in req.images]
    return {"text": complete(req.messages, req.max_tokens, images=images)}
