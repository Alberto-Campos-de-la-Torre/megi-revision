"""Subida desde el teléfono, SIN sesión: solo con el código del QR.

El código (`enlaces_subida.token`) lo generó un médico con sesión para UNA
consulta, caduca a los 15 minutos y se revoca al generar otro o al salir de la
pantalla. Con él el teléfono puede: ver a quién está subiendo (nombre corto,
nada más) y subir archivos. No lista, no borra, no lee nada del expediente.
Un código inválido, caducado o revocado responde 404 sin distinguir cuál.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..db import db
from ..services import analisis_estudios as analisis
from ..services import estudios_archivo as ea
from ..uploads import read_capped
from .estudios import guardar_estudio

router = APIRouter()


def _enlace(conn, token: str) -> dict:
    r = conn.execute(
        """SELECT e.*, p.name AS patient_name, c.status AS consultation_status
           FROM enlaces_subida e
           JOIN patients p ON p.id = e.patient_id
           JOIN consultations c ON c.id = e.consultation_id
           WHERE e.token = ?""", (token,)).fetchone()
    if not r or r["revoked_at"] or float(r["expires_at"] or 0) < time.time():
        raise HTTPException(status_code=404, detail="el código no es válido o ya caducó")
    if r["consultation_status"] in ("approved", "exported"):
        raise HTTPException(status_code=409, detail="la consulta ya está cerrada")
    return r


def _nombre_corto(name: str) -> str:
    partes = (name or "").split()
    if len(partes) <= 1:
        return name or ""
    return f"{partes[0]} {partes[1][0]}."


@router.get("/subida/{token}")
def info(token: str):
    with db() as conn:
        r = _enlace(conn, token)
        n = conn.execute("SELECT count(*) FROM estudios_aportados WHERE consultation_id = ?",
                         (r["consultation_id"],)).fetchone()[0]
    return {"ok": True, "paciente": _nombre_corto(r["patient_name"]),
            "expira_en_s": max(0, int(float(r["expires_at"]) - time.time())),
            "subidos": n, "max": ea.MAX_ESTUDIOS_POR_CONSULTA,
            "max_mb": ea.MAX_ESTUDIO_BYTES // (1024 * 1024)}


@router.post("/subida/{token}/archivo")
async def subir(token: str, tareas: BackgroundTasks, file: UploadFile = File(...)):
    with db() as conn:
        r = _enlace(conn, token)
    raw = await read_capped(file, ea.MAX_ESTUDIO_BYTES, "El archivo")
    with db() as conn:
        _enlace(conn, token)   # pudo caducar mientras subía
        est = guardar_estudio(conn, r["consultation_id"], r["patient_id"], raw, file.filename or "",
                              "telefono", r["created_by"])
        conn.execute("UPDATE enlaces_subida SET usos = COALESCE(usos, 0) + 1 WHERE token = ?", (token,))
    if est["analisis_estado"] != "descartado":
        tareas.add_task(analisis.procesar_estudio, est["id"])
    return est



# ------------------------------------------------------------- pase de la mesa de anestesia
class PaseReq(BaseModel):
    pase: str


@router.post("/anestesio/pase/validar")
def validar_pase_anestesio(body: PaseReq):
    """La mesa del anestesiólogo (electros) llama aquí con el pase que llegó en
    su URL. Sin sesión de MEGI: el pase es la credencial. Un solo uso, 90 s.
    Responde 404 si no existe, caducó o ya se usó (sin distinguir)."""
    tok = (body.pase or "").strip()
    with db() as conn:
        r = conn.execute("SELECT * FROM pases_anestesio WHERE token = ?", (tok,)).fetchone()
        if not r or r["used_at"] or float(r["expires_at"] or 0) < time.time():
            raise HTTPException(status_code=404, detail="pase no válido o caducado")
        conn.execute("UPDATE pases_anestesio SET used_at = ? WHERE token = ?", (_ahora(), tok))
        u = conn.execute("SELECT username, name, role FROM users WHERE username = ?", (r["username"],)).fetchone()
    return {"ok": True, "usuario": r["username"], "nombre": u["name"] if u else r["username"], "rol": u["role"] if u else None}


def _ahora() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
