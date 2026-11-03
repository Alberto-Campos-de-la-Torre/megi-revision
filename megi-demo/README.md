# MEGI · Médico — asistente clínico local

Asistente clínico con IA **100 % on-device** (Apple Silicon): escucha la consulta,
transcribe (ASR médico propio), consolida nota SOAP con hechos clínicos validados,
sugiere con base en GPC reales (RAG con citas), gestiona agenda/expediente,
receta con gate de seguridad receta×alergias, imprime documentos sellados con hash,
exporta FHIR y se puede operar por **comandos de voz agénticos** con verificación
de hablante. Multiusuario con login y auditoría por usuario.

Nada de audio, transcripts ni notas sale del equipo.

> Cambios de septiembre 2026 (ASR v2.1, motivo de consulta, sugerencias en vivo,
> rehabilitación, ESLint) y cómo modificarlos: [`docs/cambios_2026-09_rehabilitacion_y_motivo.md`](docs/cambios_2026-09_rehabilitacion_y_motivo.md).
> RAG de etiquetas FDA + tabla de contraindicaciones (paquete `FDA_movil/`, verificador
> de recetas `/api/drugs/check` y alertas en el cierre del SOAP):
> [`docs/cambios_2026-09-13_a_16_fda_rag_contraindicaciones.md`](docs/cambios_2026-09-13_a_16_fda_rag_contraindicaciones.md).
> Historial completo de cambios: [`docs/CHANGELOG-0.0.1.md`](docs/CHANGELOG-0.0.1.md)
> (iteraciones 1–13 + fases de voz). Estado de pendientes y revisión de seguridad:
> [`docs/revision_2026-07-12_gaps_y_seguridad.md`](docs/revision_2026-07-12_gaps_y_seguridad.md).

## Arquitectura (v0.0.1, 3 procesos)

```
Frontend Vite + React :5173
  │  /api (proxy dev, token firmado en cada petición)
  ▼
Backend FastAPI :8000 (py3.9)
  │  auth HMAC · SQLite · storage sesiones/audio · seguridad clínica (server-side)
  │  proxy WS autenticado: /api/asr/stream/general?ticket=… (un solo uso, 30 s)
  ▼
ASR service FastAPI :8010 (py3.14 + MLX, aislado en 127.0.0.1)
     ASR general      → megi-medical-v2.1-a075-merged
     ASR identificador→ megi-medical-v1.6A-preview-merged-ckpt750 + resolver_v1.1
     LLM (escriba/RAG)→ gemma-4-26b-a4b-it-4bit (mlx_lm)
     RAG              → índice bge-m3 de 526 GPC (con citas)
     Huella vocal     → sherpa-onnx + WeSpeaker CAM++_LM
```

- El backend (py3.9) nunca importa el motor MLX: es **cliente HTTP** del ASR
  service (py3.14). Pipeline de audio: `MediaRecorder (webm/opus)` →
  `POST /api/audio/*` → `ffmpeg → wav 16k` → ASR service → transcript/resolver →
  SQLite + `data/sessions/{cid}/audio/{aid}/`.
- Transcripción de consulta: **chunked-batch como fuente de verdad** + streaming
  WS en vivo (shadow); SOAP agéntico incremental con gemma y consolidación final
  con capa de hechos clínicos + validadores deterministas.
- Ruta de identificadores (CURP/NSS/INE/RFC): resolver v1.1 con estados
  `VALUE | MULTI_CANDIDATE | ABSTAIN | INVALID`; no adivina la "B/V pelona".

## Modelos (bundle `models_megi`)

Los modelos y el motor viven fuera de este repo, en el bundle
**`megi final/models_megi/`** (ver su `LEEME_MODELOS_MEGI.md`):

| Pieza | Ruta en el bundle |
|---|---|
| Motor (streaming/VAD, normalización, resolver, catálogos) | `models_megi/engine/` |
| ASR general v2.1 (activo) | `models_megi/engine/megi-medical-v2.1-a075-merged` |
| ASR general v1.5 (anterior, reserva) | `models_megi/engine/megi-medical-v1.5-preview-merged` |
| ASR identificadores v1.6A ckpt750 | `models_megi/engine/megi-medical-v1.6A-preview-merged-ckpt750` |
| LLM gemma-4-26b-a4b-it-4bit (snapshot local) | `models_megi/llm/gemma-4-26b-a4b-it-4bit` |

Incluidos en este repo: índice RAG (`asr_service/rag/index/`) y modelos de
hablante (`asr_service/models/speaker/`). **No incluido:** `BAAI/bge-m3`
(embeddings de query RAG; se descarga de HF en el primer uso, ~2.3 GB — sin él,
guías/chat RAG quedan degradados y el resto funciona).

> `v1.6A-ckpt750` es candidato `identifier_route_only`,
> `candidate_not_blind_evaluated`; el BLIND de identificadores sigue **sellado**.
> Métricas: [`docs/asr_model_status.md`](docs/asr_model_status.md) y
> [`docs/identifier_router_eval.md`](docs/identifier_router_eval.md).

## Cómo correr

### Uso normal (consultorio) — un comando

```bash
./scripts/megi start llm   # arranca ASR + backend + LLM, con vigilante
```

Y se abre **http://localhost:8000**: el backend sirve el frontend construido, así
que **Vite no hace falta**. `megi status`, `megi logs`, `megi stop` y, tras cada
`git pull`, **`megi update`** (reconstruye el frontend y reinicia; si las
versiones no cuadran la app lo avisa). Detalle y limitaciones —incluido por qué
el arranque aún no es automático— en [`docs/empaquetado.md`](docs/empaquetado.md).

### Desarrollo (3 terminales)

Ajusta `MEGI_BUNDLE` a donde tengas el bundle:

```bash
export MEGI_BUNDLE="$HOME/Documents/work/megi final"
```

### 1) ASR service :8010 (py3.14 + MLX)

El venv MLX **no viene en el bundle** (no es portable). Primera vez:

```bash
cd "$MEGI_BUNDLE/pagina_megi/ia megi/asr_service"
python3.14 -m venv venv_mlx
./venv_mlx/bin/pip install mlx mlx-whisper mlx-lm mlx-vlm numpy soundfile safetensors \
    onnxruntime sherpa-onnx fastapi "uvicorn[standard]" sentence-transformers
```

Arranque:

```bash
MEGI_ENGINE_DIR="$MEGI_BUNDLE/models_megi/engine" \
MEGI_LLM_MODEL="$MEGI_BUNDLE/models_megi/llm/gemma-4-26b-a4b-it-4bit" \
MEGI_VENV_PY="$PWD/venv_mlx/bin/python3" \
./run_asr_service.sh
```

### 2) Backend :8000 (py3.9)

```bash
cd "$MEGI_BUNDLE/pagina_megi/ia megi/backend"
# primera vez en un equipo nuevo: python3 -m venv .venv && .venv/bin/pip install -e . && instalar requirements-dev.txt para tests
source .venv/bin/activate
MEGI_MODE=real MEGI_REAL_ASR=true uvicorn app.main:app --reload
```

### 3) Frontend :5173

```bash
cd "$MEGI_BUNDLE/pagina_megi/ia megi/frontend"
npm install        # primera vez
npm run dev        # VITE_MEGI_MODE=real por .env; proxy /api → :8000
```

Sin ASR real (iterar UI sin MLX): omite el paso 1 y usa
`MEGI_MODE=local_mock` / `VITE_MEGI_MODE=local_mock` (audio real, transcript mock).

### Instalación nueva vs migración

`backend/data/` del bundle trae la base y sesiones de la instalación anterior.
Para empezar de cero: borra `data/megi.sqlite`, `data/sessions/`,
`data/speaker_profiles/` y regenera el secreto:

```bash
cd backend && .venv/bin/python -m app.gen_secret --force
```

En el primer arranque sin admin, la app muestra la pantalla de **configuración**
que crea el primer administrador.

## Seguridad (v0.0.1)

- **Tokens firmados (HMAC).** Todo `/api` clínico exige token; gestión de
  usuarios exige rol `admin` (server-side). El WebSocket ASR pasa por un **proxy
  autenticado** del backend; el ASR queda aislado en `127.0.0.1:8010`.
- **Secreto por instalación.** En modo `real` el backend **no arranca** sin
  secreto propio (`python -m app.gen_secret` → `data/megi_secret.key`, permisos
  600, no versionar; rotar con `--force`).
- **Primer arranque seguro.** Sin usuario de fábrica; bootstrap `/auth/setup`
  solo si no hay admin (409 después); usuarios nuevos con cambio de contraseña
  forzado; recuperación local `python -m app.create_admin`.
- **Seguridad clínica server-side.** El gate receta×alergias se **recalcula al
  aprobar** (409 si hay blocker sin confirmación); el frontend falla cerrado.
  Auditoría persistente por usuario, incluidas las acciones por voz.
- **Voz nunca autoriza sola.** Verificación de hablante (WeSpeaker) solo amplía
  una whitelist de bajo impacto; finalizar consulta exige confirmación táctil;
  regrabar huella exige contraseña. Limitación conocida ante TTS/replay
  documentada en [`futuro/seguridad_autenticacion_pendiente.md`](futuro/seguridad_autenticacion_pendiente.md).
- **Contraseñas con PBKDF2-HMAC-SHA256** (sal por usuario, 600k iteraciones); los
  hashes SHA-256 antiguos se migran solos en el primer login. `/auth/login` tiene
  backoff exponencial por usuario (429 tras 5 fallos) y el cambio de contraseña
  forzado se impone **server-side** (403 hasta cambiarla), no solo en la UI.
- **Separación por médico.** Cada médico ve solo su agenda: el paciente lleva
  dueño (`patients.doctor_id`) y consultas, audio, documentos y citas heredan de
  él. El rol `admin` gestiona usuarios y catálogos, **no abre expedientes
  ajenos**. Lo garantiza `tests/test_aislamiento_medicos.py`, que recorre todas
  las rutas clínicas con dos médicos. Para migrar un expediente anterior:
  `python -m app.assign_owner <usuario> --aplicar`.
- **Sesiones revocables.** El token dura 7 días y lleva un `sid` en la tabla
  `sessions`: `/auth/logout` lo invalida de verdad, `/auth/sessions` lista los
  accesos abiertos y cambiar la contraseña cierra los demás.
- **WebSocket con ticket de un solo uso.** El navegador pide `POST /api/asr/ticket`
  (30 s, un uso) y solo ese ticket viaja en la URL; el proxy valida `Origin` y
  audita inicio/fin de streaming.
- **Aislamiento del ASR service.** `audio_path` limitado a `backend/data`
  (`MEGI_ASR_AUDIO_DIRS`) y, si defines `MEGI_ASR_TOKEN` en ambos procesos, el
  ASR exige la cabecera `X-MEGI-ASR-Token`: ningún otro proceso local lo usa.
- **PHI en reposo:** el disco cifrado es el control vigente. Si FileVault está
  apagado, el backend lo avisa al arrancar y lo reporta en `GET /api/config`
  (`security.disk_encryption`). **Actívalo antes de instalar en consultorio.**
- **Hallazgos y estado completo** (incluido lo que sigue abierto: cifrado de PHI a
  nivel de aplicación y autorización por paciente entre usuarios): ver
  [`docs/revision_2026-07-12_gaps_y_seguridad.md`](docs/revision_2026-07-12_gaps_y_seguridad.md).

### Variables de entorno (backend)

| Variable | Default | Notas |
|---|---|---|
| `MEGI_MODE` | `real` | `real` \| `local_mock`. En `real` se exige secreto propio. |
| `MEGI_SECRET` | — | Secreto HMAC; si falta se lee `data/megi_secret.key`. |
| `MEGI_REAL_ASR` | `false` | `true` para inferencia real vía ASR service. |
| `MEGI_ASR_SERVICE_URL` | `http://localhost:8010` | Ubicación del ASR service. |
| `MEGI_DB` | `backend/data/megi.sqlite` | Ruta de la base (tests usan temporal). |
| `MEGI_STATE_DIR` | `backend/data` | Raíz de lo que se escribe: `sessions/`, `speaker_profiles/`, `voice_shadow.jsonl` (los tests lo mandan a un temporal). |
| `MEGI_RAG_INDEX` | `asr_service/rag/index/chunks.jsonl` | Índice para la biblioteca de guías. |
| `MEGI_TOKEN_TTL_DAYS` | `7` | Vida del token de sesión (revocable vía `sessions`). |
| `MEGI_ASR_TOKEN` | — | Si se define, debe ser **el mismo** en el ASR service. |
| `MEGI_ALLOWED_ORIGINS` | `localhost:5173,5174` (+127.0.0.1) | CORS y `Origin` del WS. |
| `MEGI_PBKDF2_ITERS` | `600000` | Iteraciones del hash de contraseñas. |

### Variables de entorno (ASR service)

| Variable | Default | Notas |
|---|---|---|
| `MEGI_ENGINE_DIR` | — (**obligatoria**) | Motor del bundle: `models_megi/engine`. Sin ella el ASR no arranca y lo explica. `run_asr_service.sh` la deduce de `MEGI_BUNDLE`. |
| `MEGI_FDA_MOVIL_DIR` | `<repo>/FDA_movil` | Paquete FDA (índice + tabla). Si no existe, `/v1/rag/search_fda` y `/v1/drugs/check` responden "no disponible" y todo lo demás sigue igual. |
| `MEGI_RAG_FDA_INDEX_DIR` | `<FDA_movil>/index_fda` | Índice semántico FDA (bge-m3, 1.4 GB). |
| `FDA_CONTRA_DB` | `<FDA_movil>/contra/contraindicaciones.sqlite` | Tabla de contraindicaciones del verificador de recetas. |
| `MEGI_ASR_GENERAL_MODEL` | `<engine>/megi-medical-v2.1-a075-merged` | Apunta a v1.5 para volver atrás. |
| `MEGI_ASR_IDENTIFIER_MODEL` | `<engine>/megi-medical-v1.6A-preview-merged-ckpt750` | |
| `MEGI_LLM_MODEL` | `mlx-community/gemma-4-26b-a4b-it-4bit` | Acepta ruta local (snapshot del bundle). |
| `MEGI_SPEAKER_MODEL` | `asr_service/models/speaker/wespeaker_…CAMpp_LM.onnx` | Incluido. |
| `MEGI_VENV_PY` | `<engine>/entrenamiento/venv_mlx/bin/python3` | Python del venv MLX. |
| `MEGI_ASR_PORT` / `MEGI_ASR_LOG_DIR` | `8010` / `./logs` | |
| `MEGI_ASR_TOKEN` | — | Auth compartida con el backend (cabecera `X-MEGI-ASR-Token`). |
| `MEGI_LLM_SERVICE_URL` | — | Si se define (p. ej. `http://127.0.0.1:8011`), el ASR **delega** la generación y no carga gemma. |
| `MEGI_LLM_PRELOAD` | `false` | Carga el LLM al arrancar (para el proceso dedicado: `./run_llm_service.sh`). |
| `MEGI_ASR_AUDIO_DIRS` | `backend/data` | Directorios de los que acepta `audio_path` (separados por `:`). |

## Funcionalidad (estado actual)

- **Agenda y pacientes:** citas y walk-ins, expediente con historial (SOAP,
  transcript, audio autenticado), perfil de alergias/crónicos confirmado por el
  médico, seguimientos, tendencia de signos vitales.
- **Consulta:** grabación real, transcripción chunked-batch + streaming en vivo,
  SOAP agéntico incremental con citas de GPC, extracción de hechos clínicos
  (presentes/negados/alarmas), captura de identificador por voz (resolver v1.1).
- **Revisión:** nota editable (también **por voz** con propuesta→confirmación),
  Dx CIE-10 buscable, receta con validador receta×alergias **bloqueante**,
  checklist antes de aprobar, perfil médico.
- **Impresión/documentos:** nota sellada (SHA-256 real; firma aún
  `mock_not_legal_signature`), referencia, orden de estudios, incapacidad;
  export **FHIR** R4 aproximado; envío mailto/wa.me.
- **Guías clínicas:** biblioteca de 526 GPC + chat RAG con fuentes citadas.
- **MEGI Voz (fases 1–6+):** barra global de comandos, navegación/pacientes por
  voz, edición de SOAP/Dx/receta con confirmación y auditoría, push-to-command
  con ASR local, palabra de activación "MEGI" (modo experto opt-in), huella
  vocal del médico para manos libres de bajo impacto.
- **Administración y auditoría:** usuarios (admin), estadísticas, ventana de
  auditoría por consulta (nota IA vs médico, quién aprobó, sello, timeline).

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q     # 156 en verde (2026-07-27, sin MLX)
cd frontend && npm test                          # vitest (71 pruebas)
```

El backend corre hoy sobre el py3.9 de CommandLineTools (EOL desde oct-2025). La
suite completa pasa también en Python 3.14 con el venv `backend/.venv314`
(`python3.14 -m venv .venv314` + las dependencias de `pyproject.toml`,
`requirements-dev.txt` y `websockets`); migrar es cambiar el intérprete con el que
se lanza uvicorn.

## Estructura

```
ia megi/
  frontend/        Vite + React (token en cada petición; WS por proxy del backend)
  backend/         FastAPI + SQLite (py3.9) — auth, storage, seguridad clínica
  asr_service/     FastAPI + MLX (py3.14) — ASR, LLM, RAG, huella vocal
  FDA_movil/       RAG de etiquetas FDA (ES+EN) + tabla de contraindicaciones (verificador de recetas);
                   los datos pesados (índice, modelo bge-m3, sqlite) NO se versionan: ver FDA_movil/README.md
  docs/            changelog, estado de modelos, revisión de gaps/seguridad
  futuro/          roadmaps (voz agéntica, seguridad)
  rag-documentacion/  corpus fuente del índice RAG
  MEGI Medico.html, app.jsx, components/, data.js   # demo CDN original (solo referencia)
```

## Pendientes principales

Ver detalle en [`docs/revision_2026-07-12_gaps_y_seguridad.md`](docs/revision_2026-07-12_gaps_y_seguridad.md):
apertura del BLIND, diarización real, router automático general/identificador,
anti-spoofing de voz, firma digital legal, integraciones PACS/LIS/EHR,
empaquetado de producción (candidato: shell Tauri como en `canvas-megi-ia`),
hardening de contraseñas/login, cifrado en reposo.
