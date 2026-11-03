from fastapi import APIRouter, Depends

from ..config import BUILD_ID, MODE
from ..security import require_user
from ..services import health_probe

router = APIRouter()


@router.get("/health")
def health():
    # `build` lo compara el frontend con el suyo: si no coinciden, la app avisa
    # de que hay que ejecutar `megi update` (ver components/service_health.jsx).
    return {"status": "ok", "mode": MODE, "build": BUILD_ID}


@router.get("/health/services")
def services_health(user: dict = Depends(require_user)):
    """Salud REAL de los servicios de modelo (§4): pregunta al ASR en vez de
    confiar en el flag de configuración. La UI lo usa para avisar cuando la
    transcripción sería simulada. Este router es público a nivel de app, así que
    la sesión se exige aquí, en el endpoint."""
    return health_probe.probe()
