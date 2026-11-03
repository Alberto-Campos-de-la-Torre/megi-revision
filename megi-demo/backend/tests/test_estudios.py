"""Estudios que trae el paciente: subida desde el escritorio, enlace con código
para el teléfono (sin sesión), estado «sin estudios», pertenencia y expediente.
"""
import io
import time

import pytest
from PIL import Image


def _png(color=(200, 30, 30), seed=None, size=(640, 520)) -> bytes:
    """Imagen con textura (el triaje descarta las uniformes y las pequeñas)."""
    import numpy as _np
    # cada llamada sin semilla da una imagen distinta: el triaje rechaza repetidos
    global _N_PNG
    _N_PNG = globals().get("_N_PNG", 0) + 1
    rng = _np.random.default_rng(seed if seed is not None else sum(color) * 1000 + _N_PNG)
    base = rng.integers(30, 220, (8, 7), dtype=_np.uint8)
    im = Image.fromarray(base).resize(size, Image.BICUBIC).convert("RGB")
    b = io.BytesIO(); im.save(b, format="PNG"); return b.getvalue()


_PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"


@pytest.fixture()
def consulta(client, auth, patient):
    r = client.post("/api/consultations", json={"patient_id": patient["id"], "motivo": "dolor lumbar"}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def _subir(client, auth, cid, nombre, data, tipo="application/octet-stream"):
    return client.post(f"/api/consultations/{cid}/estudios", files={"file": (nombre, data, tipo)}, headers=auth)


def test_subir_listar_ver_y_borrar(client, auth, consulta):
    cid = consulta["id"]
    r = _subir(client, auth, cid, "rx_torax.png", _png(), "image/png")
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["formato"] == "png" and e["tiene_vista"] and e["origen"] == "escritorio" and e["ancho"] == 640

    r = _subir(client, auth, cid, "labs.pdf", _PDF, "application/pdf")
    assert r.status_code == 200, r.text
    pdf = r.json()
    assert pdf["formato"] == "pdf" and not pdf["tiene_vista"]

    # el formato lo deciden los bytes: un PDF renombrado .jpg sigue siendo PDF
    r = _subir(client, auth, cid, "engaño.jpg", _PDF + b"% otra copia\n", "image/jpeg")
    assert r.status_code == 200 and r.json()["formato"] == "pdf"

    r = _subir(client, auth, cid, "programa.bin", b"\x00\x01\x02\x03MZ\x90basura binaria", "application/octet-stream")
    assert r.status_code == 415

    lst = client.get(f"/api/consultations/{cid}/estudios", headers=auth).json()
    assert len(lst["estudios"]) == 3 and lst["estado"] == "con_estudios" and lst["max"] == 20

    v = client.get(f"/api/consultations/{cid}/estudios/{e['id']}/vista", headers=auth)
    assert v.status_code == 200 and v.headers["content-type"] == "image/png"
    assert client.get(f"/api/consultations/{cid}/estudios/{pdf['id']}/vista", headers=auth).status_code == 404
    o = client.get(f"/api/consultations/{cid}/estudios/{pdf['id']}/original", headers=auth)
    assert o.status_code == 200 and o.headers["content-type"] == "application/pdf" and o.content == _PDF

    assert client.delete(f"/api/consultations/{cid}/estudios/{e['id']}", headers=auth).json()["ok"]
    assert client.get(f"/api/consultations/{cid}/estudios/{e['id']}/vista", headers=auth).status_code == 404
    assert len(client.get(f"/api/consultations/{cid}/estudios", headers=auth).json()["estudios"]) == 2


def test_estado_sin_estudios(client, auth, consulta):
    cid = consulta["id"]
    assert client.get(f"/api/consultations/{cid}/estudios", headers=auth).json()["estado"] is None
    r = client.post(f"/api/consultations/{cid}/estudios/estado", json={"estado": "sin_estudios"}, headers=auth)
    assert r.status_code == 200 and r.json()["estado"] == "sin_estudios"
    assert client.post(f"/api/consultations/{cid}/estudios/estado", json={"estado": "otro"}, headers=auth).status_code == 400
    assert _subir(client, auth, cid, "a.png", _png(seed=13)).status_code == 200
    # con archivos ya subidos no se puede decir que no trajo nada
    assert client.post(f"/api/consultations/{cid}/estudios/estado", json={"estado": "sin_estudios"}, headers=auth).status_code == 409
    assert client.get(f"/api/consultations/{cid}/estudios", headers=auth).json()["estado"] == "con_estudios"


def test_enlace_y_subida_desde_el_telefono(client, auth, consulta, patient):
    cid = consulta["id"]
    r = client.post(f"/api/consultations/{cid}/estudios/enlace", headers={**auth, "Origin": "https://megiia.com"})
    assert r.status_code == 200, r.text
    enlace = r.json()
    assert enlace["url"] == f"https://megiia.com/subir/{enlace['token']}" and enlace["expira_en_s"] == 900

    # el teléfono: sin sesión, solo con el código; ve el nombre corto y nada más
    info = client.get(f"/api/subida/{enlace['token']}")
    assert info.status_code == 200, info.text
    d = info.json()
    assert d["paciente"] == "Test P." and d["subidos"] == 0 and d["max"] == 20
    assert set(d) == {"ok", "paciente", "expira_en_s", "subidos", "max", "max_mb"}

    r = client.post(f"/api/subida/{enlace['token']}/archivo", files={"file": ("foto.jpg", _png((10, 200, 10), seed=11), "image/png")})
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["origen"] == "telefono" and e["subido_por"] == "king" and e["consultation_id"] == cid
    assert client.get(f"/api/subida/{enlace['token']}").json()["subidos"] == 1
    # y el médico lo ve en su lista, con sesión
    lst = client.get(f"/api/consultations/{cid}/estudios", headers=auth).json()["estudios"]
    assert [x["origen"] for x in lst] == ["telefono"]

    # código inventado: 404 sin pistas
    assert client.get("/api/subida/no-existe").status_code == 404
    assert client.post("/api/subida/no-existe/archivo", files={"file": ("a.png", _png(seed=12), "image/png")}).status_code == 404

    # generar otro enlace revoca el anterior
    nuevo = client.post(f"/api/consultations/{cid}/estudios/enlace", headers=auth).json()
    assert client.get(f"/api/subida/{enlace['token']}").status_code == 404
    assert client.get(f"/api/subida/{nuevo['token']}").status_code == 200

    # caducado: 404
    from app.db import db
    with db() as conn:
        conn.execute("UPDATE enlaces_subida SET expires_at = ? WHERE token = ?", (time.time() - 1, nuevo["token"]))
    assert client.get(f"/api/subida/{nuevo['token']}").status_code == 404

    # revocar a mano
    otro = client.post(f"/api/consultations/{cid}/estudios/enlace", headers=auth).json()
    assert client.delete(f"/api/consultations/{cid}/estudios/enlace", headers=auth).json()["ok"]
    assert client.get(f"/api/subida/{otro['token']}").status_code == 404


def test_url_publica_configurada_manda(client, auth, consulta, monkeypatch):
    from app.routes import estudios
    monkeypatch.setattr(estudios, "PUBLIC_URL", "http://192.168.100.43:5174/")
    r = client.post(f"/api/consultations/{consulta['id']}/estudios/enlace", headers={**auth, "Origin": "http://localhost:5174"})
    assert r.json()["url"].startswith("http://192.168.100.43:5174/subir/")


def test_consulta_ajena_es_404(client, auth, consulta):
    r = client.post("/api/users", json={"username": "otra_dra", "password": "clave12345", "role": "medico", "name": "Otra"}, headers=auth)
    assert r.status_code == 200, r.text
    tok = client.post("/api/auth/login", json={"username": "otra_dra", "password": "clave12345"}).json()["token"]
    r = client.post("/api/auth/change-password", json={"current_password": "clave12345", "new_password": "clave67890"},
                    headers={"Authorization": f"Bearer {tok}"})
    otra = {"Authorization": f"Bearer {r.json()['token']}"}
    cid = consulta["id"]
    assert client.get(f"/api/consultations/{cid}/estudios", headers=otra).status_code == 404
    assert client.post(f"/api/consultations/{cid}/estudios/enlace", headers=otra).status_code == 404
    assert _subir(client, otra, cid, "a.png", _png(seed=14)).status_code == 404


def test_aparecen_en_el_expediente(client, auth, consulta, patient):
    _subir(client, auth, consulta["id"], "ultrasonido.jpg", _png(seed=15), "image/png")
    exp = client.get(f"/api/patients/{patient['id']}/expediente", headers=auth).json()
    assert exp["conteos"]["aportados"] >= 1 and exp["aportados"][0]["nombre"] == "ultrasonido.jpg"
    d = client.post(f"/api/patients/{patient['id']}/expediente/resumen", headers=auth).json()
    assert "Estudios que trajo el paciente" in d["resumen"]
    q = client.post(f"/api/patients/{patient['id']}/expediente/preguntar", json={"pregunta": "¿trajo algún archivo?"}, headers=auth).json()
    assert "ultrasonido.jpg" in q["respuesta"]



def test_nueva_consulta_no_pisa_un_borrador_con_estudios(client, auth, patient):
    """11-oct: «Nueva consulta» por cefalea reutilizaba el borrador de dolor de
    garganta del mismo día (que ya tenía estudios subidos) y le pisaba el motivo.
    Un borrador vacío sí se corrige (comportamiento previo); uno con estudios o
    nota está en curso y la nueva consulta es otra."""
    a = client.post("/api/consultations", json={"patient_id": patient["id"], "motivo": "dolor de garganta"}, headers=auth).json()
    assert _subir(client, auth, a["id"], "labs.png", _png(seed=21)).status_code == 200
    b = client.post("/api/consultations", json={"patient_id": patient["id"], "motivo": "cefalea"}, headers=auth).json()
    assert b["id"] != a["id"] and b["motivo"] == "cefalea" and b["retomada"] is False
    from app.db import db
    with db() as conn:
        assert conn.execute("SELECT motivo FROM consultations WHERE id = ?", (a["id"],)).fetchone()["motivo"] == "dolor de garganta"
        assert conn.execute("SELECT count(*) FROM estudios_aportados WHERE consultation_id = ?", (a["id"],)).fetchone()[0] == 1
    # el borrador nuevo y vacío sí se corrige con otro motivo (no se acumulan vacíos)
    c = client.post("/api/consultations", json={"patient_id": patient["id"], "motivo": "mareo"}, headers=auth).json()
    assert c["id"] == b["id"] and c["motivo"] == "mareo"
    # el refresco (solo_retomar) vuelve al borrador más reciente
    r = client.post("/api/consultations", json={"patient_id": patient["id"], "solo_retomar": True}, headers=auth).json()
    assert r["id"] == b["id"]
