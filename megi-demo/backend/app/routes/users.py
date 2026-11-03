"""Gestión de usuarios (v0.0.1).

Acceso local: usuarios persistidos en SQLite. La contraseña se guarda con
PBKDF2-HMAC-SHA256 y sal por usuario; los hashes legados (SHA-256 sin sal)
se migran de forma perezosa en el primer login exitoso.
La página de Administración del frontend solo se muestra a usuarios 'admin'.
"""
import hashlib
import hmac
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..db import db
from ..schemas import UserCreate
from ..security import require_admin

router = APIRouter()

# OWASP recomienda >=600k iteraciones para PBKDF2-HMAC-SHA256 (2023).
# Ajustable por env para que la suite de tests no pague el costo completo.
_PBKDF2_ITERATIONS = int(os.environ.get("MEGI_PBKDF2_ITERS", "600000"))

# Usuarios protegidos: no se pueden borrar desde la app (ni por otro admin).
# Cuenta de recuperación/dueño del sistema. Comparar siempre en minúsculas.
_PROTECTED_USERS = {"king"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash(pw: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return "pbkdf2_sha256$%d$%s$%s" % (_PBKDF2_ITERATIONS, salt.hex(), dk.hex())


def _verify_password(pw: str, stored: str):
    """Devuelve (ok, needs_rehash). Acepta el formato actual
    (pbkdf2_sha256$iters$salt$hash) y el legado (SHA-256 sin sal), que se
    marca para re-hashear en cuanto la contraseña se comprueba válida."""
    stored = stored or ""
    if stored.startswith("pbkdf2_sha256$"):
        try:
            _, iters, salt_hex, hash_hex = stored.split("$")
            dk = hashlib.pbkdf2_hmac(
                "sha256", pw.encode("utf-8"), bytes.fromhex(salt_hex), int(iters)
            )
        except ValueError:
            return False, False
        ok = hmac.compare_digest(dk.hex(), hash_hex)
        return ok, ok and int(iters) != _PBKDF2_ITERATIONS
    legacy = hashlib.sha256(pw.encode("utf-8")).hexdigest()
    ok = hmac.compare_digest(legacy, stored)
    return ok, ok


def seed_users() -> None:
    """P2: ya NO se siembra un admin fijo (antes: king/votapan).

    El primer administrador se crea en el primer arranque desde la pantalla de
    configuración (`POST /api/auth/setup`) o localmente con
    `python -m app.create_admin`. Sin admin, la app muestra la pantalla de setup.
    """
    return


def _public(r) -> dict:
    keys = r.keys()
    return {"username": r["username"], "name": r["name"], "role": r["role"], "created_at": r["created_at"],
            "visible_para": r["visible_para"] if "visible_para" in keys else None,
            "acceso_anestesio": bool(r["acceso_anestesio"]) if "acceso_anestesio" in keys else False}


def _lo_ve(r, admin: dict) -> bool:
    """¿Este admin puede ver/administrar al usuario? Los ocultos solo los ve el
    admin al que se le asignaron. El propio usuario nunca se oculta a sí mismo."""
    keys = r.keys()
    dueno = r["visible_para"] if "visible_para" in keys else None
    return not dueno or dueno == admin["username"] or r["username"] == admin["username"]


def _usuario_visible(conn, username: str, admin: dict):
    """Fila del usuario, o 404 si no existe O si está oculto para este admin:
    un 403 le diría que existe, que es justo lo que se quiere evitar."""
    r = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not r or not _lo_ve(r, admin):
        raise HTTPException(status_code=404, detail="usuario no encontrado")
    return r


def has_admin() -> bool:
    """True si ya existe al menos un administrador (setup completado)."""
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").fetchone()["n"]
    return n > 0


def create_admin(username: str, name: str, password: str, must_change: bool = False) -> dict:
    """Crea un usuario admin. Lo usa el bootstrap de primer arranque y el CLI.
    No hace control de acceso: el llamador decide cuándo es válido crearlo."""
    u = (username or "").strip().lower()
    if not u or not password:
        raise ValueError("usuario y contraseña requeridos")
    with db() as conn:
        if conn.execute("SELECT 1 FROM users WHERE username = ?", (u,)).fetchone():
            raise ValueError("ese usuario ya existe")
        conn.execute(
            "INSERT INTO users (username, name, role, password_hash, created_at, must_change_password) "
            "VALUES (?,?,?,?,?,?)",
            (u, (name or "").strip() or u, "admin", _hash(password), _now(), 1 if must_change else 0),
        )
        r = conn.execute("SELECT * FROM users WHERE username = ?", (u,)).fetchone()
    return _public(r)


def set_password(username: str, new_password: str) -> bool:
    """Cambia la contraseña y limpia el flag de cambio obligatorio."""
    u = (username or "").strip().lower()
    if not new_password:
        raise ValueError("contraseña requerida")
    with db() as conn:
        if not conn.execute("SELECT 1 FROM users WHERE username = ?", (u,)).fetchone():
            return False
        conn.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = ?",
            (_hash(new_password), u),
        )
    return True


def verify_user(username: str, password: str):
    """Devuelve {username, name, role, must_change_password} si las credenciales
    son válidas, o None."""
    u = (username or "").strip().lower()
    with db() as conn:
        r = conn.execute("SELECT * FROM users WHERE username = ?", (u,)).fetchone()
    if not r:
        return None
    ok, needs_rehash = _verify_password(password, r["password_hash"])
    if not ok:
        return None
    if needs_rehash:
        # Migración perezosa: hash legado (o iteraciones viejas) -> formato actual.
        with db() as conn:
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE username = ?", (_hash(password), u)
            )
    return {
        "username": r["username"],
        "name": r["name"],
        "role": r["role"],
        "must_change_password": bool(r["must_change_password"]),
    }


@router.get("/users")
def list_users(admin: dict = Depends(require_admin)):
    with db() as conn:
        rows = conn.execute("SELECT * FROM users ORDER BY created_at").fetchall()
    return [_public(r) for r in rows if _lo_ve(r, admin)]


@router.post("/users")
def create_user(body: UserCreate, admin: dict = Depends(require_admin)):
    u = body.username.strip().lower()
    if not u or not body.password:
        raise HTTPException(status_code=400, detail="usuario y contraseña requeridos")
    with db() as conn:
        exists = conn.execute("SELECT 1 FROM users WHERE username = ?", (u,)).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail="ese usuario ya existe")
        # P2: el usuario debe cambiar la contraseña que le puso el admin en su
        # primer login (la contraseña inicial la conoce el admin, no es secreta).
        conn.execute(
            "INSERT INTO users (username, name, role, password_hash, created_at, must_change_password, visible_para) "
            "VALUES (?,?,?,?,?,1,?)",
            (u, body.name.strip() or u, body.role, _hash(body.password), _now(),
             admin["username"] if body.solo_visible_para_mi else None),
        )
        r = conn.execute("SELECT * FROM users WHERE username = ?", (u,)).fetchone()
    return _public(r)


class VisibilidadReq(BaseModel):
    solo_visible_para_mi: bool


@router.patch("/users/{username}/visibilidad")
def cambiar_visibilidad(username: str, body: VisibilidadReq, admin: dict = Depends(require_admin)):
    """Oculta un usuario al resto de administradores (queda visible solo para
    quien lo oculta) o vuelve a hacerlo visible. Solo el admin al que está
    asignado puede cambiarlo; para los demás el usuario no existe."""
    u = (username or "").strip().lower()
    if u in _PROTECTED_USERS or u == admin["username"]:
        raise HTTPException(status_code=400, detail="ese usuario no se puede ocultar")
    with db() as conn:
        r = _usuario_visible(conn, u, admin)
        if r["role"] == "admin":
            raise HTTPException(status_code=400, detail="un administrador no se puede ocultar a otros administradores")
        conn.execute("UPDATE users SET visible_para = ? WHERE username = ?",
                     (admin["username"] if body.solo_visible_para_mi else None, u))
        return _public(conn.execute("SELECT * FROM users WHERE username = ?", (u,)).fetchone())


@router.delete("/users/{username}")
def delete_user(username: str, admin: dict = Depends(require_admin)):
    u = (username or "").strip().lower()
    # Cuenta protegida: no se puede borrar desde la app bajo ninguna circunstancia.
    if u in _PROTECTED_USERS:
        raise HTTPException(status_code=403, detail="este usuario está protegido y no puede borrarse")
    with db() as conn:
        r = _usuario_visible(conn, u, admin)      # oculto para este admin = no existe
        # No permitir borrar el último administrador.
        if r["role"] == "admin":
            admins = conn.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").fetchone()["n"]
            if admins <= 1:
                raise HTTPException(status_code=400, detail="no puedes borrar al último administrador")
        conn.execute("DELETE FROM users WHERE username = ?", (u,))
    return {"ok": True, "deleted": u}



class AnestesioReq(BaseModel):
    acceso: bool


@router.patch("/users/{username}/anestesio")
def cambiar_acceso_anestesio(username: str, body: AnestesioReq, admin: dict = Depends(require_admin)):
    """Autoriza o retira el acceso a la sección Anestesio (modelos restringidos).
    Mismo alcance que la visibilidad: solo sobre usuarios que este admin ve."""
    u = (username or "").strip().lower()
    with db() as conn:
        r = conn.execute("SELECT * FROM users WHERE username = ?", (u,)).fetchone()
        if not r or not _lo_ve(r, admin):
            raise HTTPException(status_code=404, detail="usuario no encontrado")
        conn.execute("UPDATE users SET acceso_anestesio = ? WHERE username = ?", (1 if body.acceso else 0, u))
        r = conn.execute("SELECT * FROM users WHERE username = ?", (u,)).fetchone()
    return _public(r)
