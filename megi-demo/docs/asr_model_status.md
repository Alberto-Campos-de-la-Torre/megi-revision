# Estado de modelos ASR

Documento de estado de los modelos ASR de MEGI. Mantener fuera del README de la app
para que este no se vuelva un reporte de entrenamiento.

## Modelos

| Rol           | Modelo                                          | Estado            | Alcance                         |
|---------------|-------------------------------------------------|-------------------|---------------------------------|
| General       | `megi-medical-v2.1-a075-merged`                 | **`default`**     | `general_medical_transcription` |
| General (reserva) | `megi-medical-v1.5-preview-merged`          | `fallback`        | `general_medical_transcription` |
| Identificador | `megi-medical-v1.6A-preview-merged-ckpt750`     | `declared`        | `identifier_route_only`         |

- **v2.1-a075** — ruta médica general. Modelo por defecto del proyecto desde el
  2026-09-12 (`megi_asr/config.py:GENERAL_MODEL`). LoRA `megi-medical-v2/checkpoint-7340`
  (rank 16, alpha 32) fusionado sobre `whisper-large-v3` a **escala 0.75**.
  La escala no es un detalle: el mismo LoRA a 2.0 (alpha/rank) rinde *peor* que v1.5.
- **v1.5-preview** — modelo general anterior. Se conserva como reserva: para volver,
  `MEGI_ASR_GENERAL_MODEL="$MEGI_ENGINE_DIR/megi-medical-v1.5-preview-merged"`.
- **v1.6A-preview-ckpt750** — candidato especializado para la ruta de identificadores.
  Marcado `candidate_not_blind_evaluated`. **El cambio a v2.1 no lo toca**: la ruta de
  identificadores sigue igual.

## BLIND

- BLIND de identificadores: **sellado, no abierto**.
- No publicar métricas BLIND aquí hasta su apertura formal.

## Métricas DEV

> Pendiente. Registrar aquí WER/CER por dominio y por ruta cuando se corran las
> evaluaciones DEV. No mezclar DEV con BLIND.

| Conjunto | Métrica | Valor | Fecha | Notas |
|----------|---------|-------|-------|-------|
| 3 consultas reales (barrido de escala LoRA) | WER | **10.79 %** (v2.1-a075) | 2026-09-08 | Fuente: `merge_info.json` del modelo. |
| 3 consultas reales (barrido de escala LoRA) | WER | 22.77 % (v1.5) | 2026-09-08 | Comparador. |
| 3 consultas reales (barrido de escala LoRA) | WER | 24.11 % (mismo LoRA a escala 2.0) | 2026-09-08 | Descartado: peor que v1.5. |

> **Muestra pequeña.** Son 3 consultas, no un DEV formal. La mejora es grande y
> consistente, pero conviene levantar un DEV con más sesiones antes de tratar
> este 10.79 % como la cifra oficial del modelo.
>
> **Falta medir en streaming.** Ese WER sale de la ruta **chunked-batch**. El
> mismo modelo alimenta el streaming en vivo, donde `commit_stable_words` decide
> qué palabras confirma por `logprob`. Ya hay precedente de un modelo bueno en
> batch que se cayó ahí: `megi_medical_v1_phase1` quedó en `batch_offline_only`
> porque descartaba ~20 % de palabras al borde. Verificar cobertura en vivo.

## Notas

- Sprint 1: modelos **solo declarados** en `GET /api/config`.
- Sprint 2.1: inferencia **BATCH real** cableada vía microservicio `asr_service/` (py3.14+mlx),
  reutilizando el motor de `entrenamiento mlx` sin vendorizar. `features.real_asr` refleja
  `MEGI_REAL_ASR`. Ruta general → `megi-medical-v1.5-preview-merged`; identificadores →
  `megi-medical-v1.6A-preview-merged-ckpt750` + `resolver_v1.1`.
- Streaming incremental (AudioWorklet + WS): pendiente (Sprint 2.2+), a comparar contra batch.
