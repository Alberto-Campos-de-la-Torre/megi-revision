"""SOAP agéntico: extracción focalizada, actualización incremental y cierre."""
import json
import os
import time

from fastapi import APIRouter
from pydantic import BaseModel

from rag.contra_checker import alertas_altas, contra
from rag.rag_service import rag as rag_index
from rag.router import should_retrieve

try:
    from clinical import finalize_transcript
except ImportError:  # pragma: no cover
    from ..clinical import finalize_transcript  # type: ignore

from ..audio import _log
from ..llm import _extract_json, _extract_json_object, _gen_json, _sources_block, available, complete

router = APIRouter()

SOAP_SYSTEM = (
    "Eres un escriba clínico para una consulta médica en México. Construyes una nota "
    "SOAP de forma INCREMENTAL a partir de texto YA confirmado por ASR. Reglas DURAS:\n"
    "- Usa SOLO información presente en el texto. NO inventes datos.\n"
    "- SUGIERES, NO DECIDES: usa 'compatible con / considerar / valorar / requiere "
    "correlación clínica'. NO emitas diagnóstico definitivo si el texto no lo sustenta.\n"
    "- No diagnostiques sin evidencia suficiente; marca incertidumbre en warnings.\n"
    "- NO conviertas identificadores (CURP/NSS/INE) en valores finales; anótalos como "
    "'pendiente de validación estructurada'.\n"
    "- Si se menciona un fármaco, NO afirmes validación de Cuadro Básico: di 'validación de "
    "presentación/CNIS pendiente'.\n"
    "- S=subjetivo, O=objetivo (signos/exploración), A=análisis, P=plan.\n"
    "Responde EXCLUSIVAMENTE un JSON válido (sin razonamiento, sin markdown) con forma:\n"
    '{"soap_patch":[{"section":"S|O|A|P","action":"append|upsert","text":"...","citations":["S1"]}],"warnings":["..."]}\n'
    "Cada item lleva 'citations' = lista de IDs de fuente realmente usados ([] si ninguna)."
)

RAG_RULES = (
    "FUENTES: el bloque FUENTES CLÍNICAS contiene guías reales (GPC) pertinentes al caso.\n"
    "- En A (análisis) y P (plan): además de integrar lo dicho, AÑADE de forma BREVE las "
    "recomendaciones de las FUENTES que apliquen al caso, en tono 'considerar…/valorar…', e "
    "INCLUYE el ID de la fuente en 'citations' (p. ej. {\"section\":\"P\",\"text\":\"Considerar "
    "estratificación de riesgo cardiovascular.\",\"citations\":[\"S1\"]}).\n"
    "- CITA SOLO los IDs dados (S1, S2…); NUNCA inventes una cita ni cites un ID inexistente; "
    "no cites una fuente que no aplique al caso.\n"
    "- NOM solo para estructura/cumplimiento de la nota, NO para diagnóstico."
)

FINAL_FACTS_SYSTEM = (
    "Eres un extractor de hechos clinicos para una consulta medica en Mexico. "
    "Tu tarea NO es redactar el SOAP: primero separas hechos, negaciones, datos "
    "condicionales y dudas de ASR. Devuelve EXCLUSIVAMENTE JSON valido con la clave "
    "'clinical_facts'. Reglas duras:\n"
    "- Si una frase contiene 'niega', 'sin', 'no refiere', 'no presenta' o 'ausencia de', "
    "sus sintomas van a sintomas_negados, nunca a sintomas_presentes.\n"
    "- sintomas_negados = SOLO sintomas que el paciente niega referir (tos, disnea, dolor "
    "toracico, nausea, vomito, diarrea, congestion). Los hallazgos NORMALES de exploracion "
    "(sin estertores, sin soplos, sin edema, uvula central, sin trismus) van a 'exploracion', "
    "NO a sintomas_negados.\n"
    "- Frases como 'datos de alarma', 'acudir si presenta', 'en caso de', 'regresar si' "
    "van a datos_alarma_condicionales, no a sintomas_presentes.\n"
    "- Si hay ruido ASR o una frase rota, registra incertidumbre; no inventes certeza.\n"
    "- Si una dosis/frecuencia parece absurda, conserva el texto y marca validez "
    "'requiere_verificacion'.\n"
    "- 'alergias': SOLO si en la consulta se mencionan alergias del paciente (p. ej. "
    "'es alergico a penicilina', 'alergia a sulfas'). Registra el alergeno (Penicilina, "
    "Sulfas, AINE, etc.). Si no se mencionan, deja la lista vacia. No inventes.\n"
    "- 'antecedentes_cronicos': SOLO si se mencionan padecimientos cronicos o diagnosticos "
    "previos del paciente (HTA, DM2, asma, EPOC, ERC, hipotiroidismo, etc.). No inventes.\n"
    "Usa SIEMPRE comillas dobles validas de JSON (nunca comillas simples). Sin comentarios.\n"
    "Ejemplos (salida correcta):\n"
    'Texto: "Se dan datos de alarma: dificultad para respirar, voz apagada."\n'
    '-> {"sintomas_presentes":[],"datos_alarma_condicionales":["Dificultad respiratoria","Voz apagada"]}\n'
    'Texto: "Niega dificultad respiratoria, nausea y vomito."\n'
    '-> {"sintomas_negados":["Dificultad respiratoria","Nausea","Vomito"]}\n'
    'Texto: "Paracetamol 500 mg cada 6 meses, corrijo, cada 6 a 8 horas."\n'
    '-> {"medicamentos":[{"nombre":"Paracetamol","dosis":"500 mg","via":"VO","frecuencia":"cada 6 a 8 horas","validez":"plausible"}]}'
)

class SoapReq(BaseModel):
    consultation_id: str | None = None
    new_confirmed_text: str
    current_soap: dict = {}
    # Ficha del paciente. Hasta ahora el escriba ordenaba la nota a ciegas: no
    # sabía a quién atendía ni por qué venía, aunque el expediente lo tuviera
    # desde antes de que el paciente se sentara.
    paciente: dict = {}


class FinalizeReq(BaseModel):
    consultation_id: str | None = None
    transcript: str
    current_soap: dict = {}
    # Ficha del paciente (alergias, crónicos, edad, sexo, embarazo): alimenta el
    # verificador de contraindicaciones del cierre. Opcional: sin ella se
    # verifica solo receta × diagnósticos de la propia consulta.
    paciente: dict = {}


def _alertas_seguridad(meds: list, dx: dict, paciente: dict) -> dict:
    """Verificador FDA_movil sobre lo recetado hoy + lo habitual, contra los
    diagnósticos de la consulta y la ficha del paciente. Determinista y rápido
    (< 10 ms); si la tabla no está, devuelve vacío y NO rompe el cierre."""
    rx = [m for m in (meds or []) if m.get("rol") in ("indicado", "habitual")]
    if not rx:
        return {"alertas": [], "resumen": {}, "farmacos_detectados": []}
    p = paciente or {}
    conds = list(dx.get("principal") or []) + [str(c) for c in (p.get("cronicos") or [])]
    try:
        res = contra.check_rx(rx, conditions=conds, allergies=p.get("alergias") or [],
                              age=p.get("edad"), sex=p.get("sexo"), embarazo=p.get("embarazo"))
    except Exception as e:  # pragma: no cover
        return {"alertas": [], "resumen": {}, "farmacos_detectados": [], "error": str(e)}
    if res.get("error"):
        return {"alertas": [], "resumen": {}, "farmacos_detectados": [], "error": res["error"]}
    return {"alertas": res["alertas"], "resumen": res["resumen"],
            "farmacos_detectados": res["farmacos_detectados"], "nota": res.get("nota")}

def _retrieve(new_text: str, current_soap: dict):
    """Router -> retrieval. Devuelve (retrieved[], retrieval_meta, rag_block)."""
    decision = should_retrieve(new_text, current_soap)
    meta = {"needs_rag": decision["needs_rag"], "reason": decision.get("reason")}
    if not decision["needs_rag"]:
        return [], meta, ""
    meta["queries"] = [q["query"] for q in decision.get("queries", [])]
    if not rag_index.available():
        meta["error"] = rag_index.status().get("error") or "index_not_available"
        meta["retrieved_count"] = 0
        return [], meta, ""
    meta["index_version"] = rag_index.index_version
    retrieved, seen = [], set()
    for q in decision.get("queries", []):
        for r in rag_index.search(q["query"], k=5, use_cases=q.get("use_cases"), tiers=q.get("tiers")):
            if r["chunk_id"] in seen:
                continue
            seen.add(r["chunk_id"])
            retrieved.append(r)
    retrieved = retrieved[:6]
    for i, r in enumerate(retrieved, start=1):   # IDs cerrados globales S1..N
        r["citation_id"] = f"S{i}"
    meta["retrieved_count"] = len(retrieved)
    return retrieved, meta, (_sources_block(retrieved) if retrieved else "")


# ---------- Módulo especializado: MEDICAMENTOS (lo crítico va en su propio paso) ----------
MEDS_EXTRACT_SYSTEM = (
    "Eres farmacologo clinico. De la transcripcion de una consulta (con ruido de ASR),\n"
    "extrae SOLO los medicamentos, cada uno con su ROL EXACTO. Nada mas.\n"
    "ROLES (elige el correcto para cada uno):\n"
    "- 'habitual': tratamiento cronico que el paciente YA toma antes de esta consulta.\n"
    "- 'automedicacion': lo que el paciente tomo SIN indicacion medica.\n"
    "- 'suspender': lo que el medico INDICA SUSPENDER/EVITAR en esta consulta.\n"
    "- 'indicado': lo que el medico PRESCRIBE o recomienda iniciar/continuar HOY.\n"
    "Reglas duras:\n"
    "- Un farmaco que el medico manda SUSPENDER es 'suspender', NUNCA 'indicado', aunque\n"
    "  el paciente lo haya tomado antes.\n"
    "- Si el paciente se automedico algo y el medico lo suspende, registralo DOS veces:\n"
    "  una como 'automedicacion' y otra como 'suspender'.\n"
    "- No inventes dosis ni frecuencia; si no se dijo, deja \"\".\n"
    "- Si una dosis/frecuencia suena absurda por ruido de ASR (p.ej. 'cada 6 meses' para un\n"
    "  analgesico), marca \"validez\":\"requiere_verificacion\".\n"
    "Responde SOLO un JSON array (vacio [] si no hay farmacos):\n"
    '[{"nombre":"","dosis":"","frecuencia":"","via":"","rol":"habitual|automedicacion|suspender|indicado","validez":"plausible|requiere_verificacion"}]\n'
    "Ejemplo:\n"
    'Texto: "toma metformina 850 mg cada 12 horas, se automedico ibuprofeno por dolor de\n'
    'rodilla, se indica suspender ibuprofeno y otros AINEs, para dolor leve preferir\n'
    'paracetamol a dosis habituales."\n'
    '-> [{"nombre":"Metformina","dosis":"850 mg","frecuencia":"cada 12 horas","via":"VO","rol":"habitual","validez":"plausible"},\n'
    '{"nombre":"Ibuprofeno","dosis":"","frecuencia":"","via":"","rol":"automedicacion","validez":"plausible"},\n'
    '{"nombre":"Ibuprofeno","dosis":"","frecuencia":"","via":"","rol":"suspender","validez":"plausible"},\n'
    '{"nombre":"Paracetamol","dosis":"","frecuencia":"","via":"VO","rol":"indicado","validez":"plausible"}]\n'
)

def _extract_meds_focused(transcript: str) -> list:
    """Módulo especializado de medicamentos: prompt enfocado + roles. Devuelve la
    lista cruda (el backend la reconcilia contra el catálogo y corre rx-check).

    Se extrae por VENTANAS con traslape: con transcripts largos (>~7k chars) Gemma
    26B-4bit deja de producir JSON parseable y el módulo caía a [] (consulta real
    de 12k chars perdió TODOS los fármacos). Cada ventana queda en el rango probado
    (≤6k) y los resultados se fusionan por (nombre, rol) conservando el item con
    más campos llenos."""
    roles = {"habitual", "automedicacion", "suspender", "indicado"}
    text = (transcript or "").strip()[:18000]
    WIN, STEP = 6000, 5000
    windows, i = [], 0
    while True:
        windows.append(text[i:i + WIN])
        if i + WIN >= len(text):
            break
        i += STEP

    def _filled(m: dict) -> int:
        return sum(1 for f in ("dosis", "frecuencia", "via") if m.get(f))

    def _n_txt(s: str) -> str:
        import unicodedata
        s = unicodedata.normalize("NFKD", (s or "").lower())
        return "".join(c for c in s if not unicodedata.combining(c)).strip()

    merged = {}
    for win in windows:
        arr = _gen_json(MEDS_EXTRACT_SYSTEM, f"TRANSCRIPCION:\n{win}", max_tokens=1000, array=True)
        for m in arr if isinstance(arr, list) else []:
            if not (isinstance(m, dict) and m.get("nombre") and m.get("rol") in roles):
                continue
            item = {"nombre": str(m["nombre"]).strip(), "dosis": str(m.get("dosis") or "").strip(),
                    "frecuencia": str(m.get("frecuencia") or "").strip(), "via": str(m.get("via") or "").strip(),
                    "rol": m["rol"], "validez": m.get("validez") if m.get("validez") in ("plausible", "requiere_verificacion") else "plausible"}
            key = (_n_txt(item["nombre"]), item["rol"])
            prev = merged.get(key)
            if prev is None or _filled(item) > _filled(prev) or (
                    _filled(item) == _filled(prev) and item["validez"] == "requiere_verificacion"):
                merged[key] = item
    return list(merged.values())


class MedsExtractReq(BaseModel):
    transcript: str


@router.post("/v1/soap/extract_meds")
def soap_extract_meds(req: MedsExtractReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    meds = _extract_meds_focused(req.transcript or "")
    return {"status": "done", "medicamentos": meds, "latency_ms": int((time.time() - t0) * 1000)}


# ---------- Módulo especializado: HECHOS CLÍNICOS (negaciones/alarmas/exploración/vitales) ----------
FACTS_EXTRACT_SYSTEM = (
    "Eres medico. De la transcripcion de una consulta (con ruido de ASR), extrae SOLO los\n"
    "HECHOS CLINICOS del interrogatorio y la exploracion. NADA de medicamentos ni\n"
    "diagnosticos (esos van aparte). Reglas CRITICAS de atribucion:\n"
    "1. sintomas_presentes = SOLO lo que el paciente REFIERE tener AHORA.\n"
    "2. sintomas_negados = lo que el paciente NIEGA ('niega', 'sin', 'no refiere', 'no\n"
    "   presenta'). NUNCA en presentes.\n"
    "3. datos_alarma_condicionales = sintomas que el medico enuncia como SEÑAL DE ALARMA\n"
    "   ('acudir a urgencias si presenta fiebre', 'regresar si aumenta el edema'). NO son\n"
    "   sintomas presentes NI hallazgos. REGLA DE ORO: si un sintoma aparece SOLO como dato\n"
    "   de alarma y/o el paciente lo NIEGA, va a alarmas y/o negados, JAMAS a presentes.\n"
    "4. exploracion = hallazgos RELEVANTES de la exploracion (maximo 6, concisos; incluye\n"
    "   los NORMALES clave: 'ruidos cardiacos sin soplos'). Los normales NO son negados.\n"
    "5. signos_vitales = objeto {ta, fc, fr, temp, spo2, peso, talla, glucosa} solo con lo dicho.\n"
    "No inventes. Usa comillas dobles JSON validas. Responde SOLO JSON:\n"
    '{"sintomas_presentes":[],"sintomas_negados":[],"datos_alarma_condicionales":[],'
    '"exploracion":[],"signos_vitales":{}}\n'
    "Ejemplo:\n"
    'Texto: "refiere edema y cansancio, niega fiebre y dolor toracico. Acudir a urgencias si\n'
    'presenta fiebre, dificultad respiratoria o disminucion de orina. TA 158/94, FC 86."\n'
    '-> {"sintomas_presentes":["Edema","Cansancio"],"sintomas_negados":["Fiebre","Dolor toracico"],'
    '"datos_alarma_condicionales":["Fiebre","Dificultad respiratoria","Disminucion de orina"],'
    '"exploracion":[],"signos_vitales":{"ta":"158/94","fc":"86 lpm"}}\n'
)


def _extract_facts_focused(transcript: str) -> dict | None:
    """Módulo especializado de hechos clínicos: negaciones/alarmas/exploración/
    vitales bien atribuidos (reemplaza los regex de demo de clinical.py)."""
    parsed = _gen_json(FACTS_EXTRACT_SYSTEM, f"TRANSCRIPCION:\n{transcript[:9000]}", max_tokens=1400)
    if not isinstance(parsed, dict):
        return None
    # Tolera la key alterna que el modelo a veces usa para alarmas.
    alarmas = parsed.get("datos_alarma_condicionales")
    if alarmas is None:
        for k in ("tarjetas_de_alarma_condicionales", "datos_de_alarma", "alarmas"):
            if isinstance(parsed.get(k), list):
                alarmas = parsed[k]; break
    clean = lambda xs: [str(x).strip() for x in (xs or []) if str(x).strip()]
    sv = parsed.get("signos_vitales") if isinstance(parsed.get("signos_vitales"), dict) else {}
    return {"sintomas_presentes": clean(parsed.get("sintomas_presentes")),
            "sintomas_negados": clean(parsed.get("sintomas_negados")),
            "datos_alarma_condicionales": clean(alarmas),
            "exploracion": clean(parsed.get("exploracion")),
            "signos_vitales": {str(k): str(v).strip() for k, v in sv.items() if v and str(v).strip() and str(v) != "None"}}


class FactsExtractReq(BaseModel):
    transcript: str


@router.post("/v1/soap/extract_facts")
def soap_extract_facts(req: FactsExtractReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    facts = _extract_facts_focused(req.transcript or "") or {}
    return {"status": "done", **facts, "latency_ms": int((time.time() - t0) * 1000)}


# ---------- Módulo especializado: DIAGNÓSTICOS (el codigo CIE lo pone el catalogo) ----------
DX_EXTRACT_SYSTEM = (
    "Eres medico. De la transcripcion de una consulta (con ruido de ASR), extrae la\n"
    "IMPRESION DIAGNOSTICA principal y los DIAGNOSTICOS DIFERENCIALES. Devuelve el\n"
    "NOMBRE CLINICO de cada diagnostico, limpio y estandar (como se buscaria en un\n"
    "catalogo CIE-10). NO inventes codigos CIE: eso lo hace el catalogo despues.\n"
    "Reglas:\n"
    "- 'principal': el/los diagnostico(s) que el medico considera mas probable(s).\n"
    "- 'diferenciales': los que menciona como posibilidades a descartar.\n"
    "- Nombre estandar y conciso ('Enfermedad renal cronica', no 'probable dano en el\n"
    "  rinon de larga evolucion'). Sin 'probable/posible/sospecha' en el nombre.\n"
    "- No incluyas comorbilidades cronicas ya conocidas salvo que sean el motivo de hoy.\n"
    "Responde SOLO JSON: {\"principal\":[\"\"],\"diferenciales\":[\"\"]}\n"
    "Ejemplo:\n"
    'Texto: "se considera enfermedad renal cronica descompensada con probable lesion\n'
    'renal aguda; diferenciales: nefropatia diabetica, sindrome nefrotico, infeccion\n'
    'urinaria complicada."\n'
    '-> {"principal":["Enfermedad renal cronica","Lesion renal aguda"],'
    '"diferenciales":["Nefropatia diabetica","Sindrome nefrotico","Infeccion urinaria"]}\n'
)


def _extract_dx_focused(transcript: str) -> dict:
    """Módulo especializado de diagnósticos: nombres clínicos limpios (sin código).
    El backend asigna el CIE-10 desde el catálogo estructurado."""
    parsed = _gen_json(DX_EXTRACT_SYSTEM, f"TRANSCRIPCION:\n{transcript[:9000]}", max_tokens=500)
    if not isinstance(parsed, dict):
        return {"principal": [], "diferenciales": []}
    clean = lambda xs: [str(x).strip() for x in (xs or []) if str(x).strip()][:8]
    return {"principal": clean(parsed.get("principal")), "diferenciales": clean(parsed.get("diferenciales"))}


class DxExtractReq(BaseModel):
    transcript: str


@router.post("/v1/soap/extract_dx")
def soap_extract_dx(req: DxExtractReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    dx = _extract_dx_focused(req.transcript or "")
    return {"status": "done", **dx, "latency_ms": int((time.time() - t0) * 1000)}


def _extract_clinical_focused(transcript: str) -> tuple[dict | None, dict]:
    """Optimización de latencia: hechos clínicos + diagnósticos en UNA llamada
    (ambos son comprensión del interrogatorio/impresión). Los medicamentos y el
    redactor siguen aparte. Devuelve (facts, dx). Cae a llamadas separadas si el
    JSON combinado falla (robustez sobre el ahorro)."""
    system = (FACTS_EXTRACT_SYSTEM.replace(
        'Responde SOLO JSON:\n'
        '{"sintomas_presentes":[],"sintomas_negados":[],"datos_alarma_condicionales":[],'
        '"exploracion":[],"signos_vitales":{}}\n',
        'AGREGA tambien la impresion diagnostica con NOMBRES CLINICOS ESTANDAR Y CONCISOS\n'
        '(como se buscarian en CIE-10), sin codigo. SEPARA cada diagnostico y quita\n'
        'contexto: "Lesion renal aguda sobre ERC descompensada" -> ["Lesion renal aguda",\n'
        '"Enfermedad renal cronica"]. Sin "probable/descompensada/sobre" en el nombre.\n'
        '"dx_principal" = los mas probables; "dx_diferenciales" = a descartar.\n'
        'Responde SOLO JSON:\n'
        '{"sintomas_presentes":[],"sintomas_negados":[],"datos_alarma_condicionales":[],'
        '"exploracion":[],"signos_vitales":{},"dx_principal":[],"dx_diferenciales":[]}\n'))
    parsed = _gen_json(system, f"TRANSCRIPCION:\n{transcript[:9000]}", max_tokens=1600)
    if not isinstance(parsed, dict):
        return None, {"principal": [], "diferenciales": []}   # el llamador cae a separado
    clean = lambda xs: [str(x).strip() for x in (xs or []) if str(x).strip()]
    alarmas = parsed.get("datos_alarma_condicionales")
    if alarmas is None:
        for k in ("tarjetas_de_alarma_condicionales", "datos_de_alarma", "alarmas"):
            if isinstance(parsed.get(k), list):
                alarmas = parsed[k]; break
    sv = parsed.get("signos_vitales") if isinstance(parsed.get("signos_vitales"), dict) else {}
    facts = {"sintomas_presentes": clean(parsed.get("sintomas_presentes")),
             "sintomas_negados": clean(parsed.get("sintomas_negados")),
             "datos_alarma_condicionales": clean(alarmas),
             "exploracion": clean(parsed.get("exploracion")),
             "signos_vitales": {str(k): str(v).strip() for k, v in sv.items() if v and str(v).strip() and str(v) != "None"}}
    dx = {"principal": clean(parsed.get("dx_principal"))[:8],
          "diferenciales": clean(parsed.get("dx_diferenciales"))[:8]}
    return facts, dx


SOAP_CONSOLIDATE_SYSTEM = (
    "Eres medico y REDACTAS la NOTA SOAP final de una consulta en Mexico a partir de la\n"
    "transcripcion (con ruido de ASR y repeticiones) y de MEDICAMENTOS YA CLASIFICADOS que\n"
    "se te entregan. Reglas CRITICAS:\n"
    "1. CONCISO pero COMPLETO: integra TODO lo clinicamente relevante (dx, estudios,\n"
    "   referencias, indicaciones, alarmas). No repitas frases. No inventes datos.\n"
    "2. Un sintoma que el paciente NIEGA va a negados, NUNCA a presentes. Un sintoma que\n"
    "   solo aparece como DATO DE ALARMA ('acudir si presenta fiebre') NO es sintoma\n"
    "   presente ni hallazgo: es alarma condicional.\n"
    "3. Para el Plan y el tratamiento, USA los MEDICAMENTOS entregados con su rol: en la\n"
    "   receta/indicaciones solo los 'indicado'; menciona los 'suspender' como indicacion\n"
    "   de suspension; los 'habitual' como tratamiento previo. NO agregues farmacos que no\n"
    "   esten en esa lista ni cambies su rol.\n"
    "4. No inventes dosis. Usa comillas dobles JSON validas.\n"
    "Responde SOLO JSON: {\"soap\":{\"S\":\"\",\"O\":\"\",\"A\":\"\",\"P\":\"\"},\"motivo_consulta\":\"\"}\n"
)


def _llm_consolidate_soap(transcript: str, meds: list | None = None) -> tuple[dict | None, list[str]]:
    """REDACTA el SOAP final (conciso + completo + coherente) usando los medicamentos
    ya clasificados por el módulo especializado. No re-extrae fármacos."""
    if os.environ.get("MEGI_FINALIZE_USE_LLM", "1") == "0":
        return None, []
    llm = available()
    if llm["error"]:
        return None, [f"consolidacion LLM no disponible: {llm['error']}"]
    meds_block = ""
    if meds:
        lines = [f"- {m['nombre']} {m.get('dosis','')} {m.get('frecuencia','')} [{m['rol']}]".strip()
                 for m in meds]
        meds_block = "MEDICAMENTOS YA CLASIFICADOS:\n" + "\n".join(lines) + "\n\n"
    msgs = [{"role": "user", "content": f"{SOAP_CONSOLIDATE_SYSTEM}\n{meds_block}TRANSCRIPCION:\n{transcript[:9000]}\n->"}]
    raw = complete(msgs, 1800)
    parsed = _extract_json_object(raw)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("soap"), dict):
        return None, ["consolidacion LLM no devolvio SOAP valido; se usa el reconstructor previo"]
    soap = {k: str(parsed["soap"].get(k) or "").strip() for k in ("S", "O", "A", "P")}
    return {"soap": soap, "motivo_consulta": str(parsed.get("motivo_consulta") or "").strip()}, []


def _llm_extract_final_facts(transcript: str) -> tuple[dict | None, list[str]]:
    if os.environ.get("MEGI_FINALIZE_USE_LLM", "1") == "0":
        return None, ["extraccion LLM desactivada; usando extractor determinista"]
    llm = available()
    if llm["error"]:
        return None, [f"LLM no disponible para extraccion final: {llm['error']}"]
    user = (
        "Devuelve SOLO JSON con esta forma:\n"
        '{"clinical_facts":{"motivo_consulta":"","sintomas_presentes":[],"sintomas_negados":[],'
        '"exploracion":[],"signos_vitales":{},"datos_alarma_condicionales":[],"medicamentos":[],'
        '"impresion_diagnostica":[],"diagnosticos_diferenciales":[],"indicaciones":[],'
        '"incertidumbres":[],"conflictos":[],"alergias":[],"antecedentes_cronicos":[]}}\n\n'
        f"Transcripcion completa:\n\"{transcript}\""
    )
    msgs = [{"role": "user", "content": FINAL_FACTS_SYSTEM + "\n\n" + user}]
    raw = complete(msgs, 2600)
    parsed = _extract_json_object(raw)
    if not parsed:
        return None, ["LLM no devolvio JSON valido para clinical_facts; usando extractor determinista"]
    facts = parsed.get("clinical_facts") if isinstance(parsed.get("clinical_facts"), dict) else parsed
    return facts, []


def _retrieve_final_sources(facts: dict) -> tuple[list[dict], dict]:
    meta = {"needs_rag": False, "reason": "final_clinical_guidance", "retrieved_count": 0, "cited_count": 0}
    if not rag_index.available():
        meta["error"] = rag_index.status().get("error") or "index_not_available"
        return [], meta
    # Consulta ENFOCADA al diagnóstico (la impresión + motivo) en vez de volcar todos
    # los síntomas/exploración (eso traía guías tangenciales por encima de la correcta).
    impression = " ".join(facts.get("impresion_diagnostica") or [])
    motivo = facts.get("motivo_consulta", "")
    top_sx = " ".join((facts.get("sintomas_presentes") or [])[:3])
    query = " ".join(x for x in ([impression, motivo] if impression else [motivo, top_sx]) if x).strip()[:300]
    if len(query) < 8:
        return [], meta
    meta["needs_rag"] = True
    meta["query"] = query
    min_score = float(os.environ.get("MEGI_RAG_MIN_SCORE", "0.55"))
    raw = rag_index.search(query, k=8, use_cases=["dx_analisis_plan"], tiers=[1])
    retrieved = []
    for r in raw:
        doc_type = (r.get("metadata") or {}).get("doc_type")
        if doc_type not in {"GRR", "GER"}:
            continue
        if float(r.get("score", 0)) < min_score:
            continue
        retrieved.append(r)
        if len(retrieved) >= 5:
            break
    for i, r in enumerate(retrieved, start=1):
        r["citation_id"] = f"S{i}"
    meta["retrieved_count"] = len(retrieved)
    meta["cited_count"] = len(retrieved)
    meta["min_score"] = min_score
    return retrieved, meta


def _bloque_paciente(p: dict) -> str:
    """Contexto del paciente para el escriba. Corto a propósito: son decenas de
    tokens, no cientos — esto acompaña a CADA chunk y el presupuesto de latencia
    es de ~4 s por llamada.

    El MOTIVO es el de hoy, no el del alta del paciente: quien se registró por
    lumbalgia en marzo puede volver en julio por otra cosa."""
    if not p:
        return ""
    trozos = []
    if p.get("edad") or p.get("sexo"):
        trozos.append(f"{p.get('edad','?')} años, {p.get('sexo','?')}")
    if p.get("motivo"):
        trozos.append(f"viene por: {p['motivo']}")
    if p.get("cronicos"):
        trozos.append("crónicos: " + ", ".join(p["cronicos"][:6]))
    if p.get("alergias"):
        trozos.append("ALERGIAS: " + ", ".join(p["alergias"][:6]))
    if not trozos:
        return ""
    return ("Paciente (del expediente, NO es texto de la consulta; úsalo solo para "
            "encuadrar, no lo copies a la nota): " + " · ".join(trozos) + "\n\n")


@router.post("/v1/soap/update")
def soap_update(req: SoapReq):
    llm = available()
    if llm["error"]:
        return {"status": "not_configured", "error": llm["error"], "soap_patch": [],
                "warnings": [], "sources": [], "retrieval": {"needs_rag": False, "reason": "llm_not_configured"}}
    t0 = time.time()
    retrieved, retrieval, rag_block = _retrieve(req.new_confirmed_text, req.current_soap or {})

    cur = json.dumps(req.current_soap or {"S": "", "O": "", "A": "", "P": ""}, ensure_ascii=False)
    parts = [SOAP_SYSTEM]
    if rag_block:
        parts += [RAG_RULES, rag_block]
    ficha = _bloque_paciente(req.paciente)
    user = (f"{ficha}SOAP actual: {cur}\n\nNuevo texto confirmado (chunk):\n\"{req.new_confirmed_text}\"\n\n"
            "Devuelve SOLO el JSON soap_patch para integrar este texto.")
    msgs = [{"role": "user", "content": "\n\n".join(parts) + "\n\n" + user}]
    # 1024 y no 512: medido con chunks reales de 20 s y la ficha del paciente, el
    # peor caso genera ~430 tokens — el 84 % del tope anterior. Truncar el JSON no
    # degrada la nota, la PIERDE: `_extract_json` devuelve None y el chunk entero
    # se descarta (status invalid_json), o sea 20 s de consulta fuera del
    # expediente. Subir el tope no cuesta nada si no se usa: se paga por token
    # generado, y la generación para en el cierre del JSON.
    raw = complete(msgs, 1024)
    parsed = _extract_json(raw)
    reintentos = 0
    if parsed is None:
        # Un JSON inválido tira 20 s de consulta enteros (medido: pasó con el
        # primer chunk, el del preámbulo del paciente, y se perdió el antecedente
        # y la radiografía). Un segundo intento con la instrucción reforzada sale
        # mucho más barato que perder el chunk; solo si también falla se rinde.
        reintentos = 1
        msgs_r = [{"role": "user", "content": msgs[0]["content"] +
                   "\n\nATENCION: tu respuesta anterior no fue JSON valido. Devuelve UNICAMENTE el objeto JSON "
                   "{\"soap_patch\": [...], \"warnings\": [...]}, sin texto antes ni despues, sin comentarios."}]
        raw = complete(msgs_r, 1024)
        parsed = _extract_json(raw)
    latency_ms = int((time.time() - t0) * 1000)
    if parsed is None:
        _log({"kind": "soap", "consultation_id": req.consultation_id, "status": "invalid_json",
              "reintentos": reintentos, "raw_tail": raw[-300:], "latency_ms": latency_ms})
        return {"status": "invalid_json", "soap_patch": [], "warnings": ["LLM no devolvió JSON válido"],
                "raw": raw[-800:], "sources": [], "retrieval": retrieval, "latency_ms": latency_ms}

    patches = parsed.get("soap_patch", [])
    warnings = list(parsed.get("warnings", []))
    # validación de citas: gemma solo puede citar IDs recuperados
    valid_ids = {r["citation_id"] for r in retrieved}
    cited = set()
    for p in patches:
        cites = p.get("citations") or []
        keep = [c for c in cites if c in valid_ids]
        dropped = [c for c in cites if c not in valid_ids]
        if dropped:
            warnings.append(f"citas inválidas descartadas: {dropped}")
        p["citations"] = keep
        cited.update(keep)
    sources = [{k: r[k] for k in ("citation_id", "citation", "source_id", "chunk_id", "page", "score")}
               for r in retrieved if r["citation_id"] in cited]
    retrieval["cited_count"] = len(sources)

    _log({"kind": "soap", "consultation_id": req.consultation_id, "patches": len(patches),
          "needs_rag": retrieval.get("needs_rag"), "retrieved": retrieval.get("retrieved_count", 0),
          "cited": len(sources), "reintentos": reintentos, "latency_ms": latency_ms})
    return {"status": "done", "soap_patch": patches, "warnings": warnings,
            "sources": sources, "retrieval": retrieval, "latency_ms": latency_ms}


@router.post("/v1/soap/finalize")
def soap_finalize(req: FinalizeReq):
    t0 = time.time()
    transcript = (req.transcript or "").strip()
    if not transcript:
        return {"status": "error", "error": "empty_transcript", "soap": {"S": "", "O": "", "A": "", "P": ""},
                "clinical_facts": {}, "validation": {"status": "requires_review", "official_note": False,
                "flags": [], "warnings": ["Transcripcion vacia; no se puede consolidar nota final."]},
                "sources": [], "retrieval": {"needs_rag": False, "reason": "empty_transcript"},
                "latency_ms": int((time.time() - t0) * 1000)}

    # Pipeline MODULAR. Antes había una llamada LLM redundante
    # (_llm_extract_final_facts, ~2600 tok) cuyos hechos/meds/dx eran sobreescritos
    # por los 3 módulos: eliminada. finalize_transcript corre SIN LLM (determinista,
    # rápido) solo para la estructura/validación base; el contenido real lo dan los
    # módulos. Total de llamadas Gemma: 4 (facts, meds, dx, consolidador).
    meds = _extract_meds_focused(transcript)
    # Hechos + diagnósticos en una sola llamada (3 llamadas Gemma en vez de 4). Si
    # el JSON combinado falla, cae a los módulos separados (robustez > ahorro).
    facts_focused, dx = _extract_clinical_focused(transcript)
    if facts_focused is None:
        dx = _extract_dx_focused(transcript)
        facts_focused = _extract_facts_focused(transcript)
    result = finalize_transcript(transcript, llm_facts=None)

    # RAG de fuentes usando la impresión del MÓDULO de dx (mejor query que el regex).
    retrieved, retrieval = _retrieve_final_sources(
        {"impresion_diagnostica": dx["principal"], "motivo_consulta": "",
         "sintomas_presentes": (facts_focused or {}).get("sintomas_presentes", [])})
    result["sources"] = [{k: r[k] for k in ("citation_id", "citation", "source_id", "chunk_id", "page", "score")}
                         for r in retrieved]

    consolidated, cons_warn = _llm_consolidate_soap(transcript, meds=meds)
    if consolidated:
        result["soap"] = consolidated["soap"]
        facts = result.get("clinical_facts") or {}
        if consolidated.get("motivo_consulta"):
            facts["motivo_consulta"] = consolidated["motivo_consulta"]
        # Módulo de hechos: reemplaza síntomas/negados/alarmas/exploración/vitales
        # del extractor de demo (regex). Si el módulo falló tras reintentos, se
        # VACÍAN esos campos (no se muestran los del regex, que trae el bug de
        # atribuir fiebre negada como presente) y se avisa para revisión manual.
        keys_hechos = ("sintomas_presentes", "sintomas_negados", "datos_alarma_condicionales",
                       "exploracion", "signos_vitales")
        if facts_focused:
            for k in keys_hechos:
                facts[k] = facts_focused.get(k, [] if k != "signos_vitales" else {})
        else:
            for k in keys_hechos:
                facts[k] = [] if k != "signos_vitales" else {}
            result["validation"]["warnings"] = list(dict.fromkeys(
                result["validation"].get("warnings", []) +
                ["No se pudieron extraer los hechos clínicos con seguridad; revísalos en el transcript."]))
        facts["medicamentos"] = [m for m in meds if m.get("rol") == "indicado"]   # solo lo recetado
        facts["medicamentos_habitual"] = [m for m in meds if m.get("rol") == "habitual"]
        facts["medicamentos_suspender"] = [m for m in meds if m.get("rol") == "suspender"]
        facts["medicamentos_automedicacion"] = [m for m in meds if m.get("rol") == "automedicacion"]
        # Diagnósticos como NOMBRES (el backend les asigna el CIE-10 del catálogo).
        facts["dx_principal_texto"] = dx["principal"]
        facts["dx_diferenciales_texto"] = dx["diferenciales"]
        result["clinical_facts"] = facts
    if cons_warn:
        result["validation"]["warnings"] = list(dict.fromkeys(result["validation"].get("warnings", []) + cons_warn))

    # Alertas de seguridad (tabla de contraindicaciones FDA_movil): receta ×
    # diagnósticos × ficha del paciente. NO se escriben en la nota: viajan en
    # `alertas_seguridad` (metadatos; el backend las guarda con los hechos
    # clínicos y en la auditoría del cierre, como registro de que se avisó) y
    # las absoluta/mayor dejan un aviso en validation.warnings. Antes se
    # anexaban al Plan como bloque [F#] y el médico pidió que no. Apoyo: él decide.
    seguridad = _alertas_seguridad(meds, dx, req.paciente)
    result["alertas_seguridad"] = seguridad
    altas = alertas_altas(seguridad["alertas"])
    if altas:
        result["validation"]["warnings"] = list(dict.fromkeys(
            result["validation"].get("warnings", []) +
            [f"Seguridad de la receta (FDA): {len(altas)} alerta(s) de severidad absoluta/mayor; revísalas en el panel de alertas."]))
    latency_ms = int((time.time() - t0) * 1000)
    _log({"kind": "soap_finalize", "consultation_id": req.consultation_id,
          "status": result["status"], "official_note": result["official_note"],
          "retrieved": retrieval.get("retrieved_count", 0),
          "alertas_fda": len(seguridad["alertas"]), "alertas_fda_altas": len(altas),
          "latency_ms": latency_ms})
    return {**result, "retrieval": retrieval, "latency_ms": latency_ms}
