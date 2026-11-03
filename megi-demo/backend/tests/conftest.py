"""Fixtures de prueba.

IMPORTANTE (ajuste #2): el aislamiento se configura ANTES de importar
`app.main`, porque `config.DB_PATH` se congela al importar. Si no se hace aquí,
los tests apuntarían a la base real.
"""
import os
import sys
import tempfile
from pathlib import Path

# --- 1) Aislar el entorno ANTES de cualquier import de la app ---
_TMP = tempfile.mkdtemp(prefix="megi-test-")
os.environ["MEGI_DB"] = str(Path(_TMP) / "test.sqlite")   # SQLite temporal
# Todo lo que la app escribe (audio de sesiones, perfiles de voz, shadow log) va
# al temporal: la suite ya NO ensucia backend/data/ de la instalación.
os.environ["MEGI_STATE_DIR"] = str(Path(_TMP) / "state")
os.environ["MEGI_REAL_ASR"] = "false"                     # sin MLX/gemma
os.environ["MEGI_MODE"] = "local_mock"
os.environ["MEGI_SECRET"] = "test-secret"                 # token reproducible
os.environ["MEGI_PBKDF2_ITERS"] = "1000"                  # hashing rápido en tests

_BACKEND = Path(__file__).resolve().parent.parent          # backend/
_ASR = _BACKEND.parent / "asr_service"                     # para tests unit de clinical.py
for p in (str(_BACKEND), str(_ASR)):
    if p not in sys.path:
        sys.path.insert(0, p)

import pytest                                              # noqa: E402
from fastapi.testclient import TestClient                 # noqa: E402

from app.main import app                                  # noqa: E402


@pytest.fixture(scope="session")
def client():
    # El context manager dispara el lifespan (init_db). Ya NO hay admin fijo (P2):
    # creamos el primer administrador con /auth/setup (primer arranque).
    with TestClient(app) as c:
        r = c.post("/api/auth/setup", json={"username": "king", "name": "King", "password": "votapan"})
        assert r.status_code == 200, r.text
        yield c


@pytest.fixture(scope="session")
def admin_token(client):
    r = client.post("/api/auth/login", json={"username": "king", "password": "votapan"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture()
def auth(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture()
def patient(client, auth):
    r = client.post("/api/patients", json={
        "name": "Test Paciente", "age": 40, "sex": "M", "reason": "prueba", "kind": "espontaneo",
    }, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture()
def consultation(client, auth, patient):
    r = client.post("/api/consultations", json={"patient_id": patient["id"]}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()
