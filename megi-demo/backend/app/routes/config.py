from fastapi import APIRouter, Depends

from .. import phi_at_rest
from ..security import require_user
from .me import profile_of
from ..config import (
    ASR_SERVICE_URL,
    MODE,
    MODES_SUPPORTED,
    MODEL_REGISTRY,
    REAL_ASR,
    REAL_INFERENCE,
    load_seed,
)

router = APIRouter()


@router.get("/config")
def get_config(user: dict = Depends(require_user)):
    return {
        "mode": MODE,
        "modes_supported": MODES_SUPPORTED,
        "models": MODEL_REGISTRY,
        "features": {
            "real_inference": REAL_INFERENCE,
            "real_asr": REAL_ASR,
            "asr_service_url": ASR_SERVICE_URL,
        },
        # PHI en reposo: el disco cifrado es el control vigente (#7). null = no
        # se pudo determinar (p. ej. fuera de macOS).
        "security": {"disk_encryption": phi_at_rest.filevault_enabled()},
        # El perfil que se imprime es el del médico que ha iniciado sesión.
        # Antes era `seed["DOCTOR"]`, único para toda la instalación: con varios
        # médicos eso significaba imprimir la cédula de otro.
        "doctor": profile_of(user["username"]),
    }


@router.get("/clinical")
def get_clinical():
    seed = load_seed()
    return {k: seed[k] for k in ["TRANSCRIPT", "SUGGESTED_DX", "SUGGESTED_RX", "VITALS", "SOAP", "FLAGS"]}
