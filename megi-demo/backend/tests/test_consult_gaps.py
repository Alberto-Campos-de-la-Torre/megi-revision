"""Sugerencias de interrogatorio durante la consulta (services/consult_gaps.py).

Lo que se protege aquí no es que sugiera, sino que se CALLE cuando toca: estas
sugerencias aparecen a media consulta, y una que sobra cuesta la atención del
médico. De ahí que la mitad de los casos comprueben silencio.

Regla de oro: un hueco existe solo si el dato no está NI en el expediente NI en
lo que ya se habló. Si la condición ya consta en el expediente, no es un hueco —
es una alerta, y de eso responde routes/safety.py:compute_alerts.
"""
from app.services import consult_gaps


def _ids(soap, allergies=None, chronic=None):
    return {g["id"] for g in consult_gaps.detect(soap, allergies or [], chronic or [])}


def _soap(S="", O="", A="", P=""):
    return {"S": S, "O": O, "A": A, "P": P}


# --- fármaco × condición sin preguntar ------------------------------------

def test_aine_sin_preguntar_por_rinon_gastritis_ni_hta():
    ids = _ids(_soap(S="Dolor lumbar de 4 dias.", P="1. Ibuprofeno 400 mg VO c/8 h."))
    assert "farmaco:ibuprofen" in ids


def test_una_sola_sugerencia_por_farmaco_aunque_choque_con_varias_condiciones():
    """El AINE choca con riñón, HTA y estómago. Tres avisos seguidos por la misma
    receta son ruido: se agrupan en uno que las nombra todas."""
    gaps = consult_gaps.detect(_soap(P="1. Ibuprofeno 400 mg c/8 h."), [], [])
    de_farmaco = [g for g in gaps if g["tipo"] == "farmaco_condicion"]
    assert len(de_farmaco) == 1
    texto = de_farmaco[0]["texto"]
    for etiqueta in ("enfermedad renal", "hipertensión", "gastritis"):
        assert etiqueta in texto


def test_usa_el_nombre_escrito_en_el_plan_no_el_patron_de_la_regla():
    gaps = consult_gaps.detect(_soap(P="1. Ibuprofeno 400 mg c/8 h."), [], [])
    assert "Ibuprofeno" in gaps[0]["texto"]
    assert "ibuprofen " not in gaps[0]["texto"]   # el patrón crudo se lee como errata


def test_calla_si_ya_se_pregunto_durante_la_consulta():
    ids = _ids(_soap(S="Niega enfermedad renal, gastritis y no es hipertenso.",
                     P="1. Ibuprofeno 400 mg c/8 h."))
    assert "farmaco:ibuprofen" not in ids


def test_reconoce_la_condicion_aunque_se_escriba_distinto():
    """El médico escribe como habla: 'hipertenso', no 'hipertension'; 'enfermedad
    renal crónica', no 'ERC'. Si no se reconoce la variante, el aviso reaparece
    después de que ya se preguntó — el peor modo de fallar de esta función."""
    for redaccion in ("no es hipertenso", "sin hipertension arterial",
                      "niega presion alta"):
        ids = _ids(_soap(S=f"Niega enfermedad renal, gastritis; {redaccion}.",
                         P="1. Ibuprofeno 400 mg c/8 h."))
        assert "farmaco:ibuprofen" not in ids, redaccion


def test_calla_si_la_condicion_ya_consta_en_el_expediente():
    """Ahí no falta preguntar: falta no recetarlo. Es trabajo de compute_alerts."""
    ids = _ids(_soap(P="1. Metformina 850 mg c/12 h."),
               chronic=["Enfermedad renal cronica estadio 3b"])
    assert "farmaco:metformin" not in ids


def test_betabloqueador_pregunta_por_asma_o_epoc():
    ids = _ids(_soap(P="1. Propranolol 40 mg c/12 h."), allergies=["Ninguna"])
    assert "farmaco:propranolol" in ids


def test_farmacos_distintos_generan_sugerencias_distintas():
    gaps = consult_gaps.detect(
        _soap(P="1. Metformina 850 mg c/12 h.\n2. Naproxeno 250 mg c/12 h."), [], [])
    assert {"farmaco:metformin", "farmaco:naproxen"} <= {g["id"] for g in gaps}


# --- alergias nunca confirmadas -------------------------------------------

def test_avisa_si_receta_y_no_hay_ninguna_alergia_registrada():
    assert "alergias" in _ids(_soap(P="1. Amoxicilina 500 mg VO c/8 h."))


def test_calla_si_el_expediente_ya_tiene_alergias():
    assert "alergias" not in _ids(_soap(P="1. Amoxicilina 500 mg c/8 h."),
                                  allergies=["Penicilina"])


def test_calla_si_ya_se_hablo_de_alergias_en_la_consulta():
    assert "alergias" not in _ids(_soap(S="Niega alergias a medicamentos.",
                                        P="1. Amoxicilina 500 mg c/8 h."))


def test_calla_si_no_se_esta_recetando_nada():
    assert "alergias" not in _ids(_soap(S="Control sano.", P="1. Continuar con dieta."))


# --- dato de alarma mencionado y no explorado ------------------------------

def test_dolor_toracico_sin_exploracion_cardiovascular():
    assert "alarma:dolor toracico" in _ids(
        _soap(S="Refiere dolor toracico opresivo al caminar.", O="Abdomen blando."))


def test_calla_si_la_alarma_ya_se_exploro():
    assert "alarma:dolor toracico" not in _ids(
        _soap(S="Refiere dolor toracico.",
              O="TA 130/80 mmHg. Ruidos cardiacos ritmicos sin soplos."))


def test_disnea_sin_oximetria():
    assert "alarma:disnea" in _ids(_soap(S="Refiere disnea de medianos esfuerzos.",
                                         O="Consciente, orientada."))


# --- silencio y robustez ---------------------------------------------------

def test_consulta_completa_no_sugiere_nada():
    assert _ids(_soap(S="Control. Niega alergias, enfermedad renal y gastritis.",
                      O="TA 120/80 mmHg.", A="Control sano.",
                      P="1. Continuar dieta.")) == set()


def test_soap_vacio_no_revienta():
    assert consult_gaps.detect({}, [], []) == []
    assert consult_gaps.detect(_soap(), [], []) == []


def test_nunca_devuelve_mas_del_tope():
    gaps = consult_gaps.detect(
        _soap(S="Refiere dolor toracico, disnea y sangrado.",
              P="1. Ibuprofeno 400 mg.\n2. Metformina 850 mg.\n3. Propranolol 40 mg."), [], [])
    assert len(gaps) <= consult_gaps.MAX_SUGERENCIAS


def test_el_aviso_en_vivo_nunca_emite_tamizaje():
    """Medido en 20 consultas: el tamizaje por edad salía en 19 —«tamiz de cáncer
    colorrectal» en una faringitis—. Es información que el médico ya vio en
    «Antes de empezar»; en vivo es ruido duplicado en el peor momento."""
    gaps = consult_gaps.detect(_soap(S="Refiere odinofagia de dos dias.", A="Faringitis aguda",
                                     P="1. Paracetamol 500 mg."), [], [])
    assert not any(g["tipo"] == "tamizaje" for g in gaps)
    assert all(g["tipo"] in ("farmaco_condicion", "alarma", "alergias") for g in gaps)
