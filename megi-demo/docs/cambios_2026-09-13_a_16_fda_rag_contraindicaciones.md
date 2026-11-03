# Cambios del 13 al 16 de septiembre de 2026 — FDA → RAG de Megi → tabla de contraindicaciones

Registro completo de lo hecho en `Desktop/fda_xml` y en la copia de desarrollo de `Desktop/pagina_megi/ia megi/asr_service`.
**Producción de Megi (usuario `megi`, puertos 8010 y 8000) no se tocó en ningún momento.** Nada se borró: cada archivo
sustituido tiene respaldo con fecha, y cada salida anterior se apartó renombrada.

---

## 1. Diagnóstico del estado de la traducción (13-sep)

| Hallazgo | Detalle |
|---|---|
| Base autoritativa | `dailymed_labels/translation_cache.sqlite` del Desktop (3.8 GB). La copia del volumen CLIPS_VAD quedó congelada el 23-jun (R1708) y `loop_gpt55.py status` la prefiere si está montada: usar `FDA_XML_ROOT=$PWD` para forzar el Desktop. |
| Avance real | 478,305 textos únicos traducidos de 1,237,867 (38.6%); 457,011 con auditoría de segundo modelo. En chunks del corpus (2,963,445): 1,158,651 cubiertos (39.1%). El "50%" recordado era la mitad hash-low (50.2%); la mitad hash-high va en 27.1%. |
| Fusión volumen→Desktop | Verificada fila por fila: mismas 1,237,867 filas; 391 retraducciones intencionales R906-R911; 58 filas con versión inferior en Desktop (22 perdieron validación Opus, 36 Sonnet→gemma), recuperables del volumen. |
| Residuos | 2,165 filas en `dispensed` huérfanas (25-jun, 12-jul, R4375); 4,428 `done` con text_es == text_en (INCI, tablas, otros idiomas: legítimos). |
| Pipeline de traducción | Parado desde el 24-jul (R4375). No se reanudó por decisión del usuario. |

---

## 2. Índice RAG de FDA para pagina_megi

### 2.1 Índice v1 (8-sep, retomado el 13-sep)
- Corpus armado desde carpetas de rondas (296,291 textos únicos = 719,704 chunks). `build_rag_ready.py` → `build_fda_index_corpus.py` (filtro a secciones clínicas + dedupe) → `embed_fda_index.py` (bge-m3).
- El embedding original murió por RAM a 20,000/80,912 (compilador Metal + copias de matriz). Se reutilizaron los 20,000 vectores parciales (cosenos 1.000) y se completó con el script corregido (memmap, streaming, `torch.mps.empty_cache`): 18 min, RSS < 1.5 GB.
- Bug corregido en `rag/rag_service.py`: `server.py` llamaba `rag_fda.status()` y el método no existía. Añadido (usa `self._dir`).

### 2.2 Índice v2 desde la sqlite (13-sep)
- `build_rag_ready.py` ahora es copia del usuario (el original era de root: `build_rag_ready.py.root_orig_20260908`) con `--from-db` y veredictos `accept_sonnet`/`accept` como buenos.
- Resultado: 1,076,016 chunks listos (+64%), 139,383 textos únicos clínicos, 10,825 fármacos, 102,506 etiquetas.
- `embed_fda_index.py` ganó `--reuse DIR` (copia vectores de textos idénticos) y `--src`.

### 2.3 Índice mixto ES + EN (13-sep)
- `build_fda_index_corpus_en.py`: los chunks clínicos aún sin traducir entran en inglés con `language="en"`, `validation_status="untranslated_en"` y aviso. Mixto = 139,383 ES + 121,063 EN = 260,446 textos; 52 min de embedding.
- Tres reglas en `rag_service.py` (solo actúan si los chunks traen `language`; el índice GPC queda igual):
  1. cada resultado expone `language` y `validation_status`;
  2. un chunk EN se descarta si ese (sección, principio activo) ya existe en español en el índice;
  3. los pasajes EN llevan `notice` "texto original en inglés · traducción no validada" y la cita lo dice.
- Índice activo: `rag_ready/index_fda` (1.4 GB). Guardados: `index_fda_es_v2_20260913`, `index_fda_v1_20260913_80k`, `index_fda_root_partial_20260908`, `rag_ready/_v1_20260908_from_rounds/`.

### 2.4 Filtro por nombre de fármaco (14-sep, estilo AskFDALabel)
- Investigación: AskFDALabel (FDA 2025) abandona la búsqueda semántica pura y reconoce el fármaco, normaliza marca/sal a genérico y consulta por fármaco + sección (95% de reconocimiento). Drugs.com no es retrieval: base curada (Cerner Multum, Micromedex, ASHP, etiquetas FDA) con severidad major/moderate/minor precalculada.
- `rag_service.py`: `detect_drugs()` (bases sin sal/forma/dosis, alias marca→genérico Rx desde `drug_aliases.json`, sinónimos ES→EN, variantes de grafía f→ph / -ina→-in / etc., emparejamiento aproximado con stoplist clínica), filtro duro por fármaco con relleno si < k, `detect_sections()` con boost 0.06, boost multi-fármaco 0.04, regla 2 por principio activo, `COMPOUNDS` (etinilestradiol, insulinas, sales minerales) y `SALTS` ampliado.
- Benchmark `tests/bench_rag_fda_lang.py` (450 búsquedas por índice, 200 por conjunto, 4 fármacos × 10 formulaciones, riesgo por sección y por fármaco con boxed warning). Resultados en `rag_ready/bench_lang_rules.json`:

| Conjunto (hit@5) | Sin filtro | Con filtro |
|---|---|---|
| Fármacos solo en inglés | 24.5% | 79.0% |
| … nivel crítico (boxed, contraindicaciones) | 30.0% | 80.0% |
| Fármacos en ambos idiomas | 44.5% | 83.5% |
| … nivel crítico | 56.0% | 94.0% |
| Detección del fármaco en la consulta | — | 98–100% |
| Violaciones de la regla 2 | 0 | 0 |
| Latencia media | 42 ms | 22–26 ms |

Respaldos: `rag_service.py.bak_pre_fda`, `.bak_pre_status_20260913`, `.bak_pre_lang_rules_20260913`, `.bak_pre_drugfilter_20260913`, `.bak_pre_salts2_20260916`.

---

## 3. Tabla estructurada de contraindicaciones tipo Drugs.com (13→16-sep)

### 3.1 Pipeline
| Paso | Script | Salida |
|---|---|---|
| Extracción con gemma-4-26b local (mlx_lm) sobre CONTRAINDICATIONS → BOXED WARNING → DRUG INTERACTIONS del índice mixto | `extract_contraindications.py` (modos normal, `--repass`, `--ids`) | `rag_ready/contra/extractions.jsonl` (último registro por chunk gana) |
| Reparación determinista de citas | `repair_citations.py` | `rag_ready/contra/extractions_repaired.jsonl` |
| Consolidación + filtros + calibración | `build_contra_table.py` | `rag_ready/contra/contraindicaciones.sqlite` (tablas `contra` y `contra_agg`), `.jsonl`, `stats.json` |
| Verificador mínimo | `build_contra_table.py --check "warfarina, ibuprofeno" --conditions "embarazo, insuficiencia renal"` | alertas con severidad y cita |
| Muestreo para auditoría | `tests/sample_contra_audit.py --n 60 --seed N [--version v5]` | JSON con texto fuente e ítems |

Motor: `~/megi_final/canvas-megi-ia/asr_service/venv_mlx/bin/python` (py3.14, mlx_lm 0.31.3, gemma 4-bit). Sin API de Anthropic ni modelos en ollama. 36,467 chunks → 32,108 tras omitir casi-duplicados. ~3–4 s/chunk en contraindicaciones y ~9–11 s/chunk en interacciones (más ítems por chunk). Duración total ≈ 52 h con un solo incidente (22:30 del 14-sep: `MTLCompilerService` de macOS dejó de responder; relanzado a las 22:36 sin pérdida).

### 3.2 Versiones del prompt (auditadas por Opus sobre 60 chunks cada una)
| Versión | Cambio | Soportado | Severidad | Cita literal | Omisiones/60 |
|---|---|---|---|---|---|
| v1 | base | 98.9% | 92.9% | 100% | 14 |
| v2 | enumeraciones expandidas, antecedentes no son objetos, todo lo de CONTRAINDICATIONS = absoluta | 99.1% | 97.9% | 88.5% | 7 |
| v3 | cita exacta en el idioma del texto, "excepto/salvo" no genera ítem, "no coadministrar X en Y" = un ítem, paraguas conservados | 99.7% | 99.7% | 92.2% | 11 |
| v4 | cita contigua sin "…", barrido con patrón AINE, objeto = el otro fármaco en interacciones | 98.1% | 99.6% | 93.8% | 17 |
| v5 (congelado) | anti-inversión, cita sin recomposición, conteo de viñetas con `needs_repass` | ver auditoría final | | | |

v1 y v2 se reiniciaron desde cero (salidas conservadas en `extractions_prompt_v1_*.jsonl` y `_v2_*.jsonl`); v3→v4→v5 se aplicaron en caliente con `prompt_version` en cada registro. Respaldos `extract_contraindications.py.bak_prompt_v1..v4`, `.bak_pre_ids_20260916`.

### 3.3 Auditoría final (v5 + re-pase, 60 chunks / 433 ítems, todas las secciones e idiomas)
| Métrica | Contraindicaciones | Interacciones | Boxed warning |
|---|---|---|---|
| Objeto soportado | 100% | 96.3% | 97.3% |
| Severidad correcta (modelo) | 92.9% | 78.0% | 94.6% |
| Cita literal contigua (modelo) | 92.9% | 83.4% | 78.4% |
| Inventados / omisiones | 0 / 0 | 9 / 11 | 1 / 5 |

Veredicto: apta con reservas como verificador asistido con cita obligatoria. Reservas: citas no verificadas (13.6%) y severidad de interacciones. Ambas se atendieron después (3.4 y 3.5).

### 3.4 Reparación de citas (16-sep)
- `repair_citations.py`: mejor coincidencia contigua de la cita en el texto fuente (normalizando acentos/puntuación; expansión a límite de palabra solo si el corte cae a mitad de palabra). Reparó 19,442 de 19,800 ítems (98.2%).
- 258 chunks con citas traducidas al inglés se reextrajeron con `--ids` (registros `v5-cita`).
- Resultado: cita verificada 99.7–99.9% por sección; 545 ítems quedan sin verificar (confianza media).

### 3.5 Filtros de confianza y calibración de severidad (16-sep)
- `build_contra_table.py` añade a `contra` las columnas `cita_ok`, `flags` (`cita_no_verificada`, `auto_referencia`, `negacion`), `confianza` (alta/media/baja), `severidad_modelo`, `sev_fuente`. `contra_agg` (la que usa el verificador) solo incluye confianza alta.
- Calibración léxica `calibrate()` para DRUG INTERACTIONS y BOXED WARNING (CONTRAINDICATIONS respeta el modelo): ventana = fila que contiene la cita (no cruza filas de tabla) + detalle; `absoluta` solo con término de contraindicación en la fila (sin paréntesis) y sin condicional ("a menos que", "en general"…); `mayor` si hay acción sobre el uso concomitante (`ACTION_RE`, con exclusiones `ACTION_NEG_RE` para "para evitar eventos adversos", "cuando se suspenda el inductor", "si ocurre X, considere suspender") o desenlace letal (`LETHAL`); desenlace grave con intervención de solo vigilancia (`WATCH`) = `moderada`; `menor` solo con marcador explícito.
- Validación de Opus sobre los mismos 100 ítems (verdades por ítem):

| Versión | Acierto | Contraindicaciones falsas | Contraindicaciones perdidas |
|---|---|---|---|
| Severidad del modelo | 37% | 6 | 0 |
| v1 | 81% | 6 | 0 |
| v2 | 81% | 1 | 1 |
| v3 | 85% | 0 | 0 |
| v4 | 90% | 0 | 0 |
| v5 (adoptada) | ≈91% | 0 | 0 |

Reportes: `rag_ready/contra/calib_validation_seed11*_report.json`; respaldos `build_contra_table.py.bak_pre_filters_20260916`, `.bak_pre_calib{,2,3,4,5}_20260916`.

### 3.6 Cifras finales
| | |
|---|---|
| Chunks procesados | 32,108 (+488 re-pase de cobertura, +258 reextracción de citas) |
| Ítems extraídos | 228,088 |
| Filas `contra` (una por principio activo del producto) | 292,637; confianza alta 291,192 / media 545 / baja 900 |
| Filas `contra_agg` (verificador) | 78,484 = 30,244 contraindicaciones + 14,486 boxed + 33,754 interacciones |
| Fármacos con filas | 2,248 |
| Severidad agregada | 34,236 absoluta / 22,994 mayor / 19,901 moderada / 1,353 menor |
| Interacciones agregadas | 19,849 moderada / 10,715 mayor / 1,844 absoluta / 1,346 menor |
| Cobertura Rx (4,377 principios activos) | 2,197 con alguna fila (50%); 1,926 contraindicaciones; 1,151 interacciones; 954 boxed; 510 con las tres |
| Tamaño | sqlite 178 MB; jsonl 43 MB |

Límites conocidos (≈9% residual de la calibración): tablas por bloques con el verbo de acción lejos de la cita, "en general, evitar" degradado, suspensión condicionada a un evento leída como acción. Cobertura del 50% de los activos Rx porque el 59% del corpus sigue sin traducir (los chunks EN sí se incluyeron en la tabla).

---

## 4. Archivos nuevos y modificados

**fda_xml**: `build_rag_ready.py` (copia de usuario con `--from-db`), `build_fda_index_corpus_en.py`, `embed_fda_index.py` (`--reuse`, `--src`), `extract_contraindications.py`, `repair_citations.py`, `build_contra_table.py`, `tests/bench_rag_fda_lang.py`, `tests/sample_contra_audit.py`, `rag_ready/index_fda/` (+ `drug_aliases.json`), `rag_ready/contra/*`, `rag_ready/bench_lang_rules*.json`, este documento.

**pagina_megi/ia megi/asr_service**: `rag/rag_service.py` (status, reglas de idioma, filtro de fármaco/sección, normalización). `server.py` no se modificó después del 8-sep (ya tenía `/v1/rag/search_fda` y `/v1/rag/status`).

---

## 5. Siguiente paso: unir la tabla con el SOAP de Megi

Lo que ya existe en `server.py` y encaja directo:
- `/v1/soap/extract_meds`: extrae la receta de la consulta con roles (indicado / suspendido / etc.).
- `/v1/drugs/consult`: consultor farmacológico; su contexto sale de `vademecum.lookup()` (un vademécum FDA pequeño de 293 KB) y de "reglas del catálogo" curadas por el médico.
- `/v1/drugs/alternatives`: recibe una interacción `{farmaco_a, farmaco_b, severidad, mecanismo}` y propone alternativas.
- `/v1/soap/finalize` y `/v1/soap/update`: redactan el SOAP con citas `[S1]…` obligatorias sobre fuentes recuperadas.

Plan propuesto (en la copia de desarrollo; producción solo cuando el usuario lo decida):
1. **Módulo `rag/contra_checker.py`** que cargue `contraindicaciones.sqlite` (solo `contra_agg`), reutilice `RAGService.detect_drugs` para normalizar nombres y exponga `check(rx_list, conditions, sexo, embarazo, edad)` → alertas `{farmaco, objeto, tipo, seccion, severidad, evidencias, cita, language}` ordenadas por severidad. Hoy existe como función en `build_contra_table.py --check`; es moverla y darle índice en memoria (< 1 s de carga).
2. **Endpoint `/v1/drugs/check`**: entrada = receta de `extract_meds` + condiciones/diagnósticos del SOAP (`extract_dx`, alergias, embarazo). Salida = alertas de tres tipos: fármaco–condición (contraindicaciones y boxed), fármaco–fármaco (interacciones cruzadas entre la receta) y alergia. Cada alerta con cita textual y `language`.
3. **Alimentar `/v1/drugs/alternatives`** con las alertas de severidad absoluta o mayor (ya acepta exactamente ese dict).
4. **Enriquecer `_drug_context_block`** de `/v1/drugs/consult`: sustituir o complementar `vademecum.lookup` con las filas de la tabla del fármaco preguntado (más completas: 2,248 fármacos frente al vademécum pequeño) y, para preguntas abiertas, con `rag_fda.search`.
5. **SOAP**: en `finalize`, añadir una sección de "Alertas de seguridad" al Plan con las alertas de severidad absoluta/mayor y su cita, marcadas como apoyo y nunca como decisión; el modelo solo puede citar IDs dados (regla ya existente).
6. **Frontend** (`live_soap.jsx` / `real_consulta.jsx`): mostrar las alertas con color por severidad, la cita desplegable y el aviso cuando la fuente sea inglés sin validar.
7. **Pruebas**: 20 recetas sintéticas con interacciones conocidas (warfarina+AINE, IECA+potasio, ISRS+tramadol, metformina+contraste) y condiciones (embarazo, insuficiencia renal, asma) para medir alertas verdaderas/falsas antes de exponerlo al médico.

Reglas de uso acordadas con las auditorías: cita obligatoria en toda alerta; la severidad de interacciones es orientación (≈91% de acierto), no decisión; en contraindicaciones el uso asistido ya es sólido.

---

## 6. Integración en este repo (`test_megiia.com`, rama `megi-final`, 16-sep-2026)

Este documento es la copia de `FDA_movil/docs/CAMBIOS_2026-09-13_a_16.md` (registro de cómo se
construyó el paquete) más esta sección, que describe cómo quedó **enganchado** en el código de
Megi. El paquete original apuntaba a un `server.py` monolítico; aquí el ASR ya está partido en
`megi_asr/routers/`, así que el parche `server.py.fda.patch` no se aplicó tal cual: se
reimplementó por router. Los pasos 1–6 del plan de la sección 5 están hechos; el 7 (20 recetas
sintéticas medidas por un médico) queda pendiente.

**Estado al cierre: 19 tests del ASR (contrato + verificador), suite completa del backend y 86 de
frontend en verde.** Las tres pruebas de referencia de `FDA_movil/docs/PRUEBAS_Y_USO.md`
reproducen exactamente las cifras de origen en esta máquina (P2: 20/26/2 alertas con los mismos
conteos por severidad; P3: mismos títulos S1–S3 y scores 0.7877 / 0.7653 / 0.7243; carga del
índice 19.9 s, 260 446 chunks).

### 6.1 Dónde vive cada pieza

| Pieza del paquete | En este repo | Qué cambió |
|---|---|---|
| `megi/rag/rag_service.py` | `asr_service/rag/rag_service.py` (sustituido) | El índice FDA (`rag_fda`) se busca por defecto en `<repo>/FDA_movil/index_fda` (`MEGI_FDA_MOVIL_DIR` / `MEGI_RAG_FDA_INDEX_DIR`), no en una ruta de la Mac de origen. El índice GPC (`rag`) no cambia. |
| `checker/contra_checker.py` | `asr_service/rag/contra_checker.py` (nuevo) | Carga perezosa con `status()` (el ASR arranca sin la tabla), `check()` idéntico al del paquete (mismos conteos), `check_rx()` con los tres tipos de alerta del contrato, deduplicación por (fármaco, tipo, con qué choca, sección), `rows()` para el consultor. Instancia única `contra`. |
| `megi/server.py.fda.patch` | `megi_asr/routers/knowledge.py` | `POST /v1/rag/search_fda` y `GET /v1/rag/status` (gpc + fda + contra). |
| plan §5, paso 2 | `megi_asr/routers/drugs.py` → `POST /v1/drugs/check` | Body `{rx_list, conditions, allergies, age, sex, embarazo}`; edad y embarazo se traducen a poblaciones de la tabla (`ninos`, `adolescentes`, `pacientes de edad avanzada`, `embarazo`). |
| plan §5, paso 4 | `megi_asr/routers/drugs.py` → `_drug_context_block` | El consultor (`/v1/drugs/consult`) recibe primero las filas de la tabla (CONTRAINDICATIONS, BOXED WARNING, DRUG INTERACTIONS, con cita) y cae al vademécum pequeño solo para fármacos sin fila. |
| plan §5, paso 5 | `megi_asr/routers/soap.py` → `/v1/soap/finalize` | Nuevo campo `paciente` en `FinalizeReq`. Tras consolidar, `_alertas_seguridad()` verifica lo recetado hoy + lo habitual contra dx principal + crónicos + alergias + edad/sexo/embarazo. Devuelve `alertas_seguridad` (metadatos: NO se escribe nada en la nota; el médico pidió que las alertas no aparezcan en el texto del Plan) y las absoluta/mayor añaden un warning de validación. El backend las guarda en `clinical_facts` y en la auditoría del cierre (`review_events`, kind `soap_finalize`) como registro de que se avisó. |
| `/health` | `megi_asr/routers/system.py` | Clave nueva `fda: {index, contra}`; `rag` conserva exactamente las tres claves que lee el backend. |
| contrato | `asr_service/tests/test_api_contract.py` | Rutas y cuerpos nuevos congelados (incluido `paciente` en update/finalize). |
| pruebas | `asr_service/tests/test_contra_checker.py` | Los casos P2 del paquete + marcas/grafías + tres tipos de alerta + sin tabla. Se salta si falta el sqlite. |
| backend | `backend/app/services/asr_client.py` | `drugs_check()`; `soap_finalize()` acepta `paciente`. |
| backend | `backend/app/routes/medications.py` → `POST /api/drugs/check` | Requiere sesión y `MEGI_REAL_ASR=true` (503 si no, como el consultor). Con `patient_id` completa alergias/crónicos/edad/sexo del expediente. Complementa al rx-check determinista del catálogo (`safety.py`), no lo sustituye. |
| backend | `backend/app/routes/live.py` → `/api/soap/finalize` | Lee la ficha del paciente ANTES de llamar al ASR y la pasa; guarda `alertas_seguridad` dentro de `clinical_facts` para que revisión las muestre. |
| backend | `backend/tests/test_medications.py` | Auth/503, y paso de receta + expediente al ASR con respuesta íntegra (cita y origen). |
| frontend | `frontend/src/components/alertas_fda.jsx` (nuevo) | Color por severidad, cita desplegable, aviso "texto original en inglés · traducción no validada", leyenda de apoyo/COFEPRIS. |
| frontend | `live_soap.jsx` (`FinalSoapResult`) y `revision.jsx` | Muestran el bloque con `alertas_seguridad` del cierre. `api.drugsCheck()` en `client.js` para usos futuros (rx-check en vivo). |
| repo | `.gitignore` | `FDA_movil/index_fda/`, `modelos/`, `contra/*.sqlite|*.jsonl`, `env.sh` fuera de git (5.9 GB). Código, docs y reportes de auditoría sí se versionan. |

### 6.2 Instalar en otra máquina

```bash
# 1) copiar la carpeta FDA_movil/ completa (5.9 GB) a la raíz del repo
cd FDA_movil && bash instalar.sh      # copia bge-m3 al caché HF si falta, escribe env.sh, prueba el verificador
# 2) nada más: el ASR busca <repo>/FDA_movil por defecto. Para otra ruta:
export MEGI_FDA_MOVIL_DIR=/ruta/FDA_movil     # (o MEGI_RAG_FDA_INDEX_DIR + FDA_CONTRA_DB por separado)
# 3) comprobar
curl -s localhost:8010/v1/rag/status | python3 -m json.tool
cd asr_service && venv_mlx/bin/python -m pytest tests/test_contra_checker.py -q
```

RAM al servir: ~1.1 GB (matriz del índice FDA, solo si alguien llama a `search_fda`) + bge-m3 ya
compartido con el índice GPC. El verificador (`/v1/drugs/check`, cierre del SOAP) no carga modelo:
abre el sqlite en < 1 s y responde en < 10 ms.

### 6.3 Reglas que el código respeta

- Toda alerta lleva `cita` y `fuente`; el frontend no muestra ninguna sin cita salvo la alergia
  directa del expediente (`fuente: expediente`).
- La severidad de interacciones es orientación (≈91 %). Ninguna alerta se escribe en la nota:
  se muestran en el panel, se guardan con los hechos clínicos y en la auditoría del cierre.
- Nunca bloquea: si falta la tabla o falla, `alertas_seguridad` viene vacío con `error` y el cierre
  del SOAP sigue igual que antes.
- Producción (`megi` en :8010/:8000) no se tocó; todo esto está en la copia de desarrollo.

### 6.4 Pendiente

1. Las 20 recetas sintéticas del plan (warfarina+AINE, IECA+potasio, ISRS+tramadol,
   metformina+contraste, embarazo, insuficiencia renal, asma) medidas por un médico antes de
   exponer el bloque del Plan en producción.
2. Alimentar `/v1/drugs/alternatives` desde las alertas absoluta/mayor en la UI (el endpoint ya
   acepta el dict; falta el botón en `alertas_fda.jsx`).
3. Llamar a `api.drugsCheck()` en el rx-check en vivo (`clinical_voice.jsx`) además del cierre.

### 6.5 Alertas y sugerencias en vivo; panel técnico (16-sep, tarde)

- **Columna derecha de la consulta en vivo** (`live_soap.jsx`): ya no muestra la transcripción
  confirmada ni los eventos. Ahí va `consulta_feed.jsx`: sugerencias de interrogatorio (los
  `gaps` que ya viajaban en `/api/soap/update`) y **alertas FDA en vivo**. El toast flotante de
  `consulta_hints.jsx` dejó de renderizarse (el archivo se conserva); las sugerencias se listan
  en el panel.
- **Alertas en vivo**: `/api/soap/update` devuelve `alertas_fda` (`live.py::_alertas_en_vivo`).
  El backend manda al verificador la **transcripción acumulada** (`context_text`) más la ficha del
  paciente; el verificador detecta los fármacos **mencionados** (no solo recetados: "podría darle
  prednisona" ya avisa) y, del texto, solo condiciones/poblaciones del paciente (palabra completa,
  ≥ 6 letras; los nombres de fármaco entran por la vía fármaco–fármaco). Sin LLM, < 10 ms.
- **Panel técnico** (`real_consulta.jsx`): ahora enseña transcripción confirmada, hablantes y
  eventos (`tech_transcript.jsx`, alimentado por `LiveSoap` vía `onTech`). La grabación manual, el
  streaming y el shadow quedaron ocultos tras `SHOW_LEGACY_TECH = false`.
- Contrato: `/v1/drugs/check` y `/api/drugs/check` aceptan `context_text`. Tests:
  `test_contra_checker.py::test_context_text_*`, `backend/tests/test_alertas_en_vivo.py`,
  `frontend/src/test/consulta_feed.test.jsx`.
- En modo texto no se usan los alias de marca y se ignoran las "bases" de la tabla que son
  palabras corrientes (`TEXT_STOP` en `contra_checker.py`: "para", "control", "water"…): son
  fragmentos de nombres de producto que en una receta explícita no molestan pero en una
  conversación disparaban alertas falsas.
- **Límite conocido**: la tabla solo cubre CONTRAINDICATIONS, BOXED WARNING y DRUG INTERACTIONS.
  Un corticoide en un diabético (hiperglucemia) vive en WARNINGS AND PRECAUTIONS y NO genera
  alerta; un AINE en un hipertenso sí (interacción con antihipertensivos, moderada). Para cubrir
  WARNINGS habría que reextraer esa sección con el pipeline de `FDA_movil/scripts_fuente/`.

### 6.6 Fusión de alertas, cruces por clase y citas globales (16-sep, noche)

- **Una alerta por fármaco y por "contra qué"** (`_dedupe` en `contra_checker.py`): la misma
  condición en boxed warning e interacciones ya no sale dos veces; la más grave manda y el resto
  de citas viaja en `otras_citas` (la tarjeta las muestra al desplegar y avisa "N citas").
- **Mapa de clases** (`CLASES`): la tabla describe muchas interacciones por clase ("relajantes
  musculares", "depresores del SNC", "AINE", "IECA"…). Ahora tramadol + carisoprodol, ketorolaco +
  meloxicam (contraindicación de AINE concomitante) y similares se cruzan; la alerta trae `clase`.
  Solo actúa en `check_rx` (`clases=True`); `check()` conserva los conteos de referencia del paquete.
- **Citas con id global por consulta** (`live.py::_renumerar_citas`): el ASR numera S1… por
  llamada y la nota acumulada mezclaba chunks. El backend reasigna ids únicos por consulta (una
  fuente ya citada conserva el suyo), reescribe los `[S#]` del parche y elimina ids sin fuente. La
  lista de fuentes en vivo muestra `[S#]` delante de cada cita.
- **Rehabilitación en vivo** (`consulta_feed.jsx::RehabEnVivo`): el protocolo detectado se muestra
  durante la consulta (antes solo en revisión); insertar en el Plan sigue en revisión.
- **Las alertas no se escriben en la nota** (§6.5 corregido): quedan en `clinical_facts.alertas_seguridad`
  y en el evento `soap_finalize` de `review_events` como constancia de que se avisó.

### 6.7 Lo que enseñó la consulta C-431d2b3e (16-sep, noche)

Síntomas: el primer chunk volvió sin JSON (se perdieron antecedente y radiografía), el Subjetivo
salió duplicado, y no hubo alertas de ketorolaco ni carisoprodol porque el ASR escribió
"ketrolaco" y "caripromodol". Correcciones:

- **Reintento del escriba** (`soap.py`): ante JSON inválido se pide una segunda vez con la
  instrucción reforzada; solo si también falla se devuelve `invalid_json`. Ambos casos quedan en
  `asr_requests.jsonl` con la cola de la respuesta. Test: `tests/test_soap_retry.py`.
- **Respuesta cruda persistida** (`live.py`): con `invalid_json`, `soap_patches.warnings` guarda
  `raw_llm: …` para poder diagnosticar el chunk perdido.
- **Sin frases repetidas al anexar** (`live.py::_sin_repetidas`): un `append` descarta las frases
  que la sección ya tiene (sin acentos/mayúsculas/puntuación).
- **Emparejamiento laxo en texto libre** (`contra_checker.py::_detect_laxo`): prefijo de 3 letras
  y similitud ≥ 0.82 en palabras de ≥ 8 letras; solo para la transcripción, nunca para recetas
  explícitas. `TEXT_STOP` creció con palabras inglesas corrientes ("complete" ← "completa").
- **Rehabilitación en vivo**: `POST /api/rehab/insertar` pega el protocolo al Plan (lado tomado de
  la nota si es inequívoco; si no, queda marcado), registra la 'aplicada' y la revisión no lo
  repropone (`ya_insertado`). Si el protocolo no aparece en vivo es porque el SOAP aún no trae la
  región/diagnóstico (en C-431d2b3e el chunk perdido era justo el del fémur).
