"""Genera un secreto de firma de tokens por instalación (P0).

Escribe un archivo local `data/megi_secret.key` (NO versionar) que `security.py`
usa para firmar/verificar los tokens de sesión. En modo real el backend exige
este secreto: sin él (o con el default de desarrollo) NO arranca, para evitar
que alguien falsifique un token de administrador.

Uso:
    cd backend && .venv/bin/python -m app.gen_secret          # crea si no existe
    cd backend && .venv/bin/python -m app.gen_secret --force  # regenera (invalida sesiones)
"""
import os
import secrets
import sys

from .config import DATA_DIR

SECRET_FILE = DATA_DIR / "megi_secret.key"


def write_secret(path, value: str) -> None:
    """Escribe el secreto SIEMPRE con permisos 600, sin ventana insegura.

    Antes se escribía con el umask por defecto (0644 típico) y se hacía chmod
    después: entre ambas llamadas el secreto era legible por cualquier usuario
    del equipo. Se crea con el modo correcto y se publica con rename atómico."""
    tmp = path.parent / (path.name + ".tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(value)
            f.flush()
            os.fsync(f.fileno())
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(str(tmp), str(path))
    os.chmod(str(path), 0o600)   # por si el destino ya existía con otro modo


def main() -> None:
    force = "--force" in sys.argv
    if SECRET_FILE.exists() and not force:
        print(f"Ya existe (usa --force para regenerar): {SECRET_FILE}")
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_secret(SECRET_FILE, secrets.token_hex(32))
    verb = "regenerado (sesiones anteriores quedan inválidas)" if force else "generado"
    print(f"Secreto {verb}: {SECRET_FILE}")


if __name__ == "__main__":
    main()
