"""Health-check ACTIVO de los servicios de modelo (§4, revisión 2026-07-12).

El problema que resuelve: `MEGI_REAL_ASR` es **configuración, no salud**. Si el
ASR service está caído (o el flag está en false), varias rutas devuelven
transcript mock con la misma forma que el real, y nada en la UI lo grita: se
puede documentar una consulta con un transcript inventado sin enterarse.

Aquí se pregunta de verdad al servicio y se traduce a una sola conclusión que el
frontend pueda mostrar sin interpretar nada: `transcription_mode` y
`safe_to_document`. El resultado se cachea unos segundos porque la UI lo pide en
bucle.
"""
import time

import httpx

from ..config import ASR_SERVICE_URL, ASR_TOKEN, BUILD_ID, MODE, REAL_ASR

_TIMEOUT = 2.5
_CACHE_TTL = 5.0
_cache = {"at": 0.0, "data": None}

# Qué significa cada modo para quien documenta la consulta.
_MODE_COPY = {
    "real": None,
    "mock": ("Transcripción SIMULADA: el ASR real está desactivado "
             "(MEGI_REAL_ASR=false). No documentes una consulta con este texto."),
    "unavailable": ("El servicio de ASR no responde: no se puede transcribir. "
                    "Revisa que esté arriba en el puerto 8010 antes de continuar."),
}


def _probe_asr() -> dict:
    headers = {"X-MEGI-ASR-Token": ASR_TOKEN} if ASR_TOKEN else {}
    t0 = time.time()
    try:
        r = httpx.get(f"{ASR_SERVICE_URL}/health", timeout=_TIMEOUT, headers=headers)
        r.raise_for_status()
        body = r.json()
        return {"reachable": True, "latency_ms": int((time.time() - t0) * 1000),
                "detail": body, "error": None}
    except Exception as e:
        return {"reachable": False, "latency_ms": int((time.time() - t0) * 1000),
                "detail": None, "error": f"{type(e).__name__}: {e}"}


def probe(force: bool = False) -> dict:
    now = time.time()
    if not force and _cache["data"] and (now - _cache["at"]) < _CACHE_TTL:
        return _cache["data"]

    asr = _probe_asr() if REAL_ASR else {"reachable": False, "latency_ms": 0,
                                         "detail": None, "error": "no_configurado"}
    if not REAL_ASR:
        mode = "mock"
    elif asr["reachable"]:
        mode = "real"
    else:
        mode = "unavailable"

    d = asr.get("detail") or {}
    models = d.get("models") or {}
    rag = d.get("rag") or {}
    llm = d.get("llm") or {}
    data = {
        "mode": MODE,
        # Versión del backend: la UI la compara con la suya y avisa si no
        # coinciden (frontend construido != servidor en marcha).
        "build": BUILD_ID,
        "transcription_mode": mode,
        "safe_to_document": mode == "real",
        "warning": _MODE_COPY.get(mode),
        "services": {
            "asr": {
                "configured": REAL_ASR,
                "reachable": asr["reachable"],
                "latency_ms": asr["latency_ms"],
                "url": ASR_SERVICE_URL,
                "error": asr["error"],
                "models_ok": bool(models) and "missing" not in models.values(),
                "streaming": d.get("streaming"),
            },
            # El LLM (escriba/RAG) y el RAG viven en el mismo proceso MLX; se
            # reportan por separado porque degradan por separado.
            "llm": {"model": llm.get("model"), "loaded": llm.get("loaded")},
            "rag": {"index_present": rag.get("index_present"),
                    "loaded": rag.get("loaded"), "error": rag.get("error")},
        },
        "checked_at": now,
    }
    _cache.update(at=now, data=data)
    return data
