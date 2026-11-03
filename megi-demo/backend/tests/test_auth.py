"""Contrato de acceso: público vs autenticado vs admin."""


def test_login_ok(client):
    r = client.post("/api/auth/login", json={"username": "king", "password": "votapan"})
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "admin" and body["token"]


def test_login_bad_password(client):
    r = client.post("/api/auth/login", json={"username": "king", "password": "malo"})
    assert r.status_code == 401


def test_health_is_public(client):
    assert client.get("/api/health").status_code == 200


def test_clinical_endpoints_require_token(client):
    for path in ("/api/patients", "/api/config", "/api/stats", "/api/guidelines"):
        assert client.get(path).status_code == 401, path


def test_clinical_endpoints_ok_with_token(client, auth):
    for path in ("/api/patients", "/api/config", "/api/stats"):
        assert client.get(path, headers=auth).status_code == 200, path


def test_users_requires_admin(client, auth):
    # crea un médico, entra con él y confirma que NO puede listar usuarios (403)
    client.post("/api/users", json={"username": "medico_test", "password": "pw", "role": "medico"}, headers=auth)
    tok = client.post("/api/auth/login", json={"username": "medico_test", "password": "pw"}).json()["token"]
    r = client.get("/api/users", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403
