"""Megi IA en Revisión: contexto de ESA consulta y ESE paciente, nada más."""
import json

import pytest


@pytest.fixture()
def consulta_con_datos(client, auth, patient):
    from app.db import db
    # consulta previa del mismo paciente
    prev = client.post("/api/consultations", json={"patient_id": patient["id"], "motivo": "gastritis"}, headers=auth).json()
    with db() as conn:
        conn.execute("UPDATE consultations SET final_soap = ?, dx_codes = ?, prescription = ?, status = 'approved' WHERE id = ?",
                     (json.dumps({"S": "ardor epigástrico", "O": "", "A": "Gastritis", "P": "omeprazol"}),
                      json.dumps([{"code": "K29.7", "label": "Gastritis"}]), json.dumps([{"drug": "Omeprazol", "dose": "20 mg", "freq": "cada 24 h"}]), prev["id"]))
    # consulta actual, con transcripción y SOAP automático
    cur = client.post("/api/consultations", json={"patient_id": patient["id"], "motivo": "dolor de garganta"}, headers=auth).json()
    with db() as conn:
        conn.execute("UPDATE consultations SET transcript = ?, soap = ?, prescription = ?, vitals = ? WHERE id = ?",
                     ("Doctor: ¿qué le pasa? Paciente: me duele la garganta desde hace tres días y tengo fiebre. Doctor: le voy a dar amoxicilina.",
                      json.dumps({"S": "Dolor de garganta de 3 días con fiebre", "O": "Faringe hiperémica", "A": "Faringitis aguda", "P": "Amoxicilina 500 mg cada 8 h"}),
                      json.dumps([{"drug": "Amoxicilina", "dose": "500 mg", "freq": "cada 8 horas"}]), json.dumps({"temp": "38.4"}), cur["id"]))
    return cur, prev


def test_contexto_solo_de_esta_consulta_y_este_paciente(client, auth, patient, consulta_con_datos):
    from app.db import db
    from app.services import consulta_contexto as cc
    cur, prev = consulta_con_datos
    # otro paciente del mismo médico: NO debe aparecer
    otro = client.post("/api/patients", json={"name": "Otro Paciente", "age": 60, "sex": "M", "reason": "lumbalgia", "kind": "espontaneo"}, headers=auth).json()
    client.post("/api/consultations", json={"patient_id": otro["id"], "motivo": "lumbalgia"}, headers=auth)
    with db() as conn:
        ctx = cc.construir_contexto(conn, cur["id"], soap_editado={"S": "", "O": "", "A": "Faringitis estreptocócica", "P": "Amoxicilina"})
    assert "[T] TRANSCRIPCIÓN ORIGINAL" in ctx and "me duele la garganta" in ctx
    assert "[SA] SOAP AUTOMÁTICO" in ctx and "Faringe hiperémica" in ctx
    assert "[SL] SOAP LIMPIO (en edición por el médico ahora)" in ctx and "Faringitis estreptocócica" in ctx
    assert "[RX] RECETA: Amoxicilina 500 mg cada 8 horas" in ctx and "[SV] SIGNOS VITALES: temp 38.4" in ctx
    assert "[C1]" in ctx and "gastritis" in ctx and "Omeprazol" in ctx          # consulta previa del MISMO paciente
    assert "Otro Paciente" not in ctx and "lumbalgia" not in ctx                # otro paciente: fuera
    assert cur["id"] not in ctx and prev["id"] not in ctx and "king" not in ctx  # sin ids ni usuarios


def test_preguntar_mock_y_real(client, auth, consulta_con_datos, monkeypatch):
    cur, _ = consulta_con_datos
    url = f"/api/consultations/{cur['id']}/preguntar"
    r = client.post(url, json={"pregunta": "¿qué antibiótico se le dio y por qué?"}, headers=auth).json()
    assert r["fuente"] == "mock" and "Amoxicilina" in r["respuesta"] or "amoxicilina" in r["respuesta"].lower()
    r = client.post(url, json={"pregunta": "¿qué tomaba antes para el estómago?"}, headers=auth).json()
    assert "Omeprazol" in r["respuesta"]
    r = client.post(url, json={"pregunta": "¿resonancia de rodilla?"}, headers=auth).json()
    assert r["respuesta"].startswith("No está en la información disponible")
    assert client.post(url, json={"pregunta": "  "}, headers=auth).json()["error"] == "pregunta vacía"

    from app.services import asr_client, consulta_contexto
    monkeypatch.setattr(consulta_contexto, "REAL_ASR", True)
    visto = {}
    def fake(contexto, pregunta, historial, k=5):
        visto.update(contexto=contexto, pregunta=pregunta, historial=historial)
        return {"status": "done", "respuesta": "La GPC recomienda penicilina [S1]; la nota omite la alergia [SL].", "fuentes": [{"citation_id": "S1", "citation": "GPC Faringoamigdalitis"}], "model": "gemma-test"}
    monkeypatch.setattr(asr_client, "consulta_preguntar", fake)
    r = client.post(url, json={"pregunta": "¿es correcto el antibiótico?", "historial": [{"rol": "medico", "texto": "hola"}],
                               "soap": {"S": "", "O": "", "A": "Faringitis", "P": "Amoxicilina"}, "rx": [{"drug": "Amoxicilina", "dose": "500 mg"}]}, headers=auth).json()
    assert r["fuente"] == "llm" and r["fuentes"][0]["citation_id"] == "S1" and r["modelo"] == "gemma-test"
    assert "[SL] SOAP LIMPIO (en edición" in visto["contexto"] and visto["historial"] == [{"rol": "medico", "texto": "hola"}]


def test_consulta_ajena_404(client, auth, consulta_con_datos):
    cur, _ = consulta_con_datos
    r = client.post("/api/users", json={"username": "dra_x", "password": "clave12345", "role": "medico", "name": "X"}, headers=auth)
    tok = client.post("/api/auth/login", json={"username": "dra_x", "password": "clave12345"}).json()["token"]
    r = client.post("/api/auth/change-password", json={"current_password": "clave12345", "new_password": "clave67890"}, headers={"Authorization": f"Bearer {tok}"})
    otra = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.post(f"/api/consultations/{cur['id']}/preguntar", json={"pregunta": "¿qué tiene?"}, headers=otra).status_code == 404
