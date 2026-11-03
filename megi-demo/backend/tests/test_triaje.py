"""Triaje antes de la GPU: repetidos, fotos repetidas, imágenes vacías y texto
sin datos no llegan a los modelos."""
import io

import numpy as np
import pytest
from PIL import Image

from app.services import analisis_estudios as an
from app.services import triaje


def _png_im(im) -> bytes:
    b = io.BytesIO(); im.save(b, format="PNG"); return b.getvalue()


def _radiografia(seed=0, size=(640, 520)) -> Image.Image:
    rng = np.random.default_rng(seed)
    base = rng.integers(30, 220, (8, 7), dtype=np.uint8)
    return Image.fromarray(base).resize(size, Image.BICUBIC).convert("RGB")


@pytest.fixture()
def consulta(client, auth, patient):
    r = client.post("/api/consultations", json={"patient_id": patient["id"], "motivo": "control"}, headers=auth)
    return r.json()


def test_huella_y_calidad():
    im = _radiografia(1)
    h = triaje.dhash(_png_im(im))
    w, hh = im.size
    mas_brillo = Image.fromarray(np.clip(np.asarray(im).astype(np.int16) + 25, 0, 255).astype(np.uint8))
    assert triaje.hamming(h, triaje.dhash(_png_im(mas_brillo))) <= triaje.HAMMING_DUPLICADO
    recortada = im.crop((int(w * 0.01), int(hh * 0.01), int(w * 0.99), int(hh * 0.99)))
    assert triaje.hamming(h, triaje.dhash(_png_im(recortada))) <= triaje.HAMMING_DUPLICADO
    assert triaje.hamming(h, triaje.dhash(_png_im(_radiografia(2)))) > triaje.HAMMING_DUPLICADO
    assert triaje.calidad_imagen(_png_im(im))["motivo"] is None
    assert "uniforme" in triaje.calidad_imagen(_png_im(Image.new("RGB", (800, 600), "white")))["motivo"]
    assert "pequeña" in triaje.calidad_imagen(_png_im(Image.new("RGB", (90, 60), (10, 200, 30))))["motivo"]
    assert triaje.texto_sin_estudio("hola que tal, saludos") and triaje.texto_sin_estudio("x")
    assert triaje.texto_sin_estudio("Glucosa 142 mg/dL\nHemoglobina 13.1") is None


def test_repetido_exacto_responde_409_y_no_se_guarda(client, auth, consulta, monkeypatch):
    monkeypatch.setattr(an, "TYPESAFE_URL", "")
    cid = consulta["id"]
    png = _png_im(_radiografia(3))
    assert client.post(f"/api/consultations/{cid}/estudios", files={"file": ("rx.png", png, "image/png")}, headers=auth).status_code == 200
    r = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("rx_copia.png", png, "image/png")}, headers=auth)
    assert r.status_code == 409 and "archivo repetido" in r.json()["detail"] and "rx.png" in r.json()["detail"]
    assert len(client.get(f"/api/consultations/{cid}/estudios", headers=auth).json()["estudios"]) == 1


def test_foto_repetida_y_vacia_se_descartan_sin_gpu(client, auth, consulta, monkeypatch):
    llamadas = []
    monkeypatch.setattr(an, "TYPESAFE_URL", "http://typesafe.test")
    def fake(path, body):
        llamadas.append(path)
        if path == "/api/clasificar":
            return {"tipo": "torax", "clase_bruta": "torax", "p": {"torax": 0.99}, "distancia": 9, "nombre_modelo": "Megi_tipo_estudio"}
        return {"nombre_modelo": "Megi_torax_one", "corrida": "s1_v2", "hallazgos": []}
    monkeypatch.setattr(an, "_post_typesafe", fake)
    cid = consulta["id"]
    im = _radiografia(4)
    client.post(f"/api/consultations/{cid}/estudios", files={"file": ("rx.png", _png_im(im), "image/png")}, headers=auth)
    n_gpu = len(llamadas)
    assert n_gpu == 2

    w, h = im.size
    otra_toma = Image.fromarray(np.clip(np.asarray(im).astype(np.int16) + 20, 0, 255).astype(np.uint8))   # misma placa, otra exposición
    r = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("rx_otra_toma.jpg", _png_im(otra_toma), "image/png")}, headers=auth)
    assert r.status_code == 200
    e = r.json()
    assert e["analisis_estado"] == "descartado" and "foto repetida de «rx.png»" in e["triaje"]["motivo"]

    r = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("negra.png", _png_im(Image.new("RGB", (900, 700), (3, 3, 3))), "image/png")}, headers=auth)
    assert r.json()["analisis_estado"] == "descartado" and "uniforme" in r.json()["triaje"]["motivo"]

    r = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("notas.csv", b"hola,que,tal\nsin,datos,aqui\n" * 3, "text/csv")}, headers=auth)
    assert r.json()["analisis_estado"] == "descartado"

    # ninguna de las tres llegó a la GPU ni al pre-diagnóstico
    assert len(llamadas) == n_gpu
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    assert [x["analisis_estado"] for x in d["estudios"]] == ["listo", "descartado", "descartado", "descartado"]
    assert all(x["analisis"] == [] for x in d["estudios"][1:])
    assert d["estudios"][1]["tipo_label"] == "Descartado en el triaje"
    assert "rx_otra_toma" not in d["prediagnostico"]["texto"] and "[E1] rx.png" in d["prediagnostico"]["texto"]
    assert len(d["prediagnostico"]["hechos"]) == 1


def test_descartado_tambien_desde_el_telefono(client, auth, consulta, monkeypatch):
    monkeypatch.setattr(an, "TYPESAFE_URL", "")
    cid = consulta["id"]
    tok = client.post(f"/api/consultations/{cid}/estudios/enlace", headers=auth).json()["token"]
    r = client.post(f"/api/subida/{tok}/archivo", files={"file": ("blanca.jpg", _png_im(Image.new("RGB", (1000, 800), "white")), "image/png")})
    assert r.status_code == 200 and r.json()["analisis_estado"] == "descartado"
    png = _png_im(_radiografia(5))
    assert client.post(f"/api/subida/{tok}/archivo", files={"file": ("a.png", png, "image/png")}).status_code == 200
    assert client.post(f"/api/subida/{tok}/archivo", files={"file": ("a_otra_vez.png", png, "image/png")}).status_code == 409
