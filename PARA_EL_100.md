# Qué falta para el 100 · iteraciones del proyecto

Actualizado: **7 nov 2026**. Calificación independiente vigente: **91/100** (dictamen de reverificación UX, `evidencia/resultados/ux-2026-11-07/reverificacion/dictamen.json`), frente a 88/100 tras I1–I6, 84/100 antes de H1–H3 y 77/100 en el plan inicial. Es una evaluación del proyecto para el hackatón; la nota oficial corresponde al jurado. Completar este plan no garantiza una puntuación concreta.

| Criterio | Nota actual | Puntos hasta el máximo | Qué lo cerraría (según el dictamen) |
|---|---|---|---|
| Utilidad y ejecución | 38/40 | 2 | Sesiones con médicos y cuentas individuales en la instalación destino (detenido por decisión de David) |
| Creatividad y diseño | 17/20 | 3 | Fricción corregida y comprobada (hecho el 7 nov) + observación de usuarios nuevos (pendiente de participantes) |
| Innovación | 17/20 | 3 | Valor diferencial con resultados comparables (hecho el 7 nov, sin afirmar reducción de errores) |
| Uso de Agent-Native | 19/20 | 1 | Demo del código final con continuidad UI–agente (hecha el 7 nov); puntuación final subjetiva del jurado |
| **Total** | **91/100** | 9 | Lo que queda depende de médicos reales y de la entrega |

Alcance de esta actualización: dejar las iteraciones listas para ejecutar. **No autoriza publicación, despliegue, GitHub, Clips, envío del formulario o commits.** La publicación y el envío siguen detenidos según [ENVIO_HACKATHON.md](ENVIO_HACKATHON.md). Se conserva el histórico al final; sus instrucciones no son el plan vigente.

## Respuesta al dictamen de 91 · 7 nov 2026

El dictamen cerró UX1–UX3 y dejó cuatro frentes «para aspirar al 100». Dos se han trabajado hoy con evidencia reproducible; los otros dos siguen detenidos por decisión de David (sin participantes, sin cuentas reales, entrega parada). Detalle en [ESTADO.md](ESTADO.md).

| Frente | Qué pedía el dictamen | Qué hay ahora | Estado |
|---|---|---|---|
| Creatividad y diseño | Corregir fricción; comprobar teclado, zoom y estados de error/espera/vacío; cerrar hallazgos con capturas | `evidencia/friccion-ui.mjs` **40/40**: teclado de punta a punta (tarjetas, plan en blanco, formulario, bloqueo, pestañas con flechas, diálogo con foco atrapado y Escape, chat), zoom (texto 200 % y ventana 640 px) y estados interceptados (espera, MEGI caído, vacío, consulta inexistente, acción fallida). Seis fricciones corregidas y dos estados de recuperación nuevos del agente (ver ESTADO.md). Capturas en `evidencia/capturas-friccion/`. | **Hecho lo que no requiere usuarios.** Observar usuarios nuevos sigue en I4. |
| Innovación | Valor diferencial de selección, bloqueos, fuentes y conciliación con resultados comparables, sin afirmar reducción de errores | `evidencia/valor-diferencial.mts` **20/20** y [`evidencia/valor-diferencial.md`](evidencia/valor-diferencial.md): misma receta inicial en cuatro casos; la mesa hace visibles 3 alertas antes de aprobar, rechaza 12/12 intentos sobre líneas fijadas y 12/12 fuera de alcance sin escribir nada, detiene 2 aprobaciones por conciliación y 2 por bloqueo, enlaza 7/11 líneas con la nota o la medicación, y deja 26 versiones y 30 eventos; el chat sin mesa, 0 por construcción. | **Hecho.** Cuenta mecanismos, no errores clínicos. |
| Uso de Agent-Native | Demo del código final: continuidad UI–agente sobre el mismo registro, alcance y recuperación, respaldada por pruebas | `evidencia/continuidad.mjs` **18/18** con modelo real (un reintento documentado a través del aviso del tablero) y guion [`evidencia/demo-continuidad.md`](evidencia/demo-continuidad.md): propuesta desde el tablero, fijar y acotar desde la UI, reajuste dentro del alcance, rechazo atómico de un reajuste que toca la fijada, cancelación sin parcial, conciliación, exportación sellada. Respaldo: 195/195 de servidor, recorrido 33/33, advertencias 7/7, agente 15/15. | **Hecho.** La puntuación final es del jurado. |
| Utilidad y ejecución | Sesiones con médicos (manual frente a agente) y cuentas individuales en la instalación destino | Protocolo y comparación estructural listos ([`PENDIENTE_VALIDACION_USUARIOS.md`](PENDIENTE_VALIDACION_USUARIOS.md)); identidad por médico implementada contra el backend de evidencia (I2). | **Detenido por decisión de David (7 nov):** sin participantes ni cuentas reales. |
| Entrega | Clips, equipo, aceptación, formulario y recibo | — | **Detenido por decisión de David (7 nov).** |

## Cierre de las iteraciones · 7 nov 2026

Ejecutadas sobre la app con cambios sin commit sobre `b631b87` y el backend de evidencia (SQLite aislado, dos cuentas ficticias). Matriz con pruebas, hashes y límites: [`evidencia/resultados/iteraciones-i1-i6.json`](evidencia/resultados/iteraciones-i1-i6.json) (generada por `evidencia/cerrar-iteraciones.py`). Detalle en [ESTADO.md](ESTADO.md).

| Iteración | Estado | Qué lo acredita |
|---|---|---|
| I1 Revalidar HTTP | **Completado** | `verificar.mjs` 6/6 en cero (typecheck, doctor, build, auditoría `--http` 117/117, batería `--http` 33/33, trazable 45/45); recorrido de navegador en modo http 25/25 con fases A (cuenta compartida), B (conexión propia) y C (denegación 403 `sin_rol_clinico`, sin llamadas clínicas). |
| I2 Identidad por médico | **Mitigado (decisión de David, 7 nov): completo en el backend de evidencia; cuentas individuales reales pendientes del consultorio** | Conexión propia por médico en la superficie de secretos del framework; dos cuentas de MEGI con expedientes separados; MEGI firma `approved_by` con la identidad propia; rotación, revocación y almacén caído cubiertos. Falta que el consultorio dé de alta cuentas individuales; `MEGI_MEDICOS` sigue como respaldo (H2 mitigado para quien no conecta). |
| I3 Coste acotado | **Completado** | Endpoints paginados en MEGI y adaptador que los consume; comparación anterior/posterior con 10, 100 y 500 pacientes y expediente de 60 recetas; regresiones con el límite de peticiones por página. |
| I4 Usuarios | **Pendiente (sin participantes; decisión de David, 7 nov)** | Marcado en [`PENDIENTE_VALIDACION_USUARIOS.md`](PENDIENTE_VALIDACION_USUARIOS.md); protocolo, tareas y criterios en [`evidencia/protocolo-usuarios.md`](evidencia/protocolo-usuarios.md). Sin resultados: no se afirma ahorro. |
| I5 Interacción | **Completado según su aceptación; abierto lo que dependa de I4** | «Ninguna conocida» ya no va en rojo (registro en verde, distinto de «sin registro» en ámbar); lista paginada con total; 390 px sin desbordamiento y acción principal visible. Capturas antes/después en `evidencia/capturas-comparacion/` y evaluación visual en [`evidencia/evaluacion-visual-i5.md`](evidencia/evaluacion-visual-i5.md); smoke del agente 15/15. Sin observaciones de usuarios. |
| I6 Cierre | **Cierre local realizado; entrega detenida por decisión de David (7 nov)** | Resultados, capturas, matriz y hashes guardados; documentación actualizada. Publicación, Clips, formulario y commits siguen detenidos (H5). |


## Punto de partida verificado

- **Vigente tras el cierre (7 nov): 195/195 automatizadas** (auditoría `--http` 117/117, batería `--http` 33/33, revisión trazable 45/45) y recorrido http 25/25; typecheck, doctor y build en cero. Antes del cierre: 154/154 (81/81, 28/28 más dos mediciones, 45/45). Resultados: [auditoría](evidencia/auditoria-hackathon-resultados.json), [batería](pruebas-hackathon/bateria-resultados.json) y [revisión trazable](pruebas-hackathon/revision-trazable-resultados.json).
- **H1 corregido:** respuesta inválida del verificador → 502 `verificador_invalido`, sin escrituras; alerta sin atribución → aplicada a toda la receta propuesta. [Reproducción posterior](evidencia/resultados/auditoria-independiente-tras-correccion.json).
- **H2:** con I2, cada médico conecta su propia cuenta de MEGI y MEGI firma con su identidad; `MEGI_MEDICOS` queda como respaldo para la cuenta de servicio. Pendiente solo de cuentas individuales reales en el consultorio.
- **H3:** con I3, listar una página cuesta 2 peticiones y no descarga el expediente de todos los pacientes; el historial va por lotes paginados. Medido en `evidencia/resultados/coste-historial.json`.
- **Límite:** el backend de evidencia no es la instalación del consultorio; las cuentas de MEGI son ficticias. Sin participantes (I4) no hay evidencia de utilidad.
- App con cambios sin commit sobre `b631b87`. Registrar el diff y hashes al cerrar cada iteración; no atribuir el estado modificado únicamente a ese commit. [Estado detallado](ESTADO.md).

## Iteración I1 · Revalidar la integración HTTP actual — prioridad P0

**Estado: completado el 7 nov** (`node evidencia/backend.mjs` + `node evidencia/verificar.mjs` + `node evidencia/recorrido-http.mjs`; totales reales arriba). Objetivo: comprobar que las correcciones funcionan con el backend y no solo con transporte simulado.

1. Arrancar `node evidencia/backend.mjs` desde la raíz. Usa el SQLite de prueba en `evidencia/.runtime/backend/` y puerto 8123. No sembrar ni modificar la instalación del consultorio.
2. En otra terminal, ejecutar `node evidencia/verificar.mjs`: incluye typecheck, doctor, build, auditoría `--http`, batería `--http` y revisión trazable. El script apunta por defecto a `http://127.0.0.1:8123`.
3. Crear una instancia de UI de ensayo con base SQL nueva y `MEGI_MODE=http`, URL del backend de prueba y `MEGI_MEDICOS` con el correo de la sesión de ensayo. El comando `pnpm demo` fuerza mock y **no acredita** esta prueba HTTP.
4. Probar lectura, propuesta, conciliación, bloqueo, aprobación y recuperación de exportación contra los casos ficticios. Comprobar el correo del aprobador en la auditoría de MEGI y distinguirlo de `approved_by` de la cuenta de servicio.
5. Probar sin lista y con correo no autorizado: acceso a MEGI/decisiones médicas denegados, sin mutaciones ni llamadas clínicas remotas. Verificar el contrato de error que recibe la UI, no solo el rechazo del adaptador.

**Aceptación:** todos los comandos terminan en cero; el recorrido HTTP y sus rechazos están automatizados y pasan; JSON, logs y capturas identifican modo, URL, fecha y revisión exacta. Registrar los totales reales: las 81 pruebas locales actuales no incluyen las cinco comprobaciones adicionales de backend vivo. No reutilizar 57/57 como total vigente ni presentar pruebas de mock como integración HTTP.

## Iteración I2 · Identidad y autorización por médico — prioridad P1

**Estado: completado en el backend de evidencia el 7 nov; pendiente de cuentas individuales reales en el consultorio.** `MEGI_MEDICOS` es la mitigación actual, no sustituye la separación de credenciales y expedientes.

- Sustituir la instancia/cuenta HTTP global por una conexión resuelta por usuario y, cuando corresponda, organización. Reutilizar el mecanismo de credenciales del framework; conservar secretos en servidor y fuera de resultados y trazas.
- Aplicar la autorización de lectura y escritura a pacientes, consultas y planes; comprobar el acceso al padre al operar una línea. Definir qué ocurre al revocar el rol o la conexión, incluidas las lecturas locales de datos ya conservados.
- Hacer que la aprobación remota use la identidad individual del médico. Mantener también su identidad en la bitácora local; escribir el correo en una nota no equivale a que el backend lo autentique como firmante.
- Añadir regresiones con dos médicos y expedientes distintos: A no lee, edita, aprueba ni exporta los de B; revocación deniega acceso; reconexión y caducidad no mezclan sesiones. Agente/MCP/CLI siguen sin poder suplantar decisiones UI.

**Aceptación:** evidencia de extremo a extremo con dos cuentas de backend y prueba de firma atribuida al usuario correcto, además de denegaciones cruzadas. Si faltan cuentas o soporte del backend, registrar la dependencia y mantener H2 como mitigado; no marcarlo cerrado por la lista de correos.

Áreas: `megi-revision/server/lib/megi/index.ts`, `server/lib/megi/megi-http.ts`, `server/lib/plan.ts`, acciones clínicas y autorización del backend de `megi-demo/backend/app/`.

## Iteración I3 · Pendientes e historial con coste acotado — prioridad P1

**Estado: completado el 7 nov** (`GET /review/pending`, `POST /review/medication-history`, adaptador paginado con respaldo para backends anteriores, medición en `evidencia/coste-historial.mts`). Paralelizar reduce esperas, pero no elimina el recorrido completo ni reduce por sí solo el total de peticiones.

- Incorporar una lectura paginada de consultas pendientes, filtrada por médico en servidor, con los datos necesarios para pintar la lista. El adaptador debe consumirla sin recorrer todos los pacientes.
- Incorporar lectura de medicación/historial por lotes o paginada. Conservar fuente, pauta y estado; no limitar a las últimas cinco consultas ni omitir crónicos antiguos para abaratar la verificación.
- La verificación debe trabajar con el conjunto completo requerido. Página incompleta o backend caído: error explícito y sin aprobación, nunca un `ok` basado en un historial truncado.
- Mantener deduplicación limitada a una acción, frescura entre acciones, login único en vuelo y concurrencia acotada.
- Medir volumen de peticiones, tamaño de respuesta, tiempo y concurrencia con datos sintéticos de distinto tamaño (por ejemplo 10, 100 y 500 pacientes), más un caso con historial largo y un crónico antiguo relevante.

**Aceptación:** listar una página no descarga el expediente completo de todos los pacientes; la evidencia compara el coste anterior y posterior. No hay duplicados ni pérdidas al recorrer páginas; una medicación nueva entra en el siguiente cruce y exige conciliación. Cada regresión documenta el límite esperado de peticiones según página/lote, no una cifra universal sin relación con el contrato.

## Iteración I4 · Evidencia de utilidad con usuarios — prioridad P1

**Estado: pendiente; requiere participantes.** Protocolo listo en `evidencia/protocolo-usuarios.md`. Objetivo: medir utilidad y usabilidad. No es una validación clínica del catálogo ni de las recomendaciones.

- Preparar tareas equivalentes con pacientes ficticios para revisión manual y con agente: alergia, medicación sin conciliar, línea fijada e instrucción ambigua. Definir antes de medir qué cuenta como tarea completada correctamente.
- Realizar sesiones con médicos participantes; alternar el orden de modalidades para reducir el efecto de aprendizaje. Registrar número real de participantes, experiencia, tareas, orden y fallos; no inventar muestras o testimonios.
- Medir tiempo hasta plan visible, tiempo total hasta aprobación, correcciones manuales, tareas completadas y errores. Separar tiempo del servidor, API del modelo y trabajo del usuario.
- Guardar resultados agregados y observaciones de fricción, usando solo información autorizada de los participantes. Con pocos casos, presentar resultados descriptivos y exploratorios; conservar intentos fallidos.

**Aceptación:** protocolo reproducible, resultados completos con tamaño de muestra y limitaciones, y decisiones de producto ligadas a observaciones concretas. Si no hay participantes, dejar la iteración pendiente; cuatro pacientes sintéticos y una medición no prueban ahorro generalizable.

## Iteración I5 · Pulir la interacción visible — prioridad P2

**Estado: completado según su aceptación el 7 nov** (capturas antes/después, recorridos sin desbordamiento, smoke del agente, evaluación visual registrada); abierto solo lo que deba apoyarse en observaciones de I4. Usar lo observado en I4 cuando esté disponible; los ajustes evidentes de jerarquía pueden avanzar antes.

- Distinguir visualmente «Ninguna conocida», alergia registrada y falta de registro: no usar el mismo rojo de alerta para ausencia conocida de alergias. Mantener texto explícito y no depender solo del color.
- Revisar a 390 px la jerarquía de ficha, conciliación y acciones principales. La siguiente acción debe quedar identificable y accesible; comprobar también chat abierto, diálogos, teclado y mensajes de validación.
- Hacer visibles en el recorrido las aportaciones ya implementadas: motivo del agente, antes/después, alcance de selección y respeto de líneas fijadas. Mantener fuentes y detalles secundarios en desplegables, sin añadir pantallas ni controles redundantes.
- Conservar español, foco accesible y progreso derivado de eventos reales; no simular actividad o tiempos del modelo.

**Aceptación:** capturas comparables antes/después en escritorio y móvil, recorrido de edición/aprobación sin desbordamientos ni controles tapados, y smoke del agente que confirme sincronización, cancelación y respeto del bloqueo. La evaluación visual se registra además de las aserciones automatizadas.

## Iteración I6 · Cerrar evidencia y preparar entrega — prioridad P0 al congelar código

**Estado: cierre local realizado el 7 nov;** entrega (H5) detenida. Cierre local ejecutable tras las iteraciones; los pasos de publicación continúan detenidos.

- Repetir I1 y los recorridos de navegador/agente sobre la revisión final, en bases de ensayo. Restaurar únicamente los casos propios con las acciones previstas; conservar bases anteriores, mediciones y datos de otros usuarios.
- Guardar logs, JSON, capturas, modelo efectivo y limitaciones. Relacionar I1–I6 con sus pruebas y fuentes: la matriz histórica A–E y los verificadores que la consumen no acreditan automáticamente estas iteraciones nuevas.
- Actualizar `ESTADO.md`, `evidencia/README.md`, descripción y guion de entrega con lo realmente completado. Conservar resultados anteriores como históricos y no sobrescribir un fallo con una afirmación de éxito sin nueva ejecución.
- Identificar la revisión final con commit base, diff y hashes del código y de la evidencia mientras no haya autorización de commit. No hacer staging, commits ni publicaciones como consecuencia de este plan.
- Preparar el ensayo del flujo actual: propuesta → conciliación → edición/bloqueo → reajuste acotado → comparación → aprobación/exportación. Evitar promesas clínicas y distinguir demo sintética de integración real.

**Aceptación local:** pruebas y recorridos completos pasan sobre el código final, sin fallos omitidos; la matriz distingue completado, mitigado y pendiente. Ninguna iteración se marca terminada solo porque existe el código o un archivo de resultados.

**Pendientes de entrega H5, sujetos a reanudación expresa por David:** Clips público sin sesión, datos definitivos del equipo, aceptación de bases, formulario y recibo. Seguir [ENVIO_HACKATHON.md](ENVIO_HACKATHON.md). Repo público, despliegue y diapositivas son opcionales. No son sustitutos del formulario.

## Orden de ejecución y criterio de cierre

1. **I1 primero:** detectar regresiones reales de las últimas correcciones antes de añadir funciones.
2. **I2 e I3:** resolver dependencias del backend; mantener explícitas las mitigaciones si no se pueden completar.
3. **I4 e I5:** obtener evidencia de utilidad y ajustar la interacción; documentar qué mejoras se apoyan en observaciones y cuáles en revisión de diseño.
4. **I6:** revalidar el estado final y preparar la entrega dentro de la autorización vigente.

Para una nueva calificación, revisar los cuatro criterios con la evidencia resultante. La validación clínica formal queda fuera de lo demostrado por este prototipo; no presentarla como requisito oficial del hackatón ni como conseguida por completar estas tareas.

---

## Histórico · Plan inicial de 77/100

<details>
<summary>Plan del 6 de noviembre: conservar como referencia, no ejecutar como tareas vigentes</summary>

Los bloques A–E siguientes pertenecen a la auditoría inicial. Su evolución y cierre previo están en `ESTADO.md` y en la evidencia enlazada. Sus tiempos, totales, recomendaciones y autorizaciones no reemplazan las iteraciones I1–I6 anteriores. En particular, no borrar bases, no recortar historiales clínicos y no interpretar indicaciones antiguas de commit/publicación como autorización actual.

---

## Bloque A · Correcciones de código (obligatorias, ~3 h)

Son los hallazgos del revisor independiente sobre los cambios de hoy. Los dos primeros son de seguridad clínica.

| # | Qué pasa | Dónde | Arreglo |
|---|---|---|---|
| A1 | La verificación de interacciones usa la instantánea guardada al proponer el plan, no la medicación viva de MEGI. Una receta aprobada en MEGI después de proponer no entra al cruce (modo http). | `megi-revision/server/lib/plan.ts` 314-322 · `server/lib/revision.ts` 45-53 · `server/lib/megi/megi-http.ts` 455 | En `medicacionParaVerificar` fusionar el historial vivo (`paciente.historialMedicacion` recién leído) con las decisiones guardadas (`plan.conciliacion`), en vez de sustituirlo. Lo nuevo entra como `sin_confirmar`. |
| A2 | El agente solo está obligado a mandar `versionEsperada` cuando hay alcance definido. Sin alcance puede pisar una dosis que el médico acaba de editar. | `server/lib/revision.ts` 55 | Exigir `versionEsperada` siempre que `actor === "agente"`. Actualizar el prompt y la skill si hace falta (ya lo piden). Añadir una prueba a `pruebas-hackathon/revision-trazable.mts`. |
| A3 | `medicacionActiva` lee todas las consultas aprobadas del paciente, una petición por consulta, en cada verificación y en cada listado. Hoy en la mañana estaba en 4 peticiones; ahora crece con el expediente. | `server/lib/megi/megi-http.ts` 364-399 y 431 | Limitar a las últimas N aprobadas (p. ej. 5) o cachear por paciente durante la petición. Conservar la medición `uti-peticiones-por-verificacion` de la batería como regresión. |
| A4 | Planes anteriores a la migración v2: cualquier mutación hace dos llamadas a MEGI con la fila bloqueada (`FOR UPDATE`); si MEGI falla, 500 sin código. | `server/lib/plan.ts` 196-201 | Hidratar antes del bloqueo o envolver en try/catch con `fail(..., { errorCode: "megi_no_disponible", statusCode: 502 })`. |
| A5 | `contextoFuente` guarda la consulta entera, transcripción incluida, en la tabla de planes, y se vuelve a parsear por línea en cada lectura. | `actions/proponer-plan.ts` 136 · `server/lib/revision.ts` 27-40 | Guardar solo lo que se usa: `soap`, `medicamentosPropuestos`, `pendientes`, `historialMedicacion`. Parsear una vez por petición y pasar el objeto a `evidenciaDe`. |
| A6 | Planes exportados anteriores a v2 muestran «requiere confirmación» en cada línea. | `server/lib/revision.ts` 29 | Si `plan.estado === "exportado"`, omitir `fuentes` o usar un texto neutro. |
| A7 | Aviso «El plan cambió» parpadea al abrir el diálogo de aprobación (la versión sube antes de que llegue el refetch). | `app/routes/revision.$consultaId.tsx` 77, 374, 407 | Abrir el diálogo después del refetch de `obtener-plan`, o comparar contra la versión que devolvió `preparar-aprobacion`. |
| A8 | El índice ya no lista consultas exportadas; solo se llega por URL. | `actions/listar-consultas.ts` 48 | Pestaña o filtro «Exportadas» en `/revision`. |
| A9 | Cosmético: dos pasos «4.» en la skill; importación sin usar en `proponer-plan`; deps del effect en `MedicionesRevision.tsx`. | `.agents/skills/revision-clinica/SKILL.md` 27-28 · `actions/proponer-plan.ts` 6 · `app/components/revision/MedicionesRevision.tsx` 17 | Limpiar. |
| A10 | Sin sondeo, si el canal de sincronización cae no hay respaldo. | `app/routes/revision.$consultaId.tsx` | `refetchOnWindowFocus: true` y `refetchInterval: 60000` como red de seguridad. |

Al terminar el bloque: `pnpm typecheck`, `pnpm agent-native:doctor`, `pnpm build`, auditoría `--http` 57/57, batería `--http` 33/33, revisión trazable 30/30 (con la prueba nueva de A2 → 31/31). Commit local.

---

## Bloque B · Evidencia reproducible (obligatoria, ~2 h)

Hoy los recorridos de `evidencia/` fallan con la interfaz nueva; pasaron solo con copias adaptadas en el scratchpad.
ESTADO.md cita una comprobación manual con Firefox que nadie puede repetir.

| # | Qué | Cómo |
|---|---|---|
| B1 | `evidencia/recorrido.mjs` | «Verificado» → «Sin alertas detectadas»; botón `Añadir` con `exact: true`; `Rechazar` con `.first()`. |
| B2 | `evidencia/advertencias.mjs` | Añadir el paso de conciliación antes de aprobar: `getByLabel(/Estado de Losartán/).selectOption("activo")` → «Guardar conciliación» → esperar el toast. Comprobar que el botón de aprobar está deshabilitado antes. |
| B3 | `evidencia/agente.mjs` | «Explicación del agente» ya no existe: comprobar «Motivo del último cambio» abierto. El compositor es un `div[contenteditable]` con rol textbox, no `textarea`; Enter no envía: usar el botón «Send message». Esperar fin de turno (sin «Trabajando»), no solo texto estable. |
| B4 | Resultados | Volver a correr todo con el backend de demo arriba y guardar JSON y capturas. Quitar de ESTADO.md la afirmación de «no se hizo build» (sí pasa) y la comprobación manual; dejar solo lo reproducible. |
| B5 | Semilla | Mateo (demo-c2) queda exportado y Luis en revisión en `.demo/pglite` tras las pruebas de hoy. Antes de grabar: `restaurar-demo` o borrar `.demo/`. |

---

## Bloque C · Que lo distintivo se vea (Creatividad, ~3 h)

Un juez ve diez proyectos. Lo que recuerda de este debe ser: *el médico fija una línea y el agente no puede tocarla; el médico selecciona dos líneas y el agente solo puede trabajar ahí; cada cambio tiene versión y fuente*. Hoy eso existe pero está escondido.

| # | Qué | Dónde |
|---|---|---|
| C1 | El razonamiento del agente está colapsado en «Motivo del último cambio». Mostrarlo abierto cuando el último cambio es del agente; es lo que el jurado quiere ver. | `app/routes/revision.$consultaId.tsx` 172 |
| C2 | Comparar versiones: hoy es texto. Diff visual con color: retiradas en rojo tachado, añadidas en verde, editadas en ámbar con antes → después. | `app/components/revision/ComparacionPlan.tsx`, `app/lib/revision-diff.ts` |
| C3 | La selección múltiple no explica para qué sirve. Al marcar una casilla, mostrar la barra «El agente solo podrá editar estas N líneas» con el botón de pedir reajuste acotado. | `revision.$consultaId.tsx` 200-201 |
| C4 | Estado vacío de una consulta sin plan: tres pasos en una línea (el agente propone → tú fijas y ajustas → apruebas y exportas) en vez de dos botones sueltos. | `revision.$consultaId.tsx` bloque sin plan |
| C5 | Español completo: título de la pestaña y barra lateral «Megi Revision» → «MEGI Revisión»; sugerencias del chat en inglés («Help me with this revision», «Explain what I am looking at») → español; «Dev's workspace». | `agent-native-email-branding.ts`, `server/plugins/agent-chat.ts` (suggestions), `app/root.tsx` |
| C6 | Mientras el agente trabaja (60 s hoy), el tablero debe mostrar qué está haciendo: «Leyendo contexto → verificando 3 fármacos → creando plan». `EstadoAgente.tsx` existe; conectarlo a los pasos del run. | `app/components/revision/EstadoAgente.tsx`, `TrabajoAgente.tsx` |
| C7 | Reducir densidad: «Fuentes y alcance de la verificación» cerrado por defecto está bien; el panel de conciliación abierto solo cuando hay `sin_confirmar`; pestaña «Cambios» con icono por actor. | `LineaPlan.tsx`, `ConciliacionMedicacion.tsx`, `Bitacora.tsx` |

---

## Bloque D · El agente que actúa con límites (Innovación, ~2 h)

| # | Qué | Cómo |
|---|---|---|
| D1 | Cuando el médico rechaza o bloquea una línea con bloqueo de seguridad, el agente propone el reemplazo **sin que se lo pidan**, acotado a esa línea. | En `onRechazar`/bloqueo con `verificacion === "bloqueado"`: `sendToAgentChat({ message, context, submit: true })` tras `definir-alcance` con solo esa línea. Ya existe `pedirReemplazo` en `agente.ts`; falta que sea automático y acotado. |
| D2 | Sin alergias registradas: el agente debe usar `ask-question` estructurada («¿Confirmas que no tiene alergias conocidas? Sí / No / No sé») antes de proponer, no solo decirlo en prosa. | Prompt en `server/plugins/agent-chat.ts` + regla en la skill. |
| D3 | Métricas: la página de mediciones debe mostrar manual vs agente con la leyenda «exploratorio, n pequeño» y el tiempo del servidor separado del tiempo del modelo. Ya se mide; falta que se presente como comparación. | `app/components/revision/MedicionesRevision.tsx`, `actions/metricas-revision.ts` |
| D4 | Latencia: 60 s por propuesta se nota en el video. Causas probables: `docs-search` de la skill en cada conversación y 13 herramientas iniciales. Probar: skill más corta (la mitad), `historial-plan` y `metricas-revision` fuera de las iniciales, y medir. Objetivo < 35 s. | `server/plugins/agent-chat.ts`, `.agents/skills/revision-clinica/SKILL.md` |

---

## Bloque E · Agent-Native a fondo (~1.5 h)

| # | Qué | Cómo |
|---|---|---|
| E1 | Invalidación dirigida: hoy cualquier acción del agente invalida todas las consultas `["action"]`. Declarar `resourceType: "plan"` (y `resourceId`) en las acciones de plan para que solo se refresque el tablero afectado. | `actions/*.ts`, ver `use-db-sync` del framework |
| E2 | `view-screen` ya hidrata consulta, plan y selección. Añadir también la versión y el alcance en `<current-screen>` del prompt para que el agente no necesite `obtener-plan` antes de cada edición (menos latencia, D4). | `actions/view-screen.ts`, `app/hooks/use-navigation-state.ts` |
| E3 | Aprobación por HTTP: las acciones con `needsApproval` por `caller === "http"` tienen página de aprobación del framework; mostrarla 10 s en el video como prueba de que la regla vive en la acción. | Ya existe; solo guion. |
| E4 | `metricas-revision` e `historial-plan` como herramientas MCP de solo lectura ya están en `keyToolNames`; añadir una captura del manifiesto a la evidencia (hoy está en `revision-trazable-mcp.json`, basta referenciarla en el README). | `megi-revision/README.md` |

---

## Documentos del proyecto que deben reflejar lo nuevo (~1 h)

- `ENVIO_HACKATHON.md`, párrafo «Project description»: añadir versiones atómicas, alcance por selección aplicado en servidor, conciliación de medicación obligatoria antes de aprobar, fuentes por línea. Hoy describe la app del 2 de noviembre.
- `PLAN_HACKATHON_AGENT_NATIVE.md` §10, guion del video: insertar el paso de conciliación (15 s), la selección de dos líneas con reajuste acotado (30 s) y la comparación de versiones (15 s). Quitar lo que ya no existe («Explicación del agente»).
- `megi-revision/README.md`: tabla de acciones con las siete nuevas y la columna «quién puede llamarla» (agente / solo médico desde UI).
- `ESTADO.md`: una entrada con lo que se corrigió de los bloques A y B y los números reales de verificación.

---

## Orden sugerido para los dos días de código que quedan

1. **Hoy noche:** A1, A2, A3 (seguridad y coste) + B1-B4 (evidencia) + commit local. Sin esto, el jurado podría ver un fallo en vivo y nosotros no tendríamos cómo demostrar que no.
2. **Sábado 7:** C1, C2, C3, C5, C6, D1, D4. Es lo que cambia la impresión en el video.
3. **Sábado tarde:** A4-A10, D2, D3, E1, E2, documentos. Verificación completa y congelar código.
4. **Domingo 8:** lo que David apartó para mañana (GitHub, repo, Clips). Nada de código ese día.

Lo que no cabe y hay que aceptar: usuario de servicio sigue admin (acordado para después del envío); listar consultas seguirá recorriendo pacientes hasta que MEGI exponga un endpoint de pendientes; el mock empareja alergias por subcadena.

</details>
