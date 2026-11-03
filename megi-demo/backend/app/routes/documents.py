"""Documentos clínicos derivados de la consulta (referencia, órdenes, incapacidad).

Cada documento se persiste ligado a la consulta, con un sello (hash sha256 del
contenido) y el usuario que lo generó/firmó. Reúsa el patrón de la nota: editable
por el médico, sellado y auditable.
"""
import hashlib
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..config import REAL_ASR
from ..db import db
from ..security import require_user
from ..ownership import owned_consultation
from ..schemas import DocumentCreate
from ..security import current_user
from ..services import asr_client
from ..services.doc_suggest import heuristic_suggestions, merge_suggestions

router = APIRouter()

ALLOWED_KINDS = {"referencia", "orden_estudios", "incapacidad"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(r) -> dict:
    return {
        "id": r["id"], "kind": r["kind"],
        "content": json.loads(r["content"] or "{}"),
        "content_hash": r["content_hash"],
        "created_by": r["created_by"], "created_at": r["created_at"],
    }


@router.post("/documents")
def create_document(body: DocumentCreate, user: dict = Depends(current_user)):
    if body.kind not in ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail=f"tipo de documento inválido: {body.kind}")
    canonical = json.dumps(body.content or {}, ensure_ascii=False, sort_keys=True)
    content_hash = "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    now = _now()
    with db() as conn:
        owned_consultation(conn, body.consultation_id, user)
        cur = conn.execute(
            """INSERT INTO documents
               (consultation_id, patient_id, kind, content, content_hash, created_by, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (body.consultation_id, body.patient_id, body.kind,
             json.dumps(body.content or {}, ensure_ascii=False), content_hash, user["username"], now),
        )
        r = conn.execute("SELECT * FROM documents WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _public(r)


@router.get("/consultations/{consultation_id}/documents")
def list_documents(consultation_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        rows = conn.execute(
            "SELECT * FROM documents WHERE consultation_id = ? ORDER BY id", (consultation_id,)
        ).fetchall()
    return [_public(r) for r in rows]


@router.get("/consultations/{consultation_id}/documents/suggestions")
def document_suggestions(consultation_id: str, refresh: int = 0):
    """Fase 11: qué documentos amerita la consulta (para que la impresión solo
    ofrezca los que tienen sustento y con campos prellenados).

    Heurística de vocabulario sobre transcript+SOAP siempre; refinamiento con
    gemma si hay inferencia real. Fusión sesgada a recall (aplica si cualquiera
    de las dos lo detecta). Se cachea en la consulta; `?refresh=1` recalcula.
    """
    with db() as conn:
        row = conn.execute(
            "SELECT transcript, soap, final_soap, doc_suggestions FROM consultations WHERE id = ?",
            (consultation_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="consulta no encontrada")

    if row["doc_suggestions"] and not refresh:
        try:
            return json.loads(row["doc_suggestions"])
        except Exception:
            pass  # caché corrupto -> recalcular

    transcript = row["transcript"] or ""
    soap = {}
    try:
        soap = json.loads(row["final_soap"] or row["soap"] or "{}") or {}
    except Exception:
        soap = {}
    base_text = transcript + " " + " ".join(str(v) for v in soap.values())

    heur = heuristic_suggestions(base_text)
    llm, source = None, "heuristica"
    if REAL_ASR and transcript.strip():
        try:
            r = asr_client.suggest_documents(transcript, soap)
            if r.get("status") == "done":
                llm, source = r.get("suggestions"), "llm+heuristica"
        except Exception:
            pass  # sin LLM: la heurística sostiene la función

    result = merge_suggestions(heur, llm)
    result["source"] = source
    result["computed_at"] = _now()

    with db() as conn:
        conn.execute(
            "UPDATE consultations SET doc_suggestions = ? WHERE id = ?",
            (json.dumps(result, ensure_ascii=False), consultation_id),
        )
    return result
