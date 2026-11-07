"""Segundo médico ficticio para las pruebas de identidad (I2). Solo para el
backend de evidencia (SQLite aislado de evidencia/.runtime/backend): crea la
cuenta `demo_medica_b` con UN paciente propio (P-DEMOB1), una consulta previa
aprobada y una consulta consolidada pendiente de revisión. Idempotente.
Ejecutar desde megi-demo/backend: .venv/bin/python ../../evidencia/sembrar-medico-b.py
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.getcwd())
from app.db import db, init_db  # noqa: E402
from app.routes.users import _hash, set_password  # noqa: E402

USER, NAME, PASSWORD = "demo_medica_b", "Dra. Segunda Ficticia", "demo-megi-b-2026"
ROLE = "medico"


def _iso(days_ago, hour=10):
    d = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return d.replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()


def _J(v):
    return json.dumps(v, ensure_ascii=False)


def main():
    init_db()
    now = datetime.now(timezone.utc).isoformat()
    with db() as conn:
        if conn.execute("SELECT 1 FROM users WHERE username = ?", (USER,)).fetchone():
            set_password(USER, PASSWORD)
        else:
            conn.execute(
                "INSERT INTO users (username, name, role, password_hash, created_at, must_change_password) VALUES (?,?,?,?,?,0)",
                (USER, NAME, ROLE, _hash(PASSWORD), now),
            )
        for t, col in (("review_events", "consultation_id"), ("exports", "consultation_id"), ("soap_patches", "consultation_id")):
            conn.execute(f"DELETE FROM {t} WHERE {col} LIKE 'C-DEMOB%'")
        conn.execute("DELETE FROM appointments WHERE patient_id LIKE 'P-DEMOB%'")
        conn.execute("DELETE FROM consultations WHERE id LIKE 'C-DEMOB%'")
        conn.execute("DELETE FROM patients WHERE id LIKE 'P-DEMOB%'")
        conn.execute(
            """INSERT INTO patients (id, name, short, curp, nss, age, sex, time, status, reason, last,
                   allergies, chronic, scheduled_date, kind, created_at, email, phone, birthdate, doctor_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("P-DEMOB1", "Bruno Paciente Ficticio", "Bruno P. Ficticio", "PAFB880202HDFRCR05", "56789012345",
             45, "M", "", "terminada", "Tos y fiebre de 4 días", "Consulta de hoy",
             _J(["Penicilina"]), _J(["Hipertensión arterial"]), None, "espontaneo", _iso(200), "", "", None, USER),
        )
        prev_soap = {"S": "Control de presión.", "O": "TA 138/88.", "A": "Hipertensión arterial.", "P": "Losartán 50 mg cada 24 h."}
        started = _iso(45)
        conn.execute(
            """INSERT INTO consultations (id, patient_id, status, started_at, updated_at, doctor_id, motivo, transcript,
                   soap, final_soap, finalized_at, approved_soap, prescription, dx_codes, approved_by, approved_at, vitals)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("C-DEMOB1-PREV", "P-DEMOB1", "approved", started, started, USER, "Control de hipertensión", "",
             _J(prev_soap), _J(prev_soap), started, _J(prev_soap),
             _J([{"drug": "Losartán 50 mg", "dose": "50 mg", "freq": "cada 24 h", "duration": "continuo"}]),
             _J([{"code": "I10", "label": "Hipertensión esencial"}]), NAME, started, _J({"ta": "138/88"})),
        )
        soap = {"S": "Tos productiva y fiebre de 4 días.", "O": "T 38.2, crepitantes basales derechos.",
                "A": "Neumonía adquirida en la comunidad, leve.", "P": "Amoxicilina 500 mg cada 8 h 7 días. Control en 72 h."}
        hoy = _iso(0, 9)
        conn.execute(
            """INSERT INTO consultations (id, patient_id, status, started_at, updated_at, doctor_id, motivo, transcript,
                   soap, final_soap, clinical_facts, validation_flags, finalized_at, vitals)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("C-DEMOB1", "P-DEMOB1", "in_review", hoy, now, USER, "Tos y fiebre de 4 días",
             "Tengo tos con flemas y fiebre desde hace cuatro días.", _J(soap), _J(soap),
             _J({"diagnosticos": [{"code": "J18.9", "label": "Neumonía, no especificada"}],
                 "medicamentos_propuestos": ["Amoxicilina 500 mg cada 8 h 7 días"],
                 "alergias_mencionadas": ["Penicilina"], "pendientes": ["Control en 72 h"]}),
             _J({"status": "requires_review", "official_note": False, "flags": [], "warnings": []}), now, _J({"t": "38.2"})),
        )
    print(f"Segundo médico sembrado: {USER} · paciente P-DEMOB1 · consulta C-DEMOB1 pendiente · C-DEMOB1-PREV aprobada")


if __name__ == "__main__":
    main()
