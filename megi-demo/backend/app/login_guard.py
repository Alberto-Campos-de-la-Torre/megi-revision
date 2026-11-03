"""Límite de intentos de login con backoff exponencial (hallazgo #2,
revisión 2026-07-12).

Contador por usuario INTENTADO (exista o no, para no revelar cuáles existen)
persistido en SQLite. A partir de FAILURES_BEFORE_LOCK fallos consecutivos se
impone una espera que se duplica con cada fallo extra, con tope MAX_DELAY_S.
Un login exitoso limpia el contador.
"""
import time

from .db import db

FAILURES_BEFORE_LOCK = 5
BASE_DELAY_S = 5.0
MAX_DELAY_S = 300.0


def _delay_for(failures: int) -> float:
    extra = failures - FAILURES_BEFORE_LOCK
    if extra < 0:
        return 0.0
    return min(MAX_DELAY_S, BASE_DELAY_S * (2 ** extra))


def seconds_until_allowed(username: str) -> float:
    """Segundos de espera restantes para este usuario (0 = puede intentar)."""
    u = (username or "").strip().lower()
    with db() as conn:
        r = conn.execute(
            "SELECT locked_until FROM login_attempts WHERE username = ?", (u,)
        ).fetchone()
    if not r or not r["locked_until"]:
        return 0.0
    return max(0.0, float(r["locked_until"]) - time.time())


def register_failure(username: str) -> int:
    """Registra un intento fallido y devuelve el total de fallos consecutivos."""
    u = (username or "").strip().lower()
    now = time.time()
    with db() as conn:
        r = conn.execute(
            "SELECT failures FROM login_attempts WHERE username = ?", (u,)
        ).fetchone()
        failures = (r["failures"] if r else 0) + 1
        locked_until = now + _delay_for(failures)
        conn.execute(
            "INSERT INTO login_attempts (username, failures, last_failure_at, locked_until) "
            "VALUES (?,?,?,?) ON CONFLICT(username) DO UPDATE SET "
            "failures = excluded.failures, last_failure_at = excluded.last_failure_at, "
            "locked_until = excluded.locked_until",
            (u, failures, now, locked_until),
        )
    return failures


def clear(username: str) -> None:
    u = (username or "").strip().lower()
    with db() as conn:
        conn.execute("DELETE FROM login_attempts WHERE username = ?", (u,))
