# MEGI · Médico — Cambios v0.0.1 ("quitar demo + cablear SOAP real")

Fecha: 2026-06-29

---

## Bitácora posterior (26-jul → 17-ago 2026)

Tres bloques de trabajo que no estaban en esta bitácora. El detalle vive en
`docs/revision_2026-07-12_gaps_y_seguridad.md` (tabla de cierre),
`docs/security_findings_2026-07-26.md` y `docs/empaquetado.md`; aquí queda el
resumen para que el historial no tenga un hueco de tres semanas.

**Seguridad (26-27 jul).** Antes: contraseñas con SHA-256 sin sal, login sin
límite de intentos, `must_change_password` solo impuesto en la UI, ASR service
sin auth y aceptando cualquier `audio_path`, tokens de 30 días irrevocables.
Ahora: PBKDF2 con sal y migración perezosa al hacer login, backoff exponencial
(429 tras 5 fallos), el flag dentro del token firmado con rechazo 403
server-side, allowlist de directorios en el ASR más token compartido opcional, y
sesiones revocables de 7 días con `sid` en base. Se cerraron además dos hallazgos
propios: un **path traversal** en la subida de audio (un `consultation_id` con
`../` escribía fuera del directorio de sesiones, verificado) y la **firma de la
consulta**, que se tomaba del cuerpo de la petición en vez del token — cualquiera
podía aprobar una nota a nombre de otro médico.

**Arquitectura (27-jul).** `MEGI_REAL_ASR` era configuración, no salud: si el ASR
se caía, algunas rutas devolvían transcript mock con la misma forma que el real y
nada lo advertía. Ahora el backend pregunta de verdad (`/api/health/services`) y
la UI muestra puntos de estado y una banda de aviso cuando documentar no es
seguro. `server.py` pasó de 1 907 líneas a 52 más ocho routers por dominio, con
un test de contrato que congela las rutas. El LLM puede correr en proceso aparte.

**Multi-tenencia (17 ago).** Antes: cualquier usuario autenticado veía el
expediente completo —`list_patients()` no filtraba y `doctor_id` iba siempre
NULL—, correcto para una app local de un médico y una filtración en cuanto hay
dos. Por qué ahora: el rumbo pasó a un servidor con varios médicos, cada uno con
su agenda y pacientes reales. Ahora: `patients.doctor_id` es la raíz de la
pertenencia y consultas, audio, documentos y citas heredan de él; las guardas
viven en `app/ownership.py` y responden 404 (no 403, que confirmaría que el id
existe); el rol admin no abre expedientes ajenos. Lo respalda un test de
aislamiento entre dos médicos que empezó con 17 fallos y hoy pasa con 19 casos.
Al migrar contra una copia del expediente real apareció que
`consultations.doctor_id` traía el código de consultorio del IMSS y no un
usuario: se preserva en `imss_consultorio` en vez de pisarlo.

**Empaquetado Fase 1 (12-17 ago).** El backend sirve el frontend construido, así
que Vite desaparece de producción y todo queda en un origen. `scripts/megi`
centraliza la operación, con un vigilante que relanza lo que se caiga (con
periodo de gracia, para no relanzar servicios que aún cargan modelos). Guardia de
versión entre frontend y backend, rotación de logs y `megi backup` con
instantánea consistente de SQLite. Pendiente: que arranque solo al encender,
bloqueado por TCC de macOS.

Decisiones tomadas por el usuario para este paso:
1. **Modo por defecto:** `real` (stack real: backend :8000 + microservicio ASR/MLX :8010).
2. **Datos mock del frontend:** **eliminar por completo** (`src/mock/data.js`).
3. **Alcance:** quitar la demo **y** cablear revisión/impresión al SOAP real.

> Convención de esta bitácora: cada cambio lleva **Antes / Por qué / Ahora**.
> Los cambios marcados con ⚠️ **tocan el flujo de datos clínicos (SOAP)** — se
> documentan con más detalle porque originalmente eran zona "no tocar".

---

## 1. Modo de ejecución (frontend)

**Archivo:** `frontend/.env`

- **Antes:** `VITE_MEGI_MODE=demo`. La app arrancaba en modo demo, es decir, **sin
  backend**, usando `src/mock/data.js` y la consulta **simulada** con guion.
- **Por qué:** la 0.0.1 debe ser el producto real, no el teatro de demo.
- **Ahora:** `VITE_MEGI_MODE=real` y se añadió `VITE_ASR_WS_URL` para el streaming.
  El comentario del archivo documenta los dos modos que quedan (`real`, `local_mock`).

## 2. Cliente API sin demo ni mocks

**Archivo:** `frontend/src/api/client.js`

- **Antes:** el cliente tenía un modo `demo` completo: `DEMO_CONFIG`, import de
  `src/mock/data.js`, `localResolveIdentifier` (resolver de identificadores falso por
  texto), `sha256Hex` en el navegador, y métodos `*Mock`
  (`transcribeGeneralMock`, `transcribeIdentifierMock`, `resolveIdentifierMock`) con
  ramas `if (MODE === "demo") …`.
- **Por qué:** eliminar el mock por completo (decisión 2) y dejar un transporte
  único contra el backend.
- **Ahora:** el cliente solo hace `fetch` al backend. Métodos reales:
  `getHealth, getConfig, getPatients, getPatient, createConsultation,
  getConsultation, patchConsultation, reviewSave, reviewApprove, uploadAudio,
  uploadChunk, soapUpdate, soapFinalize, getSoap, exportConsultation`.
  - Se eliminó `resolveIdentifierMock` (el backend solo tiene
    `/identifier/resolve/mock`; la resolución **real** ocurre por **audio** en la
    consulta vía `uploadAudio(audioKind:"identifier")`).
  - `exportConsultation(id)` ahora es **GET** al backend (que calcula el hash real),
    en vez de calcular un sha256 en el navegador sobre un payload mock.

## 3. Provider de datos sin "bundle clínico" enlatado

**Archivo:** `frontend/src/api/MegiDataProvider.jsx` ⚠️

- **Antes:** al montar cargaba `getConfig` + `getPatients` + **`getClinical`**, y
  exponía `useMegiData()` con `{ TRANSCRIPT, SUGGESTED_DX, SUGGESTED_RX, VITALS,
  SOAP, FLAGS }` provenientes del **seed** (datos clínicos enlatados de un caso de
  angina). Toda la app (consulta simulada, revisión, impresión) leía ese SOAP/Dx/Rx
  falso.
- **Por qué:** ese bundle ES el SOAP de demo. Para cablear el SOAP real había que
  dejar de inyectar el enlatado y que cada pantalla lea la nota real de su consulta.
- **Ahora:** solo carga `getConfig` + `getPatients` (config y doctor siguen siendo
  reales del backend). Se eliminó `useMegiData()`. La nota clínica se obtiene por
  consulta con `api.getSoap(consultationId)`.

## 4. Eliminación de datos mock

**Archivo:** `frontend/src/mock/data.js` (borrado)

- **Antes:** definía `PATIENTS, TRANSCRIPT, SUGGESTED_DX, SUGGESTED_RX, VITALS,
  SOAP, FLAGS, DOCTOR` y un `MEGI_DATA` global.
- **Por qué:** decisión 2 (eliminar mock por completo). Los pacientes y el doctor
  ahora vienen del backend (sembrados desde `backend/data/seed.json`).
- **Ahora:** archivo y carpeta `src/mock/` eliminados.

## 5. Consulta: se elimina la simulada; siempre consulta real

**Archivo:** `frontend/src/components/consulta.jsx`

- **Antes:** `Consulta` decidía por modo: si `demo`/`demo_mock` renderizaba
  `SimulatedConsulta` (timeline, transcript con guion, `LiveSummary`, `SoapBuilder`,
  `VitalsLive`, `ProgressStrip`, `DxList`, todo con datos enlatados); si no,
  `RealConsulta`. Exportaba además `DxList`.
- **Por qué:** la simulada es 100% teatro de demo; en 0.0.1 sobra.
- **Ahora:** `Consulta` siempre renderiza `RealConsulta` (audio real → ASR/MLX). Se
  borraron todos los componentes simulados y la exportación de `DxList`. Recibe y
  pasa `consultationId`.
- **Nota:** `frontend/src/components/agentic.jsx` (AgenticResearch) quedó **huérfano**
  (solo lo usaba la simulada). No se importa en ningún lado, así que no entra al
  bundle. Se deja el archivo por si se reusa; se puede borrar más adelante.

## 6. App: dueño del `consultationId` y del `reviewData`  ⚠️

**Archivo:** `frontend/src/App.jsx`

- **Antes:** App no conocía la consulta. `RealConsulta` creaba **su propia** consulta
  y `Revision` creaba **otra** distinta. Consulta y revisión quedaban
  **desconectadas**: la nota real de la grabación no llegaba a la revisión.
- **Por qué:** para cablear el SOAP real, consulta → revisión → impresión deben
  compartir el **mismo** `consultation_id` (el SOAP final se persiste por id en el
  backend). Es el cambio clave que conecta todo el flujo clínico.
- **Ahora:** App posee `consultationId` y `reviewData`. Al iniciar consulta
  (`beginConsultation`) crea **una** consulta (`api.createConsultation`) y pasa el id
  a `Consulta`, `Revision` e `Imprimir`. `approve(payload)` guarda `reviewData`
  (SOAP editado + Dx/Rx/notas/identidad) y navega a impresión.

## 7. Consulta real: recibe el id por props  ⚠️

**Archivo:** `frontend/src/components/real_consulta.jsx`

- **Antes:** creaba su propia consulta en un `useEffect` y la guardaba en estado local.
- **Por qué:** evitar consultas duplicadas y compartir el id con revisión/impresión.
- **Ahora:** recibe `consultationId` por props (lo crea App). Se eliminó el efecto de
  creación. **El resto del pipeline (grabación, chunks, ASR, `soapUpdate`,
  `soapFinalize`, streaming WS, identificador por audio) quedó intacto.**

## 8. Revisión: nota SOAP REAL + Dx/Rx manuales  ⚠️ (cambio principal)

**Archivo:** `frontend/src/components/revision.jsx`

- **Antes:**
  - Leía el SOAP/Dx/Rx/FLAGS del **bundle enlatado** (`useMegiData()`), no de la
    consulta.
  - Tenía un **resumen ejecutivo hardcodeado** ("Masculino de 60 años con dolor
    torácico…"), una lista fija de **"Acciones principales"** (ECG, prueba de
    esfuerzo…), **referencias GPC fijas** (IMSS-080-08, etc.) y **timestamps falsos**
    ("consulta finalizada · 14:32", "duración 18:42").
  - El Dx usaba `DxList` con `SUGGESTED_DX` mock; la receta usaba `SUGGESTED_RX` mock.
  - La tarjeta de identificadores usaba el **resolver mock** por texto
    (`resolveIdentifierMock`, "dicta be e eme…").
  - Creaba su propia consulta.
- **Por qué:** todo eso era contenido de demo. Para cablear el SOAP real hay que
  mostrar la nota consolidada por el pipeline y dejar de fabricar Dx/Rx/alertas.
- **Ahora:**
  - Recibe `consultationId` (de App) y al montar hace `api.getSoap(consultationId)`:
    usa **`final_soap`** (o `soap` si aún no se finaliza) como nota **editable**,
    muestra **alertas reales** desde `validation.flags`/`warnings` y **hechos
    clínicos reales** desde `clinical_facts` (presentes / negados / alarmas).
  - El "resumen ejecutivo" fijo se reemplazó por el **Análisis (A) real** + las
    **alertas de seguridad reales**. Se eliminaron acciones, GPC y timestamps falsos.
  - **Dx (CIE-10) y receta son captura MANUAL** (listas que inician vacías, con
    agregar/quitar). Motivo: el pipeline **aún no emite** CIE-10 ni receta
    estructurada (eso es trabajo posterior); en 0.0.1 preferimos vacío + manual antes
    que datos inventados.
  - La identidad (CURP/NSS) es **confirmación manual** (campos editables prellenados
    con el paciente), sin resolver mock. La resolución por voz vive en la consulta.
  - El **checklist bloqueante** (de la iteración de UX) se conserva y sigue gateando
    "Aprobar e imprimir".
  - Al aprobar: `reviewSave` + `reviewApprove` y entrega el payload real a App.

## 9. Impresión: imprime la nota REAL  ⚠️

**Archivo:** `frontend/src/components/imprimir.jsx`

- **Antes:** leía SOAP/Dx/Rx/VITALS del **bundle enlatado**. La hoja "Resumen
  paciente" era **prosa 100% hardcodeada** (angina estable, "toma aspirina 100 mg",
  señales de alarma fijas). Folio fijo `MEGI-2026-04-2042`. Creaba su propia consulta
  para el hash.
- **Por qué:** misma razón — era demo. Debe imprimir lo que realmente se documentó.
- **Ahora:** recibe `consultationId` + `reviewData` de App. La nota usa el **SOAP
  real** (`reviewData.soap` o `api.getSoap`), Dx/receta del médico (`reviewData`), y
  el folio = `consultation_id`. La hoja de resumen muestra el **Plan (P) real** y las
  **señales de alarma reales** (`clinical_facts.datos_alarma_condicionales`); se
  eliminó la prosa inventada. La rejilla de signos vitales estructurados se quitó (el
  pipeline no los emite estructurados; van dentro del texto de Objetivo). El sello
  usa `api.exportConsultation` (hash real del backend).

## 10. Backend: sellar la nota REAL en el export  ⚠️

**Archivo:** `backend/app/routes/export.py`

- **Antes:** `_build_note` construía la nota (y por tanto el **hash SHA-256**) desde
  el **seed** (`seed["SOAP"]`, `SUGGESTED_DX`, `SUGGESTED_RX`, `VITALS`) — es decir,
  el sello era sobre datos enlatados, no sobre la consulta.
- **Por qué:** un sello de contenido debe cubrir la nota **real** de la consulta.
- **Ahora:** `_build_note(patient, consultation)` lee de la **consulta**:
  `final_soap` (o `soap`), `clinical_facts` y `transcript`. Se eliminó la dependencia
  de `load_seed` en este endpoint. La firma sigue siendo `mock_not_legal_signature`.
  - **Limitación conocida:** los Dx/receta que captura el médico en revisión se
    persisten como `review_events` (vía `reviewSave`), pero **aún no** se incorporan a
    la estructura de la consulta ni al hash. Queda para un paso posterior.

## 11. Backend: modo por defecto `real`

**Archivo:** `backend/app/config.py`

- **Antes:** `MODE` por defecto `local_mock`; `MODES_SUPPORTED` incluía
  `demo_mock`, `demo`.
- **Por qué:** alinear con la decisión 1 y quitar los modos de demo.
- **Ahora:** `MODE` por defecto `real`; `MODES_SUPPORTED = ["real", "local_mock"]`.
  La inferencia real sigue dependiendo de `MEGI_REAL_ASR=true` y del microservicio
  ASR/MLX arriba (ver "Cómo correr").

---

## Cómo correr la 0.0.1 (stack real)

1. **Microservicio ASR/MLX** (py3.14 + MLX) en `:8010` (whisper v1.5 + gemma + RAG).
2. **Backend** (py3.9) en `:8000`:
   `MEGI_MODE=real MEGI_REAL_ASR=true MEGI_ASR_SERVICE_URL=http://localhost:8010`
   (siembra pacientes/doctor desde `backend/data/seed.json` la primera vez).
3. **Frontend**: `npm run dev` (usa `VITE_MEGI_MODE=real`, proxy `/api` → :8000).

Sin `MEGI_REAL_ASR=true`, el backend responde transcripción/SOAP **mock** (modo
`local_mock`), útil para iterar UI sin levantar MLX. El dashboard y los pacientes
funcionan aunque el ASR esté apagado; solo la transcripción/consolidación requieren
el microservicio.

## Pendientes (siguientes pasos sugeridos)

- Emitir **Dx (CIE-10) y receta estructurados** desde el pipeline (hoy son manuales).
- Incorporar los Dx/receta del médico a la estructura de la consulta y al hash del export.
- Endpoint real de **resolución de identificador por texto** (hoy solo por audio + mock).
- Resumen para el paciente en lenguaje sencillo (hoy muestra el Plan real, sin reescritura).
- Borrar `agentic.jsx` si se confirma que no se reutiliza.

---

# Iteración 2 — login, sin pacientes falsos, agenda de pacientes, perfil médico

Fecha: 2026-06-29

## 12. Login + usuario administrador

- **Backend (`routes/auth.py`, nuevo):** `POST /api/auth/login`. Usuarios en código
  (ampliable). Sembrado: **`king` / `votapan`**, nombre de saludo **"King"**, rol
  **`admin`**. La contraseña se compara por hash SHA-256. Registrado en `main.py`.
  - **Nota:** es acceso local, no seguridad de producción (sin tokens/expiración).
- **Frontend (`components/login.jsx`, nuevo):** pantalla de acceso (usuario/contraseña).
- **`App.jsx`:** se separó en `AppInner` (la app) y `App` (raíz). La raíz hace de
  **gate de sesión**: sin sesión → `Login`; con sesión → monta el `MegiDataProvider`
  + `AppInner`. La sesión persiste en `localStorage("megi.session")`. Hay **logout**.
  - **Antes:** `main.jsx` envolvía `App` con el provider y no había auth.
  - **Ahora:** `main.jsx` solo renderiza `App`; los datos se cargan **después** del login.
- **`shared.jsx` (Topbar):** el chip de usuario muestra el **usuario logueado** (nombre +
  rol "ADMINISTRADOR") y un botón **SALIR**.

## 13. Saludo personalizado

**Archivo:** `components/dashboard.jsx`

- **Antes:** `Buenos días, Dra. Martínez` (fijo).
- **Ahora:** `Buenos días, {user.name}` → con tu cuenta dice **"Buenos días, King"**.
  - Nota: el saludo usa el **usuario logueado**; el `doctor` (Dra. Martínez, cédula) se
    mantiene aparte para la firma de la nota impresa.

## 14. Sin pacientes falsos

- **`backend/data/seed.json`:** `PATIENTS` → `[]` (se conservó `DOCTOR`).
- **DB:** se borraron las 6 filas de `patients`. La app arranca **sin pacientes**.
- **`dashboard.jsx`:** estado vacío ("Sin pacientes todavía" + CTA). Se quitó la tarjeta
  fija "Próxima consulta · María G. Hernández"; ahora deriva del primer paciente en
  espera (o muestra vacío). Se quitó el botón "NUEVA CONSULTA" (creaba consulta sin
  paciente) y "EXPORTAR AGENDA" (no-op).

## 15. Agendar pacientes (cita + espontáneo) — persistente  ⚠️ (toca esquema)

- **DB (`db.py`):** migración idempotente: a `patients` se añadieron
  `scheduled_date`, `kind` (`cita`|`espontaneo`), `created_at`.
- **Schemas:** `PatientCreate` (nombre, edad, sexo, motivo + CURP/NSS opcionales +
  kind/fecha/hora) y `PatientProfileUpdate`.
- **Backend (`routes/patients.py`):** `POST /api/patients` (crea, id `P-XXXXXX`,
  status `esperando`) y la lista ordena los espontáneos (sin hora) al final.
- **Frontend (`dashboard.jsx`):** botón **AGENDAR PACIENTE** → modal con dos modos:
  **Con cita** (fecha + hora) o **Espontáneo (walk-in)**. Tras agendar se refresca la
  lista (`useReloadPatients`, nuevo en el provider); si es espontáneo, **inicia la
  consulta de inmediato**.
- **Campos:** nombre/edad/sexo/motivo obligatorios; CURP/NSS opcionales. Alergias y
  crónicos **no** se piden aquí (ver punto 16). Persistente en SQLite.

## 16. Perfil médico (alergias/crónicos) al aprobar  ⚠️ (toca flujo clínico)

Según tu indicación: las alergias y crónicos se agregan al perfil **tras la consulta**,
cuando el médico aprueba la nota (su aprobación = visto bueno).

- **Backend (`routes/patients.py`):** `PATCH /api/patients/{id}/profile` actualiza
  `allergies`/`chronic` del paciente.
- **Frontend (`revision.jsx`):** nueva tarjeta **"Perfil médico"** (chips de
  alergias/crónicos, captura manual, prellenada con lo que ya tenga el paciente). Al
  **Aprobar e imprimir** se hace `updatePatientProfile` **antes** de aprobar, así lo
  escuchado queda en el expediente del paciente con el visto bueno del médico.
  - **Por qué manual y no automático:** el pipeline aún no extrae "alergias/crónicos"
    como campos fiables; el médico confirma. Cuando el pipeline los emita, se pueden
    prellenar desde `clinical_facts`.

## Credenciales y arranque (iteración 2)

- **Login:** usuario `king`, contraseña `votapan` (administrador).
- El backend se reinició con `MEGI_MODE=real MEGI_REAL_ASR=true`. Front en :5174.
- Para agregar más usuarios: editar `USERS` en `backend/app/routes/auth.py`.

---

# Iteración 3 — Identidad, expediente y referencia clínica

Fecha: 2026-06-30

- **Login + token de sesión firmado:** pantalla de login (`components/login.jsx`);
  usuarios en SQLite (`routes/users.py`, `auth.py`), `king/votapan` admin. **Token
  HMAC** (`security.py`) verificado en el backend; `require_user` en TODO lo
  clínico y `require_admin` en gestión de usuarios → el rol ya no se puede
  falsificar desde localStorage. Front: token en cada petición, **audio por
  fetch-blob** (el `<audio>` nativo no manda header), **401 → logout** automático.
- **Administración (usuarios):** alta/baja/listado solo admin (impuesto
  server-side); no se puede borrar el último admin ni auto-eliminarse.
- **Saludo y menú:** "Buenos días, {usuario}" (King); se quitaron Consulta/
  Revisión/Imprimir del menú (son etapas del flujo). Menú = Agenda · Pacientes ·
  Guías · Estadísticas · Administración (admin).
- **Pacientes (expediente):** directorio + historial por paciente con nota SOAP,
  **transcripción** y **audio** (reproductor minimalista, blob autenticado;
  audio/transcripción solo admin). `GET /patients/{id}/consultations`.
- **Estadísticas:** pacientes/consultas/notas/aprobadas + por estado (`/stats`).
- **Guías clínicas:** biblioteca navegable de **526 GPC** (el backend lee el índice
  RAG, sin tocar el MLX) + búsqueda en texto; **chat RAG "Preguntar a Megi-LLM"**
  (`/v1/guidelines/chat`, reusa gemma + recuperador, responde citando fuentes).
- **Auditoría por consulta:** ventana dedicada (pestaña `/?audit=<id>`) con nota IA
  vs nota del médico (qué editó), receta, dx, **quién aprobó/firmó + hora + sello**,
  validación, fuentes, línea de tiempo, audio y transcripción. Captura completa al
  aprobar: `approved_soap`, `prescription`, `dx_codes`, `approved_by/at`.
- **Creación diferida de consulta:** la consulta se crea al **iniciar la grabación**,
  no al abrir el paciente (evita borradores vacíos / estadísticas infladas).
- **Fix de títulos del índice RAG:** las portadas de las GRR dibujan el título en ~4
  capas superpuestas → títulos rotos ("Guí Guí Guí…"). `rag/fix_titles.py`
  de-duplica capas por solape y reescribe `chunks.jsonl` **sin re-embeber**
  (10 títulos corregidos).
- **Diseño/UX:** logo wordmark "megi ia" (Poppins 700) en splash/topbar/login;
  paleta + redondez "amigable" + títulos Poppins + acento salvia; reloj en vivo +
  saludo según la hora; imagen de fondo en login.

---

# Iteración 4 — Roadmap clínico (4 fases)

Fecha: 2026-06-30

- **Extracción que llena receta/perfil (⚠️ toca el extractor LLM):** los hechos
  clínicos ahora incluyen **`alergias`** y **`antecedentes_cronicos`** (además de
  `medicamentos`). En Revisión la **receta se prellena** con lo escuchado, y el
  **perfil** muestra alergias/crónicos escuchados para **validar (✓)** o **agregar (+)**.
- **Fase 1 · Documentos clínicos:** tabla `documents` + `POST /documents`;
  **Referencia/interconsulta, Orden de estudios, Incapacidad/certificado** como
  pestañas en Impresión (prellenadas, editables, **selladas** con hash + firmante,
  y auditables).
- **Fase 2 · Seguridad:** alerta determinista **receta × alergias × crónicos**
  (`/safety/rx-check`) que **bloquea** la aprobación ante alergia; **CIE-10 buscable**
  (`/cie10/search`, set curado de diagnósticos comunes de primer nivel).
- **Fase 3 · Continuidad:** **agendar seguimiento** desde la consulta (tabla
  `appointments`; panel en dashboard + expediente); **signos vitales estructurados**
  (prellenados de lo escuchado, guardados al aprobar) + **tendencia** entre visitas
  (`/patients/{id}/vitals`).
- **Fase 4 · Interoperabilidad:** **export FHIR** (`/consultations/{id}/fhir`,
  Bundle *document*); **enviar al paciente** por correo (`mailto:`) / WhatsApp
  (`wa.me`) + descarga del FHIR; contacto (email/teléfono) capturado al agendar.
  *Honesto:* los envíos abren el cliente del médico (sin servidor de envío); el
  FHIR es R4 aproximado, base para intercambio / NOM-024.

---

# Iteración 5 — Hardening del roadmap clínico

Fecha: 2026-06-30

Una revisión de código (smoke tests vía TestClient) detectó **6 bugs reales** —
todos confirmados contra el código y corregidos. **#1 y #2 cambian garantías
clínicas importantes** (bloqueo de alergia e integridad de la aprobación).

## Correcciones verificadas

- **Seguridad de receta:** el bloqueo receta × alergias ahora se valida
  **server-side** en `reviewApprove`; si hay blocker sin confirmación explícita,
  **no se aprueba** (409). El front además **falla cerrado**.
- **Flujo de aprobación:** si `reviewApprove` falla, la UI **permanece en revisión**
  y no pasa a impresión/sellado.
- **Alergias:** matching **normalizado por raíz** para plurales/variantes
  (`Penicilinas`, `Sulfas`).
- **Documentos/seguimientos:** validación de `patient_id`, `consultation_id` y
  `kind`; errores controlados **400/404** en vez de **500**.
- **FHIR:** `Composition` como **primera entrada** del Bundle *document* y
  `section.text.div` en **XHTML**.
- **Signos vitales:** temperatura normalizada a **`temp`** (y demás alias verbosos)
  → se exporta en tendencia/FHIR.

## Verificación

- `npm run build` (front) y `python -m compileall` (backend + ASR): OK.
- Smoke tests (TestClient + SQLite temporal):
  - `Penicilinas → Amoxicilina`: blocker.
  - `Sulfas → sulfametoxazol`: blocker.
  - aprobación sin confirmación: **rechazada (409)**.
  - fallo de aprobación: **no imprime**.
  - FHIR: primera entrada `Composition`, `div` XHTML.
  - temperatura: exportada como `vital-temp`.

## Tests automatizados (hecho)

Los smoke tests se convirtieron en una **suite versionada de pytest** que congela
las garantías clínicas críticas. Corre **sin el servicio MLX** (rápida, ~0.1 s).

```
cd backend
.venv/bin/python -m pip install -r requirements-dev.txt   # una vez
.venv/bin/python -m pytest -q
```

- `backend/requirements-dev.txt` (`pytest`, `httpx`) — solo para pruebas.
- `backend/tests/conftest.py`: aísla **antes** de importar la app (SQLite temporal
  vía `MEGI_DB`, `MEGI_REAL_ASR=false`, `MEGI_SECRET` fijo). Requiere el nuevo
  soporte de `MEGI_DB` en `config.py`.
- **26 tests** en verde:
  - `test_auth`: público vs token vs admin (401/403).
  - `test_safety_and_approve`: alerta receta×alergias (incl. plurales) y — lo
    crítico — el **backend recalcula y rechaza (409)** aunque el front mande
    `safety_alerts=[]`; `400/404` sin consulta; estados del paciente.
  - `test_documents_appointments`: `400/404` (kind/consulta/paciente).
  - `test_fhir_and_vitals`: `Composition` primero + `div` XHTML; `Observation`
    `vital-temp`; tendencia de vitales.
  - `test_clinical_facts`: unit puro de `clinical.py` (alergias objeto→string,
    alias `temperatura→temp`) — caza el crash de normalización sin FastAPI.
### Frontend (Vitest + React Testing Library) — hecho

Suite de front que congela el fix del **crash de render**. `jsdom`, sin backend.

```
cd frontend
npm install            # instala vitest/jsdom/testing-library (devDeps)
npm test               # vitest run
```

- Config en `vite.config.js` (bloque `test:` con `environment: "jsdom"`) +
  `src/test/setup.js` (jest-dom). Script `"test"` en `package.json`.
- `ErrorBoundary` se extrajo a `src/components/error_boundary.jsx` (reutilizable
  y testeable).
- **3 tests** en verde:
  - `revision.test.jsx`: **"Revisión NO truena con alergias como objeto"** (el bug
    real: `alergias:[{alergeno:"Penicilina"}]` → antes crasheaba; ahora coacciona y
    muestra "Penicilina"); y que la **receta se prellena** con lo escuchado.
  - `error_boundary.test.jsx`: un hijo que lanza → muestra el fallback
    ("Algo salió mal") en vez de dejar la app en blanco.

## Detalle de cada corrección (Antes / Por qué / Ahora)

## ⚠️ #1 — El gate de alergia no era realmente bloqueante (Alta)

- **Antes:** el bloqueo vivía SOLO en el frontend, y *fallaba abierto*: si
  `/safety/rx-check` fallaba, `revision.jsx` hacía `setSafetyAlerts([])` → sin
  alertas → se podía aprobar. El backend (`/review/approve`) **no recalculaba**
  seguridad → un POST directo con `safety_ack:false` + receta peligrosa daba 200.
- **Por qué:** un gate clínico no puede depender de la UI; debe imponerse en el servidor.
- **Ahora:**
  - La lógica de alertas se extrajo a `compute_alerts()` en `routes/safety.py`
    (la usa el endpoint **y** el approve).
  - `routes/review.py` **recalcula** las alertas al aprobar y **rechaza con 409**
    si hay `blocker` sin `safety_ack:true`. (El front ahora manda `allergies`/`chronic`.)
  - El frontend **falla cerrado**: si el chequeo falla → estado "no verificado" →
    `safetyOk=false` → no se puede aprobar hasta reintentar.
  - **Verificado:** sin ack → 409, con ack → 200.

## ⚠️ #2 — Aprobación fallida igual pasaba a imprimir (Alta)

- **Antes:** `approveAndPrint` capturaba el error de `reviewApprove` con solo
  `console.warn` y **luego corría `onApprove`** → imprimía/sellaba una consulta
  no aprobada (o con contenido distinto al sellado).
- **Ahora:** si `reviewApprove` lanza, se muestra el error y **se hace `return`**
  (no se navega a impresión). Se reordenó: aprobar es el paso crítico; el perfil
  (alergias/crónicos) queda best-effort *después* de aprobar.

## #3 — Falsos negativos en alergias por plurales/sinónimos (Media/Alta)

- **Antes:** `ALLERGY_RULES.get(al_n)` usaba **clave exacta**; "Penicilina**s**" y
  "Sulfa**s**" no matcheaban → 0 blockers.
- **Ahora:** `_allergy_patterns()` matchea por **raíz/subcadena** (la clave es
  subcadena de la alergia o viceversa) + stem del término. **Verificado:**
  Penicilinas→Amoxicilina y Sulfas→sulfametoxazol ahora sí dan blocker.

## #4 — Citas/documentos aceptaban datos inconsistentes (Media)

- **Antes:** `/appointments` aceptaba `patient_id` inexistente (sin REFERENCES);
  `/documents` aceptaba `kind` arbitrario y, con consulta inexistente, reventaba
  como **500 IntegrityError** (FK + `PRAGMA foreign_keys=ON`).
- **Ahora:** citas validan paciente (**404**); documentos validan consulta (**404**)
  y `kind` contra allowlist `{referencia, orden_estudios, incapacidad}` (**400**).

## #5 — El export FHIR no era Bundle *document* válido (Media)

- **Antes:** la 1ª entrada era `Patient` (FHIR exige `Composition` primero) y
  `section.text.div` era texto plano.
- **Ahora:** `Composition` es la **primera entrada** y `div` va en **XHTML**
  (`<div xmlns="http://www.w3.org/1999/xhtml">…</div>`, con escape).

## #6 — La temperatura (y otros vitales) se perdían por desajuste de clave (Media)

- **Antes:** el extractor guardaba `vitals["temperatura"]` pero la UI/FHIR esperan
  `temp` → se perdía. (El LLM además usa claves verbosas: `presion_arterial`,
  `saturacion_oxigeno`.)
- **Ahora:** `clinical.py` usa `temp`, y `normalize_facts` **normaliza alias** de
  signos vitales a las claves cortas (ta, fc, fr, temp, spo2, peso, talla, imc).
  **Verificado:** transcript con temperatura → `signos_vitales` con `temp` y
  además `ta/fc/spo2` desde las claves verbosas del LLM.

> Nota: requirió reiniciar backend y servicio ASR/MLX (cambió `clinical.py`).
> Pendiente menor del revisor: `pytest` no está instalado en el venv (se usó
> TestClient en SQLite temporal para los smoke tests).

# Iteración 6 — Seguridad de plataforma (P0/P1, prerrequisito de voz)

Cierre de dos de los tres pendientes de `futuro/seguridad_autenticacion_pendiente.md`
(el prerrequisito del roadmap agéntico por voz). Decisiones acordadas con el usuario:
secreto **exigido** en modo real; WebSocket ASR por **proxy del backend**.

## P0 — `MEGI_SECRET` exigido en modo real  ⚠️ (toca arranque/seguridad)

- **Antes:** `security.py` usaba un secreto HMAC default (`megi-dev-secret-change-me`)
  si no se definía `MEGI_SECRET`. Cualquiera que viera el código podía **firmar un
  token con rol admin** y saltarse `require_user`/`require_admin`.
- **Por qué:** un secreto conocido anula la protección server-side de tokens.
- **Ahora:** `resolve_secret(env, file, mode)` **lanza `RuntimeError` y el backend no
  arranca** en modo real si el secreto falta o es el default. Se genera uno por
  instalación con `python -m app.gen_secret` → `data/megi_secret.key` (permisos `600`,
  no versionado). `local_mock` tolera el default para no estorbar en desarrollo.
  Rotación: `--force`. Prueba: `tests/test_security_secret.py`.

## P1 — WebSocket ASR autenticado por proxy del backend  ⚠️ (toca ruta de streaming)

- **Antes:** el navegador abría el streaming **directo** a `ws://localhost:8010/v1/stream/general`,
  que **acepta sin token**. Único hueco de auth que quedaba tras tokenizar el REST:
  audio clínico entraba al ASR sin pasar por el backend.
- **Por qué:** toda conexión debe pasar por autenticación; el ASR debe quedar aislado.
- **Ahora:** nuevo proxy `routes/asr_proxy.py` en `ws://localhost:8000/api/asr/stream/general?token=…`.
  El backend **valida el token antes de `accept()`** (cierra `1008`/403 si falta o es
  inválido) y reenvía bidireccional al ASR en `127.0.0.1:8010`. El frontend usa
  `asrStreamUrl()` (token de sesión en query, porque `new WebSocket()` no admite
  cabeceras). **Verificado:** sin token → 403; con token → conecta y el `session_started`
  del ASR llega proxyeado.

> Requirió reiniciar backend (nueva ruta + enforcement de secreto) y Vite (nuevo `.env`
> apuntando al proxy). Tests: 33 backend + 3 frontend en verde.

## P2 — primer arranque seguro (sin credenciales fijas)  ⚠️ (toca auth/usuarios)

- **Antes:** `seed_users()` sembraba un admin fijo `king/votapan`. Cualquiera que
  conociera esa credencial (está/estaba en el código) entraba como administrador.
- **Por qué:** una credencial de fábrica conocida es un backdoor operativo.
- **Ahora:**
  - Se **eliminó el seed fijo**. `GET /api/auth/setup-status` indica si falta el primer
    admin; `POST /api/auth/setup` lo crea **solo en primer arranque** (si ya hay admin →
    `409`, no es backdoor). El frontend muestra la pantalla `Setup` en vez de `Login`.
  - Los usuarios creados por un admin nacen con `must_change_password=1`; el frontend
    **fuerza** `ChangePassword` en su primer login. `POST /api/auth/change-password`
    valida la contraseña actual, exige ≥6 caracteres y distinta de la anterior.
  - Botón **"Contraseña"** en el topbar para cambio voluntario.
  - Recuperación local: `python -m app.create_admin <usuario> [nombre]` (crea o
    restablece; pide la clave por `getpass`).
  - Migración idempotente: columna `users.must_change_password`.
  - **Instalaciones existentes:** conservan su `king` (es la cuenta real del usuario);
    puede cambiar la contraseña con el botón "Contraseña" o el CLI.
  - Tests: `tests/test_setup_p2.py` (setup 409, forzado, cambio válido/inválido, auth).
    Fixtures ahora bootstrapean el admin con `/auth/setup`.

## Estado del prerrequisito de voz

Los **tres** pendientes de `futuro/seguridad_autenticacion_pendiente.md` (P0 secreto,
P1 WebSocket, P2 primer arranque) quedan **cerrados**. Documentado también en `README.md`
(sección "Seguridad y primer arranque"). Menores opcionales de P1: validar `Origin` y
auditar inicio/cierre de streaming.

Tests totales tras la iteración: **38 backend + 3 frontend** en verde; `vite build` OK.

# Iteración 7 — MEGI Voz · Fase 1 (UI mock, sin ejecución real)

Prototipo de "Consulta asistida por voz" (roadmap de `futuro/habilidades_agenticas_por_voz.md`).
**No toca** SOAP/dx/receta reales ni el ASR: es una vista aislada y etiquetada que valida la UX.
Decisión de producto acordada: palabra de activación **"MEGI" obligatoria** (sin push-to-command).

## Qué entra

- **Vista MEGI Voz** (nuevo ítem de nav): 
  - **Selector de modo**: Consulta automática (flujo actual) / Consulta asistida por voz.
  - **Panel MEGI Voz** persistente: modo, activación requerida, estado de escucha
    (escuchando consulta / esperando comando / esperando confirmación), último comando,
    intención + nivel de riesgo, "MEGI dice".
  - **Simulador de comandos**: caja de texto + chips con los ejemplos del documento.
  - **Modal de propuesta** para acciones sensibles: campo, valor actual (tachado) vs
    propuesto, prompt de confirmación e indicador de "esperando confirmación por voz";
    **Confirmar / Cancelar** por botón. Las acciones de baja sensibilidad se aplican
    directo (simuladas).
  - **Auditoría simulada** (comando → intención → estado) y manejo de ambigüedad /
    rechazo cuando falta "MEGI".
- **Clasificador mock** determinista `src/lib/voice_mock.js` (sin ASR/LLM): navegación,
  pacientes, grabación, SOAP, diagnósticos, receta y documentos, con `entities`,
  `risk_level`, `requires_confirmation` y `proposal` siguiendo los contratos del documento.
  `applyProposal()` muta un **contexto de ejemplo** (no un paciente real) para que el efecto
  sea visible.

## Por qué así

- La separación audio-clínico / comando aún no existe (es Fase 2+); por eso Fase 1 es
  **solo UI**: cero riesgo, valida el flujo propuesta→confirmación antes de darle poder real.
- Se mantiene el principio del roadmap: **nada se aplica sin confirmación** y **nada** de esto
  modifica datos clínicos reales.

## Archivos

- Nuevos: `frontend/src/components/megi_voz.jsx`, `frontend/src/lib/voice_mock.js`,
  `frontend/src/test/voice_mock.test.jsx`.
- Modificados: `frontend/src/App.jsx` (vista `voz`), `frontend/src/components/shared.jsx`
  (ítem de nav "MEGI Voz").

## Verificación

- Frontend: **10 pruebas** en verde (incluye 7 nuevas de `voice_mock`); `vite build` OK.
- Sin cambios de backend (Fase 1 es puramente cliente).

## Siguiente (fuera de Fase 1)

Fase 2 = router local real de comandos (navegar, abrir paciente, guardar borrador) — ya
requiere decidir la separación comando/clínico y engancharse a acciones reales de la app.
Preguntas abiertas del documento que siguen pendientes: identificación del hablante y
latencia aceptable de comandos.

# Iteración 8 — MEGI Voz · Fase 2 (router real de comandos de baja sensibilidad)

Segundo paso del roadmap de voz: los comandos de **baja sensibilidad se ejecutan de verdad**
en la app; los sensibles siguen como propuesta (no se aplican). Sigue **sin** reconocimiento
de voz en la nube (privacidad clínica): la entrada es escrita; el ASR on-device se integra
después. Palabra "MEGI" obligatoria.

## Qué entra

- **Barra de comandos global** `components/voice_bar.jsx`: lanzador 🎙 flotante disponible en
  toda la app (junto al de preferencias). Escribes "MEGI, …" y:
  - **Navegación real**: agenda, pacientes, guías, estadísticas, MEGI Voz, impresión y
    revisión (estas dos con guarda de "consulta activa"); "volver" usa la vista anterior.
  - **Pacientes reales**: "abrir paciente X" enfoca su **expediente** (nueva prop
    `focusPatient` en `pacientes.jsx`); "iniciar consulta de X" **arranca la consulta**.
    Resolución por nombre contra la lista real con **desambiguación** (botones) si hay varios.
  - **Barrera de seguridad**: acciones sensibles (SOAP/dx/receta, aprobar, imprimir, detener)
    NO se ejecutan; se muestran como propuesta con nota de fase posterior.
- **Router puro** `lib/voice_router.js` (`routeCommand`, `resolvePatients`): traduce intención
  → acción real vía callbacks inyectados; allow-list estricta de baja sensibilidad.
- **Clasificador endurecido** (`lib/voice_mock.js`): tolera contexto vacío (el bar no tiene
  SOAP real); navegación ampliada (pacientes/guías/estadísticas/MEGI Voz); separa
  "abrir paciente" (expediente) de "iniciar consulta de" (consulta).
- `App.jsx` expone `voiceActions` (setView, openExpediente, startConsulta, goBack,
  hasActiveConsult, goRevision) + rastrea la vista previa para "volver".

## Por qué así

- Solo baja sensibilidad ejecuta: navegar/abrir no puede dañar datos clínicos. Todo lo que
  toca la nota/dx/receta exige el flujo propuesta→confirmación (Fase 3/4), aún no cableado.
- Entrada escrita (no micrófono en la nube): un scribe clínico no debe mandar audio a un
  tercero; el reconocimiento de comandos por voz reusará el ASR local más adelante.

## Verificación

- Frontend: **19 pruebas** en verde (8 nuevas de `voice_router`, incluida desambiguación,
  rechazo sin "MEGI" y no-ejecución de sensibles); `vite build` OK; HMR limpio.
- Sin cambios de backend.

## Siguiente

Fase 3 = edición de SOAP por voz **con ejecución real** (propuesta → confirmar → aplicar sobre
la nota real). Ahí entra el motor de propuesta/confirmación real y la auditoría por usuario.
Preguntas abiertas que siguen: identificación del hablante y voz on-device para comandos.

# Iteración 9 — MEGI Voz · Fase 3 (editar el SOAP por voz, con aplicación real)

Primer paso que MODIFICA contenido clínico real: edición de la nota SOAP por voz dentro de
**Revisión**, SIEMPRE con propuesta → confirmación. Nada se aplica sin que el médico confirme.
Sigue con entrada escrita (el ASR on-device de comandos entra después).

## Qué entra

- **Editor de nota por voz** `components/soap_voice.jsx`, montado en `revision.jsx` dentro de la
  tarjeta "Nota SOAP · editable". Comandos:
  - "MEGI, agrega a plan: …" → **anexa** a la sección.
  - "MEGI, reemplaza el plan con …" → **reemplaza** la sección.
  - "MEGI, elimina la última frase del análisis" → **borra** la última frase.
  - Muestra **propuesta** (valor actual tachado → propuesto); **Confirmar y aplicar** / Cancelar.
  - Al confirmar, aplica sobre el `soap {S,O,A,P}` real de Revisión (`setSoap`), que se
    aprueba/firma con el flujo existente. Log local de ediciones por voz aplicadas.
  - Declina Dx/receta (Fase 4) y navegación (usar la barra 🎙 global).
- **Preservación de acentos/mayúsculas** del texto dictado: el clasificador captura el dictado
  del texto ORIGINAL (no del normalizado), para que la nota clínica no pierda "días",
  "valoración", nombres propios, etc.
- Mapeo de secciones: subjetivo↔S, objetivo↔O, análisis↔A, plan↔P.

## Por qué así

- Es la primera vez que la voz toca la nota: se restringe a Revisión (hay SOAP editable y
  consulta), exige confirmación explícita y reusa el flujo de aprobación/firma ya auditado.
- La misma orden que en la barra global se "propone y no aplica", en Revisión sí se aplica:
  es donde tiene sentido editar la nota.

## Verificación

- Frontend: **22 pruebas** en verde (add/replace/delete SOAP + preservación de acentos +
  round-trip S/O/A/P); `vite build` OK; HMR limpio. Sin cambios de backend.

## Siguiente

Fase 4 = diagnósticos y receta por voz con validadores de seguridad antes de aplicar y
**auditoría completa** por usuario (persistente). La confirmación por voz real y la
identificación del hablante siguen como preguntas abiertas del documento.

# Iteración 10 — MEGI Voz · Fase 4 (diagnósticos y receta por voz, con seguridad y auditoría)

Cierra la parte clínica del roadmap de voz: editar **diagnósticos (CIE-10)** y **receta** por
voz, con **validador de seguridad** antes de aplicar y **auditoría persistente por usuario**.
Siempre propuesta → confirmación; nada se aplica solo. Entrada escrita (ASR on-device después).

## Qué entra

- El editor de voz de Revisión pasó de "SOAP" a **clínico completo** (`soap_voice.jsx` →
  `clinical_voice.jsx`): además de la nota, ahora maneja:
  - **Diagnósticos:** "MEGI, cambiar diagnóstico principal a I10", "agrega diagnóstico E78.5",
    "quitar diagnóstico I20.9". Resuelve la descripción CIE-10 vía `/cie10/search` y aplica
    sobre el `dxList` real (respetando `primary`).
  - **Receta:** "MEGI, agrega losartán 50 mg cada 24 horas", "elimina aspirina". `parseMed`
    separa fármaco/dosis/frecuencia (preservando acentos) y aplica sobre el `rxList` real.
  - **Validador de seguridad:** al proponer un medicamento corre `/safety/rx-check`
    (receta × alergias). Un **blocker (alergia)** deshabilita "Confirmar y aplicar" y muestra
    la alerta ⛔; los warnings (crónicos) se muestran y permiten confirmar.
- **Auditoría persistente por usuario:** nuevo `POST /api/review/event` que registra cada
  cambio por voz en `review_events` (actor = usuario autenticado) y aparece en la línea de
  tiempo de **Auditar**. Kinds: `voice_soap` / `voice_dx` / `voice_rx`.

## Por qué así

- Es la primera vez que la voz toca diagnóstico y medicación: se exige confirmación, se
  valida contra alergias (bloqueo real) y **todo queda auditado con nombre y hora**.
- Reusa la infraestructura ya probada (`compute_alerts`/`/safety/rx-check`, `log_review_event`,
  el audit de la consulta), sin inventar caminos nuevos.

## Verificación

- Backend: **42 pruebas** en verde (4 nuevas de `review/event`: persiste + aparece en audit,
  exige token, 404 consulta inexistente, sanea el kind). Round-trip en vivo: evento `voice_dx`
  → auditado con actor "King"; `rx-check` con alergia → `blocker`.
- Frontend: **24 pruebas** en verde (parseMed + preservación de acentos del fármaco);
  `vite build` OK.

## Estado del roadmap de voz

Fases 1–4 **hechas**. Queda **Fase 5** (modo experto sin palabra de activación) — y las
preguntas abiertas del documento: identificación del hablante y reconocimiento de comandos por
voz **on-device** (hoy la entrada es escrita por privacidad clínica).

# Iteración 11 — MEGI Voz · Fase 5 (modo experto sin palabra de activación)

Cierra el roadmap de voz. Preferencia OPCIONAL (por defecto OFF = seguro) que desactiva la
palabra "MEGI", con salvaguardas: indicador permanente, confirmaciones reforzadas, métricas y
vuelta rápida a modo seguro.

## Qué entra

- **Preferencia "modo experto"** `lib/voice_prefs.js`: persistente y reactiva (evento propio),
  compartida entre la barra global 🎙 y el editor de Revisión. Toggle desde el panel de la barra.
- **Clasificador** `classifyCommand(raw, ctx, { requireWake })` + flag `rejected`: por defecto
  exige "MEGI" (sin cambios); en modo experto procesa comandos sin activación. El router y los
  editores deciden por `rejected`, no por la presencia de "MEGI".
- **Salvaguardas (doc "reforzar confirmaciones"):**
  - Indicador visible permanente: anillo/punto rojo en el lanzador 🎙 + banner en panel y en el
    editor clínico de Revisión.
  - Confirmación reforzada de 2 pasos para acciones clínicas (SOAP/dx/receta) en modo experto.
  - Métricas de falsos positivos: comandos aceptados sin "MEGI" y no reconocidos.
  - Botón "Volver a modo seguro".

## Por qué así

- El modo sin activación es el más riesgoso (el paciente podría disparar comandos), por eso es
  opt-in explícito, siempre señalizado, y endurece —no relaja— las confirmaciones clínicas.

## Verificación

- Frontend: **27 pruebas** en verde (3 nuevas: default exige "MEGI"; experto ejecuta sin "MEGI";
  las acciones sensibles siguen exigiendo propuesta en experto); `vite build` OK; HMR limpio.
- Sin cambios de backend.

## Estado del roadmap de voz — COMPLETO

Fases 1–5 hechas (UI mock → router real → SOAP por voz → dx/receta con seguridad y auditoría →
modo experto). Quedan solo las **preguntas abiertas** del documento (no fases): identificación
del hablante y reconocimiento de comandos por voz **on-device** (hoy la entrada es escrita por
privacidad clínica; el ASR local de comandos sería el siguiente gran trabajo).

# Validación 2026-07-01 — hardening de MEGI Voz Fases 1–5

Revisión posterior del roadmap `futuro/habilidades_agenticas_por_voz.md` contra la
implementación real. Se detectaron y corrigieron 3 bordes de Fase 4:

- **Receta por voz falla cerrado:** si `/safety/rx-check` no responde, el medicamento ya no se
  puede aplicar por voz; queda bloqueado hasta reintentar la validación.
- **Auditoría obligatoria:** un cambio clínico por voz ya no se aplica si `POST /review/event`
  falla o no hay `consultation_id`; esto alinea el código con "todo cambio aplicado por voz
  debe quedar registrado".
- **Diagnóstico principal consistente:** cambiar el principal a un CIE-10 que ya existía ya no
  duplica el diagnóstico; quitar el principal promueve correctamente el siguiente.

Pruebas nuevas: `frontend/src/test/clinical_voice.test.jsx`.

Verificación ejecutada:

- Frontend: **30 pruebas** en verde + `npm run build` OK.
- Backend: **42 pruebas** en verde.
- Tests raíz: **8 pruebas** en verde.
- `python3 -m compileall` OK con `PYTHONPYCACHEPREFIX=/tmp/megi_pycache`.

# Iteración 12 — MEGI Voz · Fase 6 (motor empresarial + ASR local de comandos)

Implementación del siguiente paso tras Fases 1–5: convertir los comandos en una plataforma
gobernable y conectar entrada hablada real sin usar servicios externos del navegador.

## Qué entra

- **Registro empresarial de comandos** `frontend/src/lib/voice_command_registry.js`:
  cada comando declara `action`, `intent`, `risk`, `contexts`, `permission`,
  `confirmation` y `auditKind`. Esto evita que el crecimiento enterprise dependa de regex
  dispersos.
- **Política por contexto/rol/institución:**
  - La barra global puede ejecutar bajo riesgo y mostrar propuestas sensibles.
  - El editor clínico solo puede proponer/aplicar SOAP/CIE-10/receta en `revision`.
  - `permissionsForRole()` cubre `admin`/`medico`; `disabledActions` permite apagar comandos
    por instalación.
- **Push-to-command local:** botón **Dictar** en la barra 🎙. Graba audio corto con
  `MediaRecorder`, lo manda al backend y reinyecta el transcript al mismo router.
- **Backend nuevo:** `POST /api/voice/command/transcribe` (`routes/voice.py`), protegido por
  token. Usa el ASR local (`MEGI_REAL_ASR=true`) y guarda trazabilidad en `audio` con
  `audio_kind="voice_command"`. Si `MEGI_REAL_ASR=false`, devuelve **503** y no simula voz real.
- **Compatibilidad:** la entrada escrita sigue funcionando como fallback; modo experto sigue
  opt-in y las acciones clínicas conservan confirmación reforzada.

## Qué NO resuelve todavía

- Identificación del hablante: sigue abierta; por eso la entrada hablada real es por botón
  explícito, no escucha continua.
- Firma/impresión/envío legal por voz: siguen bloqueados por política.

## Verificación

- Frontend: **35 pruebas** en verde (`voice_command_registry` nuevo + suites existentes).
- Backend: **44 pruebas** en verde (`test_voice_command` nuevo).
- `python3 -m compileall` OK con `PYTHONPYCACHEPREFIX=/tmp/megi_pycache`.

# Iteración 13 — Selector de versión después del login

El usuario ya no entra directo a la app clínica tras autenticarse. Primero elige qué versión
quiere usar en esa sesión:

- **Consulta automática:** flujo clínico normal, sin barra global de comandos ni menú MEGI Voz.
- **Consulta asistida por voz:** habilita la barra de comandos, botón Dictar, MEGI Voz y el
  editor clínico por voz en Revisión.

Implementación:

- Nuevo catálogo `frontend/src/lib/app_versions.js`.
- Nueva pantalla `frontend/src/components/version_select.jsx`.
- `App.jsx` guarda `app_version` dentro de `localStorage("megi.session")`; si no existe, monta
  el selector antes de `MegiDataProvider`.
- `Topbar` oculta **MEGI Voz** en la versión automática y muestra rol + versión activa.
- Cerrar sesión limpia la versión y la vista, así el siguiente login vuelve a elegir.

Verificación:

- Frontend: **38 pruebas** en verde (`version_select` nuevo).
