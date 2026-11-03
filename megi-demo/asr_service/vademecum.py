"""Vademécum FDA/DailyMed traducido al español (fuente para el catálogo).

Índice en memoria de las fichas FDA traducidas (rag/fda_vademecum_es.dedup.jsonl):
secciones clave (dosis, interacciones, contraindicaciones, advertencias) por
fármaco. El puente ES->EN combina un mapa de nombres frecuentes + heurística de
cognados (levotiroxina->levothyroxine), porque la FDA nombra en inglés.

Es contenido regulatorio de EE.UU. traducido — la cita debe dejarlo claro.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

_PATH = Path(__file__).resolve().parent / "rag" / "fda_vademecum_es.dedup.jsonl"

# Nombres frecuentes ES -> raíz EN (generic_key del vademécum). Los cognados que
# la heurística resuelve sola no hace falta listarlos.
_ES2EN = {
    "paracetamol": "acetaminophen", "acido acetilsalicilico": "aspirin", "aspirina": "aspirin",
    "acido valproico": "valproate", "valproato de magnesio": "valproate",
    "fenitoina sodica": "phenytoin", "fenitoina": "phenytoin",
    "levotiroxina": "levothyroxine", "complejo b": "", "senosidos a-b": "",
}

# Secciones útiles para el catálogo (dosis / seguridad).
_KEEP = ("DOSAGE", "INTERACTION", "CONTRAINDICATION", "WARNING", "OVERDOSAGE", "PRECAUTION")

_INDEX: dict[str, list] | None = None


def _n(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _cognate_en(gen_es: str) -> list[str]:
    """Variantes EN plausibles de un genérico ES por reglas de sufijo INN."""
    g = _n(gen_es).split()[0] if gen_es else ""
    if not g:
        return []
    cands = {g}
    rules = [("ina$", "ine"), ("ina$", "in"), ("ol$", "ole"), ("ico$", "ic"), ("ida$", "ide"),
             ("azol$", "azole"), ("ceina$", "caine"), ("tina$", "tine"), ("ona$", "one"),
             ("eno$", "en"), ("ano$", "an"), ("io$", "ium"), ("cina$", "cin")]
    for pat, rep in rules:
        if re.search(pat, g):
            cands.add(re.sub(pat, rep, g))
    return list(cands)


def _load() -> dict:
    global _INDEX
    if _INDEX is not None:
        return _INDEX
    idx: dict[str, list] = {}
    if _PATH.exists():
        for line in _PATH.open(encoding="utf-8"):
            try:
                c = json.loads(line)
            except Exception:
                continue
            if not any(k in c.get("section", "").upper() for k in _KEEP):
                continue
            key = _n(c.get("generic_key", "")).split(",")[0]
            idx.setdefault(key, []).append({"section": c["section"], "text_es": c["text_es"]})
    _INDEX = idx
    return idx


def lookup(generico_es: str) -> dict:
    """Devuelve {'matched': <clave EN>|None, 'secciones': [{section, text_es}]}.
    Combina múltiples principios de un combo ('tramadol con paracetamol')."""
    idx = _load()
    partes = _n(generico_es).replace(" con ", " ").replace(" y ", " ").split()
    tried, out, matched = set(), [], []
    for parte in partes or [_n(generico_es)]:
        for cand in [_ES2EN.get(_n(generico_es)), _ES2EN.get(parte), *_cognate_en(parte)]:
            if not cand or cand in tried:
                continue
            tried.add(cand)
            # match exacto o por prefijo del generic_key
            for key in idx:
                if key == cand or key.startswith(cand):
                    matched.append(key)
                    out.extend(idx[key])
                    break
    # dedup por sección (texto más largo)
    best: dict[str, dict] = {}
    for s in out:
        k = s["section"].upper().replace(" SECTION", "")
        if k not in best or len(s["text_es"]) > len(best[k]["text_es"]):
            best[k] = s
    return {"matched": sorted(set(matched)) or None, "secciones": list(best.values())}
