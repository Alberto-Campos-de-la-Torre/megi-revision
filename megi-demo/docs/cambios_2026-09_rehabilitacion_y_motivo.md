# Cambios de septiembre 2026 — rehabilitación, motivo de consulta y sugerencias en vivo

Documento de referencia para quien vaya a **modificar** estas piezas. Explica qué
se añadió, por qué se diseñó así y dónde tocar para cada cambio previsible.
No es un changelog cronológico: está agrupado por funcionalidad.

Estado al cierre: **279 tests de backend y 83 de frontend en verde**. Entorno de
pruebas en `~/Desktop/test_megiia.com`, rama `megi-final`, Python 3.12 (el 3.14 de
Homebrew está roto en esta máquina: `pyexpat` enlaza una `libexpat` incompatible).

---

## Índice

1. [Modelo ASR v2.1 y chunk de 20 s](#1-modelo-asr-v21-y-chunk-de-20-s)
2. [Motivo de la consulta de hoy](#2-motivo-de-la-consulta-de-hoy)
3. [El escriba del SOAP conoce al paciente](#3-el-escriba-del-soap-conoce-al-paciente)
4. [Sugerencias de interrogatorio durante la consulta](#4-sugerencias-de-interrogatorio-durante-la-consulta)
5. [Rehabilitación: catálogo, detector, autocompletado y aprendizaje](#5-rehabilitación-catálogo-detector-autocompletado-y-aprendizaje)
6. [Perfil de equipo del consultorio](#6-perfil-de-equipo-del-consultorio)
7. [Correcciones en seguridad de recetas y preconsulta](#7-correcciones-en-seguridad-de-recetas-y-preconsulta)
8. [Frontend: caché, tamaño de texto, ESLint, identificador](#8-frontend-caché-tamaño-de-texto-eslint-identificador)
9. [Datos de prueba](#9-datos-de-prueba)
10. [Pendientes y decisiones aparcadas](#10-pendientes-y-decisiones-aparcadas)

---

## 1. Modelo ASR v2.1 y chunk de 20 s

**Qué cambió.** El modelo general de transcripción pasa de `megi-medical-v1.5-preview-merged`
a `megi-medical-v2.1-a075-merged`. Es el default del proyecto, no una variable
de entorno suelta.

**Dónde.**

| Archivo | Qué |
|---|---|
| `asr_service/megi_asr/config.py` → `GENERAL_MODEL` | default = v2.1. Sigue siendo sobreescribible con `MEGI_ASR_GENERAL_MODEL` |
| `frontend/src/components/live_soap.jsx` → `CHUNK_MS` | 10 000 → **20 000** |
| `asr_service/megi_asr/routers/soap.py` → `complete(msgs, 1024)` | tope de salida 512 → **1024** |
| `docs/asr_model_status.md`, `README.md`, `asr_service/README.md` | documentación |
| `~/Desktop/models_megi/engine/model_registry.json` | registro informativo del bundle (nadie lo lee; hay `.bak`) |

**Por qué.** Medido en esta máquina sobre dictado médico real: 20 s da el mismo
WER que 10 s (22.0 %) con 40 % menos de cómputo (3 chunks en 4.1 s frente a 5 en
7.1 s); a 30 s ya se degrada. Menos chunks son además menos costuras en
`live.py:stitch`. El tope de tokens subió porque con chunks de 20 s y la ficha
del paciente en el prompt el peor caso observado genera ~430 tokens (84 % de
512), y **truncar el JSON no degrada la nota: la pierde** (`_extract_json`
devuelve `None` y el chunk entero se descarta con `status: invalid_json`).

**Para volver a v1.5** sin tocar código:
`MEGI_ASR_GENERAL_MODEL="$MEGI_ENGINE_DIR/megi-medical-v1.5-preview-merged"`.

**Reservas documentadas.** El WER del v2.1 (10.79 % vs 22.77 %) sale de 3
consultas y de la ruta chunked-batch. Falta medir cobertura en streaming en
vivo, donde `commit_stable_words` filtra por `logprob` (precedente: un modelo
bueno en batch descartado por perder ~20 % de palabras al borde).

Scripts de medición (en el scratchpad de la sesión, no en el repo):
`probar_chunk.py`, `probar_tokens.py`. Repetirlos si se cambia de modelo.

---

## 2. Motivo de la consulta de hoy

**El problema.** `patients.reason` es el motivo con el que se dio de alta al
paciente y se queda ahí para siempre. Quien se registró por lumbalgia en marzo
puede volver en julio por cefalea, y toda la app (cabecera, «Antes de empezar»,
escriba del SOAP, agenda) preparaba la consulta con el motivo viejo.

**La regla que lo resuelve.** El motivo de hoy vive en **`consultations.motivo`**
y **todo el frontend lo lee de ahí**. Ninguna pantalla lo guarda por su cuenta.
Cada vez que una pantalla tuvo su propia copia (estado de React, `localStorage`,
`patients.reason`) apareció el bug en esa pantalla.

### Backend

`POST /api/consultations` (`backend/app/routes/consultations.py`) hace tres cosas:

1. **Retoma el borrador abierto de hoy** para ese paciente en vez de crear otro
   (mismo `id`, `retomada: true`). Solo borradores de HOY y sin transcripción:
   uno con audio es una consulta en curso, no un arranque repetido.
2. **Resuelve el motivo** en este orden, de lo más cercano a hoy a lo más
   lejano. **El orden importa** — tenerlo distinto pisaba el motivo escrito con
   el del alta:
   ```
   1. body.motivo                      lo que el médico acaba de escribir
   2. borrador abierto de hoy          lo que ya había escrito para ESTA consulta
   3. cita pendiente (appointments)    agendar ya exige motivo
   4. patients.reason si el paciente   ahí sí es el de hoy
      se dio de alta HOY
   5. → 400 con instrucción           «Falta el motivo… Ábrela desde el expediente»
   ```
3. **`solo_retomar: true`** (en `ConsultationCreate`): solo reengancha al
   borrador abierto; si no hay, **404 y nunca crea**. Lo usa el frontend tras un
   refresco de página. Sin este flag, un simple refresco podía fabricar una
   consulta por el respaldo 4.

`GET /api/patients` expone además `motivo_hoy` (borrador abierto de hoy, o cita
pendiente de hoy) y `consulta_abierta_id`. Es lo que la agenda pinta.

`GET /api/patients/{id}/preconsulta?motivo=…` acepta el motivo **directo** como
parámetro. Es imprescindible: la consulta se crea de forma diferida y cuando
esa pantalla se pinta puede no existir todavía.

Columna: `consultations.motivo` (migración idempotente en `db.py:_CONSULT_EXTRA_COLUMNS`).

### Frontend

- **`components/motivo_consulta.jsx`** — el cuadro «¿Por qué viene hoy?». Un
  solo componente para las dos puertas: expediente (`pacientes.jsx`) y agenda
  (`dashboard.jsx`). El campo arranca **vacío a propósito**: prellenarlo con el
  motivo viejo haría que se aceptara sin leer. Hay atajo «Viene por lo mismo».
  *Empezar* está deshabilitado sin texto (obligatorio).
- **`App.jsx`**: `beginConsultation(p, motivo)`. Si llega motivo, la consulta
  **se crea en ese momento** (no al grabar): decir a qué viene ya es empezar.
  La creación diferida se conserva para «abrir el expediente y mirar».
- **`App.jsx`, efecto de reenganche**: al arrancar en `view === "consulta"` con
  paciente y sin `consultationId` (refresco), llama a `createConsultation`
  con `solo_retomar` y recupera `id` y `motivo`. Si 404, vuelve a la agenda.
  Tiene guarda contra la carrera con `beginConsultation` (si hay creación en
  vuelo, no es un refresco).
- **`dashboard.jsx`**: la fila muestra `motivo_hoy || reason` etiquetado
  («motivo de hoy» / «motivo de alta»). Con `consulta_abierta_id` el botón es
  **CONTINUAR →** y entra directo con ese motivo; si no, **INICIAR →** abre el
  cuadro. Para pacientes `terminada` el botón es **OTRA CONSULTA →** (antes era
  un `VER` que no hacía nada).
- **`real_consulta.jsx`**: la cabecera muestra `motivo || patient.reason` y
  pasa `motivo` a `PreconsultaPanel`.

**Tests:** `backend/tests/test_motivo_consulta.py` (retomar, orden de
resolución, obligatoriedad, `solo_retomar`, agenda).

**Camino que aún puede fallar:** el comando de **voz** «inicia consulta con X»
no pasa motivo. Con un paciente antiguo sin cita recibirá el 400. El mensaje
dice qué hacer, pero el comando de voz no lo pide.

---

## 3. El escriba del SOAP conoce al paciente

**Qué cambió.** `POST /v1/soap/update` (servicio ASR) acepta `paciente`
(edad, sexo, motivo de hoy, crónicos, alergias) y lo mete en el prompt. Antes
ordenaba la nota a ciegas: no sabía a quién atendía ni por qué venía.

**Dónde.**

- `asr_service/megi_asr/routers/soap.py` → `SoapReq.paciente`, `_bloque_paciente()`.
  El bloque va con la instrucción explícita *«es del expediente, NO es texto de
  la consulta; úsalo para encuadrar, no lo copies a la nota»* — sin ella el
  riesgo obvio es que meta antecedentes en el S como si el paciente los dijera.
- `backend/app/routes/live.py` → `_ficha_de(cid)` lo arma y `soap_update` lo envía.
- `backend/app/services/asr_client.py` → `soap_update(..., paciente=)`.

**Efecto medido.** Con «vengo por lo de siempre, hormigueo en los pies», sin
ficha solo abre S; con ficha abre además A («compatible con polineuropatía
diabética distal según antecedentes»). Y la latencia **bajó** (13.7 s → 6.0 s):
con contexto el modelo resuelve antes en vez de divagar.

**Ojo al editar `soap.py`:** el helper `_bloque_paciente` va **antes** del
decorador `@router.post("/v1/soap/update")`. En una edición quedó entre el
decorador y `def soap_update`, el decorador registró el helper como ruta y el
endpoint devolvía `""`. Esa ruta no está cubierta por pytest.

---

## 4. Sugerencias de interrogatorio durante la consulta

Aviso discreto que aparece mientras el médico habla: «no has preguntado por X
y vas a recetar Y». Es **apoyo, no alerta**: nada bloquea, nada suena.

**Dónde.**

| Pieza | Archivo |
|---|---|
| Detección | `backend/app/services/consult_gaps.py` → `detect(soap, allergies, chronic, sugerencias_edad)` |
| Transporte | `backend/app/routes/live.py` → `_gaps_de()`, campo `gaps` en la respuesta de `/soap/update` |
| UI | `frontend/src/components/consulta_hints.jsx`, estilos `.hint-*` en `styles.css` |
| Tests | `backend/tests/test_consult_gaps.py` |

**Cómo decide.** Determinista, sin LLM, reutilizando tablas que ya existían:

- **Fármaco × padecimiento sin preguntar** — `DISEASE_RULES` de `safety.py` al
  revés: si aparece un fármaco en el plan y su condición asociada **ni está en
  el expediente ni se ha mencionado** en la consulta, es un hueco. Si ya está en
  el expediente **no** es un hueco: es una alerta, y de eso responde
  `compute_alerts`. Se agrupa **por fármaco** (un AINE choca con riñón, HTA y
  estómago a la vez; tres avisos seguidos son ruido). La comparación usa la
  tabla `FAMILIA` de sinónimos («hipertenso», «presión alta», «enfermedad renal
  crónica») porque los términos de `DISEASE_RULES` son demasiado literales.
- **Alergias nunca confirmadas** — se receta y el expediente no tiene ninguna.
- **Alarma mencionada y no explorada** — tabla `ALARMAS` (dolor torácico sin
  auscultación, disnea sin SpO₂…).
- ~~Tamizaje por edad~~ — **retirado del aviso en vivo** (2026-09-13). Medido en
  20 consultas simuladas salía en 19 («tamiz de cáncer colorrectal» en una
  faringitis). Es información que el médico ya ve en «Antes de empezar»; en
  vivo era un duplicado en el peor momento. Test: `test_el_aviso_en_vivo_nunca_emite_tamizaje`.

Tope `MAX_SUGERENCIAS = 3`. **Se apaga solo**: en
cuanto el médico pregunta y la palabra entra al SOAP, el hueco deja de venir.
Sin estado en el servidor; el cliente decide qué ya enseñó.

**UI.** Esquina inferior derecha, `opacity: .72` en reposo, uno a la vez con
7 s entre avisos, se va solo a los 13 s, sin sonido, `aria-live="polite"`,
`pointer-events` solo en la tarjeta, respeta `prefers-reduced-motion`. **Nunca
rojo**: si esto gritara como una alerta real, la que importa (receta × alergia,
que sí bloquea al aprobar) dejaría de distinguirse.

---

## 5. Rehabilitación: catálogo, detector, autocompletado y aprendizaje

Objetivo: que el médico no escriba a mano los 5–8 pasos con dosimetría de una
indicación de terapia física; los recibe del catálogo, corrige, inserta, y esa
corrección se registra para afinar la siguiente.

### 5.1 Catálogo (`backend/data/protocolos_rehabilitacion.json`)

Generado desde `r/INDICACIONES REHABILITACION CLASIFICADAS.md` (UMF 51,
Medicina de Rehabilitación) por `parsear_protocolos.py` (scratchpad). Contiene:

| | |
|---|---|
| `protocolos` | **55** en 10 regiones, 376 pasos, 166 valores de dosis |
| `ensenanzas` | 11 (higiene de columna, antiedema, terapia con espejo…) |
| `plan_alta` | 4 plantillas |
| `modalidades_referencia` | **46** rangos por agente («US analgésico: pulsado 50–70 % · 1 MHz · 1.0–1.4 W/cm² · 5–8 min») — para **adaptar** un protocolo, no solo copiarlo |
| `reglas_adaptacion` | **13** reglas contexto → acción de la tabla «Hallazgo → qué se agrega», tipadas `agrega` / `restringe` / `condiciona` |

Cada paso lleva `texto` literal, `dosis[]`, `lateralidad` (si trae
`**DERECHO/IZQUIERDO**` sin resolver), `modalidades[]` (CHC, US, TENS, C.I.,
Láser…) y, en 3 casos, `sustitucion` («en caso de no haber TENS aplicar US
1.0 W/cm²»). Cada protocolo lleva `fuentes[]`, `base_plantilla` (13 vienen de la
plantilla `.odt`, el resto son adaptaciones observadas), `requiere_lateralidad`
y `advertencias[]`.

**Por qué catálogo y no índice semántico.** Mismo criterio que `dx_reconciler`
con la CIE-10: los protocolos son dosimetría exacta; un vecino semántico
devuelve parámetros plausibles pero equivocados y eso no se ve a simple vista.
El modelo elige **cuál**; el texto sale **literal**. Fidelidad verificada:
437/437 pasos literales, 50/50 dosis clínicas recuperadas.

**Advertencia embebida.** `muneca-y-mano/po-rafi-de-escafoides` lleva en
`advertencias` la contradicción que el propio documento señala (láser a
cicatriz vs. manual del Lambda: osteosíntesis metálica contraindicada). Si esto
se muestra solo al médico, la contraindicación tiene que ir en el mismo objeto
que la indicación, no en una nota al pie. Nuevas contradicciones: tabla
`ADVERTENCIAS` del parser.

**Para regenerar el catálogo** tras editar el `.md`: correr el parser y copiar
el JSON a `backend/data/`. El parser tiene asserts de integridad (ids únicos,
sin bloques vacíos, toda región resuelta).

### 5.2 Detector y búsqueda (`backend/app/services/rehab.py`)

- `detectar(texto)` — ¿la consulta es de rehabilitación? Señales fuertes
  (`rehabilitacion`, `terapia fisica`, `tf institucional`), medias (modalidades
  y epónimos: Codman, Williams, Klapp…), maniobras (Jobe, Hawkins, Lasègue…) y
  abreviaturas de la nota (CHC, US, ADM, EMM…). **Todas con frontera de palabra**:
  por subcadena, «tens» marcaba «cefalea tensional» como rehabilitación. Tres o
  más abreviaturas juntas bonifican. Devuelve las señales, no solo el veredicto.
- `buscar(texto)` — protocolo por diagnóstico. Regla: **alguna etiqueta del
  nombre debe estar completa** en el texto. Coincidir a medias no vale: una
  «lumbalgia mecánica» casaba con «Lumbalgia con sacroilitis» por compartir la
  palabra genérica y ganaba por tener el nombre más corto. Las etiquetas salen
  de `_etiquetas()`, que entiende las tres formas del documento: `/` (sinónimos),
  «lateral **o** medial» (modificador alterno) y «Lesión **o** tendinosis del
  manguito rotador» (núcleo alterno con complemento compartido). El peso IDF
  sobre los nombres del catálogo solo ordena entre los que encajan.
- `reglas_para(soap)` — cuáles de las 13 reglas dispara la exploración
  (`DISPARADORES`, escritos a mano por precisión). Las `restringe` van primero:
  un paso que sobra puede hacer daño.
- `adaptar_a_equipo(pasos, equipo)` — ver §6.
- `analizar(soap, equipo)` — punto de entrada.

Resultado medido: 12/12 casos con el protocolo correcto en primer lugar y
**0 falsos positivos sobre 30 consultas** no relacionadas; después, **20/20**
por el pipeline real (gemma escribe el SOAP y el detector lo lee), tras cuatro
correcciones que salieron de ahí: **alias** de diagnóstico para nombres
descriptivos del catálogo (`ALIAS` en el parser → `alias[]` en el JSON),
búsqueda **en cascada** impresión → A → plan-sin-descartes → todo (buscar en
A + P concatenados hacía que «…para descartar capsulitis» en el plan ganara al
diagnóstico), corte de la impresión en «considerar / valorar / descartar», y
filtro de **negación** («niega parestesias») y **pasado** («antecedente de
fisioterapia hace años») en las reglas y señales.
Cuando detecta rehabilitación pero el catálogo no tiene el cuadro, devuelve
lista vacía: mejor vacío que irrelevante.

**Limitación conocida (pendiente).** Detecta tarde: con exploración completa
(Jobe, Hawkins, ADM, EMM, «derivado por MF») aún dice `False`; se decide cuando
aparece el plan («TF institucional»). Las señales están ponderadas hacia el
tratamiento y no hacia motivo + exploración, que es lo que existe al minuto 3.
Ahora que el motivo de hoy llega estructurado, reponderar es el siguiente paso.

### 5.3 Transporte y UI

- `/soap/update` (`live.py:_rehab_de`) devuelve `rehabilitacion` en cada chunk.
- `GET /api/rehab/consulta/{id}` (`routes/rehab.py`) recalcula sobre el SOAP
  guardado para la pantalla de revisión, con el equipo de quien pregunta.
- **`frontend/src/components/rehab_sugerencia.jsx`** — bloque junto al Plan en
  `revision.jsx`. Muestra advertencias, reglas disparadas (restricciones en
  rojo arriba), selector de lado, pasos con casillas y **Insertar en el plan**.
  Reglas: nada entra sin pulsar; el botón está **bloqueado hasta elegir lado**
  (el sistema nunca elige); los pasos `sin_equipo` entran desmarcados pero se
  ven. Falla en silencio si la API no responde: un apoyo no puede tumbar la
  revisión. **El `useEffect` que registra la impresión va antes del `return
  null`** — un hook tras un return condicional revienta React cuando `datos`
  pasa de `null` a valor (lo cazó ESLint `rules-of-hooks`).

### 5.4 Captura de correcciones (aprendizaje)

Tabla **`rehab_sugerencias`** (`db.py`, con migración `_REHAB_EXTRA_COLUMNS` e
índice parcial `ix_rehab_mostrada`):

```
evento            'mostrada' | 'aplicada'
protocolo_id      id del catálogo
alternativas      JSON: qué se ofreció y en qué orden
elegido_orden     0 = se quedó con el primero; >0 = el ranking falló
pasos_propuestos  JSON literal del catálogo
pasos_aceptados   JSON de lo que el médico se llevó (editado)
pasos_quitados    JSON  ┐ diff calculado en el SERVIDOR, no en el cliente
pasos_anadidos    JSON  ┘
lateralidad       derecho | izquierdo | NULL
reglas_mostradas  JSON
contexto          JSON {O, A}: la exploración que justificó la decisión
doctor_id         de quién se aprende
```

- `POST /api/rehab/mostrada` — al renderizarse. `INSERT OR IGNORE` con índice
  único **parcial** sobre `evento='mostrada'`: el componente se repinta y una
  sugerencia se cuenta una vez; las `aplicada` no se restringen (un duplicado
  raro no puede convertirse en un 500 a mitad de consulta).
- `POST /api/rehab/aplicar` — al insertar.
- `GET /api/rehab/aprendizaje` — resumen por protocolo: `mostradas`,
  `aplicadas`, **`rechazos`** (mostrada sin aplicada: la señal más fuerte y la
  única que no se puede reconstruir después), `tasa_aceptacion`,
  `no_era_el_primero`, pasos más quitados/añadidos. **Lee, no ajusta nada.**

**Lo que NO hace todavía, a propósito:** el ranking no se mueve con estos datos.
Con tres muestras sería adivinar. La captura sí se hizo ya porque lo que no se
graba no vuelve.

**Principio para cuando se implemente el ajuste** (acordado con el equipo):
seleccionar dentro de un conjunto acotado no es inventar. La dosis siempre está
en un rango legítimo del catálogo (`1.0–1.4 W/cm²`); lo que se aprende es
*cuándo* aplica cada valor según la exploración (edema, cicatriz, osteoporosis,
fuerza ≤ 3), o cuándo un paso se quita, o cuándo entra una enseñanza. **El LLM
devuelve una elección entre valores existentes, nunca un valor libre.** Las
variantes fuera de rango entran como `borrador` con aprobación humana, igual que
el catálogo de medicamentos (`estado: borrador → aprobado`). Por médico (consulta
privada: cada médico es su propia unidad); la agregación global queda aparcada
hasta la integración institucional, que se clasificará con reglas propias.

**Tests:** `test_rehab.py` (detector, búsqueda, equipo, integridad),
`test_rehab_sugerencias.py` (captura, rechazo, orden elegido).

---

## 6. Perfil de equipo del consultorio

**Qué.** Cada médico marca en *Mi perfil* qué aparatos tiene (CHC, US, C.I.,
TENS, Láser, Parafina, Fluidoterapia, Corrientes rusas, Exponenciales,
Compresa fría). Las sugerencias de rehabilitación se ajustan a eso.

**Por qué importa en consulta privada.** En una UMF todos comparten aparato; un
particular no. El catálogo depende del equipo: 39 protocolos usan CHC, 37 US,
23 C.I., 20 TENS, 8 láser. Sugerir la dosis de un aparato que no está enseña al
médico que el sistema no le entiende, y deja de mirarlo.

**Dónde.** Columna `users.equipo` (JSON, migración en `_USERS_EXTRA_COLUMNS`);
`routes/me.py` la expone y acepta; `schemas.DoctorProfileUpdate.equipo`;
`mi_perfil.jsx` (botones); `rehab.adaptar_a_equipo()`.

**Tres desenlaces por paso, ninguno borra en silencio:**

| `equipo_estado` | qué pasa |
|---|---|
| `disponible` | se usa tal cual |
| `sustituido` | se aplica la alternativa **que el documento ya trae** («sin TENS → US 1.0 W/cm²»; «sin parafina → CHC») y se muestra a qué sustituye |
| `sin_equipo` | se marca, se desactiva, **pero se ve** con «no tienes X». Ocultarlo sería decidir por el médico |

**Sin perfil configurado no se filtra nada**: no saber qué hay no es lo mismo
que saber que no hay.

---

## 7. Correcciones en seguridad de recetas y preconsulta

### `safety.py` — condición renal escrita como se dice

`DISEASE_RULES` de metformina y sulfonilurea listaban `["erc", "insuficiencia
renal", "nefro"]`; la del AINE incluía además `"renal"` a secas. Resultado: un
crónico escrito «Enfermedad renal crónica estadio 3b» (como está en el
expediente de la paciente de prueba) disparaba la alerta del ibuprofeno **y no
la de la metformina**. Se añadió `"renal"` (y `"nefro"`) a ambas. Son `warn`, no
`blocker`: el gate de aprobación no cambia. Test parametrizado 3 fármacos × 4
redacciones en `test_safety_and_approve.py`.

**Mismo patrón, sin tocar (decisión clínica pendiente):** «Enfermedad por
reflujo gastroesofágico» / «Reflujo» (regla AINE-GI solo acepta `erge`),
«Paciente hipertenso» (solo `hipertension`), «Enfermedad pulmonar obstructiva
crónica» (betabloqueador solo acepta `epoc`).

### `patients.py:preconsulta` — tres casos raros

- `consultas_previas` era `len()` de una ventana `LIMIT 5`: le decía «5
  consultas previas» al LLM a cualquier paciente con historial largo. Ahora
  `COUNT(*)` aparte; la ventana de 5 se conserva para último dx/receta.
- Un campo JSON corrupto descartaba la consulta **entera** (el `try` envolvía
  las tres columnas). Si era la más reciente, `ultimo_dx` pasaba a ser el de
  otra consulta sin aviso, y con una sola consulta el paciente aparecía como
  «primera visita». Ahora `_load_json(raw, fallback)` por campo, con validación
  de tipo.
- Receta como lista de cadenas (forma que `safety.py` y `age_engine` ya
  aceptaban) rompía `r.get("drug")`, el `except` lo tragaba y **se saltaba toda
  la personalización** con `resumen: None` sin explicación. Ahora
  `_drug_names()` con la misma tolerancia.

---

## 8. Frontend: caché, tamaño de texto, ESLint, identificador

### Caché de `index.html` (`backend/app/main.py:_FrontendFiles`)

Vite renombra cada bundle con hash y borra el anterior. `index.html` se servía
**sin `Cache-Control`**, el navegador lo cacheaba por heurística y tras un
`megi update` pedía un `/assets/index-XXXX.js` que ya no existía: 404, módulo
sin cargar, **pantalla en blanco** con el fondo pintado (el hash del CSS no
había cambiado). Ahora `index.html` → `no-cache`; `/assets/*` → `immutable` un
año. Esto le habría pasado a cualquier médico después de cada actualización.

### Tamaño de texto (Tweaks)

El ajuste se aplicaba (`--text-scale` en `:root`) pero no se veía: **440
`fontSize` inline en píxeles** contra 4 que escalaban. Ahora `#root { zoom:
var(--text-scale) }` en `styles.css` y se quitaron los `calc(... *
--text-scale)` (con `zoom` encima escalaban dos veces). Valores 0.9 / 1 / 1.12
/ 1.25, persistidos en `megi.config`.

### ESLint (`frontend/eslint.config.js`)

ESLint 9, configuración plana, **orientada a bugs**: son `error` solo las cosas
que compilan y no funcionan (`no-undef`, `react/jsx-no-undef`,
`react-hooks/rules-of-hooks`, `react/jsx-key`); lo demás es `warning`. Motivo:
`setMotivoHoy(...)` se usó sin declararlo, Vite compiló, 83 tests pasaron y
reventó en la consulta del médico. `npm run build` = `eslint src && vite build`,
así que `megi update` / `megi-install` pasan por el lint sin tocarlos. En su
primera pasada encontró un hook condicional en `rehab_sugerencia.jsx` y un
setter huérfano en `pacientes.jsx`. Quedan 9 avisos anteriores (React importado
sin usar; `exhaustive-deps` en `logo.jsx`, `imprimir.jsx`, `App.jsx`) que se
dejaron como avisos: cambiarlos a ciegas puede provocar bucles de render.

### Captura de identificador (CURP/NSS/INE)

**Eliminada del frontend** a petición: la tarjeta de `real_consulta.jsx`, su
grabador dedicado, estado, envío y tabla `ID_STATE`. Sin preferencia ni rastro
en `src/`. El backend conserva `routes/identifiers.py` y el servicio ASR su
ruta `/v1/transcribe/identifier` (modelo v1.6A + resolver); cuando se retire
del todo, eso es lo que queda — y la `identifier_route` del catálogo de modelos.

### Interruptor muerto (no tocado)

`showTranscript` en Tweaks se guarda y se pinta pero ningún componente lo lee.
Mostrar/Ocultar ahí no hace nada.

---

## 9. Datos de prueba

Tres pacientes bajo la cuenta `king` (P-DEMO01/02/03) con 10 consultas
aprobadas cada uno entre sep-2024 y ago-2026, gravedad baja / media / alta,
notas SOAP con el contrato del proyecto (`render_final_soap`), sellos SHA-256
recalculables por el backend, alergias respetadas en todas las recetas, 20/30
con borrador de IA distinto de la nota del médico (para la vista de auditoría).

Fuente: `pacientes_demo.json` + `seed_pacientes.py` (scratchpad de la sesión,
fuera del repo). `seed_pacientes.py --borrar` deja todo como estaba (marca
`patients.source = 'seed_demo_gravedad'`). Perfiles corregidos tras verificar
«Antes de empezar»: Mariana tiene la sensibilización a látex en `allergies`,
Jorge las dos complicaciones microvasculares en `chronic` — antes solo vivían
en la prosa de la sección A y el LLM no las veía.

Además: índice RAG copiado de la otra instalación a `asr_service/rag/index/`
(está en `.gitignore`; el README dice que viene incluido y no es así).
`BAAI/bge-m3` (~2.3 GB) se descarga solo en la primera consulta RAG.

El catálogo de **medicamentos** de esta instalación está **vacío** (0 fármacos,
0 interacciones). `load_catalog_rules` degrada sin romperse, pero la
comprobación de interacciones fármaco-fármaco está inerte aquí. El minado real
(49 medicamentos, 81 interacciones) está en `~/Desktop/pagina_megi/ia megi/`.

---

## 10. Pendientes y decisiones aparcadas

| Pendiente | Estado |
|---|---|
| Reponderar el detector de rehabilitación hacia motivo + exploración (decidir al minuto 3, no al 9) | siguiente paso; medible contra las 574 recetas extraídas |
| Que `/soap/update` devuelva también `especialidad` en la misma llamada (mismo prompt, más tokens) | pendiente; `soap_patch` debe seguir siendo obligatorio y lo demás opcional |
| Ajuste del ranking con `rehab_sugerencias` | **aparcado hasta tener datos reales**; ver principio en §5.4 |
| Arbitraje entre detectores de especialidad e histéresis para que no parpadee | cuando haya una segunda especialidad |
| Tope de sugerencias compartido entre `consult_gaps` (3) y `rehab` (3) | ajuste menor, pendiente |
| Detector de rehabilitación validado por el pipeline real | **hecho**: 20/20 (10 rehab + 10 normales); alias de dx, búsqueda en cascada impresión→A→plan, negación y pasado |
| Comando de voz «inicia consulta» sin motivo → 400 | pendiente pedir motivo por voz |
| Otras redacciones en `DISEASE_RULES` (reflujo, hipertenso, EPOC desarrollado) | decisión clínica pendiente |
| Verificar v2.1 en streaming en vivo | pendiente |
| `institution` en `rehab_sugerencias` / agregación global | aparcado: consulta privada por ahora |
| Fuentes de Google Fonts: única dependencia externa al arrancar | opcional: `.woff2` en el repo |

---

## Cómo probar cada pieza rápido

```bash
# backend
cd backend && ./.venv/bin/python -m pytest -q
# frontend (lint + build + tests)
cd frontend && npm run build && npm test -- --run
# servicios
./scripts/megi restart llm && ./scripts/megi status
# ¿el ASR carga v2.1?
curl -s http://127.0.0.1:8010/health | python3 -m json.tool | grep general
# sugerencia de rehabilitación para una consulta guardada
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/rehab/consulta/<CID>
# señal de aprendizaje acumulada
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/rehab/aprendizaje
```

Tras cualquier `npm run build`, el navegador necesita **⌘⇧R** la primera vez
(el HTML cacheado antes de la cabecera `no-cache` no se revalida solo).
