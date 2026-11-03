"""Autenticación local (v0.0.1).

Acceso por usuario/contraseña; los usuarios viven en la tabla `users`
(ver routes/users.py). El token de sesión SÍ va firmado (HMAC, ver security.py).

P2 — primer arranque seguro:
  - NO hay admin fijo de fábrica. Si no existe ningún administrador, la app
    muestra la pantalla de configuración y se crea el primero vía `/auth/setup`.
  - Los usuarios creados por un admin deben cambiar su contraseña en el primer
    login (`must_change_password`); `/auth/change-password` lo permite.
"""
from fastapi import APIRouter, Depends, HTTPException

from .. import login_guard, sessions
from ..schemas import ChangePasswordRequest, LoginRequest, SetupRequest
from ..security import current_user, issue_token, verify_token
from .users import create_admin, has_admin, set_password, verify_user

router = APIRouter()


@router.get("/auth/setup-status")
def setup_status():
    """Público: indica si falta crear el primer administrador (primer arranque)."""
    return {"needs_setup": not has_admin()}


@router.post("/auth/setup")
def setup(body: SetupRequest):
    """Público SOLO en primer arranque: crea el primer admin y devuelve sesión.
    Si ya existe un administrador, se rechaza (409) para que no sea un backdoor."""
    if has_admin():
        raise HTTPException(status_code=409, detail="La configuración inicial ya se completó")
    if len((body.password or "").strip()) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")
    try:
        user = create_admin(body.username, body.name or body.username, body.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    user["must_change_password"] = False
    user["token"] = issue_token(user["username"], user["role"], user["name"])
    return user


@router.post("/auth/login")
def login(body: LoginRequest):
    # Límite de intentos (backoff exponencial por usuario intentado). Se
    # comprueba ANTES de verificar credenciales: durante el bloqueo ni la
    # contraseña correcta entra (si no, el ataque itera gratis).
    wait = login_guard.seconds_until_allowed(body.username)
    if wait > 0:
        raise HTTPException(
            status_code=429,
            detail="Demasiados intentos fallidos; espera %d segundos" % int(wait + 1),
            headers={"Retry-After": str(int(wait + 1))},
        )
    user = verify_user(body.username, body.password)
    if not user:
        login_guard.register_failure(body.username)
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")
    login_guard.clear(body.username)
    # must_change_password viaja DENTRO del token firmado: el backend rechaza
    # todo endpoint clínico (403 en require_user) hasta cambiar la contraseña.
    user["token"] = issue_token(
        user["username"], user["role"], user["name"],
        must_change=user["must_change_password"],
    )
    return user


@router.post("/auth/change-password")
def change_password(body: ChangePasswordRequest, me: dict = Depends(current_user)):
    """El usuario autenticado cambia su propia contraseña (valida la actual)."""
    if not verify_user(me["username"], body.current_password):
        raise HTTPException(status_code=400, detail="La contraseña actual no es correcta")
    if len((body.new_password or "").strip()) < 6:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 6 caracteres")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe ser distinta de la actual")
    set_password(me["username"], body.new_password)
    # Token nuevo (mismo usuario/rol) para reflejar la sesión "limpia"...
    token = issue_token(me["username"], me["role"], me.get("name", ""))
    # ...y se cierran las demás sesiones del usuario: cambiar la contraseña debe
    # invalidar lo emitido antes (incluido el token restringido por must_change).
    sessions.revoke_all_for(me["username"], except_sid=verify_token(token)["sid"])
    return {"ok": True, "token": token}


@router.post("/auth/logout")
def logout(me: dict = Depends(current_user)):
    """Cierra ESTA sesión server-side (antes solo se borraba localStorage y el
    token seguía siendo válido hasta expirar)."""
    return {"ok": True, "revoked": sessions.revoke(me.get("sid", ""))}


@router.get("/auth/sessions")
def my_sessions(me: dict = Depends(current_user)):
    """Sesiones activas del usuario (para revisar/cerrar accesos abiertos)."""
    current = me.get("sid", "")
    return [{**s, "current": s["sid"] == current} for s in sessions.list_for(me["username"])]


@router.post("/auth/sessions/revoke-others")
def revoke_other_sessions(me: dict = Depends(current_user)):
    n = sessions.revoke_all_for(me["username"], except_sid=me.get("sid", ""))
    return {"ok": True, "revoked": n}
