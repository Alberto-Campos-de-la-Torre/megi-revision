"""Reconciliación de medicamentos contra el catálogo real (módulo especializado).

El servicio ASR extrae los fármacos con su ROL (habitual/automedicacion/
suspender/indicado). Aquí, en el backend (que sí tiene el catálogo), cada uno se:
  - normaliza contra el catálogo aprobado (marca en_catalogo + genérico canónico),
  - valida la dosis contra la dosis máxima si el catálogo la tiene,
  - y — para lo que el paciente realmente toma/tomará (indicado + habitual) — se
    corre el rx-check (alergias, crónicos, interacciones) para levantar alertas.

Es la pieza de seguridad del pipeline SOAP: solo 'indicado' es prescripción; nunca
mezcla lo que se suspende o se automedicó con lo recetado.
"""
from __future__ import annotations

from ..routes.safety import _match_genericos, _n, compute_alerts, load_catalog_rules


def _to_rx(m: dict) -> dict:
    """Forma que consume rx-check / la receta."""
    return {"drug": m.get("nombre", ""), "dose": m.get("dosis", ""),
            "freq": m.get("frecuencia", ""), "via": m.get("via", "")}


def reconcile(clinical_facts: dict, allergies: list, chronic: list) -> dict:
    """Enriquece los medicamentos de clinical_facts y devuelve alertas de la
    lista que el paciente realmente toma/tomará. No muta la entrada."""
    catalog, interactions = load_catalog_rules()

    def enrich(meds: list) -> list:
        out = []
        for m in meds or []:
            if not isinstance(m, dict) or not m.get("nombre"):
                continue
            genericos = _match_genericos(_n(m["nombre"]), catalog)
            item = dict(m)
            item["en_catalogo"] = bool(genericos)
            item["generico"] = sorted(genericos)[0] if genericos else None
            out.append(item)
        return out

    facts = dict(clinical_facts or {})
    for key in ("medicamentos", "medicamentos_habitual", "medicamentos_suspender",
                "medicamentos_automedicacion"):
        if key in facts:
            facts[key] = enrich(facts[key])

    # rx-check sobre lo que el paciente TOMA/TOMARÁ: indicado (receta de hoy) +
    # habitual (tratamiento previo) — ahí viven las interacciones reales. Lo
    # 'suspender'/'automedicacion' NO entra (justo es lo que se está retirando).
    activos = (facts.get("medicamentos") or []) + (facts.get("medicamentos_habitual") or [])
    rx_list = [_to_rx(m) for m in activos]
    alerts = compute_alerts(rx_list, allergies, chronic, catalog, interactions)
    return {"clinical_facts": facts, "med_alerts": alerts}
