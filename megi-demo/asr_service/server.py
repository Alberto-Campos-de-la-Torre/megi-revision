"""MEGI ASR Service — microservicio de inferencia real (Python 3.14 + MLX).

Corre con el venv del motor y reutiliza el engine existente sin vendorizarlo:
lo importa por ruta (`MEGI_ENGINE_DIR`, ver `megi_asr/config.py`).

Este archivo es SOLO la composición del servicio (§4 de la revisión 2026-07-12:
antes concentraba 1 900 líneas con transcripción, SOAP, vademécum, RAG, huella
vocal y comandos juntos). Cada dominio vive ahora en `megi_asr/routers/` y lo
compartido en `megi_asr/`. El punto de entrada no cambia: `uvicorn server:app`.

Contrato de la API (congelado en `tests/test_api_contract.py`):
  GET  /health                    -> estado para el health-check del backend
  POST /v1/transcribe/file        -> ruta general  (megi-medical-v1.5)
  POST /v1/transcribe/identifier  -> ruta IDs      (v1.6A + resolver_v1.1)
  WS   /v1/stream/general         -> streaming en vivo (shadow del batch)
  ... y el resto de dominios: soap, drugs, notes, knowledge, speaker.

El backend MEGI (py3.9) es cliente de este servicio; aquí NO hay DB ni UI.
"""
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from megi_asr.llm import preload_if_configured
from megi_asr.security import ASR_TOKEN, _token_ok
from megi_asr.routers import (
    drugs,
    knowledge,
    notes,
    soap,
    speaker,
    stream,
    system,
    transcription,
)

app = FastAPI(title="MEGI ASR Service", version="0.1.0")


@app.middleware("http")
async def require_asr_token(request, call_next):
    """Auth compartida backend<->ASR (activa solo si MEGI_ASR_TOKEN está definido).
    /health queda abierto para health-checks sin credenciales."""
    if ASR_TOKEN and request.url.path != "/health":
        if not _token_ok(request.headers.get("x-megi-asr-token", "")):
            return JSONResponse(
                status_code=401,
                content={"detail": "X-MEGI-ASR-Token inválido o ausente"},
            )
    return await call_next(request)


for _router in (system, transcription, speaker, stream, soap, drugs, notes, knowledge):
    app.include_router(_router.router)

# Proceso dedicado al LLM (MEGI_LLM_PRELOAD=1): carga gemma AHORA, no a media
# consulta. Medido: la carga en caliente multiplica ×6 la latencia del ASR.
preload_if_configured()
