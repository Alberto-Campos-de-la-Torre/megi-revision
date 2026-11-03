"""Citas de seguimiento (continuidad del paciente)."""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..db import db
from ..ownership import doctor_of, owned_patient
from ..schemas import AppointmentCreate
from ..security import current_user

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(r) -> dict:
    return {
        "id": r["id"], "patient_id": r["patient_id"], "consultation_id": r["consultation_id"],
        "scheduled_date": r["scheduled_date"], "time": r["time"], "reason": r["reason"],
        "status": r["status"], "created_by": r["created_by"], "created_at": r["created_at"],
    }


@router.post("/appointments")
def create_appointment(body: AppointmentCreate, user: dict = Depends(current_user)):
    with db() as conn:
        owned_patient(conn, body.patient_id, user)
        cur = conn.execute(
            """INSERT INTO appointments
               (patient_id, consultation_id, scheduled_date, time, reason, status, created_by, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (body.patient_id, body.consultation_id, body.scheduled_date, body.time,
             body.reason or "Control / seguimiento", "pendiente", user["username"], _now()),
        )
        r = conn.execute("SELECT * FROM appointments WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _public(r)


@router.get("/patients/{patient_id}/appointments")
def patient_appointments(patient_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        owned_patient(conn, patient_id, user)
        rows = conn.execute(
            "SELECT * FROM appointments WHERE patient_id = ? ORDER BY scheduled_date, time", (patient_id,)
        ).fetchall()
    return [_public(r) for r in rows]


@router.get("/appointments/upcoming")
def upcoming_appointments(user: dict = Depends(current_user)):
    today = date.today().isoformat()
    with db() as conn:
        rows = conn.execute(
            """SELECT a.*, p.name AS patient_name FROM appointments a
               LEFT JOIN patients p ON p.id = a.patient_id
               WHERE a.status = 'pendiente' AND a.scheduled_date >= ?
                 AND p.doctor_id = ?
               ORDER BY a.scheduled_date, a.time LIMIT 20""",
            (today, doctor_of(user)),
        ).fetchall()
    out = []
    for r in rows:
        d = _public(r)
        d["patient_name"] = r["patient_name"]
        out.append(d)
    return out
