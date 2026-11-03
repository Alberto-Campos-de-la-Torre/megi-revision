"""Biblioteca de guías clínicas (solo lectura).

Lee el índice RAG (chunks.jsonl) que ya generó el servicio ASR y expone listar /
leer / buscar por texto. NO usa el modelo MLX ni embeddings: es navegación y
búsqueda por palabra sobre el texto ya indexado (cero acoplamiento con gemma).
"""
import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..config import RAG_INDEX_PATH, REAL_ASR
from ..services import asr_client, guidelines_pdf

router = APIRouter()


class GuidelinesChatReq(BaseModel):
    question: str
    k: int = 5

_CACHE = {"chunks": None, "docs": None}


def _load():
    if _CACHE["chunks"] is not None:
        return _CACHE["chunks"], _CACHE["docs"]
    chunks, docs = [], {}
    if RAG_INDEX_PATH.exists():
        with open(RAG_INDEX_PATH, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                chunks.append(d)
                did = d.get("doc_id")
                doc = docs.get(did)
                if not doc:
                    doc = docs[did] = {
                        "doc_id": did, "title": d.get("title"), "source": d.get("source"),
                        "doc_type": d.get("doc_type"), "use_case": d.get("use_case"),
                        "tier": d.get("tier"), "chunk_count": 0,
                        "page_start": d.get("page_start"), "page_end": d.get("page_end"),
                    }
                doc["chunk_count"] += 1
                ps, pe = d.get("page_start"), d.get("page_end")
                if ps is not None:
                    doc["page_start"] = ps if doc["page_start"] is None else min(doc["page_start"], ps)
                if pe is not None:
                    doc["page_end"] = pe if doc["page_end"] is None else max(doc["page_end"], pe)
    _CACHE["chunks"], _CACHE["docs"] = chunks, docs
    return chunks, docs


@router.get("/guidelines")
def list_guidelines(q: str = Query("")):
    _, docs = _load()
    items = list(docs.values())
    ql = q.strip().lower()
    if ql:
        items = [d for d in items if ql in (d["title"] or "").lower()]
    items.sort(key=lambda d: (d["title"] or "").lower())
    # `pdf_available` se calcula al vuelo (un stat por guía): el corpus puede
    # copiarse al servidor después de arrancar y no hay que reiniciar.
    items = [{**d, "pdf_available": guidelines_pdf.pdf_path(d["doc_id"]) is not None} for d in items]
    return {"total": len(docs), "count": len(items), "docs": items}


@router.post("/guidelines/chat")
def guidelines_chat(body: GuidelinesChatReq):
    """Chat RAG: pregunta -> recupera guías -> Megi-LLM responde citando. Requiere
    el servicio MLX (MEGI_REAL_ASR). Aditivo: no toca el flujo de SOAP/ASR."""
    if not (body.question or "").strip():
        return {"answer": "", "sources": [], "error": "pregunta vacía"}
    if not REAL_ASR:
        return {"answer": "", "sources": [],
                "error": "El chat requiere el servicio MLX activo (MEGI_REAL_ASR=true)."}
    try:
        return asr_client.guidelines_chat(body.question.strip(), body.k)
    except Exception as e:
        return {"answer": "", "sources": [], "error": f"servicio MLX no disponible: {e}"}


@router.get("/guidelines/search")
def search_guidelines(q: str = Query(...), limit: int = 40):
    chunks, _ = _load()
    ql = q.strip().lower()
    if not ql:
        return {"query": q, "count": 0, "matches": []}
    out = []
    for d in chunks:
        text = d.get("text") or ""
        idx = text.lower().find(ql)
        if idx == -1:
            if ql not in (d.get("title") or "").lower():
                continue
            snippet = text[:180].strip() + ("…" if len(text) > 180 else "")
        else:
            start = max(0, idx - 70)
            end = idx + len(ql) + 110
            snippet = ("…" if start > 0 else "") + text[start:end].strip() + ("…" if end < len(text) else "")
        out.append({
            "doc_id": d.get("doc_id"), "title": d.get("title"),
            "citation": d.get("citation"), "chunk_id": d.get("chunk_id"),
            "page_start": d.get("page_start"), "snippet": snippet,
        })
        if len(out) >= limit:
            break
    return {"query": q, "count": len(out), "matches": out}


@router.get("/guidelines/{doc_id}/pdf")
def get_guideline_pdf(doc_id: str):
    """El PDF original de la guía, para verlo tal cual (tablas, algoritmos).
    Va con sesión como el resto; el frontend lo baja como blob y lo embebe."""
    _, docs = _load()
    if doc_id not in docs:
        raise HTTPException(status_code=404, detail="guía no encontrada")
    p = guidelines_pdf.pdf_path(doc_id)
    if p is None:
        raise HTTPException(status_code=404, detail="esta guía no tiene el PDF original en el servidor")
    return FileResponse(str(p), media_type="application/pdf",
                        headers={"Content-Disposition": f'inline; filename="{p.name}"',
                                 "Cache-Control": "private, max-age=3600"})


@router.get("/guidelines/{doc_id}")
def get_guideline(doc_id: str):
    chunks, docs = _load()
    meta = docs.get(doc_id)
    if not meta:
        raise HTTPException(status_code=404, detail="guía no encontrada")
    meta = {**meta, "pdf_available": guidelines_pdf.pdf_path(doc_id) is not None}
    doc_chunks = sorted(
        ({
            "chunk_id": d.get("chunk_id"), "page_start": d.get("page_start"),
            "page_end": d.get("page_end"), "citation": d.get("citation"), "text": d.get("text"),
        } for d in chunks if d.get("doc_id") == doc_id),
        key=lambda c: c.get("chunk_id") or "",
    )
    return {"doc": meta, "chunks": doc_chunks}
