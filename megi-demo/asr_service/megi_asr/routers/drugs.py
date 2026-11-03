"""Fármacos: consultor, alternativas, interacciones y vademécum FDA."""
import json
import time

from fastapi import APIRouter
from pydantic import BaseModel

from rag.contra_checker import alertas_altas, contra

from ..audio import _log
from ..llm import _extract_json_object, available, complete

router = APIRouter()

import vademecum  # noqa: E402

# ---------- Consultor de farmacos (tipo Drugs.com, en español) ----------
# Responde dudas del medico sobre interacciones/seguridad de farmacos, ANCLADO
# en: (1) las reglas del catalogo aprobado por el medico (prioridad) y (2) las
# fichas FDA traducidas. Prudente, cita fuentes, no sustituye el juicio clinico.
DRUG_CONSULT_PROMPT = (
    "Eres un consultor farmacologico para un medico en consulta (Mexico). Responde su\n"
    "PREGUNTA de forma clara, breve y ACCIONABLE, en espanol. Apoyate SOLO en el\n"
    "CONTEXTO dado (reglas del catalogo del consultorio + fichas FDA). Si el contexto no\n"
    "cubre la pregunta, dilo y sugiere verificar; NO inventes cifras ni interacciones.\n"
    "Estructura: (1) respuesta directa (si/no/precaucion), (2) por que (mecanismo si\n"
    "aplica), (3) que hacer. Marca severidad si hay interaccion. Eres APOYO, el medico\n"
    "decide. Cita [catalogo] o [FDA] segun la fuente usada.\n"
)


class DrugConsultReq(BaseModel):
    question: str
    context_drugs: list[str] = []   # fármacos de la receta/consulta actual
    catalog_rules: list[dict] = []  # interacciones aprobadas relevantes


def _drug_context_block(drugs: list[str], rules: list[dict]) -> str:
    parts = []
    if rules:
        parts.append("REGLAS DEL CATALOGO (curadas por el medico):")
        for r in rules[:12]:
            parts.append(f"- {r.get('farmaco_a')} + {r.get('farmaco_b')} [{r.get('severidad')}]: "
                         f"{r.get('mecanismo','')} -> {r.get('recomendacion','')}")
    # Tabla de contraindicaciones (FDA_movil, 2 248 fármacos): más completa que el
    # vademécum pequeño. Cada fila lleva cita textual y sección.
    with_table = set()
    if contra.available():
        for d in drugs[:6]:
            hit = contra.rows(d, limit=8, secciones=("CONTRAINDICATIONS", "BOXED WARNING", "DRUG INTERACTIONS"))
            if not hit["filas"]:
                continue
            with_table.add(d)
            parts.append(f"\nTABLA FDA — {d} ({', '.join(hit['farmacos_detectados'])}):")
            for f in hit["filas"]:
                aviso = " (texto en ingles sin validar)" if f.get("fuente") != "es" else ""
                parts.append(f"- [{f['seccion']}] {f['objeto']} [{f['severidad']}]{aviso}: {f['cita'][:260]}")
    # Vademécum FDA pequeño (293 KB) para lo que la tabla no cubre.
    for d in drugs[:6]:
        if d in with_table:
            continue
        hit = vademecum.lookup(d)
        secs = [s for s in hit["secciones"] if "INTERACTION" in s["section"].upper()
                or "CONTRAINDICATION" in s["section"].upper() or "WARNING" in s["section"].upper()]
        if secs:
            parts.append(f"\nFICHA FDA — {d}:")
            for s in secs[:2]:
                parts.append(f"[{s['section']}] {s['text_es'][:700]}")
    return "\n".join(parts) if parts else "(sin contexto especifico; responde con cautela general)"


# ---------- Verificador de recetas (tabla de contraindicaciones FDA_movil) ----------
class DrugCheckReq(BaseModel):
    rx_list: list                    # nombres o dicts {nombre, dosis, ...} de la receta
    conditions: list[str] = []       # diagnósticos, crónicos, hallazgos relevantes
    allergies: list[str] = []
    age: int | float | None = None
    sex: str | None = None
    embarazo: bool | None = None
    # Transcripción de la consulta en vivo: fármacos y condiciones MENCIONADOS
    # (no solo recetados) para que las alertas salgan conforme avanza la consulta.
    context_text: str | None = None


@router.post("/v1/drugs/check")
def drugs_check(req: DrugCheckReq):
    """Alertas fármaco–condición, fármaco–fármaco y alergia sobre la receta, con cita
    textual de la etiqueta FDA y origen (`es` validado / `en_sin_validar`).
    Determinista, sin LLM, < 10 ms. Apoyo: el médico decide. `alertas_altas`
    (absoluta/mayor) son las que alimentan /v1/drugs/alternatives y el Plan."""
    t0 = time.time()
    if not contra.available():
        return {"status": "error", "error": contra.status().get("error") or "contra_db_not_available",
                "farmacos_detectados": [], "alertas": [], "resumen": {}}
    res = contra.check_rx(req.rx_list, conditions=req.conditions, allergies=req.allergies,
                          age=req.age, sex=req.sex, embarazo=req.embarazo,
                          context_text=req.context_text)
    out = {"status": "done", **res, "alertas_altas": len(alertas_altas(res["alertas"])),
           "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "drug_check", "rx": len(req.rx_list), "alertas": len(res["alertas"]),
          "altas": out["alertas_altas"], "latency_ms": out["latency_ms"]})
    return out


@router.post("/v1/drugs/consult")
def drugs_consult(req: DrugConsultReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    ctx = _drug_context_block(req.context_drugs, req.catalog_rules)
    msgs = [{"role": "user", "content": f"{DRUG_CONSULT_PROMPT}\nCONTEXTO:\n{ctx}\n\nPREGUNTA DEL MEDICO:\n{req.question.strip()}\n"}]
    answer = complete(msgs, 500).strip()
    out = {"status": "done", "answer": answer, "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "drug_consult", "chars": len(req.question), "drugs": len(req.context_drugs), "latency_ms": out["latency_ms"]})
    return out


# ---------- Sugerencias de alternativas ante interaccion grave ----------
DRUG_ALT_PROMPT = (
    "Eres farmacologo. En una receta hay una INTERACCION de alto riesgo. Sugiere 1-3\n"
    "ALTERNATIVAS concretas para RESOLVERLA, priorizando farmacos del CATALOGO del\n"
    "consultorio (los que el medico ya usa). Cada sugerencia debe evitar la interaccion\n"
    "y mantener el objetivo terapeutico. Responde SOLO un JSON:\n"
    '{"resumen":"<1 frase del riesgo>","sugerencias":[{"accion":"sustituir|suspender|ajustar|monitorizar",'
    '"detalle":"<que hacer, concreto>","por_que":"<1 frase>"}]}\n'
    "Es MEJOR sugerir monitorizar que inventar un farmaco no listado. El medico decide.\n"
    "Sin texto fuera del JSON.\n"
)


class DrugAltReq(BaseModel):
    rx_list: list[str]
    interaccion: dict            # {farmaco_a, farmaco_b, severidad, mecanismo}
    catalogo: list[str] = []     # genéricos aprobados (para sugerir de ahí)


@router.post("/v1/drugs/alternatives")
def drugs_alternatives(req: DrugAltReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    ix = req.interaccion
    cat = ", ".join(req.catalogo[:40]) or "(no disponible)"
    body = (f"RECETA: {', '.join(req.rx_list)}\n"
            f"INTERACCION: {ix.get('farmaco_a')} + {ix.get('farmaco_b')} [{ix.get('severidad')}] "
            f"{ix.get('mecanismo','')}\nCATALOGO DISPONIBLE: {cat}\n")
    msgs = [{"role": "user", "content": f"{DRUG_ALT_PROMPT}\n{body}->"}]
    raw = complete(msgs, 420)
    parsed = _extract_json_object(raw)
    if not isinstance(parsed, dict):
        parsed = {"resumen": "", "sugerencias": []}
    parsed.setdefault("sugerencias", [])
    out = {"status": "done", "resumen": parsed.get("resumen", ""),
           "sugerencias": parsed["sugerencias"][:3], "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "drug_alternatives", "latency_ms": out["latency_ms"]})
    return out

VADEMECUM_SYNTH_PROMPT = (
    "Eres farmacologo. A partir de las secciones de la FICHA FDA (en espanol) de un\n"
    "farmaco, extrae SOLO lo que digan para el catalogo. Responde UN JSON:\n"
    '{"dosis_max_dia":"<solo si la ficha da un maximo explicito en adultos, ej \'4 g\';'
    ' si no, \\"\\">",\n'
    ' "precauciones":"<contraindicaciones/advertencias clave, 1-3 frases, en espanol>"}\n'
    "No inventes cifras que no esten en el texto. Sin texto fuera del JSON.\n"
)


class VademecumReq(BaseModel):
    generico: str


@router.post("/v1/vademecum/enrich")
def vademecum_enrich(req: VademecumReq):
    t0 = time.time()
    hit = vademecum.lookup(req.generico)
    if not hit["secciones"]:
        return {"status": "done", "matched": None, "dosis_max_dia": "", "precauciones": "",
                "secciones": [], "latency_ms": int((time.time() - t0) * 1000)}
    llm = available()
    dosis, prec = "", ""
    if not llm["error"]:
        fichas = "\n\n".join(f"[{s['section']}]\n{s['text_es'][:900]}" for s in hit["secciones"][:5])
        msgs = [{"role": "user", "content": f"{VADEMECUM_SYNTH_PROMPT}\nFARMACO: {req.generico}\nFICHA FDA:\n{fichas}\n->"}]
        raw = complete(msgs, 380)
        parsed = _extract_json_object(raw)
        if isinstance(parsed, dict):
            dosis = str(parsed.get("dosis_max_dia") or "").strip()
            prec = str(parsed.get("precauciones") or "").strip()
    out = {"status": "done", "matched": hit["matched"], "dosis_max_dia": dosis, "precauciones": prec,
           "secciones": [s["section"] for s in hit["secciones"]],
           "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "vademecum_enrich", "generico": req.generico, "matched": hit["matched"],
          "latency_ms": out["latency_ms"]})
    return out


# ------------------------------------------------ interacciones farmacologicas (Etapa 3)
# Propone interacciones CLINICAMENTE RELEVANTES de un farmaco contra la lista
# del catalogo aprobado del medico. Solo interacciones bien establecidas; es
# mejor omitir que inventar. El medico aprueba cada regla antes de que el
# rx-check la use.
DRUG_IX_PROMPT = (
    "Eres farmacologo clinico. Para el FARMACO dado, revisa la lista de CANDIDATOS\n"
    "(catalogo real de un consultorio de rehabilitacion) y devuelve SOLO las\n"
    "interacciones farmaco-farmaco BIEN ESTABLECIDAS y clinicamente relevantes.\n"
    "Responde SOLO un array JSON (vacio [] si no hay ninguna):\n"
    '[{"con":"<generico del candidato tal cual aparece en la lista>",\n'
    '  "severidad":"leve|moderada|grave",\n'
    '  "mecanismo":"<1 linea>","recomendacion":"<1 linea, accionable>"}]\n'
    "Reglas: SOLO candidatos de la lista (nombre exacto); no reportes la duplicidad de\n"
    "clase (eso se valida aparte); grave = combinacion a evitar o riesgo serio\n"
    "(p.ej. tramadol+sertralina: sindrome serotoninergico); moderada = requiere\n"
    "vigilancia/ajuste; leve = menor. Es MEJOR omitir que inventar. Sin texto extra.\n"
)


class DrugIxReq(BaseModel):
    farmaco: str
    clase: str = ""
    candidatos: list[dict]  # [{generico, clase}]


@router.post("/v1/drugs/interactions")
def drugs_interactions(req: DrugIxReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    lista = "\n".join(f"- {c.get('generico')} ({c.get('clase') or 'sin clase'})" for c in req.candidatos[:60])
    msgs = [{"role": "user", "content": f"{DRUG_IX_PROMPT}\nFARMACO: {req.farmaco} ({req.clase or 'sin clase'})\nCANDIDATOS:\n{lista}\n->"}]
    raw = complete(msgs, 800)
    first, last = raw.find("["), raw.rfind("]")
    parsed = None
    if first >= 0 and last > first:
        try:
            parsed = json.loads(raw[first:last + 1])
        except Exception:
            try:
                parsed = json.loads(raw[first:last + 1].replace(",]", "]"))
            except Exception:
                parsed = None
    if not isinstance(parsed, list):
        parsed = []
    valid = {(c.get("generico") or "").strip().lower() for c in req.candidatos}
    clean = []
    for it in parsed:
        if not isinstance(it, dict):
            continue
        con = (it.get("con") or "").strip().lower()
        sev = (it.get("severidad") or "").strip().lower()
        if con in valid and sev in ("leve", "moderada", "grave"):
            clean.append({"con": con, "severidad": sev,
                          "mecanismo": (it.get("mecanismo") or "").strip()[:200],
                          "recomendacion": (it.get("recomendacion") or "").strip()[:200]})
    out = {"status": "done", "interacciones": clean, "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "drug_ix", "farmaco": req.farmaco, "n": len(clean), "latency_ms": out["latency_ms"]})
    return out
