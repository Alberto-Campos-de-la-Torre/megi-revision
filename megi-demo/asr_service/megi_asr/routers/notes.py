"""Notas y asistentes de captura: documentos, notas IMSS, pre-consulta y comandos."""
import json
import time

from fastapi import APIRouter
from pydantic import BaseModel

from ..audio import _log
from ..llm import LLM_MODEL_ID, REGLAS_CLINICAS, _extract_json_object, available, complete
from ..security import _check_audio_path

router = APIRouter()

# ------------------------------------------------ documentos sugeridos (Fase 11)
# El LLM decide QUÉ documentos amerita la consulta (referencia/orden/incapacidad)
# y extrae los campos DICHOS (días, especialidad, estudios). Solo propone: el
# backend fusiona con su heurística y el médico revisa/sella. Mejor aplica=false
# que inventar.
DOC_SUGGEST_PROMPT = (
    "Eres el asistente de documentos de MEGI (consulta medica en espanol de Mexico).\n"
    "Dado el TRANSCRIPT de la consulta y la nota SOAP, decide que documentos amerita\n"
    "la consulta y extrae SOLO los datos que se dijeron. Responde UN objeto JSON:\n"
    '{"referencia":{"aplica":bool,"servicio":"","motivo":""},\n'
    ' "orden_estudios":{"aplica":bool,"tipo":"","estudios":"","justificacion":""},\n'
    ' "incapacidad":{"aplica":bool,"dias":"","ramo":"","observaciones":""}}\n'
    "Reglas:\n"
    "- aplica=true SOLO si la consulta lo menciona o lo indica ('le doy tres dias de\n"
    "  reposo' -> incapacidad aplica, dias 3; 'lo mando a cardiologia' -> referencia).\n"
    "- Campos vacios si no se dijeron; NO inventes dias, especialidades ni estudios.\n"
    "- tipo de orden: Laboratorio | Imagen | Gabinete (segun los estudios pedidos).\n"
    "- ramo tipico: Enfermedad general | Riesgo de trabajo | Maternidad.\n"
    "- Es MEJOR aplica=false que un documento sin sustento. Sin texto fuera del JSON.\n"
    "Ejemplo:\n"
    'TRANSCRIPT: "...le voy a dar tres dias de reposo y lo mando con el cardiologo,\n'
    'solicito electrocardiograma y biometria..."\n'
    '-> {"referencia":{"aplica":true,"servicio":"Cardiologia","motivo":"valoracion"},\n'
    '"orden_estudios":{"aplica":true,"tipo":"Gabinete","estudios":"Electrocardiograma, biometria hematica","justificacion":""},\n'
    '"incapacidad":{"aplica":true,"dias":"3","ramo":"Enfermedad general","observaciones":"reposo"}}\n'
)

_DOC_KINDS = {"referencia": ("servicio", "motivo"),
              "orden_estudios": ("tipo", "estudios", "justificacion"),
              "incapacidad": ("dias", "ramo", "observaciones")}


class DocSuggestReq(BaseModel):
    transcript: str
    soap: dict | None = None


@router.post("/v1/documents/suggest")
def documents_suggest(req: DocSuggestReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    soap_txt = ""
    if req.soap:
        soap_txt = "\nSOAP:\n" + "\n".join(f"{k}: {v}" for k, v in req.soap.items() if v)
    msgs = [{"role": "user", "content": f"{DOC_SUGGEST_PROMPT}\nTRANSCRIPT:\n{req.transcript.strip()[:6000]}{soap_txt}\n->"}]
    raw = complete(msgs, 300)
    parsed = _extract_json_object(raw)
    # Validación dura: estructura fija, tipos coaccionados, nada extra.
    clean = {}
    for kind, fields in _DOC_KINDS.items():
        item = (parsed or {}).get(kind) or {}
        clean[kind] = {"aplica": bool(item.get("aplica"))}
        for f in fields:
            clean[kind][f] = str(item.get(f) or "").strip()
    out = {"status": "done", "suggestions": clean, "model": LLM_MODEL_ID,
           "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "doc_suggest", "chars": len(req.transcript), "latency_ms": out["latency_ms"],
          "aplica": [k for k, v in clean.items() if v["aplica"]]})
    return out


# ------------------------------------------------ mineria de notas OCR (base de trabajo)
# Convierte una nota medica IMSS OCReada (texto ruidoso) en JSON estructurado
# para la base de trabajo notas_imss.db. Copia lo escrito, corrige SOLO errores
# obvios de OCR, nunca inventa. Uso offline/desarrollo (no ruta clinica en vivo).
NOTE_EXTRACT_PROMPT = (
    "Eres un extractor de datos de NOTAS MEDICAS IMSS digitalizadas por OCR (texto con\n"
    "errores tipicos: letras cambiadas, espacios rotos, lineas mezcladas de columnas).\n"
    "Extrae SOLO lo que este escrito. Corrige errores evidentes de OCR (EOCNCIENTE ->\n"
    "CONSCIENTE) pero NO inventes datos ausentes: usa \"\" o null. Responde UN JSON:\n"
    '{"paciente":{"nombre":"","curp":"","nss":"","edad":null,"sexo":""},\n'
    ' "nota":{"fecha":"","unidad":"","delegacion":"","consultorio":"","turno":"","matricula_medico":""},\n'
    ' "vitales":{"talla_m":null,"peso_kg":null,"glucosa":null,"temp_c":null,"ta":"","fc":null,"fr":null},\n'
    ' "diagnosticos":[""],\n'
    ' "receta":[{"farmaco":"","dosis":"","frecuencia":"","duracion":""}],\n'
    ' "incapacidad":{"aplica":false,"dias":null,"dias_acumulados":null,"empresa":"","ocupacion":""},\n'
    ' "estudios":[{"tipo":"laboratorio|radiodiagnostico","texto":""}],\n'
    ' "referencia":{"aplica":false,"servicio":""},\n'
    ' "antecedentes":{"app_negados":"","apnp_negados":"","laborales":""},\n'
    ' "resumen_clinico":"","exploracion":"","indicaciones":""}\n'
    "Notas: fecha en ISO (YYYY-MM-DD) si es legible; sexo M/F si se infiere del CURP o\n"
    "del texto; resumen/exploracion/indicaciones: transcribe corrigiendo OCR, maximo\n"
    "~120 palabras cada uno. Sin texto fuera del JSON.\n"
)


class NoteExtractReq(BaseModel):
    text: str


@router.post("/v1/notes/extract")
def notes_extract(req: NoteExtractReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    msgs = [{"role": "user", "content": f"{NOTE_EXTRACT_PROMPT}\nNOTA OCR:\n{req.text.strip()[:7000]}\n->"}]
    raw = complete(msgs, 1100)
    parsed = _extract_json_object(raw)
    if not isinstance(parsed, dict):
        return {"status": "error", "error": "salida_invalida"}
    out = {"status": "done", "extract": parsed, "model": LLM_MODEL_ID,
           "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "note_extract", "chars": len(req.text), "latency_ms": out["latency_ms"]})
    return out


# ------------------------------------------------ normalizacion de farmacos (catalogo)
# Etapa 1 del catalogo de medicamentos: normaliza items de receta minados de las
# notas OCR. Separa medicamento real de terapia fisica/material, corrige OCR y
# devuelve nombre generico + clase. Solo propone: el catalogo lo aprueba el medico.
DRUG_NORM_PROMPT = (
    "Eres un normalizador de items de receta minados de notas medicas IMSS (rehabilitacion)\n"
    "digitalizadas por OCR. Para CADA item de la lista devuelve un objeto JSON. Responde\n"
    "SOLO un array JSON, mismo orden y longitud que la entrada:\n"
    '[{"raw":"<item tal cual>","tipo":"medicamento|terapia|material|otro",\n'
    '  "generico":"<nombre generico normalizado, minusculas, sin dosis>",\n'
    '  "clase":"<clase terapeutica corta, p.ej. AINE, opioide, relajante muscular,\n'
    '           anticonvulsivante, corticoide, IBP>","via":"oral|IM|IV|topica|"}]\n'
    "Reglas: corrige errores de OCR (p.ej. 'tramaadol'->'tramadol'); combinaciones se\n"
    "quedan como combinacion ('tramadol con paracetamol'); terapias (TENS, masaje,\n"
    "ultrasonido, ejercicios, compresas, laser) son tipo=terapia con generico=nombre\n"
    "corto de la terapia; ferulas/cabestrillo son material. NO inventes clases si no\n"
    "las conoces: clase=\"\". Sin texto fuera del array.\n"
)


class DrugNormReq(BaseModel):
    items: list[str]


@router.post("/v1/notes/normalize_drugs")
def notes_normalize_drugs(req: DrugNormReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    listado = "\n".join(f"- {i}" for i in req.items[:40])
    msgs = [{"role": "user", "content": f"{DRUG_NORM_PROMPT}\nITEMS:\n{listado}\n->"}]
    raw = complete(msgs, 1600)
    # array JSON: busca el primer '[' ... ultimo ']'
    first, last = raw.find("["), raw.rfind("]")
    parsed = None
    if first >= 0 and last > first:
        try:
            parsed = json.loads(raw[first:last + 1])
        except Exception:
            fixed = raw[first:last + 1].replace(",]", "]")
            try:
                parsed = json.loads(fixed)
            except Exception:
                parsed = None
    if not isinstance(parsed, list):
        return {"status": "error", "error": "salida_invalida"}
    out = {"status": "done", "items": parsed, "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "drug_norm", "n_in": len(req.items), "n_out": len(parsed), "latency_ms": out["latency_ms"]})
    return out


# ------------------------------------------------ preconsulta (motor de edad)
PRECONSULTA_PROMPT = (
    "Eres un asistente clinico. Antes de la consulta, el medico vera SUGERENCIAS de que\n"
    "preguntar/revisar (generadas por edad e historial). Con el CONTEXTO del paciente,\n"
    "escribe un RESUMEN breve (2-4 frases) que oriente al medico: que priorizar HOY dado\n"
    "su historial, y ordena las 3-5 preguntas mas importantes. No inventes datos ni\n"
    "diagnosticos; apoyate solo en el contexto.\n"
    "Si el CONTEXTO trae 'motivo_de_hoy', ESO es lo que trae al paciente: gira el resumen\n"
    "y la prioridad en torno a ese motivo. Lo de la edad pasa a segundo plano salvo que\n"
    "sea una alarma. NO descartes ni minimices banderas rojas ya listadas.\n"
    "Ademas, si hay 'motivo_de_hoy', propone en 'preguntas_motivo' de 4 a 6 preguntas\n"
    "DIRIGIDAS a ese motivo para esa edad y sexo (semiologia del sintoma: inicio, evolucion,\n"
    "caracteristicas, factores, sintomas acompanantes) e incluye las banderas rojas propias\n"
    "del motivo con categoria 'alarma'. No repitas las SUGERENCIAS BASE. Cada pregunta lleva\n"
    "'claves': 2-4 palabras sueltas, EN LENGUAJE LLANO, tal como las diria el paciente o el\n"
    "medico en voz alta al tocar ese tema (p. ej. 'hinchada', 'comezon', 'sangra', 'se traba');\n"
    "NUNCA terminos tecnicos ('edema', 'prurito', 'hematemesis'): sirven para reconocer en la\n"
    "conversacion que ya se pregunto. Si no hay motivo, 'preguntas_motivo' va vacia.\n"
    "Responde UN JSON COMPACTO, en una sola linea, sin sangrias ni saltos:\n"
    '{"resumen":"<2-4 frases>","prioridad":["<pregunta 1>","<pregunta 2>","<pregunta 3>"],'
    '"preguntas_motivo":[{"texto":"<pregunta>","categoria":"interrogatorio|alarma|exploracion",'
    '"claves":["<palabra>","<palabra>"]}]}\n'
    "Sin texto fuera del JSON.\n"
)

_CATEGORIAS_MOTIVO = ("interrogatorio", "alarma", "exploracion")


def _limpiar_preguntas_motivo(items) -> list:
    """Solo lo que el backend sabe pintar y vigilar: texto, categoría válida y
    claves cortas. Lo demás se descarta sin fallar (gemma a veces mete campos)."""
    out = []
    for it in (items or [])[:8]:
        if not isinstance(it, dict):
            continue
        texto = str(it.get("texto") or "").strip()[:220]
        if not texto:
            continue
        cat = str(it.get("categoria") or "interrogatorio").strip().lower()
        claves = [str(c).strip().lower()[:40] for c in (it.get("claves") or []) if str(c).strip()][:4]
        out.append({"texto": texto, "categoria": cat if cat in _CATEGORIAS_MOTIVO else "interrogatorio",
                    "claves": claves})
    return out[:6]


class PreconsultaReq(BaseModel):
    context: dict
    base: list[str]


@router.post("/v1/preconsulta/personalize")
def preconsulta_personalize(req: PreconsultaReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    ctx = json.dumps(req.context, ensure_ascii=False)
    base = "\n".join(req.base[:20])
    msgs = [{"role": "user", "content": f"{PRECONSULTA_PROMPT}\nCONTEXTO:\n{ctx}\n\nSUGERENCIAS BASE:\n{base}\n->"}]
    # 1100 tokens: el JSON con 6 preguntas y claves ronda los 500-600 si sale
    # compacto; si gemma lo sangra igualmente, que no se trunque a mitad.
    raw = complete(msgs, 1100)
    parsed = _extract_json_object(raw)
    if not isinstance(parsed, dict):
        parsed = {}
    out = {"status": "done", "resumen": str(parsed.get("resumen") or "").strip(),
           "prioridad": [str(p) for p in (parsed.get("prioridad") or [])][:5],
           "preguntas_motivo": _limpiar_preguntas_motivo(parsed.get("preguntas_motivo")),
           "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "preconsulta", "n_motivo": len(out["preguntas_motivo"]), "latency_ms": out["latency_ms"]})
    return out


# ------------------------------------------------ informe radiológico (M5)
# Solo se llama cuando el dictado NO nombró los encabezados: si los nombró, el
# backend lo reparte sin LLM. Aquí se ORDENA lo dictado, no se interpreta: nada
# de añadir hallazgos que el radiólogo no dijo.
RADIOLOGIA_PROMPT = (
    "Eres un asistente que ORDENA el dictado de un informe radiologico en sus secciones.\n"
    "Reglas DURAS:\n"
    "- Usa SOLO el texto dictado. NO agregues hallazgos, medidas ni diagnosticos.\n"
    "- NO redactes de nuevo: reparte las frases tal cual, corrigiendo solo puntuacion.\n"
    "- Si algo no encaja en ninguna seccion, va en 'hallazgos'.\n"
    "- Deja vacia la seccion que no tenga contenido dictado.\n"
    "Secciones: tecnica (como se hizo el estudio), comparacion (estudios previos),\n"
    "hallazgos (descripcion), impresion (conclusion diagnostica), recomendaciones.\n"
    "Responde UN JSON: {\"tecnica\":\"\",\"comparacion\":\"\",\"hallazgos\":\"\","
    "\"impresion\":\"\",\"recomendaciones\":\"\"}\nSin texto fuera del JSON.\n"
)

_SECCIONES_RX = ("tecnica", "comparacion", "hallazgos", "impresion", "recomendaciones")


class RadiologiaReq(BaseModel):
    transcript: str


@router.post("/v1/radiologia/estructurar")
def radiologia_estructurar(req: RadiologiaReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    msgs = [{"role": "user", "content": f"{RADIOLOGIA_PROMPT}\nDICTADO:\n{req.transcript}\n->"}]
    parsed = _extract_json_object(complete(msgs, 700))
    if not isinstance(parsed, dict):
        parsed = {}
    secciones = {k: str(parsed.get(k) or "").strip() for k in _SECCIONES_RX}
    out = {"status": "done", "secciones": {k: v for k, v in secciones.items() if v},
           "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "radiologia", "latency_ms": out["latency_ms"]})
    return out


# ------------------------------------------------ lectura de imagen (M5, 21-sep)
# Aquí SÍ se interpreta: el modelo mira el estudio y propone un borrador. Es lo
# contrario de `estructurar`, así que el prompt lo deja claro por los dos lados:
# describir por estructura, decir qué NO se puede valorar y NO inventar medidas.
# gemma-4 es un modelo general, no uno validado en imagen médica: la salida se
# presenta como asistencia y nunca entra al informe sin el gesto del radiólogo.
RADIOLOGIA_IMAGEN_PROMPT = (
    "Eres un radiologo. Se te muestran {n} imagen(es) de UN estudio. Redacta en espanol un "
    "BORRADOR de informe para que otro radiologo lo revise y corrija.\n"
    "Reglas DURAS:\n"
    "- Describe SOLO lo que se ve. NO inventes medidas ni hallazgos que no puedas sustentar.\n"
    "- Si una estructura no se valora bien (proyeccion, calidad, recorte), dilo en 'limitaciones'.\n"
    "- Si la imagen NO parece un estudio de imagen medica o no corresponde a la modalidad "
    "indicada, dilo en 'limitaciones' y deja el resto vacio.\n"
    "- Usa la indicacion clinica para orientar la busqueda, NO para dar por hechos hallazgos.\n"
    "- Sin diagnosticos definitivos: en 'impresion' usa lenguaje de probabilidad.\n"
    "Responde UN JSON: {{\"tecnica\":\"proyeccion/plano y calidad tecnica\","
    "\"hallazgos\":\"por estructura, en parrafos cortos\",\"impresion\":\"conclusion probable\","
    "\"limitaciones\":\"que no se pudo valorar y por que\"}}\nSin texto fuera del JSON.\n"
)

_SECCIONES_IMAGEN = ("tecnica", "hallazgos", "impresion", "limitaciones")


class RadiologiaImagenReq(BaseModel):
    image_paths: list[str]              # PNG/JPG ya convertidos por el backend
    modalidad: str = ""
    region: str = ""
    indicacion: str = ""


@router.post("/v1/radiologia/analizar_imagen")
def radiologia_analizar_imagen(req: RadiologiaImagenReq):
    t0 = time.time()
    if not req.image_paths:
        return {"status": "error", "error": "sin_imagenes"}
    if len(req.image_paths) > 4:
        return {"status": "error", "error": "maximo_4_imagenes"}
    # Mismo allowlist que audio_path: es este proceso quien abre los archivos.
    paths = [str(_check_audio_path(p)) for p in req.image_paths]
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    if not llm.get("vision"):
        return {"status": "error", "error": "llm_sin_vision: instala mlx_vlm en venv_mlx"}

    ctx = [f"Modalidad: {req.modalidad}" if req.modalidad else "",
           f"Region: {req.region}" if req.region else "",
           f"Indicacion clinica: {req.indicacion}" if req.indicacion else ""]
    ctx_txt = "\n".join(c for c in ctx if c) or "(sin datos del estudio)"
    prompt = RADIOLOGIA_IMAGEN_PROMPT.format(n=len(paths)) + f"\nESTUDIO:\n{ctx_txt}\n->"
    msgs = [{"role": "user", "content": prompt}]
    try:
        raw = complete(msgs, 900, images=paths)
    except Exception as e:
        return {"status": "error", "error": f"lectura_fallida: {e}"}
    parsed = _extract_json_object(raw)
    if not isinstance(parsed, dict):
        parsed = {}
    lectura = {k: str(parsed.get(k) or "").strip() for k in _SECCIONES_IMAGEN}
    out = {"status": "done", "lectura": lectura, "raw": raw if not parsed else "",
           "model": LLM_MODEL_ID, "n_imagenes": len(paths),
           "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "radiologia_imagen", "n": len(paths), "latency_ms": out["latency_ms"]})
    return out


# ------------------------------------------------ parser de comandos (Fase 9B)
# El LLM SOLO PROPONE una interpretación tipada; jamás ejecuta. El registry y la
# política del frontend deciden si la intención se permite, se confirma o se
# rechaza. Es MEJOR abstenerse (unsupported) que inventar.
_PARSE_INTENTS = {
    "set_view", "go_back", "open_active", "save_draft", "show_summary",
    "show_allergies", "check_interactions",
    "open_patient", "search_patient", "start_consult",
    "start_recording", "pause_recording", "resume_recording", "stop_recording",
    "soap_add", "soap_replace", "soap_delete_last",
    "change_primary_dx", "add_dx", "remove_dx",
    "add_med", "remove_med",
    "unsupported",
}

COMMAND_PARSE_PROMPT = (
    "Eres el parser de comandos de voz de MEGI (asistente clinico en espanol). Tu unica\n"
    "tarea: convertir el texto de un comando hablado en UN objeto JSON. Tu NO ejecutas\n"
    "nada; solo propones. Intenciones permitidas (enum estricto):\n"
    "  set_view {view: dashboard|pacientes|guias|estadisticas|revision|imprimir|voz}\n"
    "    (OJO: 'agenda' o 'inicio' = view dashboard; 'guias'/'fuentes'/'biblioteca' = view guias)\n"
    "  go_back | open_active | save_draft | show_summary | show_allergies | check_interactions\n"
    "  open_patient {name} | search_patient {name} | start_consult {name}\n"
    "  start_recording | pause_recording | resume_recording | stop_recording\n"
    "  soap_add {section: subjetivo|objetivo|analisis|plan, text}\n"
    "  soap_replace {section, text} | soap_delete_last {section}\n"
    "  change_primary_dx {query o code} | add_dx {query o code} | remove_dx {query o code}\n"
    "  add_med {med} | remove_med {med}\n"
    "  unsupported {reason}  <- usalo si NO es un comando (pregunta, conversacion),\n"
    "                           si falta informacion o si pide algo que no existe.\n"
    "Responde SOLO el JSON con claves: intent, entities, confidence (0-1),\n"
    "needs_clarification (bool) y reason (solo si unsupported). Sin texto extra.\n"
    "Es MEJOR unsupported o confidence baja que inventar una accion.\n"
    "Ejemplos:\n"
    'Texto: "anota en el plan que regrese en una semana"\n'
    '-> {"intent":"soap_add","entities":{"section":"plan","text":"Regresar en una semana"},"confidence":0.9,"needs_clarification":false}\n'
    'Texto: "ponle hipertension como diagnostico principal"\n'
    '-> {"intent":"change_primary_dx","entities":{"query":"hipertension"},"confidence":0.85,"needs_clarification":false}\n'
    'Texto: "sacame de aqui"\n'
    '-> {"intent":"go_back","entities":{},"confidence":0.7,"needs_clarification":false}\n'
    'Texto: "llevame a la agenda"\n'
    '-> {"intent":"set_view","entities":{"view":"dashboard"},"confidence":0.95,"needs_clarification":false}\n'
    'Texto: "cuantos pacientes tengo hoy"\n'
    '-> {"intent":"unsupported","entities":{},"confidence":0.85,"needs_clarification":false,"reason":"pregunta informativa, no es un comando"}\n'
    'Texto: "quitale la mitad de la dosis"\n'
    '-> {"intent":"unsupported","entities":{},"confidence":0.8,"needs_clarification":true,"reason":"falta el medicamento y la dosis objetivo"}\n'
)

_ABSTAIN = {"intent": "unsupported", "entities": {}, "confidence": 0.0,
            "needs_clarification": False, "reason": "salida_invalida_del_parser"}


class CommandParseReq(BaseModel):
    text: str
    context: dict | None = None   # p. ej. {"view": "consulta", "recording": true}


@router.post("/v1/command/parse")
def command_parse(req: CommandParseReq):
    t0 = time.time()
    text = (req.text or "").strip()
    if not text:
        return {"status": "done", "parse": dict(_ABSTAIN, reason="texto_vacio"), "latency_ms": 0}
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    ctx = ""
    if req.context:
        ctx = f"Contexto de pantalla: {json.dumps(req.context, ensure_ascii=False)}\n"
    msgs = [{"role": "user", "content": f"{COMMAND_PARSE_PROMPT}{ctx}Texto: \"{text}\"\n->"}]
    raw = complete(msgs, 180)
    parsed = _extract_json_object(raw)
    # Validación dura del lado del servicio: enum de intenciones y tipos base.
    if not isinstance(parsed, dict) or parsed.get("intent") not in _PARSE_INTENTS:
        parsed = dict(_ABSTAIN)
    parsed.setdefault("entities", {})
    parsed.setdefault("needs_clarification", False)
    try:
        parsed["confidence"] = max(0.0, min(1.0, float(parsed.get("confidence", 0))))
    except (TypeError, ValueError):
        parsed["confidence"] = 0.0
    out = {"status": "done", "parse": parsed, "model": LLM_MODEL_ID,
           "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "command_parse", "chars": len(text), "intent": parsed["intent"],
          "confidence": parsed["confidence"], "latency_ms": out["latency_ms"]})
    return out


# ------------------------------------------------ expediente del paciente
# El backend manda el expediente ya consolidado y ETIQUETADO ([C1] consultas,
# [R1] estudios, [D1] envíos, [A1] citas). gemma solo redacta y responde con lo
# que está ahí: cada afirmación lleva su etiqueta y lo que no está, se dice que
# no está. Es apoyo para el médico; no se guarda ni sustituye la nota.
EXPEDIENTE_RESUMEN_PROMPT = (
    "Eres el asistente clinico de MEGI (consulta medica en espanol de Mexico).\n"
    "Resume el EXPEDIENTE del paciente para el medico que lo va a atender hoy.\n"
    "Reglas DURAS:\n"
    "- Usa SOLO lo que dice el expediente. NO inventes diagnosticos, fechas, medicamentos ni estudios.\n"
    "- Cita la fuente de cada afirmacion con su etiqueta: [C1], [R2], [D1], [A1].\n"
    "- Si una seccion no tiene datos, dilo en una linea ('Sin estudios de imagen').\n"
    "- Sin recomendaciones ni juicios clinicos propios: el medico decide.\n"
    "Estructura (texto corrido, maximo 220 palabras, sin encabezados markdown):\n"
    "1) quien es y antecedentes (alergias, cronicos); 2) historial de consultas: motivos,\n"
    "diagnosticos, tratamientos, evolucion; 3) estudios de imagen y sus impresiones;\n"
    "4) envios (referencias), ordenes e incapacidades; 5) citas pendientes.\n"
    + REGLAS_CLINICAS + "\n"
)

EXPEDIENTE_PREGUNTA_PROMPT = (
    "Eres el asistente clinico de MEGI. El medico pregunta algo sobre SU paciente.\n"
    "Responde SOLO con lo que esta en el EXPEDIENTE, citando etiquetas [C1], [R1], [D1], [A1].\n"
    "Si el expediente no lo dice, responde exactamente: 'No esta en el expediente.' y, si aplica,\n"
    "que dato si hay relacionado. Maximo 120 palabras.\n"
    + REGLAS_CLINICAS + "\n"
)


class ExpedienteResumenReq(BaseModel):
    expediente: str


class ExpedientePreguntaReq(BaseModel):
    expediente: str
    pregunta: str
    historial: list = []     # [{"rol": "medico"|"megi", "texto": "..."}]


@router.post("/v1/expediente/resumen")
def expediente_resumen(req: ExpedienteResumenReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    exp = (req.expediente or "").strip()
    if not exp:
        return {"status": "error", "error": "expediente_vacio"}
    msgs = [{"role": "user", "content": f"{EXPEDIENTE_RESUMEN_PROMPT}\nEXPEDIENTE:\n{exp[:14000]}\n\nRESUMEN:"}]
    texto = complete(msgs, 600).strip()
    out = {"status": "done", "resumen": texto, "model": LLM_MODEL_ID,
           "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "expediente_resumen", "chars_in": len(exp), "latency_ms": out["latency_ms"]})
    return out


@router.post("/v1/expediente/preguntar")
def expediente_preguntar(req: ExpedientePreguntaReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    q = (req.pregunta or "").strip()
    if not q:
        return {"status": "error", "error": "pregunta_vacia"}
    hilo = ""
    for h in (req.historial or [])[-6:]:
        if isinstance(h, dict) and (h.get("texto") or "").strip():
            quien = "MEDICO" if h.get("rol") == "medico" else "MEGI"
            hilo += f"{quien}: {str(h['texto']).strip()[:500]}\n"
    msgs = [{"role": "user", "content": (
        f"{EXPEDIENTE_PREGUNTA_PROMPT}\nEXPEDIENTE:\n{(req.expediente or '')[:14000]}\n\n"
        + (f"CONVERSACION PREVIA:\n{hilo}\n" if hilo else "")
        + f"PREGUNTA DEL MEDICO: {q}\nRESPUESTA:")}]
    texto = complete(msgs, 350).strip()
    out = {"status": "done", "respuesta": texto, "model": LLM_MODEL_ID,
           "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "expediente_pregunta", "latency_ms": out["latency_ms"]})
    return out


# ------------------------------------------------ pre-diagnóstico de estudios aportados
# Los hechos vienen del backend ya etiquetados ([E1]…): lo que dijeron los
# modelos de imagen (tórax/columna/abdomen, con sus estados y avisos) y el texto
# de los PDF. gemma ORDENA y REDACTA; no añade hallazgos ni quita avisos.
PREDIAGNOSTICO_PROMPT = (
    "Eres el asistente clinico de MEGI (consulta medica en espanol de Mexico).\n"
    "Redacta un PRE-DIAGNOSTICO de apoyo a partir de los ESTUDIOS que trajo el paciente\n"
    "y de lo que dijeron los modelos de imagen y el texto de los documentos.\n"
    "Reglas DURAS:\n"
    "- Usa SOLO los hechos listados. NO inventes hallazgos, valores ni diagnosticos.\n"
    "- Cita cada afirmacion con su etiqueta [E1], [E2]...\n"
    "- Conserva los matices: 'posible' no es 'presente'; lo marcado experimental sigue siendo experimental;\n"
    "  los avisos de los modelos (no validado, no descarta) se mantienen.\n"
    "- Si un estudio no tiene modelo o no se reconocio, dilo en una linea.\n"
    "- Termina con una linea de correlacion clinica sugerida como PREGUNTA al medico, no como indicacion.\n"
    "Formato: texto corrido, maximo 200 palabras. Primero lo relevante para el motivo de consulta,\n"
    "despues el resto.\n"
    + REGLAS_CLINICAS + "\n"
)


class PrediagnosticoReq(BaseModel):
    hechos: str
    contexto: dict = {}


@router.post("/v1/prediagnostico")
def prediagnostico(req: PrediagnosticoReq):
    t0 = time.time()
    llm = available()
    if llm["error"]:
        return {"status": "error", "error": f"llm_no_disponible: {llm['error']}"}
    hechos = (req.hechos or "").strip()
    if not hechos:
        return {"status": "error", "error": "sin_hechos"}
    msgs = [{"role": "user", "content": f"{PREDIAGNOSTICO_PROMPT}\nHECHOS:\n{hechos[:12000]}\n\nPRE-DIAGNOSTICO:"}]
    texto = complete(msgs, 520).strip()
    out = {"status": "done", "texto": texto, "model": LLM_MODEL_ID, "latency_ms": int((time.time() - t0) * 1000)}
    _log({"kind": "prediagnostico", "chars_in": len(hechos), "latency_ms": out["latency_ms"]})
    return out
