"""Tickets de un solo uso para el WebSocket de streaming (hallazgo #6, rev. 2026-07-12).

`new WebSocket()` no admite cabeceras, así que el token de sesión viajaba en el
query string: acaba en logs de proxy/servidor y dura lo que dura el token (días).

Ahora el navegador pide un ticket por REST (con su `Authorization` normal), y ese
ticket —efímero (30 s), de un solo uso y sin valor fuera del WS— es lo único que
viaja en la URL. Store en memoria: el ticket no debe sobrevivir a un reinicio del
backend, y este proceso es el único que lo canjea.
"""
import secrets
import threading
import time

TTL_S = 30.0

_lock = threading.Lock()
_tickets: dict = {}


def _purge_locked(now: float) -> None:
    for t in [t for t, v in _tickets.items() if v["exp"] < now]:
        _tickets.pop(t, None)


def issue(user: dict, consultation_id: str = "") -> dict:
    now = time.time()
    ticket = secrets.token_urlsafe(32)
    with _lock:
        _purge_locked(now)
        _tickets[ticket] = {
            "exp": now + TTL_S,
            "username": user.get("username", ""),
            "name": user.get("name", ""),
            "role": user.get("role", ""),
            "consultation_id": consultation_id or "",
        }
    return {"ticket": ticket, "expires_in": int(TTL_S)}


def redeem(ticket: str):
    """Canjea el ticket (lo consume). Devuelve el contexto o None si no vale."""
    now = time.time()
    with _lock:
        _purge_locked(now)
        data = _tickets.pop(ticket or "", None)
    if not data or data["exp"] < now:
        return None
    return data
