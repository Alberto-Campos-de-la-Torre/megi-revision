# Plan — Separación por médico (multi-tenencia)

> Bloqueante para el despliegue en servidor. Hasta que esto esté, **no debe
> entrar ningún paciente real de un médico que no sea el dueño del equipo**.

> ## Estado 2026-08-17 — IMPLEMENTADO (falta correrlo sobre los datos reales)
>
> **182 tests de backend en verde**, 19 de ellos del test de aislamiento
> (`tests/test_aislamiento_medicos.py`), que arrancó con **17 fallos**: la fuga
> era total, como se esperaba. Un médico ya no alcanza pacientes, consultas,
> audio, documentos, citas, SOAP, exportaciones ni estadísticas de otro, ni
> leyendo ni escribiendo; el admin tampoco.
>
> Piezas nuevas: `app/ownership.py` (guardas), `app/assign_owner.py` (migración),
> `patients.doctor_id` + índices, y las 11 rutas clínicas filtradas.
>
> **Hallazgo al probar la migración contra una copia del expediente real:**
> `consultations.doctor_id` **ya tenía datos, y no eran usuarios**. En las 689
> consultas importadas de notas del IMSS traía el código de consultorio/agregado
> médico (`1F19660R`, `5F1960PE`, `68 U.M.F. 51`). Dos consecuencias:
>
> 1. La decisión de anclar la pertenencia al **paciente** y no a
>    `consultations.doctor_id` resultó ser lo que salva el diseño: si el control
>    de acceso se hubiera apoyado en esa columna, habría sido un colador.
> 2. Ese dato **no se pisa**: se preserva en la columna nueva
>    `consultations.imss_consultorio`. Es información clínico-administrativa
>    real, solo estaba en la columna equivocada. Las estadísticas se agregan
>    uniéndose a `patients`, que es la fuente de verdad de la pertenencia.
>
> Migración verificada **dos veces sobre copias** (nunca sobre el original):
> 466 pacientes y 756 consultas quedan con dueño, 689 códigos preservados,
> `integrity_check` correcto.
>
> **Efecto colateral esperado:** seis tests de path traversal pasaron de esperar
> 422 a 404, porque la guarda de pertenencia responde antes que la validación de
> formato. El ataque se corta más temprano; para no perder cobertura se añadió
> una prueba directa de `uploads.safe_session_dir`.
>
> **Bloqueante encontrado que NO estaba en este plan — resuelto el mismo día:**
> la separación de *datos* no basta, faltaba la **identidad profesional**. El
> perfil que se imprime en recetas, referencias, órdenes e incapacidades —nombre,
> especialidad y **cédula profesional**— salía de `seed.json` y era único para
> toda la instalación (`Dra. Claudia Martínez Soto`, céd. 7.845.302). Con dos
> médicos, **cada receta que imprimiera uno llevaría la cédula del otro**: la
> receta es un documento legal y la cédula identifica a quien responde por ella.
> Ahora `users` guarda el perfil de cada médico, `/api/config` devuelve el del
> que ha iniciado sesión, hay pantalla **Mi perfil** en la topbar, y si falta la
> cédula se devuelve vacío con `complete: false` para que la UI avise — imprimir
> en blanco es malo, imprimir la cédula de otro es peor. `assign_owner` traslada
> el perfil del seed al médico al que se le asignan los pacientes.
>
> **Pendiente:** correr `assign_owner` sobre el expediente real (con
> `megi backup` antes) decidiendo a qué usuario se asignan los 466 pacientes, y
> el retoque del frontend (mínimo: la agenda ya muestra lo que devuelve el
> backend).

## Por qué

El nuevo objetivo es un **Mac Studio M2 Ultra sirviendo el sitio por internet**,
con varios médicos, **cada uno con su agenda** y **pacientes reales**.

Hoy no existe separación alguna. Verificado en el código:

- `patients` no tiene columna de dueño; `list_patients()` hace
  `SELECT * FROM patients ORDER BY …` **sin filtro**.
- `consultations.doctor_id` existe en el esquema pero se inserta **siempre NULL**
  (`routes/consultations.py`, único sitio que lo escribe).
- Los campos que sí hay —`created_by`, `uploaded_by`, `approved_by`, `actor`—
  son de **auditoría**, no de autorización: registran quién hizo algo, no
  restringen quién puede verlo.

Con dos médicos en el mismo servidor, cada uno vería el expediente completo del
otro desde el primer día. Con pacientes reales eso es una filtración de datos
clínicos entre profesionales distintos, no un bug cosmético.

**Superficie a cubrir: 69 consultas a tablas clínicas en 11 archivos de rutas**
(`consultations` 17, `patients` 11, `live` 9, `stats` 6, `documents` 6,
`review` 5, `appointments` 5, `voice` 4, `export` 3, `audio` 2, `asr_proxy` 1).

## Decisiones de diseño

**El dueño es el médico, y el paciente es la raíz.** `patients.doctor_id` (el
`username`, que ya es PK de `users`). Todo lo demás —consultas, audio,
documentos, citas, exportaciones— cuelga del paciente y hereda su dueño. Así
solo hay **una** pregunta que responder en cada ruta: *¿este paciente es tuyo?*

**El admin NO ve datos clínicos.** Administra usuarios y catálogos; no entra a
expedientes ajenos. Es lo correcto cuando el servidor aloja pacientes de médicos
independientes: que exista un rol capaz de leerlo todo es exactamente el riesgo
que estamos cerrando. Si algún día hace falta soporte sobre un expediente, se
añade un acceso explícito, temporal y **auditado**, no un permiso permanente.

**Lo que NO se separa**, y conviene decirlo para que nadie lo "arregle" por error:
el catálogo de medicamentos e interacciones (Cuadro Básico, conocimiento clínico
compartido, aprobado por admin), CIE-10, y el índice RAG de guías. Son globales.

**404, no 403.** Pedir un paciente ajeno responde *no encontrado*, no *prohibido*:
un 403 confirma que ese id existe y filtra información por sí mismo.

## Implementación

### A. Esquema y migración

- `patients`: nueva columna `doctor_id TEXT` (migración idempotente en `db.py`,
  igual que `_PATIENT_EXTRA_COLUMNS`).
- `consultations.doctor_id`: empezar a **poblarlo** al crear la consulta con el
  usuario autenticado (hoy va NULL).
- Índices por `doctor_id` en `patients` y `consultations`.
- **Backfill de los 466 pacientes existentes**: se asignan a un dueño explícito
  vía `python -m app.assign_owner <username>`. Nunca en silencio y nunca
  repartidos por heurística — hoy no hay dato fiable de quién atendió a quién.

### B. Guardas centralizadas

Un módulo `app/ownership.py` con lo mínimo, para no repetir el filtro en 69
sitios (que es exactamente como se escapa uno):

```python
def owned_patient(conn, patient_id, user) -> dict   # 404 si no es suyo
def owned_consultation(conn, consultation_id, user) -> dict
def scope(sql, user) -> tuple[str, list]            # añade WHERE doctor_id = ?
```

Las rutas que hoy **no reciben** el usuario (`patients`, `consultations`,
`stats`, `export`) pasan a llevar `user: dict = Depends(require_user)`; las que
ya lo reciben solo añaden la guarda.

### C. Rutas, por orden de riesgo

1. `patients.py` — listar/leer/editar perfil: filtrar por dueño.
2. `consultations.py` — incluido `GET /consultations/{id}/audio.wav`, que hoy
   sirve audio de cualquier consulta a cualquier usuario autenticado.
3. `audio.py` — `GET /audio/{audio_id}` comprueba el dueño de su consulta.
4. `live.py`, `review.py`, `documents.py`, `export.py`, `appointments.py`.
5. `stats.py` — cada médico ve **sus** números.
6. `asr_proxy.py` — el ticket ya lleva usuario; validar que la consulta es suya.

### D. Frontend

Cambio mínimo: la agenda ya muestra lo que devuelve el backend, así que al
filtrar en el servidor se separa sola. Sí hay que quitar de la UI de
administración cualquier atajo a datos clínicos, y dejar claro de quién es la
agenda que se está viendo.

## Verificación (criterio de aceptación)

**Un test de aislamiento exhaustivo**, en la línea del test de contrato del ASR:
crea dos médicos con un paciente y una consulta cada uno, y **recorre todas las
rutas clínicas** comprobando que A no alcanza nada de B — ni listados, ni por id,
ni audio, ni documentos, ni estadísticas, ni exportaciones. Debe fallar en cuanto
alguien añada una ruta sin filtrar; esa es su razón de existir.

Además:

- Migración: tras el backfill, los 466 pacientes tienen dueño y siguen visibles
  para él (`megi backup` antes, obviamente).
- Que el admin **no** pueda leer expedientes.
- Las suites actuales (162 backend / 83 frontend / 9 ASR) siguen en verde.

## Lo que esto NO resuelve

Sigue haciendo falta, antes de abrir a internet con pacientes reales: **TLS**
(hoy todo va en HTTP plano), decidir la exposición (recomendado: túnel tipo
Cloudflare/Tailscale antes que abrir el puerto), respaldo automático —un solo
equipo sostendría los expedientes de varios consultorios— y revisar duración de
sesiones y visibilidad de accesos. Ver §5 del roadmap.
