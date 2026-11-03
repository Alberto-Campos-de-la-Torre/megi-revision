"""Etapa 2: catálogo de medicamentos — borrador -> aprobación firmada por token."""


def _mk(client, auth, generico="celecoxib", **extra):
    body = {"generico": generico, "clase": "AINE", "dosis_habitual": "200 mg", **extra}
    r = client.post("/api/medications", json=body, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def test_requires_auth(client):
    assert client.get("/api/medications").status_code == 401
    assert client.post("/api/medications", json={"generico": "x"}).status_code == 401


def test_create_approve_firma_con_token(client, auth):
    m = _mk(client, auth, "tramadol")
    assert m["estado"] == "borrador"
    assert m["aprobado_por"] is None

    r = client.post(f"/api/medications/{m['id']}/approve", headers=auth)
    assert r.status_code == 200
    a = r.json()
    assert a["estado"] == "aprobado"
    # La firma sale del TOKEN (usuario autenticado), nunca de texto libre.
    assert a["aprobado_por"] == "king"
    assert a["aprobado_en"]


def test_editar_campo_clinico_reabre_a_borrador(client, auth):
    m = _mk(client, auth, "gabapentina")
    client.post(f"/api/medications/{m['id']}/approve", headers=auth)

    r = client.patch(f"/api/medications/{m['id']}", json={"dosis_max_dia": "3600 mg"}, headers=auth)
    assert r.status_code == 200
    e = r.json()
    assert e["estado"] == "borrador"           # re-aprobación obligatoria
    assert e["aprobado_por"] is None
    assert e["dosis_max_dia"] == "3600 mg"


def test_duplicado_y_borrado(client, auth):
    m = _mk(client, auth, "naproxeno")
    assert client.post("/api/medications", json={"generico": "Naproxeno"}, headers=auth).status_code == 409

    # aprobado no se borra
    client.post(f"/api/medications/{m['id']}/approve", headers=auth)
    assert client.delete(f"/api/medications/{m['id']}", headers=auth).status_code == 409
    # de vuelta a borrador (editando) sí se puede borrar
    client.patch(f"/api/medications/{m['id']}", json={"clase": "aine"}, headers=auth)
    assert client.delete(f"/api/medications/{m['id']}", headers=auth).status_code == 200


def test_gpc_suggest_fail_closed_sin_asr(client, auth):
    m = _mk(client, auth, "diclofenaco")
    r = client.post(f"/api/medications/{m['id']}/gpc-suggest", headers=auth)
    assert r.status_code == 503  # mock: sin RAG/LLM


def test_lista_ordenada_y_filtrada(client, auth):
    r = client.get("/api/medications?estado=borrador", headers=auth)
    assert r.status_code == 200
    assert all(m["estado"] == "borrador" for m in r.json())


# ---- Etapa 3: interacciones ----
def _mk_ix(client, auth, a="tramadol", b="sertralina", sev="grave"):
    # inserta directo (la generación real requiere LLM); prueba el CRUD + firma
    from app.db import db
    from datetime import datetime, timezone
    fa, fb = sorted([a, b])
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO drug_interactions (farmaco_a, farmaco_b, severidad, mecanismo, "
            "recomendacion, fuente, estado, created_at) VALUES (?,?,?,?,?,'gemma_propuesta','borrador',?)",
            (fa, fb, sev, "síndrome serotoninérgico", "evitar combinación",
             datetime.now(timezone.utc).isoformat()),
        )
        return cur.lastrowid


def test_interaction_approve_firma_con_token(client, auth):
    iid = _mk_ix(client, auth)
    r = client.post(f"/api/drug-interactions/{iid}/approve", headers=auth)
    assert r.status_code == 200
    assert r.json()["estado"] == "aprobado"
    assert r.json()["aprobado_por"] == "king"


def test_interaction_edit_reabre_borrador(client, auth):
    iid = _mk_ix(client, auth, "amitriptilina", "tramadol")
    client.post(f"/api/drug-interactions/{iid}/approve", headers=auth)
    r = client.patch(f"/api/drug-interactions/{iid}", json={"severidad": "moderada"}, headers=auth)
    assert r.status_code == 200
    assert r.json()["estado"] == "borrador"
    assert r.json()["severidad"] == "moderada"


def test_interaction_generate_requires_two_approved(client, auth, tmp_path, monkeypatch):
    # En mock (sin ASR real) el endpoint falla-cerrado antes de tocar el LLM.
    r = client.post("/api/drug-interactions/generate", headers=auth)
    assert r.status_code == 503


def test_interaction_requires_auth(client):
    assert client.get("/api/drug-interactions").status_code == 401


# ---- Consultor de fármacos (tipo Drugs.com) ----
def test_consult_requires_auth(client):
    assert client.post("/api/drugs/consult", json={"question": "x"}).status_code == 401


def test_consult_fail_closed_sin_asr(client, auth):
    r = client.post("/api/drugs/consult", json={"question": "¿tramadol con sertralina?"}, headers=auth)
    assert r.status_code == 503  # mock: sin RAG/LLM


def test_consult_rechaza_pregunta_vacia(client, auth):
    r = client.post("/api/drugs/consult", json={"question": "  "}, headers=auth)
    assert r.status_code in (422, 503)  # vacío o fail-closed, nunca 200


def test_alternatives_fail_closed_sin_asr(client, auth):
    r = client.post("/api/drugs/alternatives", json={
        "rx_list": ["Tramadol", "Sertralina"], "farmaco_a": "tramadol", "farmaco_b": "sertralina",
    }, headers=auth)
    assert r.status_code == 503


def test_detect_drugs_del_catalogo():
    # el detector reconoce genéricos del catálogo dentro de la pregunta y la receta
    from app.routes.medications import _detect_drugs
    catalog = [
        {"generico": "tramadol", "terms": {"tramadol"}},
        {"generico": "sertralina", "terms": {"sertralina"}},
    ]
    found = _detect_drugs("¿puedo dar tramadol junto con otra cosa?", [], catalog)
    assert "tramadol" in found and "sertralina" not in found
    # incluye fármacos de la receta aunque no estén en la pregunta
    found2 = _detect_drugs("¿riesgo?", ["Sertralina 50 mg"], catalog)
    assert "sertralina" in found2


# ---------------------------------------------------------------- verificador FDA (FDA_movil)
def test_drugs_check_requiere_auth_y_receta(client, auth):
    assert client.post("/api/drugs/check", json={"rx_list": ["warfarina"]}).status_code == 401
    # sin ASR real: fail-closed (503), como el resto del consultor
    r = client.post("/api/drugs/check", json={"rx_list": ["warfarina"]}, headers=auth)
    assert r.status_code == 503


def test_drugs_check_pasa_receta_y_expediente_al_asr(client, auth, patient, monkeypatch):
    """Con ASR real (simulado): el backend completa alergias/crónicos/edad/sexo del
    expediente y devuelve las alertas TAL CUAL (cita y origen incluidos)."""
    from app.routes import medications
    from app.services import asr_client

    r = client.patch(f"/api/patients/{patient["id"]}/profile", json={"allergies": ["penicilina"], "chronic": ["ERC"]}, headers=auth)
    assert r.status_code == 200, r.text
    captured = {}

    def fake_check(rx_list, conditions, allergies, age, sex, embarazo, context_text=None):
        captured.update(rx=rx_list, conditions=conditions, allergies=allergies, age=age, sex=sex, embarazo=embarazo)
        return {"status": "done", "farmacos_detectados": ["amoxicillin"], "alertas_altas": 1, "resumen": {"absoluta": 1},
                "alertas": [{"tipo_alerta": "alergia", "farmaco": "amoxicillin", "objeto": "penicilinas",
                             "seccion": "CONTRAINDICATIONS", "severidad": "absoluta", "evidencias": 3,
                             "cita": "antecedentes de reacciones alérgicas a cualquier penicilina", "fuente": "es"}]}

    monkeypatch.setattr(medications, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "drugs_check", fake_check)
    r = client.post("/api/drugs/check", json={"rx_list": ["amoxicilina 500 mg"], "conditions": ["faringitis"],
                                              "patient_id": patient["id"]}, headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert captured["rx"] == ["amoxicilina 500 mg"]
    assert captured["conditions"] == ["faringitis", "ERC"]
    assert captured["allergies"] == ["penicilina"]
    assert captured["age"] == patient["age"] and captured["sex"] == patient["sex"]
    assert body["alertas"][0]["cita"] and body["alertas"][0]["fuente"] == "es"
    assert body["alertas_altas"] == 1 and "COFEPRIS" in body["nota"]

    monkeypatch.setattr(asr_client, "drugs_check", lambda *a, **k: {"status": "error", "error": "contra_db_not_available"})
    assert client.post("/api/drugs/check", json={"rx_list": ["x"]}, headers=auth).status_code == 502
    assert client.post("/api/drugs/check", json={"rx_list": []}, headers=auth).status_code == 422
