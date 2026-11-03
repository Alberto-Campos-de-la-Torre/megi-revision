"""Motivo de consulta: sugerencias dirigidas y banderas rojas.

Lo que se protege aquí es que el motivo cambie DE VERDAD lo que se sugiere (era
el hueco: quien venía por dolor de rodilla recibía lo mismo que quien venía por
tos) y que las alarmas no se pierdan por debajo de las preguntas de rutina.
"""
import pytest

from app.services.motivo_engine import ALARMA, sugerencias_por_motivo as por_motivo


def _textos(r):
    return " ".join(s["texto"] for s in r["sugerencias"]).lower()


def test_motivo_vacio_no_aporta_nada():
    for vacio in (None, "", "   "):
        r = por_motivo(vacio)
        assert r["sugerencias"] == [] and r["reconocidos"] == []


def test_motivo_desconocido_no_inventa():
    # Preferimos no aportar a inventar preguntas sobre un texto que no entendemos.
    r = por_motivo("viene por dolor de rodilla")
    assert r["sugerencias"] == [] and r["motivo"] == "viene por dolor de rodilla"


def test_dos_motivos_distintos_dan_sugerencias_distintas():
    tos = _textos(por_motivo("tos desde hace tres semanas"))
    pecho = _textos(por_motivo("dolor de pecho"))
    assert "tuberculosis" in tos and "tuberculosis" not in pecho
    assert "coronario" in pecho and "coronario" not in tos


def test_las_alarmas_van_primero():
    r = por_motivo("cefalea intensa")
    assert r["sugerencias"][0]["categoria"] == ALARMA
    assert "trueno" in r["sugerencias"][0]["texto"]


@pytest.mark.parametrize("motivo,clave", [
    ("me duele el pecho", "dolor_toracico"),          # como se dicta de verdad
    ("dolor de pecho", "dolor_toracico"),
    ("le duele la cabeza", "cefalea"),
    ("me duele la garganta", "faringitis"),
    ("le duele el estomago", "dolor_abdominal"),
    ("me duele la espalda", "lumbalgia"),
    ("dificultad para respirar", "disnea"),
    ("trae calentura desde ayer", "fiebre"),
    ("dolor de cabeza fuerte", "cefalea"),
    ("dolor en el estomago", "dolor_abdominal"),
    ("diarrea y vomito", "diarrea"),
    ("ardor al orinar", "urinario"),
    ("dolor lumbar", "lumbalgia"),
    ("se desmayo en la mañana", "mareo"),
    ("dolor de garganta", "faringitis"),
    ("control de presion", "control_cronico"),
    ("control prenatal", "embarazo"),
    ("ansiedad e insomnio", "animo"),
    ("se cayo de las escaleras", "trauma"),
    ("le salio salpullido", "dermatosis"),
    ("palpitaciones", "palpitaciones"),
])
def test_motivos_frecuentes_se_reconocen(motivo, clave):
    assert clave in por_motivo(motivo)["reconocidos"]


def test_reconoce_sin_acentos_y_en_mayusculas():
    assert "cefalea" in por_motivo("MIGRAÑA")["reconocidos"]
    assert "disnea" in por_motivo("DISNEA de esfuerzo")["reconocidos"]


def test_un_motivo_puede_disparar_varios_patrones():
    r = por_motivo("fiebre y tos")
    assert {"fiebre", "tos"} <= set(r["reconocidos"])
    assert r["sugerencias"][0]["categoria"] == ALARMA   # las alarmas de ambos, arriba


def test_motivo_largo_se_recorta():
    r = por_motivo("tos " + "x" * 500)
    assert len(r["motivo"]) == 300


def test_forma_compatible_con_el_panel():
    # El panel pinta estas sugerencias igual que las de edad: misma forma, más
    # `claves` (cómo suena el tema en la consulta) para el seguimiento en vivo.
    s = por_motivo("tos")["sugerencias"][0]
    assert set(s) == {"categoria", "texto", "razon", "fuente", "prioridad", "claves"}


def test_todas_las_sugerencias_traen_claves():
    # Sin claves no hay seguimiento en vivo: una sugerencia muda se quedaría
    # fuera de la lista de pendientes sin que nadie se entere.
    motivos = ["dolor de pecho", "disnea", "tos", "fiebre", "cefalea", "dolor abdominal",
               "diarrea", "ardor al orinar", "lumbalgia", "mareo", "dolor de garganta",
               "control de presion", "embarazo", "ansiedad", "se cayo", "salpullido",
               "palpitaciones"]
    for m in motivos:
        sugs = por_motivo(m)["sugerencias"]
        assert sugs, m
        assert all(s["claves"] for s in sugs), m


# ------------------------------------------------------------------ endpoint
def test_endpoint_post_con_motivo_antepone_lo_del_motivo(client, auth, patient):
    r = client.post(f"/api/patients/{patient['id']}/preconsulta",
                    json={"motivo": "dolor de pecho", "personalizar": False}, headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["motivo_reconocido"] == ["dolor torácico"]
    assert "coronario" in body["sugerencias"][0]["texto"]


def test_endpoint_post_sin_motivo_se_comporta_como_el_get(client, auth, patient):
    con = client.post(f"/api/patients/{patient['id']}/preconsulta",
                      json={"personalizar": False}, headers=auth).json()
    sin = client.get(f"/api/patients/{patient['id']}/preconsulta?personalizar=0",
                     headers=auth).json()
    assert con["sugerencias"] == sin["sugerencias"]


def test_endpoint_post_respeta_la_pertenencia(client, auth):
    r = client.post("/api/patients/NO-EXISTE/preconsulta",
                    json={"motivo": "tos"}, headers=auth)
    assert r.status_code == 404
