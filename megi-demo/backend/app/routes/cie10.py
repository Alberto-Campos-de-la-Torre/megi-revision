"""Búsqueda CIE-10 (set curado de códigos frecuentes de primer nivel).

NO es el catálogo completo (~14k); es un subconjunto curado de diagnósticos
comunes para que el médico busque y seleccione rápido. Ampliable a futuro
parseando el catálogo CEMECE/CIE-10 a tabla estructurada (RAG 2).
"""
import unicodedata

from fastapi import APIRouter, Query

router = APIRouter()


def _n(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


CIE10 = [
    ("J00", "Rinofaringitis aguda (resfriado común)"),
    ("J01.9", "Sinusitis aguda, no especificada"),
    ("J02.9", "Faringitis aguda, no especificada"),
    ("J03.9", "Amigdalitis aguda, no especificada"),
    ("J06.9", "Infección aguda de vías respiratorias superiores"),
    ("J11", "Influenza, virus no identificado"),
    ("J20.9", "Bronquitis aguda, no especificada"),
    ("J18.9", "Neumonía, no especificada"),
    ("J45.9", "Asma, no especificada"),
    ("J44.9", "EPOC, no especificada"),
    ("I10", "Hipertensión esencial (primaria)"),
    ("I20.9", "Angina de pecho, no especificada"),
    ("I21.9", "Infarto agudo del miocardio"),
    ("I48", "Fibrilación y aleteo auricular"),
    ("I50.9", "Insuficiencia cardiaca, no especificada"),
    ("E11.9", "Diabetes mellitus tipo 2 sin complicaciones"),
    ("E78.5", "Hiperlipidemia, no especificada"),
    ("E66.9", "Obesidad, no especificada"),
    ("E03.9", "Hipotiroidismo, no especificado"),
    ("E05.9", "Tirotoxicosis (hipertiroidismo)"),
    ("D50.9", "Anemia por deficiencia de hierro"),
    ("K21.9", "Enfermedad por reflujo gastroesofágico (ERGE)"),
    ("K29.7", "Gastritis, no especificada"),
    ("K30", "Dispepsia funcional"),
    ("K59.0", "Estreñimiento"),
    ("K35.80", "Apendicitis aguda, no especificada"),
    ("A09", "Gastroenteritis y colitis de origen infeccioso"),
    ("A08.4", "Infección intestinal viral, no especificada"),
    ("B82.9", "Parasitosis intestinal, no especificada"),
    ("N39.0", "Infección de vías urinarias, sitio no especificado"),
    ("N18.9", "Enfermedad renal crónica, no especificada"),
    ("N20.0", "Cálculo del riñón (litiasis renal)"),
    ("N40", "Hiperplasia de la próstata"),
    ("N95.1", "Estados menopáusicos y climatéricos femeninos"),
    ("M54.5", "Lumbalgia"),
    ("M54.2", "Cervicalgia"),
    ("M25.5", "Dolor articular"),
    ("M79.1", "Mialgia"),
    ("M17.9", "Gonartrosis, no especificada"),
    ("S93.4", "Esguince de tobillo"),
    ("L20.9", "Dermatitis atópica, no especificada"),
    ("L30.9", "Dermatitis, no especificada"),
    ("L70.9", "Acné, no especificado"),
    ("B35.9", "Dermatofitosis (tiña), no especificada"),
    ("L03.9", "Celulitis, no especificada"),
    ("G43.9", "Migraña, no especificada"),
    ("R51", "Cefalea"),
    ("F32.9", "Episodio depresivo, no especificado"),
    ("F41.9", "Trastorno de ansiedad, no especificado"),
    ("G47.0", "Insomnio"),
    ("H66.9", "Otitis media, no especificada"),
    ("H10.9", "Conjuntivitis, no especificada"),
    ("R50.9", "Fiebre, no especificada"),
    ("R10.4", "Dolor abdominal, no especificado"),
    ("B34.9", "Infección viral, no especificada"),
    ("Z00.0", "Examen médico general"),
    ("Z23", "Necesidad de inmunización (vacunación)"),
    ("Z34.9", "Supervisión de embarazo normal"),
    ("O21.9", "Vómito del embarazo, no especificado"),
]
# Los 59 curados son los diagnósticos frecuentes de primer nivel: quedan marcados
# como 'frecuente' para priorizarlos ante empate (con miles de códigos, 'gastritis'
# debe resolver al K29.7 curado, no a una variante rara).
_CURADO_CODES = {c for c, _ in CIE10}
_INDEX = [{"code": c, "label": d, "n": _n(c) + " " + _n(d), "frecuente": True} for c, d in CIE10]


def _load_full_catalog() -> None:
    """Amplía el índice con el catálogo CIE-10 completo (data/cie10_full.jsonl,
    ~10.5k códigos parseados del PDF oficial). Si el archivo no existe, se queda
    con los 59 curados (degrada, no rompe)."""
    import json
    from pathlib import Path
    path = Path(__file__).resolve().parent.parent.parent / "data" / "cie10_full.jsonl"
    if not path.exists():
        return
    seen = set(_CURADO_CODES)
    added = 0
    for line in path.open(encoding="utf-8"):
        try:
            e = json.loads(line)
        except Exception:
            continue
        code, label = e.get("code"), e.get("label")
        if not code or not label or code in seen:
            continue
        seen.add(code)
        _INDEX.append({"code": code, "label": label, "n": _n(code) + " " + _n(label), "frecuente": False})
        added += 1


_load_full_catalog()


# Palabras de relleno que no discriminan (para tolerar impresiones verbosas
# como "Probable enfermedad renal crónica descompensada").
_STOP = {"probable", "posible", "sospecha", "cuadro", "datos", "de", "del", "la", "el",
         "los", "las", "en", "con", "por", "y", "o", "un", "una", "no", "sin",
         "especificada", "especificado", "secundaria", "secundario", "vs"}


def search_index(q: str, limit: int = 12) -> list:
    """Búsqueda CIE-10 reutilizable (sin HTTP): la usa el endpoint Y el módulo de
    reconciliación de diagnósticos. Devuelve [{code, label, score}] ordenado."""
    ql = _n(q).strip()
    if not ql:
        return []
    terms = [t for t in ql.split() if len(t) >= 3 and t not in _STOP] or ql.split()
    scored = []
    for r in _INDEX:
        score = sum(1 for t in terms if t in r["n"])
        if score:
            scored.append((score, 0 if r.get("frecuente") else 1, len(r["label"]), r))
    # Más términos coincidentes; a igualdad, primero los curados frecuentes, luego la
    # etiqueta más corta (más específica).
    scored.sort(key=lambda x: (-x[0], x[1], x[2]))
    return [{"code": r["code"], "label": r["label"], "score": s} for s, _, _, r in scored[:limit]]


@router.get("/cie10/search")
def search_cie10(q: str = Query(""), limit: int = 12):
    return {"total": len(_INDEX), "results": search_index(q, limit)}
