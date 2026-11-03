"""Vademécum FDA: puente ES->EN y lookup de secciones (sin LLM)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import vademecum  # noqa: E402


def test_cognate_variants():
    c = vademecum._cognate_en("gabapentina")
    assert "gabapentin" in c              # -ina -> -in
    c2 = vademecum._cognate_en("sertralina")
    assert "sertraline" in c2             # -ina -> -ine
    c3 = vademecum._cognate_en("omeprazol")
    assert "omeprazole" in c3             # -ol -> -ole


def test_lookup_cognate_and_map():
    # cognado directo
    r = vademecum.lookup("celecoxib")
    assert r["matched"] and "celecoxib" in r["matched"]
    assert r["secciones"]
    # mapa ES->EN explícito (paracetamol -> acetaminophen)
    r2 = vademecum.lookup("paracetamol")
    assert r2["matched"] and any("acetaminophen" in m for m in r2["matched"])


def test_lookup_combo_splits_principles():
    # un combo trae secciones de sus componentes
    r = vademecum.lookup("tramadol con paracetamol")
    assert r["matched"]
    keys = " ".join(r["matched"])
    assert "tramadol" in keys or "acetaminophen" in keys


def test_lookup_unknown_returns_empty():
    r = vademecum.lookup("medicamento inexistente xyz")
    assert r["matched"] is None
    assert r["secciones"] == []


def test_only_key_sections_indexed():
    # el índice solo retiene secciones útiles para el catálogo
    r = vademecum.lookup("naproxeno")
    for s in r["secciones"]:
        assert any(k in s["section"].upper() for k in vademecum._KEEP)
