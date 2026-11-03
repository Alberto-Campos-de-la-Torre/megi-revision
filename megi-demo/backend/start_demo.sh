#!/bin/sh
# Backend MEGI de DEMO (hackatón): base propia, sin ASR real, puerto 8020.
cd "$(dirname "$0")"
export MEGI_MODE=local_mock
export MEGI_REAL_ASR=false
export MEGI_PBKDF2_ITERS=100000
export MEGI_ALLOWED_ORIGINS="http://localhost:8020,http://127.0.0.1:8020,http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173"
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8020
