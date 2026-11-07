#!/bin/sh
# Backend MEGI de DEMO (hackatón): base propia, sin ASR real, puerto 8020 (MEGI_DEMO_PORT lo cambia).
cd "$(dirname "$0")"
PORT="${MEGI_DEMO_PORT:-8020}"
export MEGI_MODE=local_mock
export MEGI_REAL_ASR=false
export MEGI_PBKDF2_ITERS=100000
export MEGI_ALLOWED_ORIGINS="http://localhost:$PORT,http://127.0.0.1:$PORT,http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173"
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
