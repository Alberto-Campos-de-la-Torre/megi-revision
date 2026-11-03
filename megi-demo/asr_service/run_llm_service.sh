#!/usr/bin/env bash
# Lanza el proceso DEDICADO AL LLM (§4 revisión 2026-07-12).
#
# Por qué existe: medido en esta máquina, cargar gemma (14 GB) dentro del proceso
# del ASR multiplica ×6 la latencia de transcripción durante ~15 s, y eso pasa a
# media consulta (primera extracción SOAP). Con dos procesos, el ASR nunca carga
# gemma: delega la generación por HTTP.
#
# Es EL MISMO código que el ASR service; solo cambia la configuración:
#   - aquí: MEGI_LLM_PRELOAD=1 (carga al arrancar) y otro puerto
#   - en el ASR: MEGI_LLM_SERVICE_URL=http://127.0.0.1:8011
#
# Uso (terminal aparte, antes que el ASR):
#   export MEGI_BUNDLE="/opt/megi"           # carpeta padre de models_megi/
#   ./run_llm_service.sh
set -euo pipefail

MEGI_BUNDLE="${MEGI_BUNDLE:-/opt/megi}"
export MEGI_ENGINE_DIR="${MEGI_ENGINE_DIR:-$MEGI_BUNDLE/models_megi/engine}"
export MEGI_LLM_MODEL="${MEGI_LLM_MODEL:-$MEGI_BUNDLE/models_megi/llm/gemma-4-26b-a4b-it-4bit}"
export MEGI_LLM_PRELOAD="${MEGI_LLM_PRELOAD:-1}"
# Este proceso NO delega en nadie: es el que tiene el modelo.
unset MEGI_LLM_SERVICE_URL || true
# Mismo criterio que el ASR: el venv MLX vive junto a este script.
VENV_PY="${MEGI_VENV_PY:-$(cd "$(dirname "$0")" && pwd)/venv_mlx/bin/python3}"
PORT="${MEGI_LLM_PORT:-8011}"

if [ ! -d "$MEGI_ENGINE_DIR" ]; then
  echo "ERROR: no encuentro el motor en: $MEGI_ENGINE_DIR" >&2
  exit 1
fi
if [ ! -x "$VENV_PY" ]; then
  echo "ERROR: no encuentro el python del venv MLX en: $VENV_PY" >&2
  exit 1
fi

cd "$(dirname "$0")"
echo "[llm] cargando $MEGI_LLM_MODEL (14 GB, tarda)..." >&2
exec "$VENV_PY" -m uvicorn server:app --port "$PORT" --host 127.0.0.1
