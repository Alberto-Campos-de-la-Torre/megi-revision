"""Validación determinista de hechos clínicos (defensa en profundidad).

El módulo LLM del servicio ASR extrae síntomas presentes/negados, alarmas,
exploración y vitales con las reglas de atribución. Aquí, en el backend, se
aplica una salvaguarda dura (no confía solo en el prompt): un síntoma NO puede
estar a la vez en 'presentes' y en 'negados' o solo-en-'alarmas'. Ante conflicto
gana la NEGACIÓN/alarma (más seguro: no afirmar un síntoma que el paciente niega
o que solo se enunció como señal de alarma — caso real: 'fiebre').
"""
from __future__ import annotations

import unicodedata


def _key(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.split())


def _dedupe(items: list) -> list:
    seen, out = set(), []
    for x in items or []:
        k = _key(x)
        if k and k not in seen:
            seen.add(k)
            out.append(x)
    return out


def validate(clinical_facts: dict) -> dict:
    """Devuelve clinical_facts con los hechos deduplicados y sin conflicto
    presentes↔negados/alarmas. No muta la entrada. Añade `facts_conflicts`."""
    facts = dict(clinical_facts or {})
    presentes = _dedupe(facts.get("sintomas_presentes"))
    negados = _dedupe(facts.get("sintomas_negados"))
    alarmas = _dedupe(facts.get("datos_alarma_condicionales"))

    negado_keys = {_key(x) for x in negados}
    alarma_keys = {_key(x) for x in alarmas}
    # un presente que también está negado, o que SOLO aparece como alarma, se retira
    kept, conflicts = [], []
    for x in presentes:
        k = _key(x)
        if k in negado_keys or k in alarma_keys:
            conflicts.append(x)  # gana la negación/alarma
        else:
            kept.append(x)

    facts["sintomas_presentes"] = kept
    facts["sintomas_negados"] = negados
    facts["datos_alarma_condicionales"] = alarmas
    facts["exploracion"] = _dedupe(facts.get("exploracion"))
    if conflicts:
        facts["facts_conflicts"] = conflicts
    return facts
