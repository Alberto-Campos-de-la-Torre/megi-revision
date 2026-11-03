"""Validador de hechos clínicos: defensa dura presentes ↔ negados/alarmas."""
from app.services.facts_validator import validate


def test_fiebre_negada_y_alarma_no_queda_presente():
    # el bug real: 'Fiebre' negada + como alarma NO debe estar en presentes
    facts = {
        "sintomas_presentes": ["Edema", "Fiebre", "Cansancio"],
        "sintomas_negados": ["Fiebre", "Dolor toracico"],
        "datos_alarma_condicionales": ["Fiebre", "Dificultad respiratoria"],
    }
    out = validate(facts)
    pres = [x.lower() for x in out["sintomas_presentes"]]
    assert "fiebre" not in pres
    assert "edema" in pres and "cansancio" in pres
    assert "Fiebre" in out.get("facts_conflicts", [])


def test_presente_solo_en_alarma_se_retira():
    facts = {
        "sintomas_presentes": ["Disminucion de orina"],
        "sintomas_negados": [],
        "datos_alarma_condicionales": ["Disminucion de orina", "Confusion"],
    }
    out = validate(facts)
    assert out["sintomas_presentes"] == []  # solo era alarma condicional


def test_no_toca_presentes_legitimos():
    facts = {
        "sintomas_presentes": ["Tos", "Rinorrea"],
        "sintomas_negados": ["Fiebre"],
        "datos_alarma_condicionales": ["Dificultad respiratoria"],
    }
    out = validate(facts)
    assert set(x.lower() for x in out["sintomas_presentes"]) == {"tos", "rinorrea"}
    assert "facts_conflicts" not in out


def test_dedupe_y_acentos():
    facts = {"sintomas_presentes": ["Náusea", "Nausea", "náusea "], "exploracion": ["Abdomen blando", "abdomen blando"]}
    out = validate(facts)
    assert len(out["sintomas_presentes"]) == 1
    assert len(out["exploracion"]) == 1


def test_no_muta_entrada():
    import copy
    original = {"sintomas_presentes": ["Fiebre"], "sintomas_negados": ["Fiebre"]}
    snap = copy.deepcopy(original)
    validate(original)
    assert original == snap
