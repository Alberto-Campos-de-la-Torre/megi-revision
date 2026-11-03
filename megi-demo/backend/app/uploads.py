"""Guardas de almacenamiento para audio subido (auditoría de seguridad 2026-07-26).

Dos problemas que se arreglan aquí, en un solo sitio para que ninguna ruta se
quede fuera:

  A) `consultation_id` llegaba en un Form y se concatenaba a SESSIONS_DIR sin
     validar: un id con `../` escribía archivos FUERA del directorio de sesiones
     (verificado). `safe_session_dir()` valida el formato y además comprueba
     contención real de la ruta.
  G) `/audio/upload` y `/audio/chunk` hacían `await file.read()` sin tope (los
     endpoints de voz sí tenían límite). `read_capped()` corta en el límite y
     responde 413 sin cargar el resto en memoria.
"""
import re
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .config import SESSIONS_DIR

# Los ids los genera el servidor ("C-<hex8>", "A-<hex8>", "VC-<hex8>"...). Se
# acepta un alfabeto conservador: sin separadores de ruta, sin puntos, sin NUL.
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# Extensión del archivo original (viene del navegador: .webm, .wav, .m4a...).
_SAFE_EXT = re.compile(r"^\.[A-Za-z0-9]{1,8}$")

# Consulta completa dictada (webm/opus): holgado pero acotado.
MAX_CONSULTATION_AUDIO_BYTES = 50 * 1024 * 1024
# Chunk de streaming: son segundos de audio.
MAX_CHUNK_AUDIO_BYTES = 10 * 1024 * 1024


def safe_id(value: str, field: str = "consultation_id") -> str:
    v = (value or "").strip()
    if not _SAFE_ID.match(v):
        raise HTTPException(status_code=422, detail=f"{field} inválido")
    return v


def safe_session_dir(consultation_id: str, *parts: str) -> Path:
    """Directorio de la consulta dentro de SESSIONS_DIR, a prueba de traversal.

    Valida el id y, como defensa en profundidad, verifica que la ruta resuelta
    siga cayendo dentro de SESSIONS_DIR (protege también de symlinks)."""
    cid = safe_id(consultation_id)
    safe_parts = [safe_id(p, "path") for p in parts]
    path = SESSIONS_DIR.joinpath(cid, *safe_parts)
    try:
        path.resolve().relative_to(SESSIONS_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=422, detail="consultation_id inválido")
    return path


def safe_suffix(filename: str, default: str = ".webm") -> str:
    """Extensión del archivo subido, saneada (el nombre lo elige el cliente)."""
    ext = Path(filename or "").suffix
    return ext if _SAFE_EXT.match(ext) else default


async def read_capped(file: UploadFile, max_bytes: int, what: str) -> bytes:
    """Lee el upload sin pasar de `max_bytes` (413 en cuanto se excede)."""
    chunks = bytearray()
    while True:
        piece = await file.read(1024 * 1024)
        if not piece:
            break
        chunks += piece
        if len(chunks) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail="%s demasiado grande (máx. %d MB)." % (what, max_bytes // (1024 * 1024)),
            )
    return bytes(chunks)
