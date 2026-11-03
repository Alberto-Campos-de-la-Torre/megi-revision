import hashlib
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..db import db
from ..security import require_user
from ..ownership import owned_consultation
from ..services import audit_log

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_note(patient: dict, consultation: dict) -> dict:
    """Nota canónica para sellado (v0.0.1): se sella lo que el médico APROBÓ
    (approved_soap + receta + dx); si no hay aprobación, cae a la nota IA. Así el
    hash cubre exactamente lo que se imprime."""
    src = consultation.get("approved_soap") or consultation.get("final_soap") or consultation.get("soap")
    soap = json.loads(src) if src else {"S": "", "O": "", "A": "", "P": ""}
    facts = json.loads(consultation["clinical_facts"]) if consultation.get("clinical_facts") else {}
    rx = json.loads(consultation["prescription"]) if consultation.get("prescription") else []
    dx = json.loads(consultation["dx_codes"]) if consultation.get("dx_codes") else []
    return {
        "patient": {
            "id": patient["id"],
            "name": patient["name"],
            "curp": patient["curp"],
            "nss": patient["nss"],
        },
        "soap": soap,
        "rx": rx,
        "dx": dx,
        "clinical_facts": facts,
        "approved_by": consultation.get("approved_by"),
        "transcript": consultation.get("transcript") or "",
    }


@router.get("/export/consultation/{consultation_id}")
def export_consultation(consultation_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        c = owned_consultation(conn, consultation_id, user)
        p = conn.execute("SELECT * FROM patients WHERE id = ?", (c["patient_id"],)).fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="paciente de la consulta no encontrado")

        note = _build_note(dict(p), dict(c))
        canonical = json.dumps(note, ensure_ascii=False, sort_keys=True)
        content_hash = "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()

        audit_log.log_export(conn, consultation_id, "nota", content_hash, note)
        conn.execute(
            "UPDATE consultations SET status = 'exported', updated_at = ? WHERE id = ?",
            (_now(), consultation_id),
        )

    # Hash REAL del contenido; la firma NO es legal en Sprint 1.
    return {
        "consultation_id": consultation_id,
        "content_hash": content_hash,
        "signature_status": "mock_not_legal_signature",
        "signed_at": None,
    }
