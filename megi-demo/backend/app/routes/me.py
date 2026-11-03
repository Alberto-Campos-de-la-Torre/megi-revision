"""Perfil profesional del médico autenticado.

Lo que se imprime en recetas, referencias, órdenes e incapacidades —nombre,
especialidad y **cédula profesional**— sale de aquí, no de un perfil global.
Con varios médicos en el mismo servidor, imprimir la cédula de otro no sería un
error cosmético: la receta es un documento legal y la cédula identifica a quien
responde por ella.

Falla en abierto a propósito NO: si el perfil está incompleto se devuelve vacío
y la UI avisa, en vez de rellenar con los datos de otra persona.
"""
from fastapi import APIRouter, Depends

from ..db import db
from ..schemas import DoctorProfileUpdate
from ..security import require_user

router = APIRouter()

_CAMPOS = ("name", "specialty", "cedula", "cedula_esp", "institution", "address", "phone")
# `equipo` va aparte: se guarda como JSON y se devuelve como lista.
import json as _json


def profile_of(username: str) -> dict:
    """Perfil imprimible del médico. `complete` es lo que mira la UI para avisar
    antes de que alguien imprima una receta sin cédula."""
    with db() as conn:
        r = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not r:
        return {c: "" for c in _CAMPOS} | {"complete": False}
    d = {c: (r[c] if c in r.keys() and r[c] else "") for c in _CAMPOS}
    # Mínimo legal para imprimir: quién eres y con qué cédula.
    d["complete"] = bool(d["name"] and d["cedula"])
    try:
        d["equipo"] = _json.loads(r["equipo"]) if ("equipo" in r.keys() and r["equipo"]) else []
    except (ValueError, TypeError):
        d["equipo"] = []
    return d


@router.get("/me")
def get_me(user: dict = Depends(require_user)):
    return {"username": user["username"], "role": user.get("role"),
            **profile_of(user["username"])}


@router.patch("/me")
def update_me(body: DoctorProfileUpdate, user: dict = Depends(require_user)):
    """Cada médico edita SU perfil; nadie edita el de otro."""
    campos = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "equipo" in campos:                       # lista -> JSON en la columna
        campos["equipo"] = _json.dumps([str(x) for x in campos["equipo"]], ensure_ascii=False)
    if campos:
        sets = ", ".join(f"{k} = ?" for k in campos)
        with db() as conn:
            conn.execute(f"UPDATE users SET {sets} WHERE username = ?",
                         [*campos.values(), user["username"]])
    return {"username": user["username"], **profile_of(user["username"])}
