"""Fase 6: endpoint de ASR local para comandos hablados."""


def _files():
    return {"file": ("cmd.webm", b"not-a-real-audio", "audio/webm")}


def test_voice_command_transcribe_requires_auth(client):
    r = client.post("/api/voice/command/transcribe", files=_files())
    assert r.status_code == 401


def test_voice_command_transcribe_fails_closed_without_real_asr(client, auth):
    r = client.post("/api/voice/command/transcribe", files=_files(), headers=auth)
    assert r.status_code == 503
    assert "ASR local" in r.json()["detail"]


def test_voice_command_transcribe_rejects_oversized_audio(client, auth):
    big = {"file": ("cmd.webm", b"x" * (2 * 1024 * 1024 + 1), "audio/webm")}
    r = client.post("/api/voice/command/transcribe", files=big, headers=auth)
    assert r.status_code == 413


def test_wake_probe_requires_auth(client):
    r = client.post("/api/voice/wake/probe", files=_files())
    assert r.status_code == 401


def test_wake_probe_fails_closed_without_real_asr(client, auth):
    r = client.post("/api/voice/wake/probe", files=_files(), headers=auth)
    assert r.status_code == 503


def test_wake_probe_rejects_long_utterances(client, auth):
    big = {"file": ("probe.wav", b"x" * (512 * 1024 + 1), "audio/wav")}
    r = client.post("/api/voice/wake/probe", files=big, headers=auth)
    assert r.status_code == 413


def test_shadow_parse_requires_auth(client):
    r = client.post("/api/voice/command/parse", json={"text": "anota en el plan"})
    assert r.status_code == 401


def test_shadow_parse_fails_closed_without_real_asr(client, auth):
    r = client.post("/api/voice/command/parse", json={"text": "anota en el plan"}, headers=auth)
    assert r.status_code == 503


def test_shadow_parse_rejects_empty_text(client, auth):
    r = client.post("/api/voice/command/parse", json={"text": "  "}, headers=auth)
    assert r.status_code in (422, 503)  # texto vacío o fail-closed, nunca 200
