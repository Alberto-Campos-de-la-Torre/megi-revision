"""Segunda tanda de fixes de seguridad (2026-07-27).

Cubre los hallazgos A y B de la auditoría del 26-jul (traversal de rutas y firma
atribuida por el cliente) y los hallazgos 5-7 + L de la revisión del 12-jul
(sesiones revocables, ticket de WS, permisos del secreto, PHI en reposo).
"""
import io
import os
import stat
import wave
from pathlib import Path

import pytest

from app import phi_at_rest, sessions, ws_tickets
from app.config import SESSIONS_DIR
from app.db import db
from app.gen_secret import write_secret
from app.security import issue_token, verify_token
from app.uploads import MAX_CHUNK_AUDIO_BYTES


def _wav_bytes(ms: int = 200) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * int(16000 * ms / 1000))
    return buf.getvalue()


# ----------------------------------------------------- hallazgo A (traversal)
@pytest.mark.parametrize("evil", [
    "../../../../tmp/megi-escape",
    "..",
    "C-1234/../../etc",
    "/etc/megi",
    "C-1234\x00",
    "",
])
def test_audio_upload_rejects_path_traversal(client, auth, evil):
    r = client.post(
        "/api/audio/upload",
        files={"file": ("a.wav", _wav_bytes(), "audio/wav")},
        data={"consultation_id": evil},
        headers=auth,
    )
    # Desde la multi-tenencia hay DOS barreras y salta primero la de pertenencia
    # (404: ninguna consulta tuya tiene ese id), antes que la de formato (422).
    # Lo que importa es que se rechace y no se escriba nada; la contención de
    # rutas se prueba directamente en test_safe_session_dir_* más abajo.
    assert r.status_code in (404, 422), (evil, r.status_code)


def test_audio_chunk_rejects_path_traversal_and_writes_nothing(client, auth, tmp_path):
    evil = "../../../../" + str(tmp_path.name)
    r = client.post(
        "/api/audio/chunk",
        files={"file": ("c.wav", _wav_bytes(), "audio/wav")},
        data={"consultation_id": evil, "chunk_idx": "0"},
        headers=auth,
    )
    assert r.status_code in (404, 422)
    assert not (tmp_path / "chunks").exists()


def test_safe_session_dir_contiene_las_rutas():
    """La contención vive en `uploads.safe_session_dir`; se prueba aquí directo
    porque en la API la guarda de pertenencia ahora corta antes."""
    from fastapi import HTTPException

    from app.uploads import safe_session_dir

    for evil in ("../../../../tmp/megi-escape", "..", "C-1234/../../etc", "/etc/megi",
                 "C-1234\x00", ""):
        with pytest.raises(HTTPException) as e:
            safe_session_dir(evil)
        assert e.value.status_code == 422, evil

    ok = safe_session_dir("C-abc123", "chunks", "chunk-0001")
    assert ok.resolve().is_relative_to(SESSIONS_DIR.resolve())


def test_legit_consultation_id_still_works(client, auth, consultation):
    r = client.post(
        "/api/audio/chunk",
        files={"file": ("c.wav", _wav_bytes(), "audio/wav")},
        data={"consultation_id": consultation["id"], "chunk_idx": "0"},
        headers=auth,
    )
    assert r.status_code == 200, r.text
    written = SESSIONS_DIR / consultation["id"] / "chunks"
    assert written.exists()


def test_upload_extension_is_sanitized(client, auth, consultation):
    r = client.post(
        "/api/audio/upload",
        files={"file": ("../../evil.sh\x00.wav", _wav_bytes(), "audio/wav")},
        data={"consultation_id": consultation["id"]},
        headers=auth,
    )
    assert r.status_code == 200, r.text
    original = Path(r.json()["original_path"] if "original_path" in r.json() else "")
    row = client.get(f"/api/audio/{r.json()['audio_id']}", headers=auth).json()
    original = Path(row["original_path"])
    assert original.name in ("original.webm", "original.wav")
    assert original.resolve().is_relative_to(SESSIONS_DIR.resolve())


# ------------------------------------------------------- hallazgo G (tamaño)
def test_chunk_upload_rejects_oversize(client, auth, consultation):
    big = b"\x00" * (MAX_CHUNK_AUDIO_BYTES + 1024)
    r = client.post(
        "/api/audio/chunk",
        files={"file": ("c.wav", big, "audio/wav")},
        data={"consultation_id": consultation["id"], "chunk_idx": "0"},
        headers=auth,
    )
    assert r.status_code == 413


# ------------------------------------------------- hallazgo B (firma / actor)
def test_approve_signs_with_token_not_body(client, auth, consultation):
    r = client.post("/api/review/approve", json={
        "consultation_id": consultation["id"],
        "actor": "Dr. Impostor",          # intento de firmar como otro
        "soap": {"S": "x"},
    }, headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["approved_by"] == "King"          # el del token, no el del body

    detail = client.get(f"/api/consultations/{consultation['id']}", headers=auth).json()
    assert detail.get("approved_by") == "King"
    with db() as conn:
        row = conn.execute(
            "SELECT actor FROM review_events WHERE consultation_id = ? AND kind = 'approve'",
            (consultation["id"],),
        ).fetchone()
    assert row["actor"] == "King"


# ------------------------------------------- hallazgo 5 (sesiones revocables)
def test_logout_invalidates_the_token_server_side(client, auth):
    tok = client.post("/api/auth/login",
                      json={"username": "king", "password": "votapan"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.get("/api/patients", headers=h).status_code == 200
    assert client.post("/api/auth/logout", headers=h).json()["revoked"] is True
    # El token sigue firmado y sin expirar, pero su sesión ya no existe.
    assert client.get("/api/patients", headers=h).status_code == 401
    assert verify_token(tok) is None


def test_token_without_sid_is_rejected():
    """Tokens emitidos antes de este cambio (sin `sid`) dejan de valer."""
    import base64, hashlib, hmac, json, time
    from app import security
    payload = {"u": "king", "role": "admin", "name": "King", "exp": int(time.time()) + 600}
    p = security._b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = security._b64(hmac.new(security._SECRET, p.encode("ascii"), hashlib.sha256).digest())
    assert verify_token(f"{p}.{sig}") is None


def test_sessions_list_and_revoke_others(client, auth):
    # Usuario propio: revocar "las demás sesiones" de `king` tumbaría el token
    # compartido por el resto de la suite.
    creds = {"username": "sess_u", "password": "clave12345"}
    client.post("/api/users", json={**creds, "role": "medico"}, headers=auth)
    tmp = client.post("/api/auth/login", json=creds).json()["token"]
    client.post("/api/auth/change-password",
                json={"current_password": creds["password"], "new_password": "clave67890"},
                headers={"Authorization": f"Bearer {tmp}"})
    creds["password"] = "clave67890"

    a = client.post("/api/auth/login", json=creds).json()["token"]
    b = client.post("/api/auth/login", json=creds).json()["token"]
    ha, hb = {"Authorization": f"Bearer {a}"}, {"Authorization": f"Bearer {b}"}

    listed = client.get("/api/auth/sessions", headers=hb).json()
    assert len([s for s in listed if s["current"]]) == 1
    assert len(listed) >= 2

    assert client.post("/api/auth/sessions/revoke-others", headers=hb).json()["revoked"] >= 1
    assert client.get("/api/patients", headers=ha).status_code == 401   # la otra cayó
    assert client.get("/api/patients", headers=hb).status_code == 200   # la actual sigue


def test_change_password_revokes_previous_sessions(client, auth):
    client.post("/api/users", json={"username": "rot_u", "password": "inicial1", "role": "medico"},
                headers=auth)
    first = client.post("/api/auth/login", json={"username": "rot_u", "password": "inicial1"}).json()
    h1 = {"Authorization": f"Bearer {first['token']}"}
    second = client.post("/api/auth/login", json={"username": "rot_u", "password": "inicial1"}).json()
    h2 = {"Authorization": f"Bearer {second['token']}"}

    ok = client.post("/api/auth/change-password",
                     json={"current_password": "inicial1", "new_password": "nuevaclave1"}, headers=h2)
    assert ok.status_code == 200, ok.text
    # La sesión vieja queda revocada; la recién emitida funciona.
    assert client.get("/api/patients", headers=h1).status_code == 401
    assert client.get("/api/patients", headers={"Authorization": "Bearer %s" % ok.json()["token"]}).status_code == 200


def test_token_ttl_is_a_week_not_a_month():
    import json, time
    from app.security import _b64, _ub64
    tok = issue_token("king", "admin", "King")
    exp = json.loads(_ub64(tok.split(".")[0]))["exp"]
    assert 6 * 24 * 3600 < exp - time.time() <= 7 * 24 * 3600


# ------------------------------------------------- hallazgo 6 (ticket del WS)
def test_ws_ticket_requires_auth(client):
    assert client.post("/api/asr/ticket", json={}).status_code == 401


def test_ws_ticket_is_single_use_and_short_lived(client, auth):
    body = client.post("/api/asr/ticket", json={"consultation_id": None}, headers=auth).json()
    assert body["expires_in"] <= 60 and len(body["ticket"]) >= 32
    ctx = ws_tickets.redeem(body["ticket"])
    assert ctx and ctx["username"] == "king"
    assert ws_tickets.redeem(body["ticket"]) is None      # un solo uso
    assert ws_tickets.redeem("inventado") is None


def test_ws_rejects_missing_or_bad_ticket(client, auth):
    from starlette.websockets import WebSocketDisconnect as WSD
    for qs in ("", "?ticket=noexiste"):
        with pytest.raises(WSD):
            with client.websocket_connect(f"/api/asr/stream/general{qs}"):
                pass


def test_ws_rejects_foreign_origin(client, auth):
    from starlette.websockets import WebSocketDisconnect as WSD
    t = client.post("/api/asr/ticket", json={}, headers=auth).json()["ticket"]
    with pytest.raises(WSD):
        with client.websocket_connect(f"/api/asr/stream/general?ticket={t}",
                                      headers={"origin": "http://evil.example"}):
            pass


# --------------------------------------------- hallazgo L (permisos secreto)
def test_secret_file_is_created_600(tmp_path):
    p = tmp_path / "megi_secret.key"
    write_secret(p, "abc123")
    assert p.read_text(encoding="utf-8") == "abc123"
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600
    # Reescribir sobre un archivo con permisos laxos lo deja igualmente en 600.
    p.chmod(0o644)
    write_secret(p, "def456")
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600
    assert not (tmp_path / "megi_secret.key.tmp").exists()


# ---------------------------------------------- hallazgo 7 (PHI en reposo)
def test_filevault_parsing():
    assert phi_at_rest.parse_filevault_status("FileVault is On.") is True
    assert phi_at_rest.parse_filevault_status("FileVault is Off.") is False
    assert phi_at_rest.parse_filevault_status("") is None


def test_config_exposes_disk_encryption_state(client, auth):
    body = client.get("/api/config", headers=auth).json()
    assert "disk_encryption" in body["security"]
