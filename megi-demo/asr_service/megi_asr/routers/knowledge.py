"""Guías clínicas: búsqueda semántica y chat con citas sobre el índice de GPC."""
from fastapi import APIRouter
from pydantic import BaseModel

from rag.contra_checker import contra
from rag.rag_service import rag as rag_index
from rag.rag_service import rag_fda

from ..llm import LLM_MODEL_ID, REGLAS_CLINICAS, _sources_block, available, complete

router = APIRouter()

class RagSearchReq(BaseModel):
    query: str
    k: int = 5
    use_cases: list | None = None
    tiers: list | None = None


@router.post("/v1/rag/search")
def rag_search(req: RagSearchReq):
    if not rag_index.available():
        # El motivo REAL (falta el índice, falta sentence-transformers,
        # error al cargar bge-m3…) en vez de una cadena fija: si no, un
        # problema de dependencias parece "no hay índice" y se diagnostica mal.
        st = rag_index.status()
        return {"available": False, "error": st.get("error") or "index_not_available",
                "detail": st, "results": []}
    return {"available": True, "index_version": rag_index.index_version,
            "results": rag_index.search(req.query, k=req.k, use_cases=req.use_cases, tiers=req.tiers)}


@router.post("/v1/rag/search_fda")
def rag_search_fda(req: RagSearchReq):
    """Búsqueda sobre el índice FDA/DailyMed (paquete FDA_movil: 139 383 textos en
    español validados + 121 063 en inglés sin traducir). Índice APARTE del de guías:
    no interfiere con /v1/rag/search ni con el SOAP.

    Cada resultado trae `language` y `validation_status`; los pasajes en inglés
    llevan `notice` y la cita lo dice. Reconoce el fármaco de la consulta
    (`drug_filter`) y la sección pedida (`section_filter`). OJO: contenido
    regulatorio de EE.UU.; dosis e indicaciones pueden no coincidir con COFEPRIS."""
    if not rag_fda.available():
        st = rag_fda.status()
        return {"available": False, "error": st.get("error") or "fda_index_not_available",
                "detail": st, "results": []}
    return {"available": True, "index_version": rag_fda.index_version,
            "results": rag_fda.search(req.query, k=req.k, use_cases=req.use_cases, tiers=req.tiers)}


@router.get("/v1/rag/status")
def rag_status():
    """Estado de los tres recursos de conocimiento SIN forzar su carga."""
    return {"gpc": rag_index.status(), "fda": rag_fda.status(), "contra": contra.status()}


GUIDELINES_CHAT_SYSTEM = (
    "Eres un asistente clinico que responde preguntas apoyandote UNICAMENTE en las "
    "FUENTES de guias de practica clinica (GPC) que se te entregan.\n" + REGLAS_CLINICAS
)

# ------------------------------------------------ Megi IA sobre UNA consulta (revisión)
# El backend entrega el CONTEXTO de esa consulta y de ese paciente, ya etiquetado
# ([T] transcripción, [SA] SOAP automático, [SL] SOAP limpio, [DX], [RX], [SV],
# [E#] estudios, [C#] consultas previas). Aquí se añaden las guías recuperadas
# para la pregunta y se responde con las mismas reglas que el chat de guías.
CONSULTA_CHAT_SYSTEM = (
    "Eres Megi IA, asistente clinico del medico que esta REVISANDO una consulta antes de firmarla. "
    "Respondes sobre esa consulta y ese paciente con el CONTEXTO entregado y las FUENTES de guias "
    "recuperadas: por que se puso un medicamento o diagnostico, posibles errores u omisiones en la nota, "
    "interacciones o contraindicaciones SI estan en las fuentes, y antecedentes del paciente que convenga "
    "recordar.\n" + REGLAS_CLINICAS
)


class ConsultaChatReq(BaseModel):
    contexto: str
    pregunta: str
    historial: list = []
    k: int = 5


@router.post("/v1/consulta/preguntar")
def consulta_preguntar(req: ConsultaChatReq):
    q = (req.pregunta or "").strip()
    if not q:
        return {"respuesta": "", "fuentes": [], "error": "empty_question"}
    llm = available()
    if llm["error"]:
        return {"respuesta": "", "fuentes": [], "error": f"llm_no_disponible: {llm['error']}"}
    retrieved = rag_index.search(q, k=max(1, min(req.k, 8))) if rag_index.available() else []
    block = _sources_block(retrieved) if retrieved else "FUENTES CLINICAS RECUPERADAS: (ninguna relevante)"
    hilo = ""
    for h in (req.historial or [])[-6:]:
        if isinstance(h, dict) and (h.get("texto") or "").strip():
            hilo += f"{'MEDICO' if h.get('rol') == 'medico' else 'MEGI'}: {str(h['texto']).strip()[:500]}\n"
    user = (f"{block}\n\nCONTEXTO DE LA CONSULTA Y DEL PACIENTE:\n{(req.contexto or '')[:16000]}\n\n"
            + (f"CONVERSACION PREVIA:\n{hilo}\n" if hilo else "")
            + f"PREGUNTA DEL MEDICO:\n{q}\n\nResponde apoyandote solo en el contexto y las fuentes, citandolos.")
    msgs = [{"role": "user", "content": CONSULTA_CHAT_SYSTEM + "\n\n" + user}]
    answer = complete(msgs, 600).strip()
    sources = [{"citation_id": r.get("citation_id"), "citation": r.get("citation"), "title": r.get("title"),
                "page": r.get("page"), "score": r.get("score")} for r in retrieved]
    return {"status": "done", "respuesta": answer, "fuentes": sources, "model": LLM_MODEL_ID}


class ChatReq(BaseModel):
    question: str
    k: int = 5


@router.post("/v1/guidelines/chat")
def guidelines_chat(req: ChatReq):
    q = (req.question or "").strip()
    if not q:
        return {"answer": "", "sources": [], "error": "empty_question"}
    if not rag_index.available():
        st = rag_index.status()
        return {"answer": "", "sources": [],
                "error": st.get("error") or "index_not_available", "detail": st}
    retrieved = rag_index.search(q, k=max(1, min(req.k, 8)))
    llm = available()
    if llm["error"]:
        return {"answer": "", "sources": [], "error": f"llm_no_disponible: {llm['error']}"}
    block = _sources_block(retrieved) if retrieved else "FUENTES CLINICAS RECUPERADAS: (ninguna relevante)"
    user = (
        f"{block}\n\nPREGUNTA DEL MEDICO:\n{q}\n\n"
        "Responde apoyandote solo en las fuentes y citalas con [S#]."
    )
    msgs = [{"role": "user", "content": GUIDELINES_CHAT_SYSTEM + "\n\n" + user}]
    answer = complete(msgs, 700).strip()
    sources = [{
        "citation_id": r.get("citation_id"), "citation": r.get("citation"),
        "title": r.get("title"), "page": r.get("page"), "score": r.get("score"),
    } for r in retrieved]
    return {"answer": answer, "sources": sources, "index_version": rag_index.index_version}
