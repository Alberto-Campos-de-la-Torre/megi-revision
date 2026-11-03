import base64
import io

import httpx
from PIL import Image

from app.services import analisis_estudios as an
from test_radiologia_megi import _png


def preparar(client, auth, patient, monkeypatch):
    monkeypatch.setattr(an, "TYPESAFE_URL", "")
    monkeypatch.setattr(an, "ECO_URL", "http://eco.test")
    cid = client.post(f"/api/patients/{patient['id']}/radiologia/carpeta", headers=auth).json()["id"]
    eid = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("eco.png", _png(3), "image/png")}, headers=auth).json()["id"]
    return cid, eid


def test_eco_seleccion_persistente_y_reanalisis(client, auth, patient, monkeypatch):
    cid, eid = preparar(client, auth, patient, monkeypatch)
    llamadas = []
    b = io.BytesIO(); Image.new("RGB", (2, 2)).save(b, "PNG")
    def post(url, *, json, timeout):
        llamadas.append(json)
        return httpx.Response(200, request=httpx.Request("POST", url), json={
            "nombre_modelo": "Megi_eco_mama_consenso", "version": "eco-v1", "experimental": True,
            "resumen": "EXPERIMENTAL · sin uso comercial; medidas 20 × 15 px. Sin consenso.",
            "imagen": base64.b64encode(b.getvalue()).decode()})
    monkeypatch.setattr(an.httpx, "post", post)
    ruta = f"/api/consultations/{cid}/estudios/{eid}"
    seleccion = {"organo": "mama", "caja_xyxy": [10, 20, 100, 110]}
    assert client.post(ruta + "/ecografia", json=seleccion, headers=auth).status_code == 200
    assert llamadas[0]["organo"] == "mama" and llamadas[0]["mm_por_pixel"] is None
    assert llamadas[0]["clasificar_tiroides"] is False
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    assert d["estudios"][0]["tipo"] == "ecografia_mama" and d["estudios"][0]["tipo_p"] is None
    assert "Sin consenso" in d["prediagnostico"]["texto"]
    assert client.get(ruta + "/ecografia/vista", headers=auth).status_code == 200
    assert client.get(ruta + "/ecografia/vista").status_code == 401
    # La relectura usa la selección guardada, sin enviar la eco al clasificador de RX.
    monkeypatch.setattr(an, "identificar", lambda *_: (_ for _ in ()).throw(AssertionError("no clasificar RX")))
    assert client.post(ruta + "/analizar", headers=auth).status_code == 200
    assert len(llamadas) == 2
    otra = client.post("/api/consultations", json={"patient_id": patient["id"], "motivo": "otra"}, headers=auth).json()["id"]
    assert client.post(f"/api/consultations/{otra}/estudios/{eid}/ecografia", json=seleccion, headers=auth).status_code == 404
    assert client.get(f"/api/consultations/{otra}/estudios/{eid}/ecografia/vista", headers=auth).status_code == 404


def test_eco_rechaza_cajas_y_escala(client, auth, patient, monkeypatch):
    cid, eid = preparar(client, auth, patient, monkeypatch)
    ruta = f"/api/consultations/{cid}/estudios/{eid}/ecografia"
    for caja in ([0, 0, 0, 30], [-1, 0, 30, 30], [0, 0, 10000, 30]):
        assert client.post(ruta, json={"organo": "tiroides", "caja_xyxy": caja}, headers=auth).status_code == 422
    assert client.post(ruta, json={"organo": "abdomen", "caja_xyxy": [1, 1, 20, 20]}, headers=auth).status_code == 422
    assert client.post(ruta, json={"organo": "mama", "caja_xyxy": [1, 1, 20, 20], "mm_por_pixel": 0}, headers=auth).status_code == 422


def test_eco_servicio_caido_sin_resultados_fabricados(client, auth, patient, monkeypatch):
    cid, eid = preparar(client, auth, patient, monkeypatch)
    monkeypatch.setattr(an, "ECO_URL", "")
    client.post(f"/api/consultations/{cid}/estudios/{eid}/ecografia", json={"organo": "tiroides", "caja_xyxy": [1, 1, 20, 20]}, headers=auth)
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    assert d["estudios"][0]["analisis"][0]["status"] == "error"
    assert "MEGI_ECO_URL" in d["estudios"][0]["analisis"][0]["error"]


def test_catalogo_eco_independiente_de_rx(client, auth, monkeypatch):
    monkeypatch.setattr(an, "typesafe_disponible", lambda: False)
    monkeypatch.setattr(an, "eco_disponible", lambda: True)
    d = client.get("/api/radiologia/modelos", headers=auth).json()
    por = {m["clave"]: m for m in d["modelos"]}
    assert por["ecografia"]["conectado"] is True and por["torax"]["conectado"] is False
    assert all(m["experimental"] and m["uso_comercial"] is False for m in d["modelos"])
