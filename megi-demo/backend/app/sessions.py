"""Sesiones revocables (hallazgo #5, revisión 2026-07-12).

Antes: el token firmado valía 30 días y NO se podía revocar — cerrar sesión solo
borraba `localStorage`, así que un token filtrado seguía siendo válido un mes y la
única revocación global era rotar el secreto (tumbando a todos).

Ahora cada token lleva un `sid` que corresponde a una fila de la tabla `sessions`.
Revocar = marcar la fila; `verify_token()` lo comprueba en cada petición (SQLite
local, coste despreciable). Los tokens viejos (sin `sid`) dejan de ser válidos:
al actualizar, cada usuario vuelve a entrar una vez.
"""
import time
import uuid
from datetime import datetime, timezone

from .db import db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_session(username: str, expires_at: float) -> str:
    """Crea la sesión y devuelve su `sid` (va dentro del token firmado)."""
    sid = uuid.uuid4().hex
    with db() as conn:
        conn.execute(
            "INSERT INTO sessions (sid, username, created_at, expires_at, revoked_at, last_seen_at) "
            "VALUES (?,?,?,?,NULL,?)",
            (sid, (username or "").strip().lower(), _now_iso(), float(expires_at), _now_iso()),
        )
        # Higiene: las sesiones ya vencidas no se conservan.
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
    return sid


def is_active(sid: str) -> bool:
    if not sid:
        return False
    with db() as conn:
        r = conn.execute(
            "SELECT revoked_at, expires_at FROM sessions WHERE sid = ?", (sid,)
        ).fetchone()
    return bool(r) and r["revoked_at"] is None and float(r["expires_at"] or 0) > time.time()


def touch(sid: str) -> None:
    with db() as conn:
        conn.execute("UPDATE sessions SET last_seen_at = ? WHERE sid = ?", (_now_iso(), sid))


def revoke(sid: str) -> bool:
    with db() as conn:
        cur = conn.execute(
            "UPDATE sessions SET revoked_at = ? WHERE sid = ? AND revoked_at IS NULL",
            (_now_iso(), sid),
        )
    return cur.rowcount > 0


def revoke_all_for(username: str, except_sid: str = "") -> int:
    """Cierra todas las sesiones del usuario (menos, opcionalmente, la actual).
    Se usa al cambiar la contraseña: un cambio de credencial invalida lo viejo."""
    u = (username or "").strip().lower()
    with db() as conn:
        cur = conn.execute(
            "UPDATE sessions SET revoked_at = ? WHERE username = ? AND sid != ? AND revoked_at IS NULL",
            (_now_iso(), u, except_sid or ""),
        )
    return cur.rowcount


def list_for(username: str) -> list:
    u = (username or "").strip().lower()
    with db() as conn:
        rows = conn.execute(
            "SELECT sid, created_at, last_seen_at, expires_at FROM sessions "
            "WHERE username = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
            (u, time.time()),
        ).fetchall()
    return [dict(r) for r in rows]
