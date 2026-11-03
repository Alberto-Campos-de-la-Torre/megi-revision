"""Informes radiológicos: estructura del dictado, edición y firma.

Lo que se protege: que el dictado NUNCA se pierda, que un informe firmado no se
pueda tocar, y que el reparto por encabezados funcione sin LLM.
"""
import pytest

from app.services import radiologia as rx


# --------------------------------------------------------- reparto del dictado
def test_reparte_cuando_el_radiologo_nombra_las_secciones():
    r = rx.dividir_secciones(
        "Técnica: radiografía de tórax PA. Hallazgos: opacidad en lóbulo inferior derecho. "
        "Impresión: neumonía basal derecha.")
    assert r["estructurado"]
    assert r["secciones"]["tecnica"] == "radiografía de tórax PA"
    assert r["secciones"]["hallazgos"] == "opacidad en lóbulo inferior derecho"
    assert r["secciones"]["impresion"] == "neumonía basal derecha"


def test_sin_encabezados_no_inventa_reparto():
    # Es la señal de que hace falta el LLM (o repartir a mano).
    r = rx.dividir_secciones("se observa una opacidad en la base derecha")
    assert not r["estructurado"] and r["secciones"] == {}


def test_reconoce_sinonimos_dictados():
    r = rx.dividir_secciones("Protocolo: cortes axiales. Conclusión: sin alteraciones.")
    assert "tecnica" in r["secciones"] and "impresion" in r["secciones"]


def test_normalizacion_no_desplaza_los_cortes():
    # NFKD normal expandiría "½" y "cm²" y el informe se partiría por donde no toca.
    texto = "Técnica: TAC ½ dosis, lesión de 2 cm². Impresión: estable."
    r = rx.dividir_secciones(texto)
    assert r["secciones"]["tecnica"] == "TAC ½ dosis, lesión de 2 cm²"
    assert r["secciones"]["impresion"] == "estable"


def test_una_seccion_dictada_dos_veces_se_acumula():
    r = rx.dividir_secciones("Hallazgos: nódulo apical. Hallazgos: derrame pleural leve.")
    assert "nódulo apical" in r["secciones"]["hallazgos"]
    assert "derrame pleural leve" in r["secciones"]["hallazgos"]


def test_dictado_vacio():
    assert rx.dividir_secciones("")["estructurado"] is False


def test_tecnica_propuesta_por_modalidad():
    assert "Proyecciones" in rx.informe_vacio("radiografia")["tecnica"]
    assert rx.informe_vacio("otro")["tecnica"] == ""
    assert rx.informe_vacio("modalidad-inexistente")["hallazgos"] == ""


def test_no_se_firma_sin_hallazgos_ni_impresion():
    ok, faltan = rx.listo_para_firmar({"hallazgos": "", "impresion": ""})
    assert not ok and set(faltan) == {"hallazgos", "impresion"}
    ok2, _ = rx.listo_para_firmar({"hallazgos": "normal", "impresion": "estudio normal"})
    assert ok2


# ------------------------------------------------------------------ endpoints
@pytest.fixture()
def informe(client, auth, patient):
    r = client.post("/api/radiologia/informes",
                    json={"patient_id": patient["id"], "modalidad": "radiografia",
                          "region": "tórax", "indicacion": "tos y fiebre"}, headers=auth)
    assert r.status_code == 200
    return r.json()


def test_catalogo_de_modalidades(client, auth):
    m = client.get("/api/radiologia/modalidades", headers=auth).json()
    assert {x["id"] for x in m} >= {"radiografia", "tomografia", "resonancia"}


def test_crear_informe_propone_la_tecnica(client, auth, informe):
    assert informe["status"] == "borrador"
    assert informe["modalidad_label"] == "Radiografía"
    assert "Proyecciones" in informe["tecnica"]


def test_modalidad_invalida_se_rechaza(client, auth, patient):
    r = client.post("/api/radiologia/informes",
                    json={"patient_id": patient["id"], "modalidad": "ecografia-cuantica"}, headers=auth)
    assert r.status_code == 400


def test_editar_y_listar(client, auth, informe, patient):
    r = client.patch(f"/api/radiologia/informes/{informe['id']}",
                     json={"hallazgos": "opacidad basal derecha"}, headers=auth)
    assert r.json()["hallazgos"] == "opacidad basal derecha"
    lista = client.get(f"/api/radiologia/informes?patient_id={patient['id']}", headers=auth).json()
    assert [x["id"] for x in lista] == [informe["id"]]


def test_firmar_exige_hallazgos_e_impresion(client, auth, informe):
    r = client.post(f"/api/radiologia/informes/{informe['id']}/firmar", headers=auth)
    assert r.status_code == 400 and "hallazgos" in r.json()["detail"]


def test_informe_firmado_queda_sellado_e_inmutable(client, auth, informe):
    client.patch(f"/api/radiologia/informes/{informe['id']}",
                 json={"hallazgos": "opacidad basal", "impresion": "neumonía"}, headers=auth)
    firmado = client.post(f"/api/radiologia/informes/{informe['id']}/firmar", headers=auth).json()
    assert firmado["status"] == "firmado"
    assert firmado["content_hash"].startswith("sha256:") and firmado["signed_at"]

    # Ni se edita ni se vuelve a firmar: para corregir, adenda.
    assert client.patch(f"/api/radiologia/informes/{informe['id']}",
                        json={"impresion": "otra cosa"}, headers=auth).status_code == 409
    assert client.post(f"/api/radiologia/informes/{informe['id']}/firmar",
                       headers=auth).status_code == 409


def test_informe_ajeno_no_existe(client, auth):
    assert client.get("/api/radiologia/informes/IR-nada", headers=auth).status_code == 404
    assert client.patch("/api/radiologia/informes/IR-nada", json={"hallazgos": "x"},
                        headers=auth).status_code == 404


def test_exige_sesion(client, informe):
    assert client.get(f"/api/radiologia/informes/{informe['id']}").status_code in (401, 403)
