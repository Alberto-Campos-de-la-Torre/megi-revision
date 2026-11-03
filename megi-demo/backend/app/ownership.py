"""Pertenencia del expediente: quién puede ver qué (multi-tenencia).

El servidor pasa a alojar pacientes de médicos independientes, cada uno con su
agenda. Antes cualquier usuario autenticado veía el expediente completo, lo cual
era correcto para una app local de un solo médico y es una filtración en cuanto
hay dos.

Modelo: **el paciente es la raíz**. `patients.doctor_id` guarda el `username` del
médico dueño; consultas, audio, documentos, citas y exportaciones cuelgan del
paciente y heredan su dueño. Así cada ruta responde una sola pregunta —¿este
paciente es tuyo?— en vez de inventarse su propia regla.

Se responde **404 y no 403** a propósito: un 403 confirmaría que ese id existe.

El rol `admin` NO abre expedientes ajenos (ver `docs/plan_multi_medico.md`):
administra usuarios y catálogos. Que exista un rol capaz de leerlo todo es
justamente el riesgo que se está cerrando.
"""
from fastapi import HTTPException


def doctor_of(user: dict) -> str:
    """Identidad del médico dueño. Es el `username` (PK de `users`)."""
    return (user or {}).get("username") or ""


def owns_patient_row(row, user: dict) -> bool:
    """¿Esta fila de `patients` es de este médico? Los pacientes sin dueño
    (`doctor_id IS NULL`, anteriores a la migración) NO son de nadie: hay que
    asignarlos explícitamente con `python -m app.assign_owner`."""
    if row is None:
        return False
    try:
        owner = row["doctor_id"]
    except (KeyError, IndexError):
        owner = None
    return bool(owner) and owner == doctor_of(user)


def owned_patient(conn, patient_id: str, user: dict) -> dict:
    """Devuelve el paciente si es de este médico; 404 en cualquier otro caso."""
    row = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not owns_patient_row(row, user):
        raise HTTPException(status_code=404, detail="paciente no encontrado")
    return row


def owned_consultation(conn, consultation_id: str, user: dict) -> dict:
    """Devuelve la consulta si su paciente es de este médico; 404 si no.

    Se comprueba contra el paciente y no contra `consultations.doctor_id` para
    que una consulta mal etiquetada no se convierta en un agujero."""
    row = conn.execute(
        "SELECT * FROM consultations WHERE id = ?", (consultation_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="consulta no encontrada")
    owned_patient(conn, row["patient_id"], user)
    return row


def patient_ids_of(conn, user: dict) -> list:
    """Ids de los pacientes de este médico (para filtrar agregados/estadísticas)."""
    return [
        r["id"]
        for r in conn.execute(
            "SELECT id FROM patients WHERE doctor_id = ?", (doctor_of(user),)
        )
    ]
