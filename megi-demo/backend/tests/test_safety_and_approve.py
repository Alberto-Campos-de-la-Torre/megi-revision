"""Lo CRÍTICO: alerta receta×alergias (server-side) y gate de aprobación (#1, #3)."""


def _check(client, auth, drug, allergy, chronic=None):
    return client.post("/api/safety/rx-check", json={
        "rx_list": [{"drug": drug}], "allergies": [allergy] if allergy else [], "chronic": chronic or [],
    }, headers=auth).json()


def test_allergy_blocker(client, auth):
    assert _check(client, auth, "Amoxicilina", "Penicilina")["blockers"] == 1


def test_allergy_plurals_and_variants(client, auth):
    # #3: falsos negativos por plurales
    assert _check(client, auth, "Amoxicilina", "Penicilinas")["blockers"] >= 1
    assert _check(client, auth, "Sulfametoxazol con trimetoprim", "Sulfas")["blockers"] >= 1


def test_no_false_positive(client, auth):
    assert _check(client, auth, "Paracetamol", "Penicilina", ["HTA"])["blockers"] == 0


def test_disease_warning(client, auth):
    r = _check(client, auth, "Ibuprofeno", None, ["HTA"])
    assert r["warnings"] >= 1


# ---- La condición se escribe como se dice, no con la sigla -----------------
# El médico teclea "Enfermedad renal crónica estadio 3b" en el perfil, no "ERC".
# Metformina y sulfonilurea solo listaban ["erc", "insuficiencia renal", ...], así
# que con esa redacción NO alertaban — mientras el AINE, que sí acepta "renal" a
# secas, alertaba en el mismo paciente. La alerta clínica no puede depender de
# cómo se escribió el padecimiento.
ERC_REDACCIONES = [
    "ERC estadio 3b",
    "Enfermedad renal crónica estadio 3b",
    "Insuficiencia renal crónica",
    "Nefropatía diabética",
]


def test_riesgo_renal_alerta_se_escriba_como_se_escriba(client, auth):
    for farmaco in ("Metformina 850 mg", "Glibenclamida 5 mg", "Ibuprofeno 400 mg"):
        for cronico in ERC_REDACCIONES:
            r = _check(client, auth, farmaco, None, [cronico])
            assert r["warnings"] >= 1, f"{farmaco} no alertó con crónico '{cronico}'"


def test_sin_enfermedad_renal_no_inventa_alerta(client, auth):
    for farmaco in ("Metformina 850 mg", "Glibenclamida 5 mg"):
        assert _check(client, auth, farmaco, None, ["Asma"])["warnings"] == 0
        assert _check(client, auth, farmaco, None, [])["warnings"] == 0


# ---- Etapa 4: interacciones fármaco-fármaco desde el catálogo aprobado ----
def _seed_ix(generico_a, generico_b, sev, ap=True):
    """Aprueba dos medicamentos y una interacción entre ellos (catálogo real)."""
    from datetime import datetime, timezone
    from app.db import db
    now = datetime.now(timezone.utc).isoformat()
    a, b = sorted([generico_a, generico_b])
    with db() as conn:
        for g in (generico_a, generico_b):
            conn.execute(
                "INSERT OR IGNORE INTO medications (generico, sinonimos, clase, estado, created_at, "
                "aprobado_por, aprobado_en) VALUES (?,?,?,?,?,?,?)",
                (g, "[]", "", "aprobado", now, "king", now))
        conn.execute("DELETE FROM drug_interactions WHERE farmaco_a=? AND farmaco_b=?", (a, b))
        conn.execute(
            "INSERT INTO drug_interactions (farmaco_a, farmaco_b, severidad, mecanismo, recomendacion, "
            "fuente, estado, created_at) VALUES (?,?,?,?,?,'test',?,?)",
            (a, b, sev, "mec", "rec", "aprobado" if ap else "borrador", now))


def test_interaccion_grave_bloquea(client, auth):
    _seed_ix("tramadol", "sertralina", "grave")
    r = client.post("/api/safety/rx-check", json={
        "rx_list": [{"drug": "Tramadol 50 mg"}, {"drug": "Sertralina 50 mg"}],
        "allergies": [], "chronic": [],
    }, headers=auth).json()
    assert r["blockers"] >= 1
    ix = [a for a in r["alerts"] if a["type"] == "interaccion"]
    assert ix and ix[0]["severidad"] == "grave"


def test_interaccion_moderada_advierte(client, auth):
    _seed_ix("celecoxib", "losartan", "moderada")
    r = client.post("/api/safety/rx-check", json={
        "rx_list": [{"drug": "Celecoxib 200 mg"}, {"drug": "Losartan 50 mg"}],
        "allergies": [], "chronic": [],
    }, headers=auth).json()
    assert r["warnings"] >= 1
    assert not any(a["type"] == "interaccion" and a["severity"] == "blocker" for a in r["alerts"])


def test_interaccion_borrador_no_aplica(client, auth):
    _seed_ix("naproxeno", "omeprazol", "grave", ap=False)
    r = client.post("/api/safety/rx-check", json={
        "rx_list": [{"drug": "Naproxeno"}, {"drug": "Omeprazol"}],
        "allergies": [], "chronic": [],
    }, headers=auth).json()
    assert not any(a["type"] == "interaccion" for a in r["alerts"])  # solo lo aprobado cuenta


def test_un_solo_farmaco_sin_interaccion(client, auth):
    _seed_ix("tramadol", "sertralina", "grave")
    r = client.post("/api/safety/rx-check", json={
        "rx_list": [{"drug": "Tramadol"}], "allergies": [], "chronic": [],
    }, headers=auth).json()
    assert not any(a["type"] == "interaccion" for a in r["alerts"])


def test_approve_bloqueado_por_interaccion_grave(client, auth, consultation):
    _seed_ix("tramadol", "sertralina", "grave")
    body = {
        "consultation_id": consultation["id"], "actor": "king",
        "rx_list": [{"drug": "Tramadol 50 mg"}, {"drug": "Sertralina 50 mg"}],
        "allergies": [], "chronic": [], "safety_ack": False,
    }
    r = client.post("/api/review/approve", json=body, headers=auth)
    assert r.status_code == 409  # interacción grave sin confirmar bloquea la firma
    body["safety_ack"] = True
    assert client.post("/api/review/approve", json=body, headers=auth).status_code == 200


def test_approve_blocked_server_side_even_if_front_sends_empty(client, auth, consultation):
    # #1 y #3 del revisor: aunque el front mande safety_alerts=[], el server RECALCULA.
    r = client.post("/api/review/approve", json={
        "consultation_id": consultation["id"], "actor": "king",
        "rx_list": [{"drug": "Amoxicilina"}], "allergies": ["Penicilina"],
        "safety_alerts": [], "safety_ack": False,
        "soap": {"S": "x", "O": "", "A": "", "P": ""},
    }, headers=auth)
    assert r.status_code == 409


def test_approve_allowed_with_explicit_ack(client, auth, consultation):
    r = client.post("/api/review/approve", json={
        "consultation_id": consultation["id"], "actor": "king",
        "rx_list": [{"drug": "Amoxicilina"}], "allergies": ["Penicilina"],
        "safety_ack": True, "soap": {"S": "x", "O": "", "A": "", "P": ""},
    }, headers=auth)
    assert r.status_code == 200


def test_approve_requires_valid_consultation(client, auth):
    assert client.post("/api/review/approve", json={"actor": "king"}, headers=auth).status_code == 400
    assert client.post("/api/review/approve", json={"consultation_id": "NOPE", "actor": "king"}, headers=auth).status_code == 404


def test_approve_moves_patient_to_terminada(client, auth, patient):
    c = client.post("/api/consultations", json={"patient_id": patient["id"]}, headers=auth).json()
    assert client.get(f"/api/patients/{patient['id']}", headers=auth).json()["status"] == "en-consulta"
    client.post("/api/review/approve", json={
        "consultation_id": c["id"], "actor": "king", "soap": {"S": "x", "O": "", "A": "", "P": ""},
    }, headers=auth)
    assert client.get(f"/api/patients/{patient['id']}", headers=auth).json()["status"] == "terminada"
