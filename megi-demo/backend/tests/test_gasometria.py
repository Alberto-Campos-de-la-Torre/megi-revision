"""Calculadoras de gasometría, ácido-base y electrolitos.

Los casos son clínicos conocidos y con la cuenta hecha a mano en el comentario:
si alguien toca una fórmula, la prueba tiene que decir POR QUÉ falla, no solo
que un número cambió.
"""
import pytest

from app.services import gasometria as g


# ------------------------------------------------------------------- Winter
def test_winter_es_la_formula_de_winter():
    # HCO3 = 8 -> 1.5*8 + 8 = 20, rango 18-22
    w = g.winter(8)
    assert (w["esperado"], w["min"], w["max"]) == (20.0, 18.0, 22.0)


def test_cetoacidosis_diabetica_con_compensacion_adecuada():
    # pH 7.20 / PCO2 26 / HCO3 12 -> Winter espera 26 ± 2 (24-28): compensa bien
    r = g.interpretar(7.20, 26, 12, na=140, cl=100)
    assert r["trastorno_primario"] == "acidosis metabólica"
    assert r["compensacion"]["adecuada"] is True
    assert r["anion_gap"]["valor"] == 28.0 and r["anion_gap"]["elevado"]


def test_acidosis_metabolica_con_componente_respiratorio_anadido():
    # HCO3 8 -> se espera PCO2 18-22; mide 25: NO compensa, hay algo respiratorio
    r = g.interpretar(7.10, 25, 8, na=140, cl=100)
    assert r["compensacion"]["adecuada"] is False
    assert "acidosis respiratoria concomitante" in r["compensacion"]["lectura"]


def test_hiperventilacion_excesiva_es_alcalosis_respiratoria_anadida():
    # HCO3 8 -> espera 18-22; mide 14: se pasó de compensar
    r = g.interpretar(7.35, 14, 8)
    assert "alcalosis respiratoria concomitante" in r["compensacion"]["lectura"]


# ------------------------------------------------- otros trastornos primarios
def test_alcalosis_metabolica():
    # HCO3 32 -> 0.7*32 + 21 = 43.4, rango 41.4-45.4; mide 45 -> adecuada
    r = g.interpretar(7.50, 45, 32)
    assert r["trastorno_primario"] == "alcalosis metabólica"
    assert r["compensacion"]["adecuada"] is True


def test_acidosis_respiratoria_da_rango_agudo_a_cronico():
    # PCO2 60 -> HCO3 esperado de 26 (aguda) a 31 (crónica)
    r = g.interpretar(7.25, 60, 26)
    assert r["trastorno_primario"] == "acidosis respiratoria"
    assert r["compensacion"]["min"] == 26.0 and r["compensacion"]["max"] == 31.0


def test_ph_normal_no_descarta_trastorno():
    # El error clásico: pH normal con PCO2 y HCO3 alterados. Aquí es donde el
    # cálculo de compensación más sirve, así que se deduce el primario (como
    # "probable") en vez de rendirse: acidosis respiratoria crónica, y con
    # HCO3 36 por encima incluso de la compensación crónica esperada.
    r = g.interpretar(7.40, 60, 36)
    assert r["trastorno_primario"] == "acidosis respiratoria"
    assert r["certeza"] == "probable"
    assert "NO descarta" in r["motivo"]
    assert "alcalosis metabólica concomitante" in r["compensacion"]["lectura"]


def test_certeza_es_clara_cuando_el_ph_lo_dice():
    assert g.interpretar(7.10, 25, 8)["certeza"] == "clara"


def test_gasometria_normal():
    assert g.interpretar(7.40, 40, 24)["trastorno_primario"] == "sin trastorno ácido-base"


# ---------------------------------------------------------------- anión gap
def test_anion_gap_normal_sugiere_hiperclorémica():
    # diarrea: Na 140, Cl 115, HCO3 16 -> AG 9 (normal)
    r = g.interpretar(7.30, 32, 16, na=140, cl=115)
    assert r["anion_gap"]["valor"] == 9.0 and not r["anion_gap"]["elevado"]
    assert any("hiperclorémica" in h for h in r["hallazgos"])


def test_albumina_baja_descubre_un_gap_que_parecia_normal():
    # AG crudo 12 (normal); albúmina 2 -> 12 + 2.5*2 = 17: elevado
    ag = g.anion_gap(140, 116, 12, albumina=2.0)
    assert ag["valor"] == 12.0 and ag["corregido"] == 17.0 and ag["elevado"]


def test_delta_delta_detecta_segundo_trastorno():
    # AG 32, HCO3 8 -> (32-12)/(24-8) = 1.25 -> AG elevado aislado
    assert g.delta_delta(32, 8)["ratio"] == 1.25
    # AG 16, HCO3 8 -> (16-12)/16 = 0.25 -> hay además una hiperclorémica
    assert "hiperclorémica" in g.delta_delta(16, 8)["lectura"]


# -------------------------------------------------------------- electrolitos
def test_sodio_corregido_por_hiperglucemia():
    # glucosa 600 -> exceso 5 -> Katz 130 + 8 = 138; Hillier 130 + 12 = 142
    s = g.sodio_corregido(130, 600)
    assert (s["katz"], s["hillier"]) == (138.0, 142.0)


def test_sodio_corregido_no_baja_con_glucosa_normal():
    assert g.sodio_corregido(140, 90)["katz"] == 140.0


def test_calcio_corregido_por_albumina():
    # Ca 7.6 con albúmina 2 -> 7.6 + 0.8*2 = 9.2 (normal, no hipocalcemia)
    assert g.calcio_corregido(7.6, 2.0)["valor"] == 9.2


def test_potasio_y_lactato_se_señalan():
    r = g.interpretar(7.30, 30, 15, k=6.2, lactato=5.0)
    assert any("hiperpotasemia" in h for h in r["hallazgos"])
    assert any("hipoperfusión" in h for h in r["hallazgos"])


# --------------------------------------------------------------- oxigenación
def test_pafi_clasifica_por_berlin():
    assert g.pafi(60, 0.6)["valor"] == 100.0          # 60/0.6
    assert "grave" in g.pafi(60, 0.6)["clasificacion"]
    assert "moderado" in g.pafi(90, 0.6)["clasificacion"]   # 150
    assert "leve" in g.pafi(150, 0.6)["clasificacion"]      # 250
    assert "sin criterio" in g.pafi(400, 0.6)["clasificacion"]  # 666


# ------------------------------------------------------------- plausibilidad
@pytest.mark.parametrize("kwargs", [
    {"ph": 14, "pco2": 40, "hco3": 24},        # pH imposible
    {"ph": 7.4, "pco2": 400, "hco3": 24},      # PCO2 imposible
    {"ph": 7.4, "pco2": 40, "hco3": 200},      # HCO3 imposible
])
def test_valores_absurdos_se_rechazan(kwargs):
    # Preferimos fallar ruidosamente a interpretar un dato mal tecleado.
    with pytest.raises(g.DatoFueraDeRango):
        g.interpretar(**kwargs)


def test_texto_no_numerico_se_rechaza():
    with pytest.raises(g.DatoFueraDeRango):
        g.interpretar("siete cuarenta", 40, 24)


# ---------------------------------------------------------- serie (seriadas)
def test_tendencia_necesita_al_menos_dos():
    assert g.tendencia([{"ph": 7.2}])["suficiente"] is False


def test_tendencia_detecta_mejoria():
    serie = [{"ph": 7.10, "pco2": 25, "hco3": 8, "lactato": 6.0},
             {"ph": 7.30, "pco2": 35, "hco3": 18, "lactato": 2.0}]
    t = g.tendencia(serie)
    assert t["parametros"]["ph"]["direccion"] == "mejora"
    assert t["parametros"]["lactato"]["direccion"] == "mejora"
    assert t["resumen"].startswith("mejora")


def test_tendencia_detecta_deterioro():
    serie = [{"ph": 7.35, "hco3": 22, "lactato": 1.5},
             {"ph": 7.15, "hco3": 12, "lactato": 4.5}]
    t = g.tendencia(serie)
    assert t["parametros"]["hco3"]["direccion"] == "empeora"
    assert "empeora" in t["resumen"]


def test_tendencia_ignora_parametros_que_faltan():
    t = g.tendencia([{"ph": 7.20}, {"ph": 7.38, "hco3": 24}])
    assert "hco3" not in t["parametros"] and t["parametros"]["ph"]["direccion"] == "mejora"


# ------------------------------------------------------------------- endpoint
def test_endpoint_gasometria(client, auth):
    r = client.post("/api/calculo/gasometria",
                    json={"ph": 7.10, "pco2": 25, "hco3": 8, "na": 140, "cl": 100},
                    headers=auth)
    assert r.status_code == 200
    assert r.json()["trastorno_primario"] == "acidosis metabólica"


def test_endpoint_rechaza_dato_absurdo_con_400(client, auth):
    r = client.post("/api/calculo/gasometria",
                    json={"ph": 14, "pco2": 40, "hco3": 24}, headers=auth)
    assert r.status_code == 400


def test_endpoint_exige_sesion(client):
    r = client.post("/api/calculo/gasometria", json={"ph": 7.4, "pco2": 40, "hco3": 24})
    assert r.status_code in (401, 403)


def test_endpoint_tendencia(client, auth):
    r = client.post("/api/calculo/gasometria/tendencia",
                    json={"serie": [{"ph": 7.10, "lactato": 6}, {"ph": 7.32, "lactato": 2}]},
                    headers=auth)
    assert r.status_code == 200 and r.json()["suficiente"] is True
