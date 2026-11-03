#!/usr/bin/env bash
# Lanza el ASR service con el venv MLX (Python 3.14).
#
# Fuente canónica del motor y los modelos: el bundle `megi final/` (§4 de la
# revisión 2026-07-12). Basta con exportar MEGI_BUNDLE y el resto se deduce:
#
#   export MEGI_BUNDLE="/opt/megi"           # carpeta padre de models_megi/
#   ./run_asr_service.sh
#
# Cualquiera de las variables se puede sobreescribir a mano si tu ruta difiere.
set -euo pipefail

MEGI_BUNDLE="${MEGI_BUNDLE:-/opt/megi}"
export MEGI_ENGINE_DIR="${MEGI_ENGINE_DIR:-$MEGI_BUNDLE/models_megi/engine}"
export MEGI_LLM_MODEL="${MEGI_LLM_MODEL:-$MEGI_BUNDLE/models_megi/llm/gemma-4-26b-a4b-it-4bit}"
# El venv MLX no es portable y no viaja en el bundle. Por defecto se usa el que
# vive junto a este script (asr_service/venv_mlx), que es donde lo crea
# megi-install. Sobreescribe MEGI_VENV_PY si tu venv está en otra ruta.
VENV_PY="${MEGI_VENV_PY:-$(cd "$(dirname "$0")" && pwd)/venv_mlx/bin/python3}"
PORT="${MEGI_ASR_PORT:-8010}"

if [ ! -d "$MEGI_ENGINE_DIR" ]; then
  echo "ERROR: no encuentro el motor en: $MEGI_ENGINE_DIR" >&2
  echo "       exporta MEGI_BUNDLE (o MEGI_ENGINE_DIR) y reintenta." >&2
  exit 1
fi
if [ ! -x "$VENV_PY" ]; then
  echo "ERROR: no encuentro el python del venv MLX en: $VENV_PY" >&2
  echo "       exporta MEGI_VENV_PY apuntando al python del venv con mlx." >&2
  exit 1
fi

cd "$(dirname "$0")"
exec "$VENV_PY" -m uvicorn server:app --port "$PORT" --host 127.0.0.1
