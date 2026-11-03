"""Radiología MEGI: catálogo de modelos y carpeta de estudios por paciente."""
import io

import numpy as np
from PIL import Image

from app.services import analisis_estudios as an


def _png(seed=0) -> bytes:
    rng = np.random.default_rng(seed)
    im = Image.fromarray(rng.integers(30, 220, (8, 7), dtype=np.uint8)).resize((640, 520), Image.BICUBIC).convert("RGB")
    b = io.BytesIO(); im.save(b, format="PNG"); return b.getvalue()


def test_catalogo_de_modelos(client, auth, monkeypatch):
    monkeypatch.setattr(an, "typesafe_disponible", lambda: True)
    monkeypatch.setattr(an, "eco_disponible", lambda: False)
    d = client.get("/api/radiologia/modelos", headers=auth).json()
    claves = [m["clave"] for m in d["modelos"]]
    assert claves == ["torax", "columna", "abdomen", "ecografia", "resonancia"]
    por = {m["clave"]: m for m in d["modelos"]}
    assert por["torax"]["conectado"] is True and por["torax"]["estado"] == "disponible"
    assert por["ecografia"]["estado"] == "disponible" and por["ecografia"]["conectado"] is False
    assert "Megi_tipo_estudio" in d["clasificador"]
    monkeypatch.setattr(an, "typesafe_disponible", lambda: False)
    d = client.get("/api/radiologia/modelos", headers=auth).json()
    assert all(m["conectado"] is False for m in d["modelos"])


def test_carpeta_por_paciente_fuera_del_historial(client, auth, patient, monkeypatch):
    monkeypatch.setattr(an, "TYPESAFE_URL", "")
    c1 = client.post(f"/api/patients/{patient['id']}/radiologia/carpeta", headers=auth).json()
    assert c1["nueva"] is True
    c2 = client.post(f"/api/patients/{patient['id']}/radiologia/carpeta", headers=auth).json()
    assert c2["id"] == c1["id"] and c2["nueva"] is False           # una carpeta por paciente
    # sube y analiza como cualquier consulta
    r = client.post(f"/api/consultations/{c1['id']}/estudios", files={"file": ("rx.png", _png(1), "image/png")}, headers=auth)
    assert r.status_code == 200
    d = client.get(f"/api/consultations/{c1['id']}/estudios/analisis", headers=auth).json()
    assert len(d["estudios"]) == 1 and d["prediagnostico"]
    # pero NO es una consulta clínica: no sale en el historial ni en la preconsulta
    hist = client.get(f"/api/patients/{patient['id']}/consultations", headers=auth).json()
    assert all(c["id"] != c1["id"] for c in hist)
    exp = client.get(f"/api/patients/{patient['id']}/expediente", headers=auth).json()
    assert all(c["id"] != c1["id"] for c in exp["consultas"]) and exp["conteos"]["aportados"] == 1
    # y «Nueva consulta» no la retoma
    nueva = client.post("/api/consultations", json={"patient_id": patient["id"], "motivo": "tos"}, headers=auth).json()
    assert nueva["id"] != c1["id"]
    assert client.post("/api/patients/NO-EXISTE/radiologia/carpeta", headers=auth).status_code == 404
