#!/bin/sh
# Detiene el backend MEGI de demo (puerto 8020).
pkill -f "uvicorn app.main:app --host 127.0.0.1 --port 8020" && echo "backend de demo detenido" || echo "no estaba corriendo"
