"""Validación de documentos y citas (#4): 400/404 en vez de 500."""


def test_document_ok(client, auth, consultation):
    r = client.post("/api/documents", json={
        "consultation_id": consultation["id"], "kind": "referencia", "content": {"motivo": "x"},
    }, headers=auth)
    assert r.status_code == 200
    assert r.json()["content_hash"].startswith("sha256:")


def test_document_bad_kind(client, auth, consultation):
    r = client.post("/api/documents", json={
        "consultation_id": consultation["id"], "kind": "hackeo", "content": {},
    }, headers=auth)
    assert r.status_code == 400


def test_document_nonexistent_consultation(client, auth):
    r = client.post("/api/documents", json={
        "consultation_id": "NOPE", "kind": "referencia", "content": {},
    }, headers=auth)
    assert r.status_code == 404


def test_appointment_ok(client, auth, patient):
    r = client.post("/api/appointments", json={
        "patient_id": patient["id"], "scheduled_date": "2026-07-10", "reason": "Control",
    }, headers=auth)
    assert r.status_code == 200


def test_appointment_nonexistent_patient(client, auth):
    r = client.post("/api/appointments", json={
        "patient_id": "NOPE", "scheduled_date": "2026-07-10",
    }, headers=auth)
    assert r.status_code == 404
