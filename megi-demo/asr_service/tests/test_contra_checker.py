"""Verificador de contraindicaciones (paquete FDA_movil).

Casos de referencia de `FDA_movil/docs/PRUEBAS_Y_USO.md` §P2: los conteos deben ser
IDÉNTICOS en cualquier máquina (misma tabla); solo los tiempos varían. Se salta
si la tabla no está (instalación sin FDA_movil): el ASR funciona sin ella.
No necesita el motor MLX ni bge-m3.
"""
import sys
from collections import Counter
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag.contra_checker import ContraChecker, alertas_altas, contra  # noqa: E402

pytestmark = pytest.mark.skipif(not contra.status()["db_present"],
                                reason="requiere FDA_movil/contra/contraindicaciones.sqlite")


def _sev(res):
    return dict(Counter(a["severidad"] for a in res["alertas"]))


def test_status_no_fuerza_la_carga():
    chk = ContraChecker()
    st = chk.status()
    assert st["db_present"] and st["loaded"] is False and st["error"] is None
    assert chk.available() and chk.n_farmacos == 2248


def test_p2_warfarina_ibuprofeno_embarazo_renal():
    r = contra.check(["warfarina", "ibuprofeno"], ["embarazo", "insuficiencia renal"])
    assert r["farmacos_detectados"] == ["ibuprofen", "warfarin"]
    assert len(r["alertas"]) == 20
    assert _sev(r) == {"absoluta": 1, "mayor": 12, "moderada": 7}
    primera, segunda = r["alertas"][0], r["alertas"][1]
    assert (primera["severidad"], primera["farmaco"], primera["seccion"], primera["objeto"]) == \
        ("absoluta", "warfarin", "CONTRAINDICATIONS", "embarazo")
    assert (segunda["severidad"], segunda["farmaco"], segunda["seccion"], segunda["alerta"]) == \
        ("mayor", "ibuprofen", "DRUG INTERACTIONS", "coincide_farmaco")
    # cita obligatoria y origen en toda alerta
    assert all(a["cita"] and a["fuente"] in ("es", "en_sin_validar") for a in r["alertas"])


def test_p2_metformina_renal_acidosis():
    r = contra.check(["metformina"], ["insuficiencia renal", "acidosis"])
    assert len(r["alertas"]) == 26
    assert _sev(r) == {"absoluta": 16, "mayor": 9, "moderada": 1}
    assert [a["objeto"] for a in r["alertas"][:3]] == \
        ["acidosis metabolica cronica", "acidosis metabolica aguda", "cetoacidosis diabetica"]


def test_p2_fluoxetina_tramadol_cruce():
    r = contra.check(["fluoxetina", "tramadol"])
    assert _sev(r) == {"mayor": 2}
    assert {(a["farmaco"], a["objeto"]) for a in r["alertas"]} == \
        {("fluoxetine", "tramadol"), ("tramadol", "fluoxetine")}


def test_marcas_y_grafias_espanolas():
    assert contra.detect("Coumadin 5 mg") == {"warfarin"}
    assert "cephalexin" in contra.detect("cefalexina 500 mg")
    assert contra.detect("paracetamol") <= {"acetaminophen"} and contra.detect("paracetamol")


def test_check_rx_tres_tipos_de_alerta_y_dedupe():
    rx = [{"nombre": "Warfarina", "dosis": "5 mg", "rol": "indicado"}, "Ibuprofeno 400 mg", "amoxicilina 500 mg"]
    r = contra.check_rx(rx, conditions=["Lumbalgia"], allergies=["penicilina"], age=34, sex="F", embarazo=True)
    assert r["farmacos_detectados"] == ["amoxicillin", "ibuprofen", "warfarin"]
    tipos = {a["tipo_alerta"] for a in r["alertas"]}
    assert tipos == {"farmaco_condicion", "farmaco_farmaco", "alergia"}
    # alergia a penicilina -> amoxicilina, con cita de la etiqueta, una sola vez por sección
    alergias = [a for a in r["alertas"] if a["tipo_alerta"] == "alergia"]
    assert len(alergias) == 1 and alergias[0]["farmaco"] == "amoxicillin" and alergias[0]["cita"]
    # las filas de otras secciones/etiquetas no se pierden: van dentro de la alerta
    assert all(o["cita"] for o in alergias[0].get("otras_citas", []))
    # embarazo -> warfarina absoluta
    assert any(a["farmaco"] == "warfarin" and a["severidad"] == "absoluta"
               and a["tipo_alerta"] == "farmaco_condicion" for a in r["alertas"])
    # nada de "listado": sin condiciones un fármaco solo NO vuelca toda su ficha
    assert all(a["alerta"] != "listado" for a in r["alertas"])
    assert sum(r["resumen"].values()) == len(r["alertas"])


def test_check_rx_sin_condiciones_ni_cruces_no_lista_todo():
    r = contra.check_rx(["metformina 850 mg"])
    assert r["alertas"] == [] and r["resumen"] == {}


def test_alertas_altas_solo_absoluta_y_mayor():
    r = contra.check_rx(["warfarina", "ibuprofeno"], conditions=["embarazo"])
    altas = alertas_altas(r["alertas"])
    assert altas and all(a["severidad"] in ("absoluta", "mayor") for a in altas)
    assert alertas_altas([{"severidad": "moderada"}, {"severidad": "mayor"}, {"severidad": "menor"}]) == [{"severidad": "mayor"}]
    assert alertas_altas([]) == []


def test_rows_para_el_consultor():
    r = contra.rows("Coumadin", limit=3, secciones=("CONTRAINDICATIONS",))
    assert r["farmacos_detectados"] == ["warfarin"]
    assert len(r["filas"]) == 3 and all(f["seccion"] == "CONTRAINDICATIONS" for f in r["filas"])


def test_sin_tabla_no_rompe(tmp_path):
    chk = ContraChecker(db_path=str(tmp_path / "no_existe.sqlite"))
    assert not chk.available()
    assert chk.status()["error"] == "contra_db_not_available"
    assert chk.check_rx(["warfarina"], conditions=["embarazo"])["alertas"] == []


def test_context_text_detecta_farmacos_y_condiciones_mencionados():
    """Consulta en vivo: el médico MENCIONA prednisona, ibuprofeno y diclofenaco en
    un paciente con insuficiencia renal. Sin receta explícita ya deben salir alertas,
    y la mención del propio fármaco no debe leerse como hipersensibilidad."""
    texto = ("Antecedentes: diabetes mellitus tipo 2, insuficiencia renal. "
             "Corticosteroides sistemicos como prednisona podrian intentar recetarse; "
             "AINE no selectivos como ibuprofeno o diclofenaco podrian recetarse como analgesia.")
    r = contra.check_rx([], context_text=texto, age=58, sex="M")
    assert {"prednisone", "ibuprofen", "diclofenac"} <= set(r["farmacos_detectados"])
    conds = [a for a in r["alertas"] if a["tipo_alerta"] == "farmaco_condicion"]
    assert any(a["farmaco"] == "diclofenac" and a["condicion"] == "insuficiencia renal" for a in conds)
    # solo condiciones/poblaciones del paciente salen del texto, nunca nombres de fármaco
    assert all(a["tipo"] in ("condicion", "poblacion", "procedimiento") for a in conds)
    # el cruce entre los fármacos mencionados sí sale, por la vía fármaco–fármaco
    assert any(a["tipo_alerta"] == "farmaco_farmaco" for a in r["alertas"])
    assert all(a["alerta"] != "listado" for a in r["alertas"])
    # "plasma" no dispara "asma": el objeto debe aparecer como palabra completa
    r2 = contra.check_rx([], context_text="propranolol; se revisa el plasma del paciente")
    assert not any(a.get("condicion") == "asma" for a in r2["alertas"])


def test_fusion_por_farmaco_y_condicion_conserva_las_otras_citas():
    """Ketorolaco en adulto mayor: boxed warning + interacciones hablan de "edad
    avanzada". Antes salían como dos alertas iguales a la vista; ahora es una con
    la más grave arriba y el resto en `otras_citas`."""
    r = contra.check_rx(["ketorolaco"], age=72)
    edad = [a for a in r["alertas"] if a.get("condicion") == "pacientes de edad avanzada"]
    assert len(edad) == 1
    assert edad[0]["severidad"] == "absoluta" and edad[0]["seccion"] == "BOXED WARNING"
    secciones = {o["seccion"] for o in edad[0]["otras_citas"]}
    assert "DRUG INTERACTIONS" in secciones


def test_interaccion_por_clase_tramadol_carisoprodol():
    """La etiqueta de tramadol no nombra al carisoprodol: dice "relajantes
    musculares" / "depresores del SNC". El mapa de clases hace el cruce."""
    r = contra.check_rx(["tramadol", "carisoprodol"])
    cruces = [a for a in r["alertas"] if a["tipo_alerta"] == "farmaco_farmaco"]
    # UNA alerta por par, aunque las dos etiquetas lo cuenten cada una desde su lado
    assert len(cruces) == 1 and {cruces[0]["farmaco"], cruces[0]["con_farmaco"]} == {"tramadol", "carisoprodol"}
    assert cruces[0].get("clase") in ("relajante muscular", "opioide")
    assert cruces[0]["cita"] and any("desde la etiqueta de" in o["objeto"] for o in cruces[0].get("otras_citas", []))
    # sin clase en común no se inventa nada
    r2 = contra.check_rx(["levofloxacino", "carisoprodol"])
    assert not any(a["tipo_alerta"] == "farmaco_farmaco" for a in r2["alertas"])


def test_texto_libre_tolera_nombres_deformados_por_el_asr():
    """Consulta real: el ASR escribió "ketrolaco" y "caripromodol" y no salió
    ninguna alerta de ketorolaco ni de carisoprodol."""
    texto = ("se le prepara ketrolaco en tabletas de 10 miligramos cada 8 horas por 15 dias; "
             "tambien caripromodol con meloxicam cada 12 horas y tramador con gotas")
    r = contra.check_rx([], context_text=texto, age=68)
    assert {"ketorolac", "carisoprodol", "meloxicam", "tramadol"} <= set(r["farmacos_detectados"])
    # la pasada laxa NO aplica a recetas explícitas (contrato del paquete intacto)
    assert contra.check(["ketrolaco"])["farmacos_detectados"] == []
    # y no convierte palabras clínicas en fármacos
    r2 = contra.check_rx([], context_text="consolidacion osea completa, osteosintesis, radiografia de control, tratamiento")
    assert r2["farmacos_detectados"] == []


def test_par_de_aine_sale_una_vez_con_la_severidad_mas_alta():
    r = contra.check_rx(["ketorolaco", "meloxicam"])
    pares = [a for a in r["alertas"] if a["tipo_alerta"] == "farmaco_farmaco"
             and {a["farmaco"], a["con_farmaco"]} == {"ketorolac", "meloxicam"}]
    assert len(pares) == 1 and pares[0]["severidad"] == "absoluta"
