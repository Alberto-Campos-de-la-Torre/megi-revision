"""Resumen del expediente y preguntas sobre el paciente.

En la suite corre `local_mock`: el backend responde sin modelo (`fuente: mock`)
y lo que dice tiene que salir del expediente, no de una plantilla. También se
comprueba la vía real con el servicio MLX simulado, y que un paciente ajeno
sea 404 (misma regla que el resto del expediente).
"""
import json


def _consulta_con_nota(client, auth, patient, nota, receta=None, dx=None):
    r = client.post("/api/consultations", json={"patient_id": patient["id"]}, headers=auth)
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    from app.db import db
    with db() as conn:
        conn.execute(
            "UPDATE consultations SET final_soap = ?, prescription = ?, dx_codes = ?, vitals = ? WHERE id = ?",
            (json.dumps(nota, ensure_ascii=False), json.dumps(receta or [], ensure_ascii=False),
             json.dumps(dx or [], ensure_ascii=False), json.dumps({"ta": "130/85", "temp": "37.9"}), cid),
        )
    return cid


def test_expediente_estructurado_y_resumen_mock(client, auth, patient):
    cid = _consulta_con_nota(
        client, auth, patient,
        {"S": "Dolor de garganta de tres días", "O": "Faringe hiperémica", "A": "Faringitis aguda", "P": "Paracetamol"},
        receta=[{"drug": "Paracetamol", "dose": "500 mg", "freq": "cada 8 horas"}],
        dx=[{"code": "J02.9", "label": "Faringitis aguda"}],
    )
    r = client.post("/api/documents", json={
        "consultation_id": cid, "patient_id": patient["id"], "kind": "referencia",
        "content": {"servicio": "Otorrinolaringología", "motivo": "valoración"},
    }, headers=auth)
    assert r.status_code == 200, r.text

    e = client.get(f"/api/patients/{patient['id']}/expediente", headers=auth)
    assert e.status_code == 200
    exp = e.json()
    assert exp["conteos"]["consultas"] >= 1 and exp["conteos"]["envios"] == 1
    assert exp["consultas"][0]["dx"] == ["J02.9 Faringitis aguda"]
    assert exp["consultas"][0]["receta"] == ["Paracetamol 500 mg cada 8 horas"]
    assert exp["documentos"][0]["detalle"] == "Otorrinolaringología · valoración"

    s = client.post(f"/api/patients/{patient['id']}/expediente/resumen", headers=auth)
    assert s.status_code == 200
    d = s.json()
    assert d["fuente"] == "mock"
    # El resumen sale del expediente: dx, tratamiento, envío y signos vitales.
    for frag in ("Faringitis aguda", "Paracetamol", "Otorrinolaringología", "130/85"):
        assert frag in d["resumen"], d["resumen"]
    assert "Sin estudios de imagen" in d["resumen"]
    assert d["aviso"]


def test_preguntar_mock_busca_en_el_expediente(client, auth, patient):
    _consulta_con_nota(client, auth, patient,
                       {"S": "Tos seca de dos semanas", "O": "", "A": "Bronquitis", "P": "Ambroxol"},
                       receta=[{"drug": "Ambroxol", "dose": "30 mg", "freq": "cada 8 horas"}])
    url = f"/api/patients/{patient['id']}/expediente/preguntar"

    r = client.post(url, json={"pregunta": "¿Qué medicamento se le recetó?"}, headers=auth).json()
    assert r["fuente"] == "mock" and "Ambroxol" in r["respuesta"]

    r = client.post(url, json={"pregunta": "¿Tiene alergias?"}, headers=auth).json()
    assert "alergias" in r["respuesta"].lower()

    r = client.post(url, json={"pregunta": "¿Le hicieron resonancia de rodilla?"}, headers=auth).json()
    assert r["respuesta"].startswith("No encuentro")

    r = client.post(url, json={"pregunta": "   "}, headers=auth).json()
    assert r["error"] == "pregunta vacía"


def test_modo_real_usa_el_servicio_y_cae_a_sin_modelo(client, auth, patient, monkeypatch):
    from app import config
    from app.services import asr_client

    monkeypatch.setattr(config, "REAL_ASR", True)
    llamadas = {}

    def fake_resumen(texto):
        llamadas["texto"] = texto
        return {"status": "done", "resumen": "Resumen redactado [C1].", "model": "gemma-test", "latency_ms": 5}

    def fake_pregunta(texto, pregunta, historial):
        llamadas["historial"] = historial
        return {"status": "done", "respuesta": "No esta en el expediente.", "model": "gemma-test"}

    monkeypatch.setattr(asr_client, "expediente_resumen", fake_resumen)
    monkeypatch.setattr(asr_client, "expediente_preguntar", fake_pregunta)

    d = client.post(f"/api/patients/{patient['id']}/expediente/resumen", headers=auth).json()
    assert d["fuente"] == "llm" and d["resumen"] == "Resumen redactado [C1]." and d["modelo"] == "gemma-test"
    assert "PACIENTE:" in llamadas["texto"] and patient["name"] in llamadas["texto"]

    d = client.post(f"/api/patients/{patient['id']}/expediente/preguntar",
                    json={"pregunta": "¿fuma?", "historial": [{"rol": "medico", "texto": "hola"}, {"texto": ""}]},
                    headers=auth).json()
    assert d["fuente"] == "llm" and llamadas["historial"] == [{"rol": "medico", "texto": "hola"}]

    # Servicio caído: el médico sigue viendo el ordenamiento del expediente, marcado.
    def boom(*a, **k):
        raise RuntimeError("conexión rechazada")
    monkeypatch.setattr(asr_client, "expediente_resumen", boom)
    d = client.post(f"/api/patients/{patient['id']}/expediente/resumen", headers=auth).json()
    assert d["fuente"] == "sin_modelo" and "conexión rechazada" in d["error"] and d["resumen"]


def test_expediente_de_paciente_ajeno_es_404(client, auth, patient):
    r = client.post("/api/users", json={"username": "otro_med", "password": "clave12345", "role": "medico",
                                        "name": "Otro"}, headers=auth)
    assert r.status_code == 200, r.text
    tok = client.post("/api/auth/login", json={"username": "otro_med", "password": "clave12345"}).json()["token"]
    otro = {"Authorization": f"Bearer {tok}"}
    r = client.post("/api/auth/change-password",
                    json={"current_password": "clave12345", "new_password": "clave67890"}, headers=otro)
    otro = {"Authorization": f"Bearer {r.json()['token']}"}
    for path, method in ((f"/api/patients/{patient['id']}/expediente", "get"),
                         (f"/api/patients/{patient['id']}/expediente/resumen", "post")):
        resp = getattr(client, method)(path, headers=otro)
        assert resp.status_code == 404, (path, resp.text)
    resp = client.post(f"/api/patients/{patient['id']}/expediente/preguntar", json={"pregunta": "¿qué tiene?"}, headers=otro)
    assert resp.status_code == 404
