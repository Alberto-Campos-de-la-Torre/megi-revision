"""Fases 10-10B: perfiles de voz, verificación del hablante y etiquetado de roles."""
from app.services.speaker_profile import cosine, label_for_score, save_profile, load_profile, verify


def test_cosine_basics():
    assert cosine([1, 0], [1, 0]) == 1.0
    assert cosine([1, 0], [0, 1]) == 0.0
    assert cosine([1, 0], [-1, 0]) == -1.0
    assert cosine([0, 0], [1, 1]) == 0.0  # vector nulo no revienta


def test_verify_sin_enrolar():
    v = verify("nadie-enrolado", [1.0] * 8)
    assert v["speaker"] == "sin_enrolar"
    assert v["score"] is None


def test_enroll_verify_roundtrip(tmp_path, monkeypatch):
    import app.services.speaker_profile as sp
    monkeypatch.setattr(sp, "PROFILES_DIR", tmp_path)

    emb = [0.5, 0.1, -0.3, 0.8]
    save_profile("dra", emb, "campp", 25000)
    p = load_profile("dra")
    assert p["dim"] == 4 and p["threshold"] > 0

    # Misma voz (embedding idéntico) -> medico.
    same = verify("dra", emb)
    assert same["speaker"] == "medico"
    assert same["score"] == 1.0

    # Voz distinta (embedding casi ortogonal) -> desconocido.
    other = verify("dra", [-0.1, 0.9, 0.4, -0.05])
    assert other["speaker"] == "desconocido"
    assert other["score"] < p["threshold"]


def test_label_for_score_roles():
    """Fase 10B: etiqueta MÉDICO/OTRO/desconocido con banda de ambigüedad."""
    profile = {"threshold": 0.35}
    assert label_for_score(profile, 0.60) == "medico"    # claro sobre thr+margen
    assert label_for_score(profile, 0.47) == "medico"    # justo en thr+0.12
    assert label_for_score(profile, 0.44) == "desconocido"  # zona gris [thr, thr+0.12)
    assert label_for_score(profile, 0.38) == "desconocido"  # zona gris
    assert label_for_score(profile, 0.20) == "otro"
    # Segmento corto/ambiguo (sin score): mejor no afirmar que equivocarse.
    assert label_for_score(profile, None) == "desconocido"
    # Sin threshold en el perfil, usa el default.
    assert label_for_score({}, 0.99) == "medico"


def test_enroll_endpoint_gates(client, auth, tmp_path, monkeypatch):
    import app.services.speaker_profile as sp
    monkeypatch.setattr(sp, "PROFILES_DIR", tmp_path)  # sin perfil previo

    files = {"file": ("enroll.wav", b"x" * 100, "audio/wav")}
    assert client.post("/api/voice/speaker/enroll", files=files).status_code == 401
    r = client.post("/api/voice/speaker/enroll", files=files, headers=auth)
    assert r.status_code == 503  # fail-closed sin ASR real

    big = {"file": ("enroll.wav", b"x" * (6 * 1024 * 1024 + 1), "audio/wav")}
    assert client.post("/api/voice/speaker/enroll", files=big, headers=auth).status_code == 413


def test_reenroll_requires_password(client, auth, tmp_path, monkeypatch):
    """Regrabar la huella (reemplazar el biométrico) exige re-autenticación."""
    import app.services.speaker_profile as sp
    monkeypatch.setattr(sp, "PROFILES_DIR", tmp_path)
    sp.save_profile("king", [0.1] * 8, "campp", 20000)  # ya hay huella

    files = {"file": ("enroll.wav", b"x" * 100, "audio/wav")}
    # Sin contraseña -> 403.
    r = client.post("/api/voice/speaker/enroll", files=files, headers=auth)
    assert r.status_code == 403
    assert "contraseña" in r.json()["detail"]
    # Contraseña incorrecta -> 403.
    r = client.post("/api/voice/speaker/enroll", files=files, data={"password": "incorrecta"}, headers=auth)
    assert r.status_code == 403
    # Contraseña correcta -> pasa el candado (y cae en el fail-closed del ASR mock).
    r = client.post("/api/voice/speaker/enroll", files=files, data={"password": "votapan"}, headers=auth)
    assert r.status_code == 503


def test_speaker_status(client, auth):
    assert client.get("/api/voice/speaker/status").status_code == 401
    r = client.get("/api/voice/speaker/status", headers=auth)
    assert r.status_code == 200
    assert r.json()["enrolled"] in (True, False)
