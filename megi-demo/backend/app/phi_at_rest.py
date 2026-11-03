"""Aviso de PHI sin cifrar en reposo (hallazgo #7, revisión 2026-07-12).

`backend/data/` guarda en claro la SQLite del expediente, los WAV de la consulta
y los transcripts. Cifrar a nivel de aplicación es un proyecto aparte; el control
que sí aplica hoy en un equipo de consultorio es **FileVault**, y lo que faltaba
era que la instalación te lo dijera en vez de asumirlo.

Esto NO bloquea el arranque (dejar al médico sin sistema por un aviso sería peor):
avisa de forma visible en el log y lo expone en `/api/config` para la UI.
"""
import platform
import subprocess
from functools import lru_cache


def parse_filevault_status(output: str):
    """True = activado, False = desactivado, None = no se pudo determinar."""
    text = (output or "").strip().lower()
    if "filevault is on" in text:
        return True
    if "filevault is off" in text:
        return False
    return None


@lru_cache(maxsize=1)
def filevault_enabled():
    """Estado de FileVault en macOS (None fuera de macOS o si no se pudo saber).

    Cacheado: `/api/config` lo expone y no vale la pena un subproceso por
    petición (activar/desactivar FileVault exige reiniciar, de todos modos)."""
    if platform.system() != "Darwin":
        return None
    try:
        proc = subprocess.run(["fdesetup", "status"], capture_output=True, timeout=5)
    except Exception:
        return None
    return parse_filevault_status(proc.stdout.decode("utf-8", "replace"))


def warn_if_unprotected() -> None:
    if filevault_enabled() is False:
        print(
            "[megi] AVISO DE SEGURIDAD: FileVault está desactivado y en backend/data/ "
            "hay datos clínicos sin cifrar (expediente, audios y transcripts). "
            "Actívalo en Ajustes > Privacidad y seguridad > FileVault.",
            flush=True,
        )
