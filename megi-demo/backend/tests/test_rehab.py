"""Detección de consulta de rehabilitación y búsqueda de protocolo (services/rehab.py).

Dos riesgos distintos, y las pruebas los separan:

  DETECTAR mal   -> se le ofrece rehabilitación a una consulta que no lo es.
                    Molesto pero barato: es una sugerencia descartable.
  PROPONER mal   -> se le enseña al médico una dosimetría que no corresponde
                    (`US 1.4 W/cm²` del protocolo vecino). Eso no se ve a simple
                    vista, así que el listón para proponer protocolo es mucho
                    más alto que el de detectar: ante la duda, lista vacía.
"""
import pytest

from app.services import rehab


def _analizar(a="", p="", s="", o=""):
    return rehab.analizar({"S": s, "O": o, "A": a, "P": p})


# --- detección ------------------------------------------------------------

def test_detecta_por_frase_estandar_del_plan():
    r = _analizar(a="Tendinopatia de supraespinoso", p="TF institucional 10 sesiones.")
    assert r["es_rehabilitacion"]


def test_detecta_por_modalidades_y_abreviaturas_juntas():
    """Sin la palabra «rehabilitación» por ningún lado: CHC + US + Codman."""
    r = _analizar(a="Hombro doloroso", p="CHC a hombro derecho, US, ejercicios de Codman.")
    assert r["es_rehabilitacion"]


def test_no_detecta_control_de_diabetes():
    r = _analizar(a="DM2 en control", p="Metformina 1000 mg c/12 h. Control en 3 meses.")
    assert not r["es_rehabilitacion"]


def test_no_detecta_cefalea_tensional():
    """«tens» vive dentro de «tensional»: por subcadena, esta consulta se marcaba
    como rehabilitación. Las señales se buscan con frontera de palabra."""
    r = _analizar(a="Cefalea de tipo tensional episodica",
                  p="Paracetamol 500 mg. Higiene del sueno.")
    assert not r["es_rehabilitacion"]
    assert "tens" not in r["senales"]["modalidades"]


def test_no_detecta_hipertension():
    r = _analizar(a="Hipertension esencial no controlada", p="Losartan 100 mg c/24 h.")
    assert not r["es_rehabilitacion"]


def test_texto_vacio_o_minimo_no_revienta():
    assert not rehab.analizar({})["es_rehabilitacion"]
    assert not _analizar(a="dolor")["es_rehabilitacion"]


def test_devuelve_la_evidencia_no_solo_el_veredicto():
    """Sin saber QUÉ lo disparó, un falso positivo no se puede depurar."""
    r = _analizar(a="Lumbociatalgia", p="Terapia fisica. Ejercicios de Williams.")
    assert r["senales"]["fuertes"] == ["terapia fisica"]
    assert "williams" in r["senales"]["modalidades"]


# --- búsqueda de protocolo ------------------------------------------------

CASOS = [
    ("Tendinopatia de supraespinoso", "Tendinopatía de supraespinoso / pinzamiento subacromial"),
    ("Lumbociatalgia L5-S1", "Lumbociatalgia / radiculopatía L5–S1"),
    ("Sindrome de tunel del carpo", "Síndrome de túnel del carpo"),
    ("Esguince de tobillo derecho", "Esguince de tobillo"),
    ("Paralisis facial periferica", "Parálisis facial periférica"),
    ("Capsulitis adhesiva de hombro", "Capsulitis adhesiva / hombro congelado"),
    ("Fascitis plantar bilateral", "Fascitis plantar"),
]


@pytest.mark.parametrize("dx,esperado", CASOS)
def test_encuentra_el_protocolo_correcto(dx, esperado):
    r = _analizar(a=dx, p="Terapia fisica institucional.")
    assert r["protocolos"], f"sin protocolo para {dx}"
    assert r["protocolos"][0]["nombre"] == esperado


def test_sinonimos_separados_por_barra():
    """«Tendinopatía de supraespinoso / pinzamiento subacromial» son el mismo
    cuadro: cualquiera de los dos nombres debe encontrarlo."""
    r = _analizar(a="Pinzamiento subacromial derecho", p="Terapia fisica.")
    assert r["protocolos"][0]["id"].endswith("tendinopatia-de-supraespinoso-pinzamiento-subacromial")


@pytest.mark.parametrize("dx", ["Epicondilitis lateral derecha", "Epicondilitis medial izquierda"])
def test_modificador_alterno_con_o(dx):
    """«Epicondilitis lateral o medial» son dos etiquetas, no una sola."""
    r = _analizar(a=dx, p="Terapia fisica, US.")
    assert r["protocolos"][0]["nombre"] == "Epicondilitis lateral o medial"


@pytest.mark.parametrize("dx", ["Lesion del manguito rotador derecho",
                                "Tendinosis del manguito rotador"])
def test_nucleo_alterno_con_complemento_compartido(dx):
    """«Lesión o tendinosis del manguito rotador»: el «del manguito rotador» lo
    comparten los dos núcleos."""
    r = _analizar(a=dx, p="Terapia fisica institucional.")
    assert r["protocolos"][0]["nombre"] == "Lesión o tendinosis del manguito rotador"


def test_no_propone_por_coincidencia_parcial():
    """Una «lumbalgia mecánica» NO es «Lumbalgia con sacroilitis»: compartir la
    palabra genérica no basta, y el nombre más corto no debe ganar por serlo."""
    r = _analizar(a="Lumbalgia mecanica recurrente",
                  p="Terapia fisica. Fortalecimiento de core y estiramiento.")
    nombres = [p["nombre"] for p in r["protocolos"]]
    assert "Lumbalgia con sacroilitis" not in nombres


def test_sin_match_confiable_devuelve_vacio():
    """Mejor vacío que un protocolo irrelevante (criterio de dx_reconciler)."""
    r = _analizar(a="Desacondicionamiento tras neumonia", p="Rehabilitacion domiciliaria.")
    assert r["es_rehabilitacion"]          # sí es rehabilitación…
    assert r["protocolos"] == []           # …pero el catálogo no tiene su protocolo


def test_nunca_devuelve_mas_del_tope():
    r = _analizar(a="Lumbalgia cervicalgia hombro rodilla tobillo", p="Terapia fisica.")
    assert len(r["protocolos"]) <= rehab.MAX_PROTOCOLOS


# --- integridad de lo que se entrega --------------------------------------

def test_los_pasos_salen_literales_del_catalogo():
    """El protocolo NO se parafrasea: la dosimetría se entrega tal cual. Los
    pasos llevan además el estado de equipo, así que se compara el TEXTO, que
    es lo que de verdad no puede cambiar."""
    r = _analizar(a="Esguince de tobillo derecho", p="Terapia fisica.")
    p = r["protocolos"][0]
    del_catalogo = next(x for x in rehab.catalogo()["protocolos"] if x["id"] == p["id"])
    assert [s["texto"] for s in p["pasos"]] == [s["texto"] for s in del_catalogo["pasos"]]
    assert [s["dosis"] for s in p["pasos"]] == [s["dosis"] for s in del_catalogo["pasos"]]


def test_la_lateralidad_queda_marcada_sin_resolver():
    """El sistema no elige lado: lo deja explícito para que lo decida el médico."""
    r = _analizar(a="Tendinopatia de supraespinoso", p="Terapia fisica.")
    p = r["protocolos"][0]
    assert p["requiere_lateralidad"]
    assert any("DERECHO/IZQUIERDO" in s["texto"] for s in p["pasos"])


def test_la_advertencia_viaja_con_el_protocolo():
    """La contradicción láser/osteosíntesis no puede quedarse en una nota al pie."""
    r = _analizar(a="PO RAFI de escafoides mano derecha", p="Terapia fisica, laser a cicatriz.")
    p = next(x for x in r["protocolos"] if "escafoides" in x["id"])
    assert p["advertencias"]
    assert "OSTEOSÍNTESIS" in p["advertencias"][0]


def test_catalogo_ausente_no_rompe_la_consulta(monkeypatch):
    """Esto es apoyo: si falta el archivo, se calla; no tumba la consulta."""
    monkeypatch.setattr(rehab, "_catalogo", None)
    monkeypatch.setattr(rehab, "_pesos_cache", None)
    monkeypatch.setattr(rehab, "CATALOGO_PATH", rehab.CATALOGO_PATH.parent / "no-existe.json")
    try:
        assert _analizar(a="Esguince de tobillo", p="Terapia fisica.")["protocolos"] == []
    finally:
        rehab._catalogo = rehab._pesos_cache = rehab._frec_cache = None


# --- perfil de equipo del consultorio -------------------------------------
# En consulta privada cada médico tiene lo suyo. Sugerir la dosis de un aparato
# que no está no solo es inútil: enseña que el sistema no le entiende.

def _base_hombro():
    return next(p for p in rehab.catalogo()["protocolos"]
                if p["nombre"] == "Hombro, protocolo base")


def test_sin_perfil_de_equipo_no_se_toca_nada():
    """No saber qué hay no es lo mismo que saber que no hay."""
    pasos = rehab.adaptar_a_equipo(_base_hombro()["pasos"], None)
    assert {p["equipo_estado"] for p in pasos} == {"disponible"}


def test_con_todo_el_equipo_los_pasos_van_tal_cual():
    pasos = rehab.adaptar_a_equipo(_base_hombro()["pasos"], ["CHC", "US", "TENS", "C.I."])
    assert pasos[0]["equipo_estado"] == "disponible"
    assert pasos[0]["texto"] == _base_hombro()["pasos"][0]["texto"]


def test_aplica_la_sustitucion_que_el_documento_ya_trae():
    """«TENS …; en caso de no haber TENS aplicar US 1.0 W/cm²» — la alternativa
    la escribió el médico, no la inventa el sistema."""
    pasos = rehab.adaptar_a_equipo(_base_hombro()["pasos"], ["CHC", "US", "C.I."])
    p0 = pasos[0]
    assert p0["equipo_estado"] == "sustituido"
    assert "US" in p0["texto"] and "1.0 W/cm²" in p0["texto"]
    assert "TENS" in p0["sustituye_a"]          # queda registrado a qué sustituye


def test_sin_alternativa_el_paso_se_marca_pero_se_ve():
    """No se borra en silencio: que el médico sepa qué queda fuera es parte de
    la indicación. Ocultarlo sería decidir por él."""
    pasos = rehab.adaptar_a_equipo(_base_hombro()["pasos"], ["CHC"])
    p0 = pasos[0]
    assert p0["equipo_estado"] == "sin_equipo"
    assert "TENS" in p0["falta"]
    assert p0["texto"]                           # el texto sigue estando


def test_la_sustitucion_no_se_usa_si_tampoco_hay_con_que():
    """Sustituir TENS por US requiere tener US; si no, es sin_equipo, no otra
    sustitución imposible."""
    pasos = rehab.adaptar_a_equipo(_base_hombro()["pasos"], ["Parafina"])
    assert pasos[0]["equipo_estado"] == "sin_equipo"


def test_los_pasos_sin_aparato_nunca_se_marcan_como_faltantes():
    """Estiramientos, higiene de columna o Codman no dependen de equipo."""
    pasos = rehab.adaptar_a_equipo(_base_hombro()["pasos"], ["CHC"])
    sin_modalidad = [p for p in pasos if not p.get("modalidades")]
    assert sin_modalidad
    assert all(p["equipo_estado"] == "disponible" for p in sin_modalidad)


# --- reglas de adaptación: negación y precisión de los disparadores ---------
# Salieron de simular consultas reales: «niega parestesias» disparaba
# neurodinamia, y «contractura de isquiotibiales» disparaba la regla del trapecio.

def test_un_hallazgo_negado_no_dispara_la_regla():
    r = _analizar(s="Dolor de hombro derecho. Niega parestesias.",
                  o="Jobe y Hawkins positivos.", a="Tendinopatia de supraespinoso", p="Terapia fisica.")
    assert not any(x["hallazgo"].startswith("Tinel") for x in r["reglas"])


def test_el_mismo_hallazgo_afirmado_si_dispara():
    r = _analizar(s="Refiere parestesias en la mano derecha.", o="Tinel positivo.",
                  a="Sindrome de tunel del carpo", p="Terapia fisica.")
    assert any(x["hallazgo"].startswith("Tinel") for x in r["reglas"])


def test_la_negacion_es_de_ventana_corta():
    """«Niega fiebre, pero sí parestesias»: la negación no alcanza a las parestesias."""
    r = _analizar(s="Niega fiebre, tos y malestar, pero sí refiere parestesias nocturnas.",
                  a="Sindrome de tunel del carpo", p="Terapia fisica.")
    assert any(x["hallazgo"].startswith("Tinel") for x in r["reglas"])


def test_contractura_de_isquiotibiales_no_es_de_trapecio():
    r = _analizar(s="Dolor lumbar.", o="Contractura de isquiotibiales, Lasegue positivo.",
                  a="Lumbociatalgia L5-S1", p="Terapia fisica.")
    assert not any("trapecio" in x["hallazgo"].lower() for x in r["reglas"])


def test_contractura_de_trapecio_si_dispara():
    r = _analizar(o="Contractura de trapecio bilateral, espasmo paravertebral.",
                  a="Cervicalgia", p="Terapia fisica.")
    assert any("trapecio" in x["hallazgo"].lower() for x in r["reglas"])


# --- lo que enseñaron 20 consultas simuladas por el pipeline real ------------

@pytest.mark.parametrize("dx,esperado", [
    ("Cuadro compatible con sindrome post COVID-19.", "Estado post COVID-19"),
    ("Cuadro compatible con cervicalgia por contractura muscular.", "Cervicalgia sistematizada"),
    ("Postoperatorio de meniscectomia parcial de rodilla derecha.", "PO artroscopia de rodilla"),
])
def test_alias_para_nombres_descriptivos(dx, esperado):
    """gemma escribe el diagnóstico como se dice; el catálogo a veces lo nombra
    como se hace («…terapia institucional», «PO artroscopia»). Los alias cubren
    ese hueco sin relajar la regla de etiqueta completa."""
    r = _analizar(a=dx, p="Terapia fisica institucional.")
    assert r["protocolos"], f"sin protocolo para {dx}"
    assert r["protocolos"][0]["nombre"].startswith(esperado)


def test_la_impresion_gana_a_los_diferenciales():
    """A = «compatible con lesión del manguito rotador. Considerar capsulitis
    adhesiva». El diagnóstico es el manguito; capsulitis es un diferencial y no
    puede ganar solo porque su etiqueta también esté completa en A."""
    r = _analizar(a="Cuadro compatible con lesion del manguito rotador derecho. "
                    "Considerar capsulitis adhesiva como diagnostico diferencial.",
                  p="Terapia fisica.")
    assert r["protocolos"][0]["nombre"] == "Lesión o tendinosis del manguito rotador"


def test_fisioterapia_en_pasado_no_es_consulta_de_rehabilitacion():
    r = _analizar(s="Congestion nasal de tres dias. Hace anos fue a fisioterapia por la rodilla.",
                  a="Rinofaringitis viral", p="Paracetamol, lavados nasales.")
    assert not r["es_rehabilitacion"]


def test_derivado_a_rehabilitacion_hoy_si_cuenta():
    r = _analizar(s="Viene derivado por su medico familiar a rehabilitacion por dolor de hombro.",
                  a="Tendinopatia de supraespinoso", p="TF institucional.")
    assert r["es_rehabilitacion"]


def test_antecedente_de_fisioterapia_hace_anos_no_cuenta():
    """Así lo reescribe gemma: la marca de historia va ANTES y la de tiempo DESPUÉS."""
    r = _analizar(s="Refiere congestion nasal. Menciona antecedente de fisioterapia por "
                    "patologia de rodilla hace anos con buena respuesta.",
                  a="Cuadro compatible con rinofaringitis viral.", p="Paracetamol.")
    assert not r["es_rehabilitacion"]


def test_diferencial_en_la_misma_frase_no_gana():
    r = _analizar(a="Cuadro compatible con lesion del manguito rotador derecho, considerar "
                    "capsulitis adhesiva.", p="Terapia fisica.")
    assert r["protocolos"][0]["nombre"] == "Lesión o tendinosis del manguito rotador"


def test_una_complicacion_a_descartar_en_el_plan_no_gana_al_diagnostico():
    """Caso real de gemma: A = «Lesión del manguito rotador derecho.» y P termina
    en «…para descartar complicaciones como capsulitis adhesiva». Buscar en
    A + P concatenados hacía ganar a la capsulitis."""
    r = _analizar(a="Lesion del manguito rotador derecho.",
                  p="Plan: terapia fisica, CHC, ultrasonido terapeutico, fortalecimiento. "
                    "Considerar seguimiento de la movilidad para descartar complicaciones "
                    "como capsulitis adhesiva.")
    assert r["protocolos"][0]["nombre"] == "Lesión o tendinosis del manguito rotador"


def test_el_plan_si_sirve_cuando_a_esta_vacia():
    """Al principio de la consulta A no existe: el plan es el único respaldo."""
    r = _analizar(a="", p="Terapia fisica institucional por esguince de tobillo derecho.")
    assert r["protocolos"] and r["protocolos"][0]["nombre"] == "Esguince de tobillo"
