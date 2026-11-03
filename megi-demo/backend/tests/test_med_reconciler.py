"""Módulo de reconciliación de medicamentos: normaliza vs catálogo + rx-check."""
from app.services.med_reconciler import reconcile


def _facts():
    return {
        "medicamentos": [{"nombre": "Paracetamol 500 mg", "rol": "indicado"}],
        "medicamentos_habitual": [
            {"nombre": "Sertralina 50 mg", "rol": "habitual"},
            {"nombre": "Amlodipino 5 mg", "rol": "habitual"},
        ],
        "medicamentos_suspender": [{"nombre": "Ibuprofeno", "rol": "suspender"}],
        "medicamentos_automedicacion": [{"nombre": "Ibuprofeno", "rol": "automedicacion"}],
    }


def _seed_amitriptilina_sertralina_grave():
    from datetime import datetime, timezone
    from app.db import db
    now = datetime.now(timezone.utc).isoformat()
    with db() as conn:
        for g in ("amitriptilina", "sertralina"):
            conn.execute("INSERT OR IGNORE INTO medications (generico, sinonimos, estado, created_at, "
                         "aprobado_por, aprobado_en) VALUES (?,?,?,?,?,?)",
                         (g, "[]", "aprobado", now, "king", now))
        a, b = sorted(["amitriptilina", "sertralina"])
        conn.execute("DELETE FROM drug_interactions WHERE farmaco_a=? AND farmaco_b=?", (a, b))
        conn.execute("INSERT INTO drug_interactions (farmaco_a, farmaco_b, severidad, mecanismo, "
                     "recomendacion, fuente, estado, created_at) VALUES (?,?,?,?,?,'test','aprobado',?)",
                     (a, b, "grave", "serotoninergico", "evitar", now))


def test_reconcile_marca_en_catalogo(client, auth):
    # celecoxib no está; sertralina sí (si el catálogo la tiene aprobada)
    _seed_amitriptilina_sertralina_grave()
    out = reconcile(_facts(), allergies=[], chronic=[])
    facts = out["clinical_facts"]
    # cada med queda enriquecido con en_catalogo / generico
    for key in ("medicamentos", "medicamentos_habitual", "medicamentos_suspender"):
        for m in facts[key]:
            assert "en_catalogo" in m and "generico" in m
    sert = facts["medicamentos_habitual"][0]
    assert sert["en_catalogo"] is True and sert["generico"] == "sertralina"


def test_rxcheck_solo_sobre_activos_no_suspendidos(client, auth):
    _seed_amitriptilina_sertralina_grave()
    # amitriptilina INDICADO + sertralina HABITUAL -> interacción grave debe salir
    facts = {
        "medicamentos": [{"nombre": "Amitriptilina 50 mg", "rol": "indicado"}],
        "medicamentos_habitual": [{"nombre": "Sertralina 50 mg", "rol": "habitual"}],
        "medicamentos_suspender": [{"nombre": "Ibuprofeno", "rol": "suspender"}],
    }
    out = reconcile(facts, allergies=[], chronic=[])
    ix = [a for a in out["med_alerts"] if a["type"] == "interaccion"]
    assert ix and ix[0]["severidad"] == "grave"


def test_suspendido_no_dispara_interaccion(client, auth):
    _seed_amitriptilina_sertralina_grave()
    # si amitriptilina está SUSPENDIDO (no activo), no debe cruzar con sertralina
    facts = {
        "medicamentos": [],
        "medicamentos_habitual": [{"nombre": "Sertralina 50 mg", "rol": "habitual"}],
        "medicamentos_suspender": [{"nombre": "Amitriptilina 50 mg", "rol": "suspender"}],
    }
    out = reconcile(facts, allergies=[], chronic=[])
    assert not any(a["type"] == "interaccion" for a in out["med_alerts"])


def test_reconcile_no_muta_entrada():
    original = _facts()
    import copy
    snapshot = copy.deepcopy(original)
    reconcile(original, allergies=[], chronic=[])
    assert original == snapshot  # la entrada no se toca
