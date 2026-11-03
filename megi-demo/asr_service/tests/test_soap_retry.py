"""El escriba reintenta UNA vez cuando el LLM no devuelve JSON (routers/soap.py).

Medido en consulta real: el primer chunk (preámbulo del paciente) volvió sin JSON
y se perdieron 20 s de consulta —antecedente y radiografía—. Con el reintento el
chunk se salva si el segundo intento sí es JSON; si no, se reporta invalid_json
con la cola de la respuesta para diagnosticarlo."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_ENGINE = os.environ.get("MEGI_ENGINE_DIR", "")
pytestmark = pytest.mark.skipif(not (_ENGINE and Path(_ENGINE).is_dir()),
                                reason="requiere el motor MLX (exporta MEGI_ENGINE_DIR al bundle)")


@pytest.fixture()
def cliente(monkeypatch):
    from fastapi.testclient import TestClient
    import server
    from megi_asr.routers import soap
    monkeypatch.setattr(soap, "available", lambda: {"error": None})
    monkeypatch.setattr(soap, "_retrieve", lambda t, s: ([], {"needs_rag": False, "reason": "test"}, ""))
    return TestClient(server.app), soap


def test_reintenta_y_salva_el_chunk(cliente):
    c, soap = cliente
    llamadas = []
    def fake_complete(msgs, max_tokens):
        llamadas.append(msgs[0]["content"])
        if len(llamadas) == 1:
            return "Claro, aquí va la nota: el paciente refiere dolor..."      # prosa, sin JSON
        return '{"soap_patch": [{"section": "S", "action": "upsert", "text": "Dolor en rodilla.", "citations": []}], "warnings": []}'
    soap.complete = fake_complete
    r = c.post("/v1/soap/update", json={"consultation_id": "C-t", "new_confirmed_text": "dolor en rodilla", "current_soap": {}}).json()
    assert r["status"] == "done" and r["soap_patch"][0]["text"] == "Dolor en rodilla."
    assert len(llamadas) == 2 and "no fue JSON valido" in llamadas[1]


def test_si_el_reintento_tambien_falla_lo_dice_con_la_cola(cliente):
    c, soap = cliente
    soap.complete = lambda msgs, max_tokens: "sigo sin JSON " * 5
    r = c.post("/v1/soap/update", json={"consultation_id": "C-t", "new_confirmed_text": "dolor en rodilla", "current_soap": {}}).json()
    assert r["status"] == "invalid_json" and "sigo sin JSON" in r["raw"]
