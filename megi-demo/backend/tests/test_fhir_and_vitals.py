"""Export FHIR-like validado por contrato local (#5) y vitales/tendencia (#6)."""


def _approve_with_vitals(client, auth, patient):
    c = client.post("/api/consultations", json={"patient_id": patient["id"]}, headers=auth).json()
    client.post("/api/review/approve", json={
        "consultation_id": c["id"], "actor": "king",
        "soap": {"S": "s", "O": "o", "A": "a", "P": "p"},
        "selected_dx": [{"code": "J03.9", "label": "Amigdalitis"}],
        "rx_list": [{"drug": "Paracetamol", "dose": "500 mg"}],
        "vitals": {"ta": "120/80 mmHg", "temp": "37.2 C"},
    }, headers=auth)
    return c["id"]


def test_fhir_composition_first_and_xhtml(client, auth, patient):
    cid = _approve_with_vitals(client, auth, patient)
    b = client.get(f"/api/consultations/{cid}/fhir", headers=auth).json()
    assert b["type"] == "document"
    # Regla del Bundle 'document': la primera entrada debe ser la Composition.
    assert b["entry"][0]["resource"]["resourceType"] == "Composition"
    div = b["entry"][0]["resource"]["section"][0]["text"]["div"]
    assert div.startswith('<div xmlns="http://www.w3.org/1999/xhtml"')


def test_fhir_exports_temperature(client, auth, patient):
    cid = _approve_with_vitals(client, auth, patient)
    b = client.get(f"/api/consultations/{cid}/fhir", headers=auth).json()
    obs_ids = [e["resource"]["id"] for e in b["entry"] if e["resource"]["resourceType"] == "Observation"]
    assert "vital-temp" in obs_ids


def test_patient_vitals_history_has_temp(client, auth, patient):
    _approve_with_vitals(client, auth, patient)
    vh = client.get(f"/api/patients/{patient['id']}/vitals", headers=auth).json()
    assert vh, "debe haber al menos un registro de vitales"
    assert vh[0]["vitals"].get("temp")
