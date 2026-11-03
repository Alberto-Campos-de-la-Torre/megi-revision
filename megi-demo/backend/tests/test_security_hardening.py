"""Fixes de la revisión 2026-07-12 (hallazgos 1-3): hashing con sal +
migración perezosa, límite de intentos de login y must_change_password
impuesto server-side."""
import hashlib

from app import login_guard
from app.db import db
from app.routes.users import _PBKDF2_ITERATIONS, _verify_password


# ---------------------------------------------------------------- hallazgo #1
def test_new_hashes_are_salted_pbkdf2(client, auth):
    for u in ("salted_a", "salted_b"):
        client.post("/api/users", json={"username": u, "password": "mismapw", "role": "medico"},
                    headers=auth)
    with db() as conn:
        rows = {r["username"]: r["password_hash"] for r in conn.execute(
            "SELECT username, password_hash FROM users WHERE username IN ('salted_a','salted_b')")}
    assert rows["salted_a"].startswith("pbkdf2_sha256$%d$" % _PBKDF2_ITERATIONS)
    # misma contraseña, sal distinta -> hash distinto
    assert rows["salted_a"] != rows["salted_b"]


def test_legacy_sha256_hash_migrates_on_login(client):
    legacy = hashlib.sha256(b"clavevieja").hexdigest()
    with db() as conn:
        conn.execute(
            "INSERT INTO users (username, name, role, password_hash, created_at, must_change_password) "
            "VALUES ('legacy_u', 'Legacy', 'medico', ?, '2025-01-01', 0)", (legacy,))
    r = client.post("/api/auth/login", json={"username": "legacy_u", "password": "clavevieja"})
    assert r.status_code == 200, r.text
    with db() as conn:
        h = conn.execute("SELECT password_hash FROM users WHERE username = 'legacy_u'").fetchone()["password_hash"]
    assert h.startswith("pbkdf2_sha256$")
    # la contraseña sigue funcionando tras la migración; una incorrecta no
    assert client.post("/api/auth/login", json={"username": "legacy_u", "password": "clavevieja"}).status_code == 200
    assert client.post("/api/auth/login", json={"username": "legacy_u", "password": "otra"}).status_code == 401
    login_guard.clear("legacy_u")


def test_verify_password_rejects_malformed_stored_hash():
    assert _verify_password("x", "") == (False, False)
    assert _verify_password("x", "pbkdf2_sha256$basura") == (False, False)


# ---------------------------------------------------------------- hallazgo #2
def test_login_lockout_after_repeated_failures(client, auth):
    client.post("/api/users", json={"username": "brute_u", "password": "correcta1", "role": "medico"},
                headers=auth)
    for _ in range(login_guard.FAILURES_BEFORE_LOCK):
        assert client.post("/api/auth/login",
                           json={"username": "brute_u", "password": "mal"}).status_code == 401
    # bloqueado: ni siquiera la contraseña correcta entra durante la espera
    r = client.post("/api/auth/login", json={"username": "brute_u", "password": "correcta1"})
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) >= 1
    # pasada la espera (simulada limpiando el contador), entra y queda limpio
    login_guard.clear("brute_u")
    assert client.post("/api/auth/login",
                       json={"username": "brute_u", "password": "correcta1"}).status_code == 200
    assert login_guard.seconds_until_allowed("brute_u") == 0.0


def test_login_lockout_applies_to_unknown_users(client):
    for _ in range(login_guard.FAILURES_BEFORE_LOCK):
        assert client.post("/api/auth/login",
                           json={"username": "ghost_u", "password": "x"}).status_code == 401
    assert client.post("/api/auth/login",
                       json={"username": "ghost_u", "password": "x"}).status_code == 429
    login_guard.clear("ghost_u")


def test_backoff_grows_and_caps():
    n = login_guard.FAILURES_BEFORE_LOCK
    assert login_guard._delay_for(n - 1) == 0.0
    assert login_guard._delay_for(n) == login_guard.BASE_DELAY_S
    assert login_guard._delay_for(n + 1) == login_guard.BASE_DELAY_S * 2
    assert login_guard._delay_for(n + 50) == login_guard.MAX_DELAY_S


def test_successful_login_clears_counter(client, auth):
    client.post("/api/users", json={"username": "clear_u", "password": "correcta1", "role": "medico"},
                headers=auth)
    for _ in range(login_guard.FAILURES_BEFORE_LOCK - 1):
        client.post("/api/auth/login", json={"username": "clear_u", "password": "mal"})
    assert client.post("/api/auth/login",
                       json={"username": "clear_u", "password": "correcta1"}).status_code == 200
    # el contador se limpió: vuelve a haber margen completo de intentos
    with db() as conn:
        assert conn.execute("SELECT 1 FROM login_attempts WHERE username = 'clear_u'").fetchone() is None


# ---------------------------------------------------------------- hallazgo #3
def test_must_change_password_blocks_clinical_endpoints(client, auth):
    client.post("/api/users", json={"username": "mc_u", "password": "inicial1", "role": "medico"},
                headers=auth)
    body = client.post("/api/auth/login", json={"username": "mc_u", "password": "inicial1"}).json()
    assert body["must_change_password"] is True
    h = {"Authorization": "Bearer %s" % body["token"]}
    # el token restringido NO sirve para endpoints clínicos (server-side, no solo UI)
    for path in ("/api/patients", "/api/config", "/api/stats"):
        assert client.get(path, headers=h).status_code == 403, path
    # pero SÍ permite cambiar la contraseña; el token nuevo ya es pleno
    ok = client.post("/api/auth/change-password",
                     json={"current_password": "inicial1", "new_password": "nuevaclave1"}, headers=h)
    assert ok.status_code == 200, ok.text
    h2 = {"Authorization": "Bearer %s" % ok.json()["token"]}
    assert client.get("/api/patients", headers=h2).status_code == 200
