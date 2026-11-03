"""Unit puro de asr_service/clinical.py: normalización que evita el crash del
render y unifica la clave de temperatura (#6). No levanta FastAPI ni el modelo."""
from clinical import normalize_facts


def test_allergies_dict_coerced_to_string():
    # El LLM a veces devuelve alergias como objetos {alergeno, reaccion} -> crasheaba el front.
    f = normalize_facts({"alergias": [{"alergeno": "Penicilina", "reaccion": "ronchas"}, "Latex"]})
    assert all(isinstance(x, str) for x in f["alergias"])
    low = [x.lower() for x in f["alergias"]]
    assert "penicilina" in low and "latex" in low


def test_chronic_dict_coerced_to_string():
    f = normalize_facts({"antecedentes_cronicos": [{"nombre": "Hipertensión"}, "DM2"]})
    assert all(isinstance(x, str) for x in f["antecedentes_cronicos"])


def test_vital_alias_temperatura_to_temp():
    f = normalize_facts({"signos_vitales": {"temperatura": "37 C", "saturacion_oxigeno": "98%"}})
    sv = f["signos_vitales"]
    assert sv.get("temp") == "37 C"
    assert sv.get("spo2") == "98%"


def test_vital_object_value_coerced_to_string():
    f = normalize_facts({"signos_vitales": {"ta": {"value": "120/80", "unit": "mmHg"}}})
    assert isinstance(f["signos_vitales"]["ta"], str)
    assert "120/80" in f["signos_vitales"]["ta"]
