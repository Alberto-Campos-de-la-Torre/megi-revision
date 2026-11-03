"""Cliente HTTP del microservicio ASR real (py3.14+mlx) en MEGI_ASR_SERVICE_URL.

El backend MEGI (py3.9) NO importa el motor; lo consume por HTTP. Esto mantiene las
rutas del backend estables: get_asr() decide entre cliente real y mock.
"""
from __future__ import annotations

import httpx

from ..config import ASR_SERVICE_URL, ASR_TOKEN

_TIMEOUT = 180.0
# Cabecera de auth compartida con el ASR service (vacía = ASR abierto, modo dev).
_HEADERS = {"X-MEGI-ASR-Token": ASR_TOKEN} if ASR_TOKEN else {}


def health() -> dict:
    r = httpx.get(f"{ASR_SERVICE_URL}/health", timeout=10.0)
    r.raise_for_status()
    return r.json()


def transcribe_file(audio_path: str, consultation_id: str | None = None,
                    route: str = "general_consultation",
                    speaker_ref: list | None = None) -> dict:
    # `route` etiqueta la petición para observabilidad y, cuando se implemente,
    # prioridad en el servicio (voice_command debe adelantarse a chunks/gemma).
    # `speaker_ref` (Fase 10B): huella del médico -> el servicio devuelve los
    # segmentos de whisper puntuados contra ella (la etiqueta se decide aquí).
    payload = {"audio_path": audio_path, "route": route, "consultation_id": consultation_id}
    if speaker_ref:
        payload["speaker_ref"] = speaker_ref
    r = httpx.post(f"{ASR_SERVICE_URL}/v1/transcribe/file", json=payload,
                   timeout=_TIMEOUT, headers=_HEADERS)
    r.raise_for_status()
    return r.json()


def parse_command(text: str, context: dict | None = None) -> dict:
    """Fase 9B: parser LLM de comandos (gemma). SOLO propone {intent, entities,
    confidence, ...}; la autorización/ejecución vive en el registry del frontend."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/command/parse",
        json={"text": text, "context": context},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def suggest_documents(transcript: str, soap: dict | None = None) -> dict:
    """Fase 11: qué documentos amerita la consulta (gemma propone; el backend
    fusiona con heurística y el médico decide)."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/documents/suggest",
        json={"transcript": transcript, "soap": soap},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def speaker_embed(audio_path: str) -> dict:
    """Fase 10: embedding de hablante (huella vocal) calculado localmente por el
    servicio ASR. La comparación/umbral/decisión viven en este backend."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/speaker/embed",
        json={"audio_path": audio_path},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def transcribe_identifier(audio_path: str, entity_type: str,
                          consultation_id: str | None = None,
                          slot_id: str | None = None) -> dict:
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/transcribe/identifier",
        json={"audio_path": audio_path, "entity_type": entity_type,
              "consultation_id": consultation_id, "slot_id": slot_id},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def soap_update(new_confirmed_text: str, current_soap: dict,
                consultation_id: str | None = None, paciente: dict | None = None) -> dict:
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/soap/update",
        json={"consultation_id": consultation_id,
              "new_confirmed_text": new_confirmed_text, "current_soap": current_soap,
              "paciente": paciente or {}},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def soap_finalize(transcript: str, current_soap: dict | None = None,
                  consultation_id: str | None = None, paciente: dict | None = None) -> dict:
    """`paciente` (alergias, crónicos, edad, sexo, embarazo) alimenta el verificador
    de contraindicaciones FDA del cierre; opcional."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/soap/finalize",
        json={"consultation_id": consultation_id,
              "transcript": transcript, "current_soap": current_soap or {},
              "paciente": paciente or {}},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def drugs_check(rx_list: list, conditions: list | None = None, allergies: list | None = None,
                age=None, sex: str | None = None, embarazo: bool | None = None,
                context_text: str | None = None) -> dict:
    """Verificador de recetas sobre la tabla de contraindicaciones FDA (FDA_movil):
    alertas fármaco–condición, fármaco–fármaco y alergia, con cita textual.
    `context_text` = transcripción en vivo: fármacos/condiciones mencionados."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/drugs/check",
        json={"rx_list": rx_list, "conditions": conditions or [], "allergies": allergies or [],
              "age": age, "sex": sex, "embarazo": embarazo, "context_text": context_text},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def preconsulta_personalize(context: dict, base_sugerencias: list) -> dict:
    """Personaliza las sugerencias pre-consulta con el historial (gemma redacta
    un resumen y prioriza). El motor determinista es la base; esto la afina."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/preconsulta/personalize",
        json={"context": context, "base": base_sugerencias},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def radiologia_estructurar(transcript: str) -> dict:
    """Ordena un dictado radiológico en secciones (solo si no traía encabezados)."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/radiologia/estructurar",
        json={"transcript": transcript},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def radiologia_analizar_imagen(image_paths: list, modalidad: str, region: str, indicacion: str) -> dict:
    """Lectura asistida de las imágenes del estudio (gemma vía mlx_vlm). Van
    RUTAS, como `audio_path`: el ASR las valida contra su allowlist y las abre.
    Leer 1-4 imágenes tarda 10-40 s; con el LLM frío, la carga suma ~10 s más."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/radiologia/analizar_imagen",
        json={"image_paths": list(image_paths), "modalidad": modalidad,
              "region": region, "indicacion": indicacion},
        timeout=max(_TIMEOUT, 300.0), headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def drugs_consult(question: str, context_drugs: list, catalog_rules: list) -> dict:
    """Consultor de fármacos (RAG catálogo + FDA) — dudas del médico en consulta."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/drugs/consult",
        json={"question": question, "context_drugs": context_drugs, "catalog_rules": catalog_rules},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def drugs_alternatives(rx_list: list, interaccion: dict, catalogo: list) -> dict:
    """Alternativas ante una interacción de alto riesgo."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/drugs/alternatives",
        json={"rx_list": rx_list, "interaccion": interaccion, "catalogo": catalogo},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def vademecum_enrich(generico: str) -> dict:
    """Ficha FDA traducida (dosis máx + precauciones) para complementar el catálogo."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/vademecum/enrich",
        json={"generico": generico},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def drug_interactions(farmaco: str, clase: str, candidatos: list) -> dict:
    """Etapa 3: propone interacciones de un fármaco contra el catálogo aprobado."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/drugs/interactions",
        json={"farmaco": farmaco, "clase": clase, "candidatos": candidatos},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def guidelines_chat(question: str, k: int = 5) -> dict:
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/guidelines/chat",
        json={"question": question, "k": k},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def expediente_resumen(expediente_txt: str) -> dict:
    """Resumen del expediente del paciente (gemma redacta; solo con lo que hay)."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/expediente/resumen",
        json={"expediente": expediente_txt},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def expediente_preguntar(expediente_txt: str, pregunta: str, historial: list | None = None) -> dict:
    """Pregunta del médico sobre el paciente, respondida solo con el expediente."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/expediente/preguntar",
        json={"expediente": expediente_txt, "pregunta": pregunta, "historial": historial or []},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def prediagnostico(hechos_txt: str, contexto: dict | None = None) -> dict:
    """Pre-diagnóstico de los estudios aportados: gemma redacta a partir de los
    hechos que devolvieron los modelos de imagen y el texto de los PDF."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/prediagnostico",
        json={"hechos": hechos_txt, "contexto": contexto or {}},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def consulta_preguntar(contexto: str, pregunta: str, historial: list | None = None, k: int = 5) -> dict:
    """Megi IA sobre UNA consulta en revisión: contexto de esa consulta + guías
    recuperadas (RAG) para la pregunta, con las reglas del chat de guías."""
    r = httpx.post(
        f"{ASR_SERVICE_URL}/v1/consulta/preguntar",
        json={"contexto": contexto, "pregunta": pregunta, "historial": historial or [], "k": k},
        timeout=_TIMEOUT, headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()
