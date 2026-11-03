"""Health-check activo de servicios de modelo (§4 revisión 2026-07-12).

Lo que se protege: que la UI pueda distinguir "transcribiendo de verdad" de
"devolviendo mock" o "ASR caído". El flag de configuración por sí solo no lo
dice, y documentar sobre un transcript simulado es el error caro.
"""
import pytest

from app.services import health_probe


@pytest.fixture(autouse=True)
def _clear_cache():
    health_probe._cache.update(at=0.0, data=None)
    yield
    health_probe._cache.update(at=0.0, data=None)


def test_requires_session(client):
    assert client.get("/api/health/services").status_code == 401


def test_mock_mode_is_flagged_as_unsafe_to_document(client, auth):
    # La suite corre con MEGI_REAL_ASR=false: el backend NO debe decir que todo
    # está bien, porque lo que produciría son transcripts simulados.
    body = client.get("/api/health/services", headers=auth).json()
    assert body["transcription_mode"] == "mock"
    assert body["safe_to_document"] is False
    assert "SIMULADA" in body["warning"] or "simulad" in body["warning"].lower()
    assert body["services"]["asr"]["configured"] is False


def test_asr_down_is_distinguished_from_mock(client, auth, monkeypatch):
    """ASR configurado pero sin responder != ASR apagado a propósito."""
    monkeypatch.setattr(health_probe, "REAL_ASR", True)
    monkeypatch.setattr(health_probe, "_probe_asr", lambda: {
        "reachable": False, "latency_ms": 3, "detail": None,
        "error": "ConnectError: conexión rechazada",
    })
    body = client.get("/api/health/services", headers=auth).json()
    assert body["transcription_mode"] == "unavailable"
    assert body["safe_to_document"] is False
    assert "no responde" in body["warning"]
    assert body["services"]["asr"]["error"].startswith("ConnectError")


def test_healthy_asr_is_safe_to_document(client, auth, monkeypatch):
    monkeypatch.setattr(health_probe, "REAL_ASR", True)
    monkeypatch.setattr(health_probe, "_probe_asr", lambda: {
        "reachable": True, "latency_ms": 12, "error": None,
        "detail": {
            "status": "ok", "streaming": True,
            "models": {"general": "/m/v1.5", "identifier": "/m/v1.6A"},
            "llm": {"model": "gemma-4-26b", "loaded": True},
            "rag": {"index_present": True, "loaded": True, "error": None},
        },
    })
    body = client.get("/api/health/services", headers=auth).json()
    assert body["transcription_mode"] == "real"
    assert body["safe_to_document"] is True
    assert body["warning"] is None
    s = body["services"]
    assert s["asr"]["models_ok"] is True and s["asr"]["reachable"] is True
    assert s["llm"]["loaded"] is True
    assert s["rag"]["index_present"] is True


def test_missing_model_files_are_reported(client, auth, monkeypatch):
    monkeypatch.setattr(health_probe, "REAL_ASR", True)
    monkeypatch.setattr(health_probe, "_probe_asr", lambda: {
        "reachable": True, "latency_ms": 9, "error": None,
        "detail": {"status": "ok",
                   "models": {"general": "/m/v1.5", "identifier": "missing"},
                   "llm": {}, "rag": {}},
    })
    body = client.get("/api/health/services", headers=auth).json()
    # Responde, pero le falta un modelo: la ruta de identificadores no serviría.
    assert body["services"]["asr"]["models_ok"] is False


def test_probe_is_cached_between_calls(client, auth, monkeypatch):
    calls = {"n": 0}

    def _counting():
        calls["n"] += 1
        return {"reachable": True, "latency_ms": 1, "error": None,
                "detail": {"models": {"general": "/m", "identifier": "/m"}}}

    monkeypatch.setattr(health_probe, "REAL_ASR", True)
    monkeypatch.setattr(health_probe, "_probe_asr", _counting)
    for _ in range(4):
        client.get("/api/health/services", headers=auth)
    assert calls["n"] == 1, "la UI consulta en bucle: no debe sondear en cada petición"
