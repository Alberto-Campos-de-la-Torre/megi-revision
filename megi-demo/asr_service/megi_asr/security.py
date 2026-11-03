"""Auth compartida backend<->ASR y allowlist de `audio_path` (hallazgo #4)."""
import os
from pathlib import Path

from fastapi import HTTPException

from .config import SERVICE_DIR

# ------------------------------------------------- seguridad local (rev. 2026-07-12)
# Hallazgo #4: sin esto, cualquier proceso local podía pedir transcribir/embeber
# cualquier archivo legible. Dos capas independientes:
#   1) audio_path restringido a MEGI_ASR_AUDIO_DIRS (default: backend/data).
#   2) si MEGI_ASR_TOKEN está definido (mismo valor en el backend), toda petición
#      HTTP (salvo /health) y el WS exigen la cabecera X-MEGI-ASR-Token.
ASR_TOKEN = os.environ.get("MEGI_ASR_TOKEN", "").strip()
_DEFAULT_AUDIO_DIRS = str(SERVICE_DIR.parent / "backend" / "data")
ALLOWED_AUDIO_DIRS = [
    Path(p).expanduser().resolve()
    for p in os.environ.get("MEGI_ASR_AUDIO_DIRS", _DEFAULT_AUDIO_DIRS).split(":")
    if p.strip()
]


def _token_ok(provided: str) -> bool:
    import hmac as _hmac
    return bool(ASR_TOKEN) and _hmac.compare_digest(provided or "", ASR_TOKEN)


def _check_audio_path(path: str) -> Path:
    p = Path(path).expanduser().resolve()
    for d in ALLOWED_AUDIO_DIRS:
        try:
            p.relative_to(d)
            return p
        except ValueError:
            continue
    raise HTTPException(
        status_code=403,
        detail="audio_path fuera de los directorios permitidos (MEGI_ASR_AUDIO_DIRS)",
    )
