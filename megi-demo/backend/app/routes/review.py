import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..db import db
from ..ownership import owned_consultation
from ..schemas import ReviewApproveRequest, ReviewEventRequest, ReviewSaveRequest
from ..security import current_user
from ..services import audit_log
from .safety import compute_alerts, load_catalog_rules

router = APIRouter()

# Tipos de evento de auditoría permitidos por esta ruta (cambios por voz, Fase 4).
_VOICE_EVENT_KINDS = {"voice_edit", "voice_soap", "voice_dx", "voice_rx"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/review/event")
def review_event(body: ReviewEventRequest, user: dict = Depends(current_user)):
    """Registra (auditoría persistente, por usuario) un cambio aplicado por voz."""
    kind = body.kind if body.kind in _VOICE_EVENT_KINDS else "voice_edit"
    with db() as conn:
        owned_consultation(conn, body.consultation_id, user)
        audit_log.log_review_event(
            conn, body.consultation_id, kind, body.payload,
            actor=user.get("name") or user.get("username"),
        )
    return {"ok": True, "logged_at": _now()}


@router.post("/review/save")
def review_save(body: ReviewSaveRequest, user: dict = Depends(current_user)):
    payload = body.model_dump()
    if body.consultation_id:
        with db() as conn:
            owned_consultation(conn, body.consultation_id, user)
            audit_log.log_review_event(conn, body.consultation_id, "save", payload,
                                       actor=user.get("name") or user.get("username"))
            conn.execute(
                "UPDATE consultations SET status = 'in_review', updated_at = ? WHERE id = ?",
                (_now(), body.consultation_id),
            )
    return {"ok": True, "saved_at": _now()}


@router.post("/review/approve")
def review_approve(body: ReviewApproveRequest, user: dict = Depends(current_user)):
    if not body.consultation_id:
        raise HTTPException(status_code=400, detail="consultation_id requerido para aprobar")
    now = _now()
    # Quién firma lo dice el TOKEN, no el cuerpo de la petición: `approved_by` es
    # la atribución legal de la nota y `actor` es dato del cliente (un
    # usuario podía firmar a nombre de otro y falsear la auditoría).
    actor = user.get("name") or user.get("username")
    with db() as conn:
        c = owned_consultation(conn, body.consultation_id, user)
        # Seguridad REAL (no solo UI): recalcular alertas (alergia + interacción
        # grave del catálogo aprobado) y bloquear si hay alguna sin confirmación
        # explícita. Es la fuente de verdad del gate clínico.
        catalog, interactions = load_catalog_rules()
        blockers = [a for a in compute_alerts(body.rx_list, body.allergies, body.chronic, catalog, interactions)
                    if a["severity"] == "blocker"]
        if blockers and not body.safety_ack:
            raise HTTPException(
                status_code=409,
                detail="Receta con alerta de seguridad sin confirmar: " + "; ".join(b["message"] for b in blockers),
            )
        audit_log.log_review_event(conn, body.consultation_id, "approve", body.model_dump(), actor)
        conn.execute(
            """UPDATE consultations
               SET status = 'approved', updated_at = ?, approved_at = ?, approved_by = ?,
                   approved_soap = ?, prescription = ?, dx_codes = ?, vitals = ?
               WHERE id = ?""",
            (
                now, now, actor,
                json.dumps(body.soap, ensure_ascii=False) if body.soap is not None else None,
                json.dumps(body.rx_list, ensure_ascii=False) if body.rx_list is not None else None,
                json.dumps(body.selected_dx, ensure_ascii=False) if body.selected_dx is not None else None,
                json.dumps(body.vitals, ensure_ascii=False) if body.vitals is not None else None,
                body.consultation_id,
            ),
        )
        # La agenda refleja el cierre: el paciente pasa a 'terminada'.
        if c["patient_id"]:
            conn.execute("UPDATE patients SET status = 'terminada' WHERE id = ?", (c["patient_id"],))
    return {"ok": True, "status": "approved", "approved_by": actor}
