"""Configuración y registro canónico de modelos (fuente de GET /api/config).

En Sprint 1 los modelos están solo DECLARADOS; los servicios devuelven mock.
La estructura soporta dos ASR simultáneos (ruta general v1.5 y ruta de
identificadores v1.6A + resolver_v1.1) para reflejar la decisión de arquitectura.
"""
import json
import os
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SEED_PATH = DATA_DIR / "seed.json"
# Ruta de la base configurable (útil para tests con SQLite temporal).
DB_PATH = Path(os.environ.get("MEGI_DB", str(DATA_DIR / "megi.sqlite")))

# Raíz de lo que la app ESCRIBE en runtime: audio de sesiones, perfiles de voz y
# log de shadow. Separado de DATA_DIR (que además guarda cosas de solo lectura:
# seed, catálogo CIE-10, secreto) para poder redirigirlo. Los tests lo mandan a
# un temporal: antes escribían audio real dentro de `backend/data/sessions/` y
# mezclaban basura de pruebas con los datos de la instalación.
STATE_DIR = Path(os.environ.get("MEGI_STATE_DIR", str(DATA_DIR)))
SESSIONS_DIR = STATE_DIR / "sessions"

# Índice RAG (solo lectura para la biblioteca de guías; vive en el servicio ASR).
RAG_INDEX_PATH = Path(os.environ.get(
    "MEGI_RAG_INDEX",
    str(DATA_DIR.parent.parent / "asr_service" / "rag" / "index" / "chunks.jsonl"),
))

# Build del frontend que sirve el backend en producción (ver main.py). En
# desarrollo no existe y se usa el dev server de Vite en :5173.
FRONTEND_DIST = Path(os.environ.get(
    "MEGI_FRONTEND_DIST", str(DATA_DIR.parent.parent / "frontend" / "dist")))

# Orígenes del frontend permitidos (CORS del backend y validación de `Origin`
# en el WebSocket de streaming; ver routes/asr_proxy.py).
# OJO: `:8000` es imprescindible desde que el backend sirve el frontend — el
# navegador manda ese Origin y sin él el proxy del WS cierra con 1008 y el
# streaming en vivo deja de funcionar.
ALLOWED_ORIGINS = [o for o in os.environ.get(
    "MEGI_ALLOWED_ORIGINS",
    "http://localhost:8000,http://127.0.0.1:8000,"
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
).split(",") if o.strip()]

# Dónde vive la página que abre el TELÉFONO al escanear el QR de estudios. En
# producción no hace falta (se usa el origen desde el que el médico usa la app,
# https://megiia.com); en desarrollo hay que poner la IP del Mac en la Wi-Fi,
# porque «localhost» en el teléfono es el teléfono.
PUBLIC_URL = os.environ.get("MEGI_PUBLIC_URL", "").strip()

# Mesa del anestesiólogo (proyecto electros, `entrenamiento/demo_web/servidor.py`):
# dirección INTERNA de su servidor. El backend la sirve dentro de MEGI por /mesa
# (routes/mesa_proxy.py) y la sección Anestesio la embebe tras volver a teclear
# la contraseña. Desarrollo: :8031 (cuenta dev); producción: :8030 (com.megi.anestesio).
ANESTESIO_URL = os.environ.get("MEGI_ANESTESIO_URL", "http://localhost:8031").strip()

# real | local_mock  (el modo "demo" se eliminó en la 0.0.1)
# Por defecto "real"; la inferencia real depende además de MEGI_REAL_ASR=true
# y de que el microservicio ASR/MLX esté arriba en MEGI_ASR_SERVICE_URL.
MODE = os.environ.get("MEGI_MODE", "real")
MODES_SUPPORTED = ["real", "local_mock"]

# ASR real (microservicio py3.14+mlx). Cuando es False, las rutas de audio
# devuelven transcript mock con la misma forma.
REAL_ASR = os.environ.get("MEGI_REAL_ASR", "false").lower() in ("1", "true", "yes")
ASR_SERVICE_URL = os.environ.get("MEGI_ASR_SERVICE_URL", "http://localhost:8010")
# Token compartido backend<->ASR (hallazgo #4 rev. 2026-07-12): si se define el
# MISMO valor en ambos procesos, el ASR rechaza a cualquier otro proceso local.
ASR_TOKEN = os.environ.get("MEGI_ASR_TOKEN", "").strip()

MODEL_REGISTRY = {
    "asr": {
        "general": {
            "id": "megi-medical-v1.5-preview",
            "status": "declared",
            "scope": "general_medical_transcription",
        },
        "identifier": {
            "id": "megi-medical-v1.6A-preview-merged-ckpt750",
            "status": "declared",
            "scope": "identifier_route_only",
            "resolver": "resolver_v1.1",
        },
    },
    "llm": {
        "primary": {"id": "mlx-community/gemma-4-26b-a4b-it-4bit", "status": "declared"},
        "benchmark": {"id": "mlx-community/gemma-4-31b-it-4bit", "status": "declared"},
    },
}

# La inferencia real depende de MEGI_REAL_ASR (microservicio ASR).
REAL_INFERENCE = REAL_ASR


def _build_id() -> str:
    """SHA corto del código que corre. Se compara con el que trae el frontend
    para detectar el desfase que ya nos mordió una vez (frontend recargado por
    HMR contra un backend con código de días antes, streaming roto en silencio).
    Se calcula UNA vez al arrancar: es la versión de este proceso, no la del
    working tree."""
    override = os.environ.get("MEGI_BUILD_ID", "").strip()
    if override:
        return override
    try:
        import subprocess
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                             cwd=str(DATA_DIR.parent.parent), capture_output=True, timeout=5)
        return out.stdout.decode().strip() or "unknown"
    except Exception:
        return "unknown"


BUILD_ID = _build_id()


def load_seed() -> dict:
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))
