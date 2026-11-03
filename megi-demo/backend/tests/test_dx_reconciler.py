"""Módulo de reconciliación de diagnósticos: el CIE-10 viene del catálogo, no del LLM."""
from app.services.dx_reconciler import reconcile


def test_asigna_cie_desde_catalogo():
    facts = {
        "dx_principal_texto": ["Enfermedad renal crónica", "Diabetes mellitus tipo 2"],
        "dx_diferenciales_texto": ["Hipertensión esencial"],
    }
    out = reconcile(facts)["clinical_facts"]
    dxs = out["diagnosticos"]
    codes = {d["texto"]: d["code"] for d in dxs}
    assert codes["Enfermedad renal crónica"] == "N18.9"
    assert codes["Diabetes mellitus tipo 2"] == "E11.9"
    assert dxs[0]["principal"] is True and dxs[1]["principal"] is False
    dif = out["diagnosticos_diferenciales"]
    assert dif[0]["code"] == "I10"  # hipertensión esencial


def test_dx_no_en_catalogo_queda_sin_codigo():
    # un diagnóstico raro que el set curado no cubre -> code vacío, NO inventado
    facts = {"dx_principal_texto": ["Síndrome de Munchausen por poder"], "dx_diferenciales_texto": []}
    out = reconcile(facts)
    d = out["clinical_facts"]["diagnosticos"][0]
    assert d["code"] == "" and d["en_catalogo"] is False
    assert "Síndrome de Munchausen por poder" in out["sin_codigo"]


def test_impresion_diagnostica_legible():
    facts = {"dx_principal_texto": ["Lumbalgia"], "dx_diferenciales_texto": []}
    out = reconcile(facts)["clinical_facts"]
    assert out["impresion_diagnostica"] == ["Lumbalgia"]
    assert out["diagnosticos"][0]["code"] == "M54.5"


def test_vacio_no_revienta():
    out = reconcile({})["clinical_facts"]
    assert out["diagnosticos"] == [] and out["diagnosticos_diferenciales"] == []


def test_marca_exacto_vs_aproximado():
    facts = {
        "dx_principal_texto": ["Enfermedad renal crónica", "Nefropatía diabética"],
        "dx_diferenciales_texto": [],
    }
    dxs = reconcile(facts)["clinical_facts"]["diagnosticos"]
    by = {d["texto"]: d for d in dxs}
    # 'enfermedad renal crónica' → N18.9: la etiqueta contiene 'enfermedad' y 'renal' -> exacto
    assert by["Enfermedad renal crónica"]["match"] == "exacto"
    # 'nefropatía diabética' → un código de nefropatía que NO dice 'diabética' -> aproximado
    assert by["Nefropatía diabética"]["match"] == "aproximado"


def test_sin_codigo_tiene_match_sin_codigo():
    d = reconcile({"dx_principal_texto": ["Síndrome de Munchausen por poder"]})["clinical_facts"]["diagnosticos"][0]
    assert d["match"] == "sin_codigo" and d["code"] == ""


def test_catalogo_ampliado_cubre_mas_que_los_curados():
    # el catálogo completo (PDF oficial) trae códigos que el set curado de 59 no tenía
    from app.routes.cie10 import _INDEX
    assert len(_INDEX) > 5000  # ~10.5k códigos
    # diagnósticos que ANTES quedaban sin código, ahora resuelven
    for dx, prefijo in [("Insuficiencia renal aguda", "N17"), ("Síndrome nefrótico", "N04")]:
        d = reconcile({"dx_principal_texto": [dx]})["clinical_facts"]["diagnosticos"][0]
        assert d["code"].startswith(prefijo), f"{dx} -> {d['code']}"


def test_curados_frecuentes_ganan_ante_empate():
    # con miles de códigos, un dx común debe resolver al código curado correcto
    for dx, code in [("Gastritis", "K29.7"), ("Lumbalgia", "M54.5"), ("Faringitis", "J02.9")]:
        d = reconcile({"dx_principal_texto": [dx]})["clinical_facts"]["diagnosticos"][0]
        assert d["code"] == code, f"{dx} -> {d['code']} (esperado {code})"
