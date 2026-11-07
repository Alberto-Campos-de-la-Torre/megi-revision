import json
from datetime import datetime, timezone

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..db import db
from ..ownership import doctor_of, owned_consultation
from ..schemas import ReviewApproveRequest, ReviewEventRequest, ReviewSaveRequest
from ..security import current_user, require_user
from ..services import audit_log
from .patients import _row_to_patient
from .safety import compute_alerts, load_catalog_rules

router = APIRouter()

# Tamaño máximo de página de las lecturas paginadas de revisión. El cliente
# puede pedir menos; nunca más (una página «infinita» equivale a no paginar).
_PAGE_MAX = 200

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


# --------------------------------------------------------------- paginadas
# Lecturas pensadas para la mesa de revisión (MEGI Revisión): evitan recorrer
# TODOS los pacientes del médico y pedir cada consulta una a una. Filtran en
# servidor por el médico del token (multi-tenencia por `patients.doctor_id`).

def _pagina(limit: int, offset: int):
    limit = max(1, min(int(limit), _PAGE_MAX))
    offset = max(0, int(offset))
    return limit, offset


@router.get("/review/pending")
def review_pending(limit: int = Query(50, ge=1, le=_PAGE_MAX), offset: int = Query(0, ge=0),
                   user: dict = Depends(require_user)):
    """Consultas consolidadas (con nota final) y todavía sin aprobar/exportar de
    los pacientes de ESTE médico, con la ficha del paciente incluida. Ordenadas de
    la más reciente a la más antigua; `total` y `next_offset` permiten recorrer
    todas las páginas sin duplicados ni huecos (orden estable por fecha e id)."""
    limit, offset = _pagina(limit, offset)
    doctor = doctor_of(user)
    where = ("FROM consultations c JOIN patients p ON p.id = c.patient_id "
             "WHERE p.doctor_id = ? AND c.final_soap IS NOT NULL AND c.final_soap != '' "
             "AND c.status NOT IN ('approved', 'exported', 'radiologia')")
    with db() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS n {where}", (doctor,)).fetchone()["n"]
        rows = conn.execute(
            f"SELECT c.*, p.id AS p_id {where} "
            "ORDER BY COALESCE(c.finalized_at, c.started_at) DESC, c.id DESC LIMIT ? OFFSET ?",
            (doctor, limit, offset),
        ).fetchall()
        pacientes = {}
        for r in rows:
            pid = r["patient_id"]
            if pid not in pacientes:
                pr = conn.execute("SELECT * FROM patients WHERE id = ?", (pid,)).fetchone()
                pacientes[pid] = _row_to_patient(pr) if pr else None
    items = []
    for r in rows:
        c = dict(r)
        c.pop("p_id", None)
        # La transcripción no hace falta para listar y puede ser larga.
        c.pop("transcript", None)
        items.append({"consultation": c, "patient": pacientes.get(r["patient_id"])})
    next_offset = offset + len(rows)
    return {"items": items, "total": total, "limit": limit, "offset": offset,
            "next_offset": next_offset if next_offset < total else None}


class MedicationHistoryRequest(BaseModel):
    patient_ids: List[str] = Field(default_factory=list, max_length=_PAGE_MAX)
    limit: int = Field(100, ge=1, le=_PAGE_MAX)
    offset: int = Field(0, ge=0)


@router.post("/review/medication-history")
def review_medication_history(body: MedicationHistoryRequest, user: dict = Depends(require_user)):
    """Recetas aprobadas/exportadas de varios pacientes en una sola lectura
    paginada (sin pedir cada consulta). Solo pacientes de ESTE médico: un id
    ajeno o inexistente responde 404 y no se devuelve nada (no se mezcla un
    historial parcial con uno ajeno). Orden estable: paciente, fecha de
    aprobación descendente, id."""
    ids = [i for i in dict.fromkeys(body.patient_ids) if i]
    if not ids:
        return {"items": [], "total": 0, "limit": body.limit, "offset": body.offset, "next_offset": None}
    limit, offset = _pagina(body.limit, body.offset)
    doctor = doctor_of(user)
    marks = ",".join("?" for _ in ids)
    with db() as conn:
        owned = {r["id"] for r in conn.execute(
            f"SELECT id FROM patients WHERE doctor_id = ? AND id IN ({marks})", (doctor, *ids))}
        ajenos = [i for i in ids if i not in owned]
        if ajenos:
            raise HTTPException(status_code=404, detail="paciente no encontrado")
        where = (f"FROM consultations WHERE patient_id IN ({marks}) "
                 "AND status IN ('approved', 'exported')")
        total = conn.execute(f"SELECT COUNT(*) AS n {where}", (*ids,)).fetchone()["n"]
        rows = conn.execute(
            f"SELECT id, patient_id, status, started_at, approved_at, approved_by, prescription {where} "
            "ORDER BY patient_id, COALESCE(approved_at, started_at) DESC, id DESC LIMIT ? OFFSET ?",
            (*ids, limit, offset),
        ).fetchall()
    items = [dict(r) for r in rows]
    next_offset = offset + len(rows)
    return {"items": items, "total": total, "limit": limit, "offset": offset,
            "next_offset": next_offset if next_offset < total else None}
