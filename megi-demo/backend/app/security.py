"""Tokens de sesión firmados (HMAC) para acceso local (v0.0.1).

No es OAuth ni JWT completo, pero cierra el agujero real: el rol va dentro de un
token FIRMADO por el servidor, así no se puede falsificar editando localStorage.
Los endpoints sensibles (administración de usuarios) exigen un token válido + rol.
"""
import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Depends, Header, HTTPException

from .config import DATA_DIR, MODE

_DEV_DEFAULT = "megi-dev-secret-change-me"
_SECRET_FILE = DATA_DIR / "megi_secret.key"   # local, NO versionar
# Hallazgo #5 (rev. 2026-07-12): antes 30 días sin revocación posible. Ahora una
# semana y, sobre todo, revocable: el `sid` del token vive en la tabla `sessions`.
_TTL = int(os.environ.get("MEGI_TOKEN_TTL_DAYS", "7")) * 24 * 3600


def resolve_secret(env_secret, file_secret, mode):
    """P0: en modo real exige un secreto propio (no el default de desarrollo).
    Si falta, el backend NO arranca (evita tokens admin falsificables)."""
    s = (env_secret or file_secret or "").strip()
    if mode == "real" and (not s or s == _DEV_DEFAULT):
        raise RuntimeError(
            "MEGI_SECRET no configurado en modo real. Genera uno por instalación:\n"
            "  cd backend && .venv/bin/python -m app.gen_secret\n"
            "o define la variable de entorno MEGI_SECRET."
        )
    return s or _DEV_DEFAULT


_file_secret = _SECRET_FILE.read_text(encoding="utf-8").strip() if _SECRET_FILE.exists() else None
_SECRET = resolve_secret(os.environ.get("MEGI_SECRET"), _file_secret, MODE).encode("utf-8")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def _ub64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def issue_token(username: str, role: str, name: str = "", must_change: bool = False) -> str:
    from . import sessions  # import diferido: sessions -> db -> config

    exp = int(time.time()) + _TTL
    payload = {"u": username, "role": role, "name": name, "exp": exp,
               "sid": sessions.new_session(username, exp)}
    if must_change:
        # Alcance restringido: solo /auth/change-password hasta cambiar la
        # contraseña (require_user rechaza con 403; ver hallazgo #3 rev. 2026-07-12).
        payload["mc"] = 1
    p = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = _b64(hmac.new(_SECRET, p.encode("ascii"), hashlib.sha256).digest())
    return f"{p}.{sig}"


def verify_token(token: str):
    try:
        p, sig = token.split(".", 1)
        expected = _b64(hmac.new(_SECRET, p.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(_ub64(p))
        if int(data.get("exp", 0)) < int(time.time()):
            return None
        # Sesión revocable: la firma ya no basta, el `sid` debe seguir vivo.
        # Los tokens anteriores a este cambio no traen `sid` y quedan inválidos.
        from . import sessions  # import diferido: sessions -> db -> config

        sid = data.get("sid", "")
        if not sessions.is_active(sid):
            return None
        return {
            "username": data["u"],
            "role": data["role"],
            "name": data.get("name", ""),
            "must_change_password": bool(data.get("mc")),
            "sid": sid,
        }
    except Exception:
        return None


def current_user(authorization: str = Header(default="")) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No autenticado")
    u = verify_token(authorization[7:])
    if not u:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada")
    return u


def require_user(user: dict = Depends(current_user)) -> dict:
    """Usuario autenticado SIN cambio de contraseña pendiente. Un token con
    `mc` (must_change_password) solo sirve para /auth/change-password, que usa
    current_user directamente; todo lo demás responde 403 hasta cambiarla."""
    if user.get("must_change_password"):
        raise HTTPException(
            status_code=403,
            detail="Debes cambiar tu contraseña antes de continuar (/auth/change-password)",
        )
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Requiere rol administrador")
    return user
