"""Estadísticas derivadas de lo ya guardado (pacientes + consultas)."""
from fastapi import APIRouter, Depends

from ..db import db
from ..ownership import doctor_of
from ..security import require_user

router = APIRouter()


@router.get("/stats")
def get_stats(user: dict = Depends(require_user)):
    doc = doctor_of(user)
    with db() as conn:
        patients_total = conn.execute("SELECT COUNT(*) AS n FROM patients WHERE doctor_id = ?", (doc,)).fetchone()["n"]
        patients_waiting = conn.execute(
            "SELECT COUNT(*) AS n FROM patients WHERE status = 'esperando' AND doctor_id = ?", (doc,)
        ).fetchone()["n"]
        consultations_total = conn.execute("SELECT COUNT(*) AS n FROM consultations c JOIN patients p ON p.id = c.patient_id WHERE p.doctor_id = ?", (doc,)).fetchone()["n"]
        consultations_finalized = conn.execute(
            "SELECT COUNT(*) AS n FROM consultations c JOIN patients p ON p.id = c.patient_id WHERE c.final_soap IS NOT NULL AND p.doctor_id = ?", (doc,)
        ).fetchone()["n"]
        consultations_approved = conn.execute(
            "SELECT COUNT(*) AS n FROM consultations c JOIN patients p ON p.id = c.patient_id WHERE c.status IN ('approved', 'exported') AND p.doctor_id = ?", (doc,)
        ).fetchone()["n"]
        rows = conn.execute(
            "SELECT c.status, COUNT(*) AS n FROM consultations c JOIN patients p ON p.id = c.patient_id WHERE p.doctor_id = ? GROUP BY c.status", (doc,)
        ).fetchall()
        by_status = {r["status"]: r["n"] for r in rows}
    return {
        "patients_total": patients_total,
        "patients_waiting": patients_waiting,
        "consultations_total": consultations_total,
        "consultations_finalized": consultations_finalized,
        "consultations_approved": consultations_approved,
        "by_status": by_status,
    }
