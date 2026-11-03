"""P2 — primer arranque seguro: setup, forzar cambio, cambio de contraseña."""


def test_setup_status_false_after_bootstrap(client):
    # El fixture `client` ya creó el admin -> ya no hace falta setup.
    r = client.get("/api/auth/setup-status")
    assert r.status_code == 200
    assert r.json()["needs_setup"] is False


def test_setup_rejected_when_admin_exists(client):
    # No debe ser un backdoor: con admin existente, /auth/setup responde 409.
    r = client.post("/api/auth/setup", json={"username": "otro", "password": "secreto"})
    assert r.status_code == 409


def test_admin_created_user_must_change_password(client, auth):
    client.post("/api/users", json={"username": "med_p2", "password": "inicial", "role": "medico"}, headers=auth)
    body = client.post("/api/auth/login", json={"username": "med_p2", "password": "inicial"}).json()
    assert body["must_change_password"] is True


def test_change_password_flow(client, auth):
    client.post("/api/users", json={"username": "med_cp", "password": "inicial", "role": "medico"}, headers=auth)
    tok = client.post("/api/auth/login", json={"username": "med_cp", "password": "inicial"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}

    # contraseña actual incorrecta -> 400
    bad = client.post("/api/auth/change-password",
                      json={"current_password": "otra", "new_password": "nuevaclave"}, headers=h)
    assert bad.status_code == 400

    # nueva demasiado corta -> 400
    short = client.post("/api/auth/change-password",
                        json={"current_password": "inicial", "new_password": "123"}, headers=h)
    assert short.status_code == 400

    # cambio válido -> 200 y limpia el flag
    ok = client.post("/api/auth/change-password",
                     json={"current_password": "inicial", "new_password": "nuevaclave"}, headers=h)
    assert ok.status_code == 200

    after = client.post("/api/auth/login", json={"username": "med_cp", "password": "nuevaclave"}).json()
    assert after["must_change_password"] is False
    # la contraseña vieja ya no sirve
    assert client.post("/api/auth/login", json={"username": "med_cp", "password": "inicial"}).status_code == 401


def test_change_password_requires_auth(client):
    r = client.post("/api/auth/change-password",
                    json={"current_password": "x", "new_password": "yyyyyy"})
    assert r.status_code == 401
