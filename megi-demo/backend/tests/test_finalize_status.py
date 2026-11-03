"""Estado de transporte vs veredicto clínico al consolidar la nota (21-sep-2026).

El ASR devuelve en `status` el veredicto de la validación ("ready",
"requires_review", "draft_only"). La pantalla espera "done" (= hay nota) y con
"ready" mostraba «La nota final no se generó (ready)» —en el MEJOR caso— y
bloqueaba «Finalizar y revisar». El backend separa las dos cosas."""
import pytest

from app.db import db
from app.routes import live
from app.services import asr_client


def _con_transcript(cid):
    with db() as conn:
        conn.execute("UPDATE consultations SET transcript = ? WHERE id = ?", ("tos seca de tres días", cid))


def _fake(status, con_soap=True, **extra):
    def f(transcript, cur, cid, paciente=None):
        out = {"status": status, "official_note": status == "ready",
               "clinical_facts": {}, "validation": {"status": status, "official_note": status == "ready",
                                                    "flags": [], "warnings": []}}
        if con_soap:
            out["soap"] = {"S": "tos seca", "O": "", "A": "IRA", "P": "reposo"}
        out.update(extra)
        return out
    return f


@pytest.mark.parametrize("clinico", ["ready", "requires_review", "draft_only"])
def test_cualquier_veredicto_clinico_con_nota_es_done(client, auth, consultation, monkeypatch, clinico):
    _con_transcript(consultation["id"])
    monkeypatch.setattr(live, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "soap_finalize", _fake(clinico))
    r = client.post("/api/soap/finalize", json={"consultation_id": consultation["id"]}, headers=auth).json()
    assert r["status"] == "done"
    assert r["clinical_status"] == clinico                 # el veredicto no se pierde
    assert r["validation"]["status"] == clinico
    assert r["official_note"] is (clinico == "ready")
    assert r["soap"]["A"] == "IRA"

    with db() as conn:
        row = conn.execute("SELECT final_soap FROM consultations WHERE id = ?", (consultation["id"],)).fetchone()
        ev = conn.execute("SELECT payload FROM review_events WHERE consultation_id = ? AND kind = 'soap_finalize' "
                          "ORDER BY id DESC LIMIT 1", (consultation["id"],)).fetchone()
    assert row["final_soap"] and "IRA" in row["final_soap"]
    assert f'"clinical_status": "{clinico}"' in ev["payload"]


def test_un_error_del_asr_sigue_siendo_error(client, auth, consultation, monkeypatch):
    _con_transcript(consultation["id"])
    monkeypatch.setattr(live, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "soap_finalize", _fake("error", con_soap=False, error="llm_no_disponible"))
    r = client.post("/api/soap/finalize", json={"consultation_id": consultation["id"]}, headers=auth).json()
    assert r["status"] == "error" and "clinical_status" not in r


def test_sin_soap_en_la_respuesta_no_se_finge_exito(client, auth, consultation, monkeypatch):
    _con_transcript(consultation["id"])
    monkeypatch.setattr(live, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "soap_finalize", _fake("ready", con_soap=False))
    r = client.post("/api/soap/finalize", json={"consultation_id": consultation["id"]}, headers=auth).json()
    assert r["status"] == "ready"        # se deja tal cual: la pantalla lo tratará como no generada
