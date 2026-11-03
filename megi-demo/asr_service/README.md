# MEGI ASR Service

Microservicio de inferencia ASR real (Python 3.14 + MLX, Apple Silicon). Reutiliza el
motor **sin vendorizarlo** (lo importa por ruta, `MEGI_ENGINE_DIR`). El backend MEGI
es cliente de este servicio; aquí no hay DB ni UI.

## Estructura

`server.py` es solo la composición (crea la app, el middleware de auth y monta los
routers). El código vive en `megi_asr/`:

| Módulo | Qué hace |
|---|---|
| `config.py` | arranque del motor, rutas de modelos, prompts. `SERVICE_DIR` ancla todo lo relativo |
| `engine.py` | whisper MLX, normalizador, resolver de identificadores, streaming |
| `security.py` | allowlist de `audio_path` y token compartido con el backend |
| `llm.py` | única puerta de generación (`complete`), local o delegada a otro proceso |
| `routers/` | `system`, `transcription`, `speaker`, `stream`, `soap`, `drugs`, `notes`, `knowledge` |

`tests/test_api_contract.py` congela las 24 rutas y los campos de cada cuerpo: es
lo que impide que un refactor rompa en silencio al backend.

## Rutas (las principales; el inventario completo está en el test de contrato)

- `GET /health` — estado + modelos cargados.
- `POST /v1/transcribe/file` — ruta general (`megi-medical-v2.1-a075-merged`).
  Body: `{ "audio_path": "...wav", "route": "general_consultation", "consultation_id": "..." }`
  → `{ transcript, normalized_text, model, duration_s, latency_ms }`
- `POST /v1/transcribe/identifier` — ruta IDs (`v1.6A-ckpt750` + `resolver_v1.1`).
  Body: `{ "audio_path": "...wav", "entity_type": "CURP|NSS|INE|INE_OCR|RFC", "slot_id": "..." }`
  → `{ raw_transcript, candidate_base, resolved: { status, value, candidates, requires_confirmation } }`

`resolved.status` ∈ `VALUE | MULTI_CANDIDATE | ABSTAIN | INVALID`. El resolver no adivina
la B/V pelona; RAW y RESOLVED parten del mismo `candidate_base`.

- `POST /v1/shadow/compare` — **diagnóstico Sprint 2.2**: corre el mismo audio por BATCH
  (archivo completo) y por STREAMING (`StreamingEngine` en chunks `chunk_ms`) y compara.
  Body: `{ "audio_path": "...wav", "chunk_ms": 250 }`
  → `{ batch:{...}, streaming:{...}, compare:{ similarity, content_similarity, content_word_diff } }`
  `content_similarity` ignora puntuación/acentos/mayúsculas para aislar **pérdida real**
  (chunking/VAD/commit) del ruido de formato. Si batch acierta y streaming no, el problema
  está en el mecanismo de streaming, no en el modelo.
  Nota: el harness alimenta el audio sin *pacing* real-time, lo que puede subestimar la
  calidad del streaming en vivo (VAD/commit asumen llegada en tiempo real).

## Arranque

```bash
# Deduce motor, LLM y venv MLX a partir del bundle:
MEGI_BUNDLE="$HOME/Documents/work/megi final" ./run_asr_service.sh   # :8010

# LLM en proceso aparte (evita que cargar gemma frene la transcripción ×6):
MEGI_BUNDLE=... ./run_llm_service.sh                                  # :8011
```

Normalmente no se arrancan a mano: `scripts/megi start llm` levanta todo.

## Variables de entorno

| Var | Default | Uso |
|-----|---------|-----|
| `MEGI_ENGINE_DIR` | — (**obligatoria**) | repo del motor (se añade a `sys.path`). Sin ella el servicio no arranca y lo dice; antes fallaba con un `ModuleNotFoundError` críptico |
| `MEGI_ASR_GENERAL_MODEL` | `<engine>/megi-medical-v2.1-a075-merged` | modelo ruta general (v1.5 para revertir) |
| `MEGI_ASR_IDENTIFIER_MODEL` | `<engine>/megi-medical-v1.6A-preview-merged-ckpt750` | modelo ruta IDs |
| `MEGI_METAL_CACHE_LIMIT_BYTES` | `1073741824` (1 GiB) | límite cache Metal MLX |
| `MEGI_ASR_PORT` | `8010` | puerto |
| `MEGI_ASR_LOG_DIR` | `./logs` | logs jsonl por request (rotar con `scripts/megi-logrotate`) |
| `MEGI_ASR_AUDIO_DIRS` | `<repo>/backend/data` | de qué directorios acepta `audio_path`. Fuera de ahí responde 403 |
| `MEGI_ASR_TOKEN` | — | si se define (igual en el backend), exige la cabecera `X-MEGI-ASR-Token` |
| `MEGI_LLM_SERVICE_URL` | — | si apunta a otro proceso, aquí NO se carga gemma: se delega |
| `MEGI_LLM_PRELOAD` | `false` | carga el LLM al arrancar (proceso dedicado) |
| `MEGI_FDA_MOVIL_DIR` | `<repo>/FDA_movil` | paquete FDA (índice + tabla de contraindicaciones). Sin él, las rutas FDA responden "no disponible" y el resto no cambia |
| `MEGI_RAG_FDA_INDEX_DIR` | `<FDA_movil>/index_fda` | índice semántico FDA/DailyMed (260 446 chunks ES+EN, 1.4 GB, bge-m3) |
| `FDA_CONTRA_DB` / `FDA_INDEX_DIR` | `<FDA_movil>/contra/contraindicaciones.sqlite` / `<FDA_movil>/index_fda` | tabla del verificador de recetas y `drug_aliases.json` (marca→genérico) |

### Rutas FDA (paquete FDA_movil, 2026-09-16)

- `POST /v1/drugs/check` — verificador de recetas sobre la tabla de contraindicaciones
  (`rag/contra_checker.py`, sin LLM, < 10 ms). Body: `{ rx_list, conditions, allergies, age, sex, embarazo }`
  → `{ farmacos_detectados, alertas: [{tipo_alerta, farmaco, objeto, seccion, severidad, cita, fuente, ...}], resumen, alertas_altas }`.
  `tipo_alerta` ∈ `farmaco_condicion | farmaco_farmaco | alergia`; `fuente` ∈ `es | en_sin_validar | expediente`.
- `POST /v1/rag/search_fda` — búsqueda semántica sobre el índice FDA (mismo body que `/v1/rag/search`);
  cada resultado trae `language`, `validation_status`, `drug_filter`, `section_filter` y `notice` si es inglés.
- `GET /v1/rag/status` — estado de los tres recursos (`gpc`, `fda`, `contra`) sin forzar su carga.
- `/v1/soap/finalize` acepta `paciente` (alergias, crónicos, edad, sexo, embarazo) y devuelve
  `alertas_seguridad` (metadatos, nunca en el texto de la nota); las absoluta/mayor añaden un aviso en `validation.warnings`.
- `/v1/drugs/consult` usa las filas de la tabla como contexto (2 248 fármacos) antes que el vademécum pequeño.

Todo es APOYO con cita obligatoria; contenido regulatorio de EE.UU. (puede diferir de COFEPRIS). Detalle,
auditorías y cifras: `docs/cambios_2026-09-13_a_16_fda_rag_contraindicaciones.md` y `FDA_movil/docs/`.

Requiere el audio ya en WAV (idealmente 16k mono; el servicio resamplea defensivamente).
El backend MEGI convierte webm→wav16k con ffmpeg antes de llamar.
