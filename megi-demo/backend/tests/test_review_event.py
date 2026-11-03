"""Fase 4: auditoría persistente de cambios por voz (POST /review/event)."""


def test_voice_event_persists_and_shows_in_audit(client, auth, consultation):
    cid = consultation["id"]
    body = {
        "consultation_id": cid,
        "kind": "voice_dx",
        "payload": {"intent": "change_primary_diagnosis", "before": "I20.9", "after": "I10",
                    "command": "MEGI, cambiar diagnóstico principal a I10"},
    }
    r = client.post("/api/review/event", json=body, headers=auth)
    assert r.status_code == 200, r.text

    audit = client.get(f"/api/consultations/{cid}/audit", headers=auth).json()
    kinds = [e["kind"] for e in audit["timeline"]]
    assert "voice_dx" in kinds
    # queda registrado el actor (usuario autenticado)
    ev = next(e for e in audit["timeline"] if e["kind"] == "voice_dx")
    assert ev["actor"]  # king / King


def test_voice_event_requires_auth(client, consultation):
    r = client.post("/api/review/event", json={"consultation_id": consultation["id"], "payload": {}})
    assert r.status_code == 401


def test_voice_event_unknown_consultation_404(client, auth):
    r = client.post("/api/review/event", json={"consultation_id": "nope", "payload": {"x": 1}}, headers=auth)
    assert r.status_code == 404


def test_voice_event_kind_is_sanitized(client, auth, consultation):
    # un kind arbitrario se normaliza a 'voice_edit'
    r = client.post("/api/review/event",
                    json={"consultation_id": consultation["id"], "kind": "hack", "payload": {}}, headers=auth)
    assert r.status_code == 200
    audit = client.get(f"/api/consultations/{consultation['id']}/audit", headers=auth).json()
    assert "hack" not in [e["kind"] for e in audit["timeline"]]
    assert "voice_edit" in [e["kind"] for e in audit["timeline"]]
