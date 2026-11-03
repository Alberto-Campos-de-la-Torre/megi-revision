"""Router de recuperación: decide si el SOAP necesita conocimiento externo (RAG).

Reglas DETERMINISTAS (no otro LLM). Conservador: si hay duda, NO recupera. Solo activa
para A/Dx, plan, receta, CIE-10, NOM, alertas. NO para demográficos, identificadores,
antecedentes negados simples, transcripción literal.
"""
from __future__ import annotations

import re
import unicodedata


def _strip(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


# señales que ACTIVAN retrieval
DX_PLAN = [
    "diagnostico", "diagnostica", "sospecha", "probable", "compatible con", "impresion",
    "analisis", "plan", "tratamiento", "manejo", "iniciar", "indicar", "prescribir",
    "solicitar", "estudio", "laboratorio", "radiografia", "referir", "referencia",
    "urgencias", "control", "seguimiento", "valoracion",
]
RED_FLAGS = ["dolor toracico", "disnea", "sincope", "diaforesis", "deficit neurologico",
             "sangrado", "fiebre", "dificultad para respirar"]
CONDITIONS = ["hipertension", "diabetes", "dislipidemia", "isquemic", "lumbalgia",
              "infeccion de vias urinarias", "asma", "epoc", "neumonia", "angina",
              "cardiopat", "obesidad", "sobrepeso"]
MEDICATION = ["mg", "miligramos", "tableta", "capsula", "dosis", "cada 8", "cada 12",
              "cada 24", "via oral", "metformina", "losartan", "atorvastatina",
              "paracetamol", "amoxicilina", "aspirina", "nitroglicerina"]
CIE = ["cie-10", "cie 10", "codigo", "codificar", "codificacion"]
NOM = ["nom-004", "expediente clinico", "cerrar nota", "estructura de la nota"]

# señales que BLOQUEAN retrieval (demográficos / identificadores / negaciones simples)
IDENTIFIERS = ["curp", "nss", "ine", "rfc", "ocr", "clave de elector",
               "numero de seguridad social"]
NEG_ANTECEDENTS = ["niega tabaquismo", "niega alcoholismo", "niega toxicomanias",
                   "niega alergias", "sin antecedentes"]


def _has(text: str, terms) -> list:
    return [t for t in terms if t in text]


def should_retrieve(new_text: str, current_soap: dict | None = None) -> dict:
    raw = (new_text or "").strip()
    t = _strip(raw)
    if len(t) < 6:
        return {"needs_rag": False, "reason": "empty_or_short"}

    # secuencias largas de dígitos (identificadores) sin señal clínica -> no RAG
    only_id = bool(_has(t, IDENTIFIERS)) or bool(re.search(r"\d{8,}", t))

    dx = _has(t, DX_PLAN)
    red = _has(t, RED_FLAGS)
    cond = _has(t, CONDITIONS)
    med = _has(t, MEDICATION)
    cie = _has(t, CIE)
    nom = _has(t, NOM)
    triggers = dx + red + cond + med + cie + nom

    # conservador: identificador/demográfico sin trigger clínico -> NO
    if only_id and not triggers:
        return {"needs_rag": False, "reason": "identifier"}
    if not triggers:
        # solo antecedentes negados / subjetivo simple
        if _has(t, NEG_ANTECEDENTS):
            return {"needs_rag": False, "reason": "subjective_simple"}
        return {"needs_rag": False, "reason": "no_clinical_trigger"}

    # razón principal
    if red:
        reason = "diagnosis_or_red_flag"
    elif med:
        reason = "medication"
    elif cie:
        reason = "cie10"
    elif nom and not (dx or cond):
        reason = "nom_compliance"
    else:
        reason = "diagnosis_or_plan"

    # use_cases según señal. CIE-10 se mantiene separado: solo entra si el texto
    # pide codificacion explicita, no como fuente narrativa para A/P.
    if cie:
        use_cases = ["codificacion_cie10"]
    elif nom and not (dx or cond or red or med):
        use_cases = ["cumplimiento_nota_nom"]
    else:
        use_cases = ["dx_analisis_plan"]
        if nom:
            use_cases.append("cumplimiento_nota_nom")

    query = re.sub(r"\s+", " ", raw)[:300]
    return {"needs_rag": True, "reason": reason,
            "queries": [{"query": query, "use_cases": use_cases, "tiers": [1]}]}
