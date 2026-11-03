"""Clinical fact extraction, validation, and safe SOAP rendering.

This module is intentionally dependency-light so the safety rules can be tested
without loading ASR/LLM models. The LLM may propose facts, but these functions
own the guardrails before a final note is considered official.
"""
from __future__ import annotations

import re
import unicodedata
from copy import deepcopy
from typing import Any


SOAP_EMPTY = {"S": "", "O": "", "A": "", "P": ""}


def strip_accents(text: str) -> str:
    text = unicodedata.normalize("NFKD", (text or "").lower())
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def compact(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def normalized_key(text: str) -> str:
    text = strip_accents(text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def empty_facts() -> dict[str, Any]:
    return {
        "motivo_consulta": "",
        "sintomas_presentes": [],
        "sintomas_negados": [],
        "exploracion": [],
        "signos_vitales": {},
        "datos_alarma_condicionales": [],
        "medicamentos": [],
        "impresion_diagnostica": [],
        "diagnosticos_diferenciales": [],
        "indicaciones": [],
        "incertidumbres": [],
        "conflictos": [],
        "alergias": [],
        "antecedentes_cronicos": [],
        "asr_quality": {"level": "unknown", "noise_markers": []},
    }


def _fold_tokens(value: str) -> set[str]:
    """Token set con plurales simples plegados (nausea==nauseas, vomito==vomitos)."""
    toks = normalized_key(value).split()
    return {t[:-1] if len(t) > 3 and t.endswith("s") else t for t in toks}


def _dedupe(items: list[Any]) -> list[Any]:
    """Dedup robusto: colapsa plurales y por contención de tokens (mantiene el más completo)."""
    out: list[Any] = []
    meta: list[tuple[set[str], int]] = []  # (tokenset, idx_en_out) para items str
    for item in items or []:
        if not isinstance(item, str):
            if item not in out:
                out.append(item)
            continue
        value = compact(item)
        if not value:
            continue
        toks = _fold_tokens(value)
        dup = False
        for i, (etoks, oi) in enumerate(meta):
            if toks and etoks and (toks <= etoks or etoks <= toks):
                if len(value) > len(out[oi]):       # conserva el más completo
                    out[oi] = value
                    meta[i] = (toks if len(toks) >= len(etoks) else etoks, oi)
                dup = True
                break
        if not dup:
            out.append(value)
            meta.append((toks, len(out) - 1))
    return out


def _add_unique(items: list[str], value: str) -> None:
    value = compact(value)
    if not value:
        return
    key = normalized_key(value)
    if key and key not in {normalized_key(x) for x in items}:
        items.append(value)


SYMPTOM_PATTERNS: list[tuple[str, list[str]]] = [
    ("Dolor de garganta", [r"dolor (?:en|de) garganta", r"molestia (?:en|de) garganta"]),
    ("Odinofagia", [r"(?:dolor|molestia).{0,45}tragar", r"odinofagia"]),
    ("Fiebre no cuantificada", [r"fiebre no cuantificada"]),
    ("Fiebre", [r"\bfiebre\b", r"temperatura de\s*38"]),
    ("Malestar general", [r"malestar general"]),
    ("Cansancio", [r"sensacion de cansancio", r"\bcansancio\b"]),
    ("Escalofrios ocasionales", [r"escalofrios? ocasionales?"]),
    ("Disminucion del apetito", [r"disminucion (?:de|del) apetito"]),
]

CANONICAL_TERMS: dict[str, list[str]] = {
    "tos productiva": [r"tos productiva", r"tos producida", r"\bproducida\b"],
    "dificultad respiratoria": [
        r"dificultad para respirar",
        r"dificultad respiratoria",
        r"\bdisnea\b",
        r"datos de dificultad respiratoria",
    ],
    "dolor toracico": [r"dolor toracico"],
    "nausea": [r"nauseas?", r"\bnausea\b"],
    "vomito": [r"vomito", r"vomitos"],
    "diarrea": [r"diarrea"],
    "congestion nasal": [r"congestion nasal"],
    "desviacion de uvula": [r"desviacion de (?:la )?uvula"],
    "trismus": [r"trismus", r"dificultad para abrir la boca"],
    "estertores": [r"estertores"],
    "sibilancias": [r"sibilancias", r"sivalancias", r"sibilancedema"],
}

ALARM_PATTERNS: dict[str, list[str]] = {
    "Dificultad respiratoria": [r"dificultad para respirar", r"dificultad respiratoria", r"\bdisnea\b"],
    "Imposibilidad para tragar liquidos": [r"imposibilidad para tragar liquidos", r"intolerancia a liquidos"],
    "Fiebre persistente o mayor de 39 C": [r"fiebre persistente", r"mayor (?:a|de) 39"],
    "Aumento importante del dolor": [r"aumento importante (?:de|del) dolor"],
    "Voz apagada": [r"voz apagada"],
    "Rigidez de cuello": [r"rigidez (?:de|del) cuello"],
    "Somnolencia": [r"somnolencia"],
    "Deshidratacion": [r"deshidratacion"],
    "Empeoramiento del estado general": [r"empeoramiento (?:de|del) estado general"],
}

EXAM_PATTERNS: list[tuple[str, list[str]]] = [
    ("Paciente consciente y orientado", [r"consciente.{0,40}orientado"]),
    ("Adecuado estado de hidratacion", [r"adecuado estado de hidratacion"]),
    ("Sin datos de dificultad respiratoria", [r"sin datos de dificultad respiratoria"]),
    ("Orofaringe hiperemica", [r"orofaringe hiper[eé]mica", r"orofaringe hiperhemica"]),
    (
        "Amigdalas aumentadas con exudado blanquecino bilateral",
        [r"am[ií]gdalas?.{0,80}exudado.{0,40}bilateral", r"exudado blanquecino bilateral"],
    ),
    ("Adenopatias cervicales dolorosas", [r"adenopat[ií]as? cervicales?.{0,30}dolorosas?"]),
    ("Mucosa oral humeda", [r"mucosa oral.{0,20}h[uú]meda"]),
    ("Sin desviacion de uvula", [r"no se observa desviacion de (?:la )?uvula", r"sin desviacion de (?:la )?uvula"]),
    ("Sin trismus", [r"ni dificultad para abrir la boca", r"sin trismus"]),
    ("Campos pulmonares bien ventilados, sin ruidos agregados", [r"campos pulmonares.{0,80}sin presencia de.{0,80}ruidos agregados"]),
    ("Ruidos cardiacos ritmicos, sin soplos", [r"ruidos cardiacos ritmicos.{0,40}sin soplos"]),
    ("Abdomen blando, depresible, no doloroso", [r"abdomen blando.{0,40}depresible.{0,40}no dolor"]),
    ("Extremidades sin edema, llenado capilar menor de 2 segundos", [r"extremidades sin edema.{0,80}llenado capilar menor"]),
]

POSITIVE_CANONICAL_LABELS = {
    "tos productiva": "Tos productiva",
    "dificultad respiratoria": "Dificultad respiratoria",
    "dolor toracico": "Dolor toracico",
    "nausea": "Nausea",
    "vomito": "Vomito",
    "diarrea": "Diarrea",
    "congestion nasal": "Congestion nasal",
}
POSITIVE_TRIGGERS = re.compile(
    r"\b(refiere|presenta|presento|con|acompanad[oa] de|asociad[oa] a|comenta)\b",
    re.IGNORECASE,
)

NEGATION_RE = re.compile(
    r"\b(niega|no refiere|no presenta|ausencia de|sin|negatriz)\b",
    re.IGNORECASE,
)
NEGATION_STOPS = [
    "menciona",
    "comenta haber tomado",
    "a la exploracion",
    "a la inspeccion",
    "los signos vitales",
    "por las caracteristicas",
    "se explica",
    "se recomienda",
    "se indica",
    "al examen",
]
ALARM_RE = re.compile(
    r"(?:se dan datos de alarma|datos de alarma|acudir si presenta|regresar si|vigilar|en caso de)",
    re.IGNORECASE,
)
ALARM_STOPS = ["se indica revaloracion", "recuerden", "firma", "nota soap"]


def _first_stop(segment: str, stops: list[str]) -> int:
    folded = strip_accents(segment)
    positions = [folded.find(stop) for stop in stops if folded.find(stop) >= 0]
    return min(positions) if positions else -1


def _captures_after(pattern: re.Pattern[str], text: str, stops: list[str], max_chars: int = 340) -> list[str]:
    out: list[str] = []
    for match in pattern.finditer(text or ""):
        segment = (text or "")[match.end() : match.end() + max_chars]
        stop = _first_stop(segment, stops)
        if stop >= 0:
            segment = segment[:stop]
        out.append(segment)
    return out


def _contains_any(text: str, patterns: list[str]) -> bool:
    folded = strip_accents(text)
    return any(re.search(pattern, folded, flags=re.IGNORECASE) for pattern in patterns)


def _find_terms(segment: str, term_map: dict[str, list[str]]) -> list[str]:
    found: list[str] = []
    for label, patterns in term_map.items():
        if _contains_any(segment, patterns):
            _add_unique(found, label)
    return found


def _extract_positive_canonical_symptoms(text: str) -> list[str]:
    """Detect present red-flag/common symptoms only with an explicit positive cue."""
    folded = strip_accents(text)
    positives: list[str] = []
    for key, patterns in CANONICAL_TERMS.items():
        if key not in POSITIVE_CANONICAL_LABELS:
            continue
        for pattern in patterns:
            for match in re.finditer(pattern, folded, flags=re.IGNORECASE):
                before = folded[max(0, match.start() - 90) : match.start()]
                if re.search(r"\b(niega|no refiere|no presenta|ausencia de|sin|negatriz|datos de alarma|acudir si|en caso de|regresar si)\b", before):
                    continue
                if POSITIVE_TRIGGERS.search(before):
                    _add_unique(positives, POSITIVE_CANONICAL_LABELS[key])
                    break
    return positives


def normalize_facts(raw: dict[str, Any] | None) -> dict[str, Any]:
    facts = empty_facts()
    if not isinstance(raw, dict):
        return facts
    for key, default in facts.items():
        value = raw.get(key, default)
        if isinstance(default, list):
            facts[key] = _dedupe(value if isinstance(value, list) else [])
        elif isinstance(default, dict):
            facts[key] = value if isinstance(value, dict) else {}
        else:
            facts[key] = compact(str(value)) if value else ""
    # Normaliza alias de signos vitales: la UI/FHIR usan claves cortas
    # (ta, fc, fr, temp, spo2, peso, talla, imc); el LLM a veces usa verbosas.
    sv = facts["signos_vitales"]
    _VITAL_ALIAS = {
        "temperatura": "temp", "saturacion": "spo2", "saturacion_oxigeno": "spo2",
        "saturacion_o2": "spo2", "oxigeno": "spo2", "spo2_aire_ambiente": "spo2",
        "presion_arterial": "ta", "presion": "ta", "tension_arterial": "ta", "pa": "ta",
        "frecuencia_cardiaca": "fc", "frecuencia_respiratoria": "fr",
        "peso_kg": "peso", "talla_m": "talla",
    }
    for src, dst in _VITAL_ALIAS.items():
        if src in sv and dst not in sv:
            sv[dst] = sv.pop(src)
    # Coacciona valores de vitales a string (el LLM a veces da {value, unit}).
    sv2 = {}
    for k, v in sv.items():
        if isinstance(v, str):
            sv2[k] = v
        elif isinstance(v, dict):
            sv2[k] = compact(" ".join(str(x) for x in (v.get("value"), v.get("unit")) if x)) or compact(str(v))
        else:
            sv2[k] = compact(str(v))
    facts["signos_vitales"] = sv2

    # Coacciona alergias/antecedentes a string (el LLM a veces da objetos
    # como {"alergeno": "...", "reaccion": "..."}); evita romper la UI.
    def _name(x):
        if isinstance(x, dict):
            return compact(str(x.get("alergeno") or x.get("nombre") or x.get("descripcion") or x.get("label") or ""))
        return compact(str(x)) if x else ""
    for key in ("alergias", "antecedentes_cronicos"):
        facts[key] = _dedupe([s for s in (_name(x) for x in facts[key]) if s])

    meds = []
    for med in facts["medicamentos"]:
        if not isinstance(med, dict):
            continue
        meds.append({
            "nombre": compact(str(med.get("nombre", ""))),
            "dosis": compact(str(med.get("dosis", ""))),
            "via": compact(str(med.get("via", ""))),
            "frecuencia": compact(str(med.get("frecuencia", ""))),
            "indicacion": compact(str(med.get("indicacion", ""))),
            "validez": compact(str(med.get("validez", ""))) or "pendiente",
            "requires_verification": bool(med.get("requires_verification", False)),
        })
    facts["medicamentos"] = meds
    return facts


def merge_facts(primary: dict[str, Any] | None, guardrail: dict[str, Any] | None) -> dict[str, Any]:
    """Merge LLM facts with deterministic guardrails, preferring safety evidence."""
    out = normalize_facts(primary)
    guard = normalize_facts(guardrail)
    # Contenido de la nota: lo redacta el LLM (out). El determinista (guard) es
    # pharyngitis-fitted, así que NO lo unimos al contenido (evita doblar/inflar);
    # solo lo usamos como red de seguridad. Si el LLM dejó vacío, caemos al guard.
    for key in [
        "sintomas_presentes",
        "exploracion",
        "impresion_diagnostica",
        "diagnosticos_diferenciales",
        "indicaciones",
        "datos_alarma_condicionales",   # gemma las captura bien (están dictadas); evita doblar
    ]:
        out[key] = _dedupe(out[key] if out[key] else guard[key])
    # Seguridad: unir SIEMPRE (que el guard recupere negaciones que el LLM omitió).
    for key in ["sintomas_negados", "incertidumbres", "conflictos"]:
        out[key] = _dedupe(out[key] + guard[key])
    for key, value in guard["signos_vitales"].items():
        if value and not out["signos_vitales"].get(key):
            out["signos_vitales"][key] = value
    if guard["motivo_consulta"] and not out["motivo_consulta"]:
        out["motivo_consulta"] = guard["motivo_consulta"]
    if guard["medicamentos"]:
        by_name = {normalized_key(m.get("nombre", "")): deepcopy(m) for m in out["medicamentos"]}
        for med in guard["medicamentos"]:
            key = normalized_key(med.get("nombre", ""))
            if not key:
                continue
            existing = by_name.get(key, {})
            by_name[key] = {**existing, **{k: v for k, v in med.items() if v}}
        out["medicamentos"] = list(by_name.values())
    out["asr_quality"] = guard.get("asr_quality", out["asr_quality"])
    return out


def _extract_vitals(text: str) -> dict[str, str]:
    vitals: dict[str, str] = {}
    folded = strip_accents(text)
    # tolerante al ASR: "120/78", "120 sobre 78", "120. diagonal 78", "120 diagonal 78"
    m = re.search(r"presion arterial(?: de)?\s*(\d{2,3})\s*(?:[/.,\-]|sobre|diagonal|barra|\s)+\s*(\d{2,3})", folded)
    if m:
        vitals["ta"] = f"{m.group(1)}/{m.group(2)} mmHg"
    m = re.search(r"frecuencia cardiaca(?: de)?\s*(\d{2,3})", folded)
    if m:
        vitals["fc"] = f"{m.group(1)} lpm"
    m = re.search(r"frecuencia respiratoria(?: de)?\s*(\d{1,3})", folded)
    if m:
        vitals["fr"] = f"{m.group(1)} rpm"
    m = re.search(r"temperatura(?: de)?\s*(\d{2}(?:[.,]\d)?)", folded)
    if m:
        vitals["temp"] = f"{m.group(1).replace(',', '.')} C"
    m = re.search(r"saturacion de oxigeno(?: del| de)?\s*(\d{2,3})\s*%", folded)
    if m:
        vitals["spo2"] = f"{m.group(1)}% aire ambiente"
    return vitals


def _extract_motive(text: str) -> str:
    folded = strip_accents(text)
    m = re.search(r"acude a consulta por presentar\s+(.{8,120}?)(?:\.|refiere|comenta|inicia)", folded)
    if m:
        phrase = compact(m.group(1))
        phrase = re.sub(r"^dolor en colectivo\.?\s*", "", phrase)
        if "garganta" in phrase:
            return "Dolor de garganta de 3 dias de evolucion" if "tres dias" in phrase or "3 dias" in phrase else "Dolor de garganta"
    if "dolor de garganta" in folded or "dolor en garganta" in folded:
        if "tres dias" in folded or "3 dias" in folded:
            return "Dolor de garganta de 3 dias de evolucion"
        return "Dolor de garganta"
    return ""


def _extract_medications(text: str) -> list[dict[str, str]]:
    meds: list[dict[str, str]] = []
    folded = strip_accents(text)
    for drug in ("paracetamol", "ibuprofeno", "amoxicilina"):
        candidates: list[dict[str, str]] = []
        for m in re.finditer(drug, folded):
            window = folded[m.start() : m.start() + 360]
            dose_match = re.search(r"(\d{2,4})\s*mg", window)
            freqs = re.findall(r"cada\s+\d{1,3}(?:\s*(?:a|-)\s*\d{1,3})?\s*(?:horas?|hrs?|meses?|dias?|semanas?|anos?)", window)
            freq = freqs[-1] if freqs else ""
            med = {
                "nombre": drug.capitalize(),
                "dosis": f"{dose_match.group(1)} mg" if dose_match else "",
                "via": "VO" if re.search(r"via oral|por via oral|\bvo\b", window) else "",
                "frecuencia": compact(freq),
                "indicacion": "fiebre o dolor" if re.search(r"fiebre|dolor", window) else "",
                "validez": "pendiente",
            }
            candidates.append(med)
        if candidates:
            candidates.sort(key=lambda item: (bool(item["frecuencia"]), bool(item["dosis"]), bool(item["via"])), reverse=True)
            meds.append(candidates[0])
    return meds


def _asr_quality(text: str) -> dict[str, Any]:
    folded = strip_accents(text)
    markers = []
    for marker in [
        "porcino",
        "alax",
        "zika",
        "mma",
        "mhd",
        "negatriz",
        "exudado maligno",
        "no se puede ver nada",
        "datos de la medicina que se utiliza para la medicina",
    ]:
        if marker in folded:
            markers.append(marker)
    level = "low" if len(markers) >= 4 else "usable"
    return {"level": level, "noise_markers": markers}


def extract_clinical_facts(transcript: str) -> dict[str, Any]:
    text = compact(transcript)
    folded = strip_accents(text)
    facts = empty_facts()
    facts["motivo_consulta"] = _extract_motive(text)
    facts["signos_vitales"] = _extract_vitals(text)
    facts["medicamentos"] = _extract_medications(text)
    facts["asr_quality"] = _asr_quality(text)

    for label, patterns in SYMPTOM_PATTERNS:
        if _contains_any(folded, patterns):
            _add_unique(facts["sintomas_presentes"], label)
    for label in _extract_positive_canonical_symptoms(text):
        _add_unique(facts["sintomas_presentes"], label)

    # SOLO síntomas que el paciente niega referir -> sintomas_negados.
    # Los negativos de EXPLORACION (estertores/sibilancias/uvula/trismus) NO van aquí:
    # ya los cubre EXAM_PATTERNS como hallazgos de O ("sin X").
    negatable_symptoms = {
        "tos productiva": "Tos productiva",
        "dificultad respiratoria": "Dificultad respiratoria",
        "dolor toracico": "Dolor toracico",
        "nausea": "Nausea",
        "vomito": "Vomito",
        "diarrea": "Diarrea",
        "congestion nasal": "Congestion nasal",
    }
    for segment in _captures_after(NEGATION_RE, text, NEGATION_STOPS):
        for label in _find_terms(segment, CANONICAL_TERMS):
            symptom = negatable_symptoms.get(label)
            if symptom:
                _add_unique(facts["sintomas_negados"], symptom)

    for segment in _captures_after(ALARM_RE, text, ALARM_STOPS, max_chars=520):
        for label, patterns in ALARM_PATTERNS.items():
            if _contains_any(segment, patterns):
                _add_unique(facts["datos_alarma_condicionales"], label)

    for label, patterns in EXAM_PATTERNS:
        if _contains_any(folded, patterns):
            _add_unique(facts["exploracion"], label)

    if _contains_any(folded, [r"faringoamigdalitis aguda"]):
        _add_unique(facts["impresion_diagnostica"], "Faringoamigdalitis aguda, probable etiologia bacteriana")
    if _contains_any(folded, [r"faringitis viral"]):
        _add_unique(facts["diagnosticos_diferenciales"], "Faringitis viral")
    if _contains_any(folded, [r"mononucleosis infecciosa"]):
        _add_unique(facts["diagnosticos_diferenciales"], "Mononucleosis infecciosa")
    if _contains_any(folded, [r"amigdalitis estreptococ"]):
        _add_unique(facts["diagnosticos_diferenciales"], "Amigdalitis estreptococica")

    return normalize_facts(facts)


def term_key(text: str) -> str:
    folded = normalized_key(text)
    for key, patterns in CANONICAL_TERMS.items():
        if _contains_any(folded, patterns) or any(part in folded for part in key.split()):
            if key in folded or any(re.search(p, folded) for p in patterns):
                return key
    if "dificultad respiratoria" in folded or "dificultad para respirar" in folded:
        return "dificultad respiratoria"
    if "dolor toracico" in folded:
        return "dolor toracico"
    if "tos" in folded:
        return "tos productiva" if "product" in folded else "tos"
    if "nausea" in folded:
        return "nausea"
    if "vomito" in folded:
        return "vomito"
    if "diarrea" in folded:
        return "diarrea"
    if "congestion nasal" in folded:
        return "congestion nasal"
    return folded


def validate_medication(med: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, str]]]:
    med = dict(med)
    flags: list[dict[str, str]] = []
    freq = strip_accents(med.get("frecuencia", ""))
    if not freq:
        med["validez"] = "requiere_verificacion"
        med["requires_verification"] = True
        flags.append({
            "kind": "medication_frequency_missing",
            "severity": "review",
            "message": f"Frecuencia no documentada para {med.get('nombre') or 'medicamento'}; verificar antes de firmar.",
        })
        return med, flags
    m = re.search(r"cada\s+(\d{1,3})(?:\s*(?:a|-)\s*(\d{1,3}))?\s*(horas?|hrs?|meses?|dias?|semanas?|anos?)", freq)
    if not m:
        med["validez"] = "requiere_verificacion"
        med["requires_verification"] = True
        flags.append({
            "kind": "medication_frequency_unparsed",
            "severity": "review",
            "message": f"Frecuencia de {med.get('nombre') or 'medicamento'} no interpretable: '{med.get('frecuencia')}'.",
        })
        return med, flags
    first = int(m.group(1))
    second = int(m.group(2) or first)
    unit = m.group(3)
    invalid = "mes" in unit or "ano" in unit or ("hora" in unit or "hr" in unit) and max(first, second) > 48
    suspicious = ("dia" in unit or "semana" in unit) and med.get("nombre", "").lower() in {"paracetamol", "ibuprofeno", "amoxicilina"}
    if invalid or suspicious:
        med["validez"] = "invalida"
        med["requires_verification"] = True
        flags.append({
            "kind": "medication_frequency_implausible",
            "severity": "blocker",
            "message": f"Indicacion farmacologica no confiable: {med.get('nombre') or 'medicamento'} {med.get('frecuencia')}; verificar frecuencia antes de firmar.",
        })
    else:
        med["validez"] = "plausible"
        med["requires_verification"] = False
    return med, flags


_EXAM_NEGATIVE_DROP = [
    "estertor", "sibilanc", "soplo", "ruidos agregados", "edema",
    "irritacion peritoneal", "desviacion de uvula", "desviacion de la uvula",
    "trismus", "dificultad para abrir la boca",
]


def _drop_exam_negatives(neg_list: list[str]) -> tuple[list[str], list[str]]:
    """Los hallazgos NORMALES de exploración (sin estertores/soplos/edema, úvula central)
    NO son síntomas que el paciente niegue: van a O, no a 'Niega…' en S."""
    kept, moved = [], []
    for s in neg_list:
        k = normalized_key(s)
        if any(t in k for t in _EXAM_NEGATIVE_DROP):
            moved.append(s)
        else:
            kept.append(s)
    return kept, moved


def validate_clinical_facts(facts: dict[str, Any], transcript: str = "") -> tuple[dict[str, Any], dict[str, Any]]:
    facts = normalize_facts(facts)
    flags: list[dict[str, str]] = []
    warnings: list[str] = []

    # negativos de exploración fuera de sintomas_negados (vengan del LLM o del determinista)
    facts["sintomas_negados"], _exam_moved = _drop_exam_negatives(facts["sintomas_negados"])
    for item in _exam_moved:
        _add_unique(facts["exploracion"], f"Sin {item[0].lower()}{item[1:]}" if not normalized_key(item).startswith("sin") else item)

    # colapsar duplicados de concepto (Dificultad para respirar == Dificultad respiratoria)
    def _dedupe_by_termkey(items: list[str]) -> list[str]:
        out, seen = [], set()
        for x in items:
            k = term_key(x)
            if k in seen:
                continue
            seen.add(k)
            out.append(x)
        return out
    facts["sintomas_negados"] = _dedupe_by_termkey(facts["sintomas_negados"])
    facts["sintomas_presentes"] = _dedupe_by_termkey(facts["sintomas_presentes"])
    facts["datos_alarma_condicionales"] = _dedupe_by_termkey(facts["datos_alarma_condicionales"])

    present_keys = {normalized_key(x) for x in facts["sintomas_presentes"]}
    if "fiebre no cuantificada" in present_keys:
        facts["sintomas_presentes"] = [x for x in facts["sintomas_presentes"] if normalized_key(x) != "fiebre"]

    present_by_key = {term_key(x): x for x in facts["sintomas_presentes"]}
    negated_by_key = {term_key(x): x for x in facts["sintomas_negados"]}
    for key in sorted(set(present_by_key) & set(negated_by_key)):
        if key in {"fiebre"}:
            continue
        flags.append({
            "kind": "negation_conflict",
            "severity": "blocker",
            "message": f"Conflicto clinico detectado: {negated_by_key[key]} aparece como negado y presente. Requiere revision.",
        })
        _add_unique(facts["conflictos"], f"{negated_by_key[key]} negado y presente")
    if flags:
        blocked_keys = {term_key(f.get("message", "")) for f in flags}
        facts["sintomas_presentes"] = [x for x in facts["sintomas_presentes"] if term_key(x) not in blocked_keys]

    alarm_keys = {term_key(x) for x in facts["datos_alarma_condicionales"]}
    if alarm_keys:
        kept = []
        for symptom in facts["sintomas_presentes"]:
            key = term_key(symptom)
            if key in alarm_keys and key not in {"fiebre"}:
                flags.append({
                    "kind": "alarm_misattribution",
                    "severity": "review",
                    "message": f"Posible mala atribucion: {symptom} parece instruccion de alarma, no sintoma actual.",
                })
                continue
            kept.append(symptom)
        facts["sintomas_presentes"] = kept

    validated_meds = []
    for med in facts["medicamentos"]:
        med, med_flags = validate_medication(med)
        validated_meds.append(med)
        flags.extend(med_flags)
    facts["medicamentos"] = validated_meds

    quality = facts.get("asr_quality") or {}
    if quality.get("level") == "low":
        flags.append({
            "kind": "asr_quality_low",
            "severity": "review",
            "message": "Calidad de transcripcion baja: generar solo borrador, no nota final.",
        })

    for flag in flags:
        warnings.append(flag["message"])

    blocker = any(flag.get("severity") == "blocker" for flag in flags)
    status = "requires_review" if blocker else "draft_only" if quality.get("level") == "low" else "ready"
    validation = {
        "status": status,
        "official_note": status == "ready",
        "flags": flags,
        "warnings": _dedupe(warnings),
    }
    return facts, validation


def _join(items: list[str]) -> str:
    items = [compact(x) for x in items if compact(x)]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " y " + items[-1]


def _infer_diagnosis(facts: dict[str, Any]) -> tuple[list[str], list[str]]:
    impressions = list(facts.get("impresion_diagnostica") or [])
    differentials = list(facts.get("diagnosticos_diferenciales") or [])
    present = " ".join(facts.get("sintomas_presentes") or [])
    exam = " ".join(facts.get("exploracion") or [])
    if (
        not impressions
        and "garganta" in normalized_key(present + " " + facts.get("motivo_consulta", ""))
        and ("exudado" in normalized_key(exam) or "fiebre" in normalized_key(present))
    ):
        impressions.append("Faringoamigdalitis aguda, probable etiologia bacteriana")
    return _dedupe(impressions), _dedupe(differentials)


def _render_medication_plan(med: dict[str, Any]) -> str | None:
    if med.get("requires_verification"):
        return f"Frecuencia de {med.get('nombre') or 'medicamento'} no confiable en audio; verificar indicacion antes de firmar."
    med_text = " ".join(x for x in [med.get("nombre"), med.get("dosis"), med.get("via"), med.get("frecuencia")] if x)
    if not med_text:
        return None
    indication = compact(str(med.get("indicacion", "")))
    if indication:
        if normalized_key(indication).startswith("en caso de"):
            return f"{med_text} {indication}, sin exceder dosis maxima recomendada."
        return f"{med_text} para {indication}, sin exceder dosis maxima recomendada."
    return f"{med_text}, sin exceder dosis maxima recomendada."


def render_final_soap(
    facts: dict[str, Any],
    validation: dict[str, Any] | None = None,
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, str]:
    facts = normalize_facts(facts)
    validation = validation or validate_clinical_facts(facts)[1]
    soap = dict(SOAP_EMPTY)

    present = _join(facts["sintomas_presentes"])
    negated = _join(facts["sintomas_negados"])
    motive = facts.get("motivo_consulta") or "Motivo de consulta no especificado"
    s_parts = [f"Consulta por {motive}."]
    if present:
        s_parts.append(f"Refiere {present}.")
    if negated:
        s_parts.append(f"Niega {negated}.")
    soap["S"] = " ".join(s_parts)

    vital_order = [
        ("ta", "TA"),
        ("fc", "FC"),
        ("fr", "FR"),
        ("temperatura", "T"),
        ("spo2", "SpO2"),
    ]
    vital_txt = ", ".join(f"{label} {facts['signos_vitales'][key]}" for key, label in vital_order if facts["signos_vitales"].get(key))
    exam = _join(facts["exploracion"])
    o_parts = []
    if vital_txt:
        o_parts.append(f"Signos vitales: {vital_txt}.")
    if exam:
        o_parts.append(f"Exploracion fisica: {exam}.")
    soap["O"] = " ".join(o_parts) or "Sin datos objetivos estructurados suficientes en la transcripcion."

    impressions, differentials = _infer_diagnosis(facts)
    a_parts = []
    if impressions:
        a_parts.append("; ".join(impressions) + ".")
    else:
        a_parts.append("Cuadro clinico en evaluacion; requiere correlacion clinica.")
    if differentials:
        a_parts.append("Diagnosticos diferenciales: " + _join(differentials) + ".")
    if validation.get("status") != "ready":
        a_parts.append("Existen alertas de calidad o seguridad que requieren revision antes de firmar.")
    soap["A"] = " ".join(a_parts)

    p_items = list(facts.get("indicaciones") or [])

    def _mentioned(text: str) -> bool:
        k = normalized_key(text)
        return any(k and k in normalized_key(p) or normalized_key(p).find(k) >= 0 for p in p_items)

    for med in facts["medicamentos"]:
        name = normalized_key(med.get("nombre", ""))
        if med.get("requires_verification"):
            # alerta de seguridad: SIEMPRE (aunque el plan ya mencione el fármaco)
            p_items.append(f"Frecuencia de {med.get('nombre') or 'medicamento'} no confiable en audio; verificar indicacion antes de firmar.")
        elif name and not _mentioned(med.get("nombre", "")):   # no re-agregar si el plan ya lo cita
            item = _render_medication_plan(med)
            if item:
                p_items.append(item)
    alarms = _join(facts["datos_alarma_condicionales"])
    plan_norm = normalized_key(" ".join(p_items))
    if alarms and "revalora" not in plan_norm and "revalorar" not in plan_norm:
        p_items.append(f"Revaloracion en 48 a 72 horas o antes si presenta {alarms}.")
    if validation.get("status") != "ready":
        p_items.append("No firmar como nota oficial hasta resolver las alertas marcadas.")
    p_items = _dedupe(p_items)
    soap["P"] = "\n".join(f"{i}. {item}" for i, item in enumerate(p_items, start=1)) or "Plan no estructurado; requiere revision clinica."
    return soap


def finalize_transcript(
    transcript: str,
    llm_facts: dict[str, Any] | None = None,
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    deterministic = extract_clinical_facts(transcript)
    facts = merge_facts(llm_facts, deterministic) if llm_facts else deterministic
    facts, validation = validate_clinical_facts(facts, transcript)
    soap = render_final_soap(facts, validation, sources)
    return {
        "clinical_facts": facts,
        "validation": validation,
        "soap": soap,
        "sources": sources or [],
        "status": validation["status"],
        "official_note": validation["official_note"],
    }
