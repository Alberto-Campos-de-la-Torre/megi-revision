"""Crea o restablece un administrador desde la terminal (P2 — recuperación local).

Úsalo cuando no hay admin (primer arranque headless) o para recuperar el acceso
si olvidaste la contraseña. Pide la contraseña por `getpass` (no queda en el
historial de shell).

Uso:
    cd backend && .venv/bin/python -m app.create_admin <usuario> [nombre]

Si el usuario ya existe, restablece su contraseña; si no, lo crea como admin.
"""
import getpass
import sys

from .db import init_db, db
from .routes.users import create_admin, set_password


def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python -m app.create_admin <usuario> [nombre]")
        raise SystemExit(2)
    username = sys.argv[1].strip().lower()
    name = sys.argv[2] if len(sys.argv) > 2 else username

    pw = getpass.getpass(f"Contraseña para '{username}': ")
    pw2 = getpass.getpass("Repite la contraseña: ")
    if pw != pw2:
        print("Las contraseñas no coinciden.")
        raise SystemExit(1)
    if len(pw.strip()) < 6:
        print("La contraseña debe tener al menos 6 caracteres.")
        raise SystemExit(1)

    init_db()
    with db() as conn:
        exists = conn.execute("SELECT role FROM users WHERE username = ?", (username,)).fetchone()

    if exists:
        set_password(username, pw)
        print(f"Contraseña restablecida para '{username}' (rol: {exists['role']}).")
    else:
        create_admin(username, name, pw)
        print(f"Administrador '{username}' creado.")


if __name__ == "__main__":
    main()
