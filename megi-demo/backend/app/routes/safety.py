"""Verificación de seguridad de la receta (determinista).

Cruza los medicamentos prescritos contra las ALERGIAS y padecimientos CRÓNICOS
del paciente (reglas curadas, seed hardcoded) Y contra el CATÁLOGO aprobado del
médico: interacciones fármaco-fármaco (tabla drug_interactions). Es APOYO, no
exhaustivo: el médico valora. Alergias e interacciones GRAVES generan 'blocker'
(confirmación explícita); las demás precauciones, 'warn'.
"""
import json
import unicodedata

from fastapi import APIRouter

from ..db import db
from ..schemas import RxCheckRequest

router = APIRouter()


def _n(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


# alergia (clave normalizada) -> patrones de nombre de fármaco relacionados
ALLERGY_RULES = {
    "penicilina": ["penicilin", "amoxicilin", "ampicilin", "dicloxacilin", "piperacilin"],
    "betalactam": ["penicilin", "amoxicilin", "ampicilin", "cefalexin", "cefuroxim", "ceftriaxon", "cefota", "cefal"],
    "cefalosporina": ["cefalexin", "cefuroxim", "ceftriaxon", "cefota", "cefal", "cefix"],
    "sulfa": ["sulfameto", "sulfadiaz", "trimetoprim", "cotrimoxazol"],
    "aine": ["ibuprofen", "naproxen", "ketorolac", "diclofenac", "acetilsalicil", "aspirin",
             "piroxicam", "meloxicam", "celecoxib", "indometacin", "ketoprofen"],
    "aines": ["ibuprofen", "naproxen", "ketorolac", "diclofenac", "acetilsalicil", "aspirin",
              "piroxicam", "meloxicam", "celecoxib", "indometacin", "ketoprofen"],
    "aspirina": ["acetilsalicil", "aspirin", "aas"],
    "acido acetilsalicilico": ["acetilsalicil", "aspirin", "aas"],
    "metamizol": ["metamizol", "dipirona"],
    "dipirona": ["metamizol", "dipirona"],
    "paracetamol": ["paracetamol", "acetaminofen"],
}

# patrones de fármaco -> condiciones crónicas con precaución
DISEASE_RULES = [
    {"drug": ["ibuprofen", "naproxen", "ketorolac", "diclofenac", "acetilsalicil", "aspirin", "piroxicam", "meloxicam", "indometacin"],
     "cond": ["erc", "renal", "insuficiencia renal", "nefro"],
     "msg": "AINE en enfermedad renal: riesgo de daño renal agudo."},
    {"drug": ["ibuprofen", "naproxen", "ketorolac", "diclofenac", "piroxicam", "meloxicam", "indometacin"],
     "cond": ["hta", "hipertension"],
     "msg": "AINE puede elevar la presión arterial y reducir el efecto de antihipertensivos."},
    {"drug": ["propranolol", "atenolol", "metoprolol", "carvedilol", "bisoprolol"],
     "cond": ["asma", "epoc", "broncoespasmo"],
     "msg": "Beta-bloqueador en asma/EPOC: riesgo de broncoespasmo."},
    # "renal" a secas es imprescindible: el médico escribe el padecimiento como se
    # dice ("Enfermedad renal crónica estadio 3b"), no con la sigla. Sin él estas
    # dos reglas solo disparaban si en el expediente ponía literalmente "ERC" o
    # "insuficiencia renal", y la regla del AINE de arriba sí lo aceptaba: el
    # mismo paciente recibía la alerta del ibuprofeno y no la de la metformina.
    {"drug": ["metformin"],
     "cond": ["erc", "renal", "insuficiencia renal", "nefro"],
     "msg": "Metformina en ERC avanzada: riesgo de acidosis láctica; ajustar o evitar."},
    {"drug": ["glibenclamid", "glimepirid"],
     "cond": ["erc", "renal", "insuficiencia renal", "nefro"],
     "msg": "Sulfonilurea en ERC: mayor riesgo de hipoglucemia."},
    {"drug": ["ibuprofen", "naproxen", "diclofenac", "ketorolac"],
     "cond": ["ulcera", "gastritis", "erge", "gastrointestinal"],
     "msg": "AINE con antecedente gastrointestinal: riesgo de sangrado/úlcera."},
]


def _allergy_patterns(al_n: str) -> list:
    """Patrones de fármaco para una alergia, tolerando plurales/variantes:
    matchea si la clave de regla es subcadena de la alergia o viceversa
    ('penicilinas'->'penicilina', 'sulfas'->'sulfa')."""
    pats = []
    for key, patterns in ALLERGY_RULES.items():
        if key in al_n or al_n in key:
            pats.extend(patterns)
    return pats


def load_catalog_rules() -> tuple:
    """Catálogo aprobado + interacciones aprobadas (Etapa 4). El rx-check LEE
    estas tablas; si están vacías (instalación nueva), degrada a solo las reglas
    seed de alergia/crónico sin romperse."""
    catalog, interactions = [], {}
    try:
        with db() as conn:
            for r in conn.execute("SELECT generico, sinonimos FROM medications WHERE estado = 'aprobado'"):
                try:
                    sin = json.loads(r["sinonimos"] or "[]")
                except Exception:
                    sin = []
                terms = {_n(r["generico"])} | {_n(s) for s in sin if s}
                # tokens significativos del genérico ("tramadol con paracetamol" -> tramadol, paracetamol)
                for tok in _n(r["generico"]).replace(" con ", " ").replace(" y ", " ").split():
                    if len(tok) > 4:
                        terms.add(tok)
                catalog.append({"generico": r["generico"], "terms": {t for t in terms if t}})
            for r in conn.execute("SELECT * FROM drug_interactions WHERE estado = 'aprobado'"):
                interactions[(r["farmaco_a"], r["farmaco_b"])] = dict(r)
    except Exception:
        pass
    return catalog, interactions


def _match_genericos(drug_name_n: str, catalog: list) -> set:
    """Genéricos del catálogo que corresponden a un fármaco prescrito
    ('Tramadol 50 mg' -> {'tramadol'})."""
    return {c["generico"] for c in catalog if any(t in drug_name_n for t in c["terms"])}


def compute_alerts(rx_list, allergies, chronic, catalog=None, interactions=None) -> list:
    """Lógica determinista compartida (endpoint rx-check Y /review/approve).
    Si catalog/interactions vienen, añade el cruce fármaco-fármaco del catálogo
    aprobado; si no, solo alergias/crónicos (comportamiento previo)."""
    drugs = []
    for r in (rx_list or []):
        name = r.get("drug") if isinstance(r, dict) else str(r)
        if name:
            drugs.append({"name": name, "n": _n(name),
                          "genericos": _match_genericos(_n(name), catalog or [])})
    allergies_n = [{"raw": a, "n": _n(a)} for a in (allergies or []) if a]
    chronic_n = [_n(c) for c in (chronic or []) if c]

    alerts = []
    for d in drugs:
        for al in allergies_n:
            patterns = _allergy_patterns(al["n"])
            stem = al["n"][:-1] if (al["n"].endswith("s") and len(al["n"]) > 4) else al["n"]
            hit = any(p in d["n"] for p in patterns) or (stem and stem in d["n"])
            if hit:
                alerts.append({
                    "severity": "blocker", "type": "alergia",
                    "drug": d["name"], "against": al["raw"],
                    "message": f"{d['name']} puede relacionarse con la alergia a {al['raw']}.",
                })
        for rule in DISEASE_RULES:
            if any(p in d["n"] for p in rule["drug"]):
                for cond in chronic_n:
                    if any(c in cond for c in rule["cond"]):
                        alerts.append({
                            "severity": "warn", "type": "cronico",
                            "drug": d["name"], "against": cond,
                            "message": f"{d['name']}: {rule['msg']}",
                        })
                        break

    # Interacciones fármaco-fármaco (catálogo aprobado). UNA alerta por PAR de
    # fármacos prescritos (la más grave): un fármaco puede matchear varios
    # genéricos redundantes del catálogo, pero clínicamente es una interacción.
    _rank = {"grave": 3, "moderada": 2, "leve": 1}
    for i in range(len(drugs)):
        for j in range(i + 1, len(drugs)):
            best = None
            for ga in drugs[i]["genericos"]:
                for gb in drugs[j]["genericos"]:
                    if ga == gb:
                        continue
                    key = (ga, gb) if ga < gb else (gb, ga)
                    ix = (interactions or {}).get(key)
                    if ix and (best is None or _rank.get(ix["severidad"], 0) > _rank.get(best["severidad"], 0)):
                        best = ix
            if best:
                alerts.append({
                    "severity": "blocker" if best["severidad"] == "grave" else "warn",
                    "type": "interaccion",
                    "drug": drugs[i]["name"], "against": drugs[j]["name"],
                    "severidad": best["severidad"],
                    "message": f"{drugs[i]['name']} + {drugs[j]['name']} ({best['severidad']}): "
                               f"{best['mecanismo']} → {best['recomendacion']}",
                })
    return alerts


@router.post("/safety/rx-check")
def rx_check(req: RxCheckRequest):
    catalog, interactions = load_catalog_rules()
    alerts = compute_alerts(req.rx_list, req.allergies, req.chronic, catalog, interactions)
    return {
        "alerts": alerts,
        "blockers": sum(1 for a in alerts if a["severity"] == "blocker"),
        "warnings": sum(1 for a in alerts if a["severity"] == "warn"),
        "note": "Apoyo determinista, no exhaustivo. El médico valora.",
    }
