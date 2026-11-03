"""Sugerencia de documentos derivados de la consulta (Fase 11).

Decide QUÉ documentos amerita la consulta (referencia, orden de estudios,
incapacidad) a partir del transcript + SOAP. Dos capas:

  1. Heurística determinista de vocabulario (este módulo): fast-path y fallback
     — si en la consulta "se escucha" incapacidad/envío/estudios, aplica.
  2. Refinamiento LLM (gemma, servicio ASR): extrae campos (días, especialidad,
     estudios) y detecta menciones que la heurística no cubre.

Regla de fusión sesgada a RECALL: si CUALQUIERA de las dos capas dice que
aplica, se ofrece (perder una incapacidad dictada pesa más que una pestaña de
sobra). Los campos prefieren al LLM. Nada se imprime solo: el documento sigue
siendo un formulario que el médico revisa, guarda y sella.
"""
from __future__ import annotations

import re
import unicodedata


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


_INCAP_RE = re.compile(
    r"\bincapacidad|\breposo\b|dias? de descanso|justificante|certificado medic"
)
_REF_RE = re.compile(
    r"\breferencia\b|interconsulta|valoracion por|\bderivar\b|segundo nivel|"
    r"\b(?:lo|la|te)\s+(?:envio|mando|derivo|refiero)\b|envio a"
)
_ORDEN_RE = re.compile(
    r"orden de estudios|solicito|biometria|quimica sanguinea|electrocardiograma|"
    r"\becg\b|radiografia|rayos x|ultrasonido|tomografia|resonancia|urocultivo|"
    r"examen general de orina|perfil (?:lipidico|tiroideo)|laboratorios?\b|estudios de"
)

_NUM_WORDS = {
    "un": "1", "uno": "1", "dos": "2", "tres": "3", "cuatro": "4", "cinco": "5",
    "seis": "6", "siete": "7", "ocho": "8", "nueve": "9", "diez": "10",
    "catorce": "14", "quince": "15", "veintiun": "21", "veintiuno": "21",
}
_DIAS_RE = re.compile(
    r"(\d+|" + "|".join(_NUM_WORDS) + r")\s+dias?\s+de\s+(?:incapacidad|reposo|descanso)"
)
_SERVICIO_RE = re.compile(
    r"(?:valoracion por|interconsulta (?:a|con)|(?:lo|la|te)\s+(?:envio|mando|derivo|refiero)\s+(?:a|con)|envio a)\s+"
    r"(?:el |la |los |las )?([a-z]+(?:\s[a-z]+)?)"
)
# Estudios concretos que la heurística sabe nombrar (para prellenar).
_ESTUDIOS = [
    ("biometria hematica", "biometria"), ("quimica sanguinea", "quimica sanguinea"),
    ("electrocardiograma", "electrocardiograma"), ("ecg", r"\becg\b"),
    ("radiografia", "radiografia|rayos x"), ("ultrasonido", "ultrasonido"),
    ("tomografia", "tomografia"), ("resonancia", "resonancia"),
    ("urocultivo", "urocultivo"), ("examen general de orina", "examen general de orina"),
    ("perfil lipidico", "perfil lipidico"), ("perfil tiroideo", "perfil tiroideo"),
]


def heuristic_suggestions(text: str) -> dict:
    """Sugerencias por vocabulario sobre transcript+SOAP. Campos vacíos si no
    hay dato explícito (nunca se inventa)."""
    n = _norm(text)

    incap = {"aplica": bool(_INCAP_RE.search(n)), "dias": "", "ramo": "", "observaciones": ""}
    m = _DIAS_RE.search(n)
    if m:
        incap["dias"] = _NUM_WORDS.get(m.group(1), m.group(1))

    ref = {"aplica": bool(_REF_RE.search(n)), "servicio": "", "motivo": ""}
    m = _SERVICIO_RE.search(n)
    if m:
        ref["servicio"] = m.group(1).strip().capitalize()

    estudios = [label for label, pat in _ESTUDIOS if re.search(pat, n)]
    orden = {
        "aplica": bool(_ORDEN_RE.search(n)),
        "tipo": "", "estudios": ", ".join(estudios), "justificacion": "",
    }

    return {"referencia": ref, "orden_estudios": orden, "incapacidad": incap}


_KEYS = {
    "referencia": ("servicio", "motivo"),
    "orden_estudios": ("tipo", "estudios", "justificacion"),
    "incapacidad": ("dias", "ramo", "observaciones"),
}


def merge_suggestions(heur: dict, llm: dict | None) -> dict:
    """Fusión: aplica = heurística OR LLM (recall primero); campos prefieren al
    LLM y caen a la heurística si el LLM no los trae."""
    out = {}
    for kind, fields in _KEYS.items():
        h = (heur or {}).get(kind) or {}
        l = (llm or {}).get(kind) or {}
        item = {"aplica": bool(h.get("aplica")) or bool(l.get("aplica"))}
        for f in fields:
            lv = str(l.get(f) or "").strip()
            item[f] = lv if lv else str(h.get(f) or "").strip()
        out[kind] = item
    return out
