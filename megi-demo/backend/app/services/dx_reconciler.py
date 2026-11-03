"""Reconciliación de diagnósticos contra el catálogo CIE-10 (módulo especializado).

El servicio ASR extrae los NOMBRES de los diagnósticos (impresión principal +
diferenciales); aquí, en el backend, cada nombre se busca en el catálogo CIE-10
ESTRUCTURADO y se le asigna un código validado. El LLM nunca inventa códigos: si
un diagnóstico no está en el catálogo, queda sin código y marcado para verificar
(mejor vacío que un código irrelevante).
"""
from __future__ import annotations

import unicodedata

from ..routes.cie10 import search_index

# Adjetivos/palabras que NO deben decidir un match por sí solos: dos dx distintos
# comparten "aguda" ("lesión renal aguda" vs "sinusitis aguda") — el falso
# positivo clásico. El match exige que coincida el término CLAVE, no estos.
_GENERIC = {"aguda", "agudo", "cronica", "cronico", "leve", "moderada", "moderado",
            "severa", "severo", "no", "especificada", "especificado", "primaria",
            "secundaria", "bilateral", "derecha", "izquierda", "sindrome", "trastorno"}


def _n(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _match_cie(texto: str) -> dict:
    hits = search_index(texto, limit=3)
    top = hits[0] if hits else None
    # Términos significativos del diagnóstico dictado (sin genéricos como 'aguda').
    toks = [t for t in _n(texto).split() if len(t) >= 4 and t not in _GENERIC]
    clave = max(toks, key=len) if toks else ""
    label_n = _n(top["label"]) if top else ""
    aceptable = bool(top) and (
        top["score"] >= 2 or (clave and clave in label_n)
    ) and (not clave or any(t in label_n for t in toks))
    if not aceptable:
        return {"texto": texto, "code": "", "label": "", "en_catalogo": False,
                "match": "sin_codigo", "candidatos": hits[:3]}
    # EXACTO vs APROXIMADO: es exacto solo si TODOS los términos significativos del
    # diagnóstico aparecen en la etiqueta del código (no falta ninguno). Si el
    # código cubre solo parte del término, se marca 'aproximado' para que el
    # médico lo revise (p. ej. 'nefropatía diabética' → N14.0 nefropatía, que no
    # dice 'diabética').
    exacto = bool(toks) and all(t in label_n for t in toks)
    return {"texto": texto, "code": top["code"], "label": top["label"],
            "en_catalogo": True, "match": "exacto" if exacto else "aproximado",
            "candidatos": hits[:3]}


def reconcile(clinical_facts: dict) -> dict:
    """Asigna CIE-10 a los diagnósticos extraídos. Devuelve clinical_facts con
    `diagnosticos` (principal, con código) y `diagnosticos_diferenciales`."""
    facts = dict(clinical_facts or {})
    principal = [_match_cie(t) for t in (facts.get("dx_principal_texto") or []) if t]
    diferenciales = [_match_cie(t) for t in (facts.get("dx_diferenciales_texto") or []) if t]
    for i, d in enumerate(principal):
        d["principal"] = (i == 0)  # el primero es el diagnóstico principal
    facts["diagnosticos"] = principal
    facts["diagnosticos_diferenciales"] = diferenciales
    # impresion_diagnostica legible (texto) para el SOAP/compatibilidad
    facts["impresion_diagnostica"] = [d["texto"] for d in principal]
    return {"clinical_facts": facts,
            "sin_codigo": [d["texto"] for d in principal + diferenciales if not d["en_catalogo"]]}
