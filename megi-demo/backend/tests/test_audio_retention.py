"""Retención de audio (retain_all): clasificación auditable en DB y meta.json."""
import io
import json
import wave
from pathlib import Path

from app.audio_meta import AUDIO_KINDS, RETENTION_POLICY, audit_meta


def _wav_bytes(ms: int = 200) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * int(16000 * ms / 1000))
    return buf.getvalue()


def test_audit_meta_classifies_every_known_kind():
    assert RETENTION_POLICY == "retain_all"
    for kind in ("general_consultation", "chunk", "identifier_slot", "voice_command"):
        m = audit_meta(kind, uploaded_by="king")
        assert m["audio_kind"] == kind
        assert m["audio_kind_label"] == AUDIO_KINDS[kind]["label"]
        assert m["purpose"] == AUDIO_KINDS[kind]["purpose"]
        assert m["uploaded_by"] == "king"
        assert m["retention"] == "retain_all"


def test_audit_meta_never_falls_open_on_unknown_kind():
    m = audit_meta("algo_nuevo")
    assert m["audio_kind"] == "algo_nuevo"
    assert m["purpose"] == "(sin clasificar)"
    assert m["retention"] == "retain_all"


def test_audio_upload_records_who_and_purpose(client, auth, consultation):
    files = {"file": ("a.wav", _wav_bytes(), "audio/wav")}
    r = client.post(
        "/api/audio/upload",
        files=files,
        data={"consultation_id": consultation["id"]},
        headers=auth,
    )
    assert r.status_code == 200, r.text
    audio_id = r.json()["audio_id"]

    row = client.get(f"/api/audio/{audio_id}", headers=auth).json()
    assert row["audio_kind"] == "general_consultation"
    assert row["uploaded_by"] == "king"
    assert row["purpose"] == AUDIO_KINDS["general_consultation"]["purpose"]
    assert row["retention"] == "retain_all"

    # El meta.json junto al archivo lleva la MISMA clasificación (auditable sin DB).
    meta = json.loads((Path(row["original_path"]).parent / "meta.json").read_text(encoding="utf-8"))
    assert meta["uploaded_by"] == "king"
    assert meta["retention"] == "retain_all"
    assert meta["purpose"] == row["purpose"]
    assert meta["audio_kind_label"] == AUDIO_KINDS["general_consultation"]["label"]


def test_audio_chunk_records_who_and_purpose(client, auth, consultation):
    files = {"file": ("c.wav", _wav_bytes(), "audio/wav")}
    r = client.post(
        "/api/audio/chunk",
        files=files,
        data={"consultation_id": consultation["id"], "chunk_idx": "0"},
        headers=auth,
    )
    assert r.status_code == 200, r.text

    from app.db import db
    with db() as conn:
        row = conn.execute(
            "SELECT uploaded_by, purpose, retention FROM audio WHERE consultation_id = ? AND audio_kind = 'chunk'",
            (consultation["id"],),
        ).fetchone()
    assert row is not None
    assert row["uploaded_by"] == "king"
    assert row["purpose"] == AUDIO_KINDS["chunk"]["purpose"]
    assert row["retention"] == "retain_all"
