"""Contrato de la API del ASR service — red de seguridad del refactor (§4).

`server.py` se está partiendo en routers por dominio. Este test congela lo ÚNICO
que el backend MEGI ve: qué rutas existen y con qué campos se les habla. Si un
movimiento de código pierde un endpoint o renombra un campo del cuerpo, esto
falla aquí en vez de fallar a media consulta.

Se salta solo si no hay motor MLX en la máquina (necesita `MEGI_ENGINE_DIR`);
correrlo:  cd asr_service && <venv_mlx>/bin/python -m pytest tests/
"""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_ENGINE = os.environ.get("MEGI_ENGINE_DIR", "")
pytestmark = pytest.mark.skipif(
    not (_ENGINE and Path(_ENGINE).is_dir()),
    reason="requiere el motor MLX (exporta MEGI_ENGINE_DIR al bundle)",
)

# --- Inventario congelado (capturado del server.py monolítico, 2026-07-27) ---
ROUTES = {
    "/health": ["GET"],
    "/v1/llm/health": ["GET"],
    "/v1/llm/complete": ["POST"],
    "/v1/transcribe/file": ["POST"],
    "/v1/transcribe/identifier": ["POST"],
    "/v1/shadow/compare": ["POST"],
    "/v1/stream/general": ["WS"],
    "/v1/speaker/embed": ["POST"],
    "/v1/documents/suggest": ["POST"],
    "/v1/notes/extract": ["POST"],
    "/v1/notes/normalize_drugs": ["POST"],
    "/v1/preconsulta/personalize": ["POST"],
    "/v1/radiologia/estructurar": ["POST"],   # alta deliberada (M5, 9-sep-2026)
    "/v1/radiologia/analizar_imagen": ["POST"],   # lectura de imagen vía mlx_vlm (21-sep-2026)
    "/v1/command/parse": ["POST"],
    "/v1/drugs/consult": ["POST"],
    "/v1/drugs/alternatives": ["POST"],
    "/v1/drugs/interactions": ["POST"],
    "/v1/vademecum/enrich": ["POST"],
    "/v1/rag/search": ["POST"],
    "/v1/guidelines/chat": ["POST"],
    # Paquete FDA_movil (2026-09-16): índice FDA + tabla de contraindicaciones.
    "/v1/drugs/check": ["POST"],
    "/v1/rag/search_fda": ["POST"],
    "/v1/rag/status": ["GET"],
    "/v1/soap/extract_meds": ["POST"],
    "/v1/soap/extract_facts": ["POST"],
    "/v1/soap/extract_dx": ["POST"],
    "/v1/soap/update": ["POST"],
    "/v1/soap/finalize": ["POST"],
}

# Campos del cuerpo JSON de cada POST: es el contrato real con
# `backend/app/services/asr_client.py`.
BODIES = {
    "/v1/transcribe/file": ["audio_path", "consultation_id", "route", "speaker_ref"],
    "/v1/transcribe/identifier": ["audio_path", "consultation_id", "entity_type", "slot_id"],
    "/v1/shadow/compare": ["audio_path", "chunk_ms", "consultation_id"],
    "/v1/llm/complete": ["images", "max_tokens", "messages"],
    "/v1/speaker/embed": ["audio_path"],
    "/v1/documents/suggest": ["soap", "transcript"],
    "/v1/notes/extract": ["text"],
    "/v1/notes/normalize_drugs": ["items"],
    "/v1/preconsulta/personalize": ["base", "context"],
    "/v1/radiologia/estructurar": ["transcript"],
    "/v1/radiologia/analizar_imagen": ["image_paths", "indicacion", "modalidad", "region"],
    "/v1/command/parse": ["context", "text"],
    "/v1/drugs/consult": ["catalog_rules", "context_drugs", "question"],
    "/v1/drugs/alternatives": ["catalogo", "interaccion", "rx_list"],
    "/v1/drugs/interactions": ["candidatos", "clase", "farmaco"],
    "/v1/vademecum/enrich": ["generico"],
    "/v1/rag/search": ["k", "query", "tiers", "use_cases"],
    "/v1/rag/search_fda": ["k", "query", "tiers", "use_cases"],
    "/v1/drugs/check": ["age", "allergies", "conditions", "context_text", "embarazo", "rx_list", "sex"],
    "/v1/guidelines/chat": ["k", "question"],
    "/v1/soap/extract_meds": ["transcript"],
    "/v1/soap/extract_facts": ["transcript"],
    "/v1/soap/extract_dx": ["transcript"],
    "/v1/soap/update": ["consultation_id", "current_soap", "new_confirmed_text", "paciente"],
    "/v1/soap/finalize": ["consultation_id", "current_soap", "paciente", "transcript"],
}


@pytest.fixture(scope="module")
def app():
    import server
    return server.app


@pytest.fixture(scope="module")
def spec(app):
    return app.openapi()


def _inventory(app) -> dict:
    """Rutas efectivas. FastAPI envuelve los routers incluidos (`_IncludedRouter`),
    así que hay que descender: el inventario no puede depender de cómo los guarde."""
    out = {}

    def walk(routes):
        for r in routes:
            included = getattr(r, "original_router", None)
            if included is not None:
                walk(included.routes)
                continue
            path = getattr(r, "path", "")
            if path.startswith(("/health", "/v1")):
                out[path] = sorted(getattr(r, "methods", None) or ["WS"])

    walk(app.routes)
    return out


def test_no_endpoint_is_lost_or_renamed(app):
    assert _inventory(app) == ROUTES


def test_request_body_fields_are_stable(spec):
    schemas = spec["components"]["schemas"]
    got = {}
    for path, ops in spec["paths"].items():
        for op in ops.values():
            ref = (op.get("requestBody", {}).get("content", {})
                     .get("application/json", {}).get("schema", {}).get("$ref"))
            if ref:
                got[path] = sorted(schemas[ref.split("/")[-1]].get("properties", {}))
    assert got == BODIES


def test_health_still_reports_what_the_backend_reads(app):
    """El health-check activo del backend (§4) lee estas claves."""
    from fastapi.testclient import TestClient

    body = TestClient(app).get("/health").json()
    for key in ("status", "mlx", "engine_dir", "models", "normalizer", "streaming", "llm", "rag"):
        assert key in body, key
    assert set(body["models"]) == {"general", "identifier"}
    assert set(body["rag"]) == {"index_present", "loaded", "error"}


def test_audio_path_allowlist_still_applies_to_every_audio_route(app):
    """Hallazgo #4: ninguna ruta que acepte `audio_path` debe leer fuera de los
    directorios permitidos, sin importar en qué módulo acabe viviendo."""
    from fastapi.testclient import TestClient

    c = TestClient(app)
    for path, body in (
        ("/v1/transcribe/file", {"audio_path": "/etc/hosts"}),
        ("/v1/transcribe/identifier", {"audio_path": "/etc/hosts", "entity_type": "CURP"}),
        ("/v1/speaker/embed", {"audio_path": "/etc/hosts"}),
        ("/v1/shadow/compare", {"audio_path": "/etc/hosts"}),
        # Las imágenes son rutas que abre este proceso: mismo allowlist.
        ("/v1/radiologia/analizar_imagen", {"image_paths": ["/etc/hosts"]}),
        ("/v1/llm/complete", {"messages": [], "images": ["/etc/hosts"]}),
    ):
        r = c.post(path, json=body)
        assert r.status_code == 403, (path, r.status_code)
