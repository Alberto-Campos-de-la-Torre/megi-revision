# ESTADO · canal de coordinación diario

Cada uno actualiza su bloque al cerrar el día: hecho / bloqueado / necesito.

## 2 nov 2026

### Frente B (David · con MEGI) — hecho
- **B1** Entorno de demo limpio en `megi-demo/` (copia de canvas-megi-ia sin datos, sin modelos, sin node_modules). Venv Python 3.12, secreto propio, puerto **8020**. `backend/start_demo.sh`, `backend/stop_demo.sh`.
- **B2** `backend/seed_demo.py`: médico `demo_medico`, 4 pacientes ficticios, 4 consultas consolidadas pendientes, 2 previas aprobadas (medicación activa), catálogo de 13 fármacos y 6 interacciones aprobadas. Idempotente, un segundo.
- **B3** `megi-demo/docs/api_megi_para_adaptador.md` con peticiones y respuestas reales; JSON crudos en `megi-demo/docs/api_samples/`.
- **B4** Adaptador real en `adaptador-megi/lib/megi/` + `probar-adaptador.ts`: 27 comprobaciones correctas.
- **B6 (adelantado)** Integración `MEGI_MODE=http`: la app completa corre contra el backend de demo y pasa el mismo smoke que en mock. Ver abajo.

### Frente A (app Agent-Native) — hecho el mismo día
- App `megi-revision/` creada desde la plantilla Chat de Agent-Native 0.222.2.
- Adaptador mock con los 4 casos; selector por `MEGI_MODE`.
- Tablas `planes`, `lineas_plan`, `eventos_revision` con migración v1.
- 8 acciones (`listar-consultas`, `ver-contexto-consulta`, `proponer-plan`, `obtener-plan`, `actualizar-linea`, `agregar-linea`, `reajustar-plan`, `aprobar-plan`) con esquemas, `outputSchema`, códigos de error y reglas de bloqueo en código.
- Pantallas `/revision` y `/revision/:consultaId`: ficha del paciente, tablero con chips de verificación, editar/bloquear/rechazar/reactivar, añadir línea, botones que abren al agente, aprobar con confirmación de alertas, pestaña de cambios, exportación FHIR descargable. Enlace en la barra lateral, `navigation.consultaId`, `homePath=/revision`.
- Prompt del agente, herramientas iniciales, sección en `AGENTS.md`, skill `revision-clinica`.
- Verificación: `pnpm typecheck` limpio, `pnpm agent-native:doctor` limpio, `pnpm build` completo, smoke de 20 comprobaciones por CLI en mock y en http (bloqueos 409, 403 al agente, 409 sin confirmar, exportación con sello, plan cerrado).

### Verificación en navegador y Git — hecho (tarde del 2 nov)
- Recorrido automatizado con Chromium sin cabeza (Playwright) contra la app en modo `http` + MEGI demo: 26 comprobaciones correctas (lista, ficha, plan en blanco, bloqueo por alergia con alternativas, diálogo de aprobación deshabilitado con bloqueo, bloquear/desbloquear, edición inline, verificado, pendiente, rechazo con motivo, bitácora, aprobado y exportado, FHIR con sello y descarga, plan cerrado, lista sin la consulta, aviso de alergias sin registro, botón que abre la barra del agente). Sin errores de red ni de consola propios. Capturas en `evidencia/capturas/`.
- MEGI recibió la aprobación real desde la app (receta Paracetamol 500 mg, aprobada por «Dra. Demo Ficticia») y se volvió a sembrar.
- Git: `megi-revision` rama `hackathon-demo` con el commit de la plantilla intacto (`c8073ca`) y encima el trabajo del hackatón; `megi-demo` con dos commits (copia previa / añadidos del hackatón); repo raíz con planes, adaptador y evidencia. Todo local, sin remoto.

### Agente en vivo — hecho con motor local (noche del 2 nov)
- Sin la clave de Grok, se probó el agente real con Ollama en el equipo: `qwen2.5:14b` con contexto de 32k (`qwen2.5-14b-32k`; el 4k por defecto trunca el catálogo de herramientas y el 7B no llama bien a las acciones). Configuración documentada en el README y en `.env`.
- Resultado en el chat real de la app (`evidencia/capturas/20…22`): el agente lee `ver-contexto-consulta`, crea el plan de demo-c2 con `proponer-plan` (naproxeno, losartán y 3 pendientes, con la advertencia AINE/HTA y la nota de «sin alergias registradas»), explica en español y la bitácora lo registra como agente. 72 s de principio a fin; el tablero se refresca solo.
- Endurecido a raíz de la prueba: el agente no puede crear un plan vacío (`lineas_vacias`), el prompt y la skill llevan un ejemplo no copiable del array `lineas`, y el tablero hace refetch mientras hay propuesta en curso.
- **Segunda mitad, hecha (noche del 2 nov, segundo intento):** con el naproxeno bloqueado por el médico, se pidió al agente en el chat «quita el naproxeno del plan». El agente leyó el plan, intentó el cambio, recibió `linea_bloqueada` y respondió: «El medicamento Naproxeno está bloqueado por el médico, por lo que no puedo quitarlo del plan. Necesitaré que el médico desbloquee esta línea antes de poder realizar el cambio». La línea siguió bloqueada e intacta (27 s de trabajo del agente). Captura `evidencia/capturas/25-agente-respeta-bloqueo.png`; propuesta completa en `20…23`.

### Verificación final sobre el código commiteado (noche del 2 nov)
- Smoke por CLI en modo `http`: 22 comprobaciones correctas (incluye el nuevo rechazo de plan vacío al agente).
- Recorrido en navegador completo + cola: 31 comprobaciones correctas, capturas regeneradas en `evidencia/capturas/`.
- Único error de red que aparece: `401` en `/_agent-native/agent-engine/status`. Sonda dedicada (`evidencia/sonda401.mjs`): ocurre exactamente una vez, en la primera petición de un navegador sin sesión; tras el inicio de sesión automático de desarrollo todas las llamadas devuelven 200 (6 de 6 en la sonda). Es el comportamiento del framework en la primera carga, no un fallo de la app. El aviso de consola «script tag while rendering» viene de `root.tsx` de la plantilla. Ninguno es de nuestro código.

### Agente en vivo con Grok (motor de la demo) — hecho (2 nov, 20:11)
- Clave de xAI recibida y guardada solo en `megi-revision/.env` (ignorado por Git). Motor fijado ahí: `AGENT_ENGINE=ai-sdk:openai`, `AGENT_MODEL=grok-4.7`, `OPENAI_BASE_URL=https://api.x.ai/v1`. Modelos disponibles consultados en la API (grok-4.3 a 4.7).
- Propuesta (demo-c2, Mateo) en **30 s**: Grok leyó el contexto, sustituyó por iniciativa propia el naproxeno de la nota por paracetamol 1 g porque el AINE sube la TA y reduce el efecto del losartán, continuó losartán, añadió 4 pendientes (incluido calor local), avisó que no hay alergias registradas y lo explicó. Verificación: 0 bloqueos, 0 advertencias. Capturas `evidencia/capturas/grok/20…22`.
- Línea bloqueada: con el paracetamol bloqueado por el médico, se le pidió «quita el naproxeno del plan». Grok leyó el plan, no cambió nada, explicó que el naproxeno ya se había sustituido por paracetamol, que esa línea está bloqueada y no la toca, resumió lo que sigue igual y preguntó a qué línea se refería si era otra. 25 s. Captura `grok/25-agente-respeta-bloqueo.png`.
- Resumen: el flujo completo de la demo funciona con el motor previsto. El motor local (Ollama) queda como respaldo documentado.

### Video de la demo con Grok — hecho (2 nov, 20:21)
- `evidencia/video/demo-grok.mp4` (191 s, también `.webm`): grabación automática del guion completo en la app real con Grok 4.7 y MEGI de demo: lista → ficha y nota SOAP → el agente propone (sustituye el naproxeno por paracetamol, explica, pide confirmar alergias) → el médico bloquea el paracetamol → se pide al agente «quita Paracetamol y agrega tratamiento tópico» → el agente revisa el plan para no tocar lo bloqueado → bitácora → aprobar y exportar a MEGI → pestaña de exportación FHIR. Fotogramas de control en `evidencia/video/fotogramas/`. **[9-nov: los dos ficheros de video se retiraron del repositorio público —16 MB de una grabación anterior a la auditoría— y los fotogramas pasaron a `evidencia/historico/fotogramas-demo-grok-4.7/`; el video sigue en la copia local.]**
- `ENVIO_HACKATHON.md`: campos del formulario, descripción en inglés lista para pegar (con trabajo previo y nuevo), pasos para grabar en Clips y lista final.

### Pendiente (decisión de David, 2 nov por la noche)
- Grabación pública en Clips y envío del formulario quedan **en espera hasta definir el reparto con el equipo** (nombres y quién envía). Todo lo demás está listo: video de referencia `evidencia/video/demo-grok.mp4` (retirado del repositorio público el 9-nov; sigue en la copia local), pasos y texto en `ENVIO_HACKATHON.md`.
- Al retomar: `megi-demo/backend/start_demo.sh` → `seed_demo.py` → borrar `megi-revision/data/` → `pnpm dev` → grabar en Clips (día 8) → enviar y guardar la confirmación (día 9, antes de las 6 PM hora de México).


## Correcciones tras la auditoría del hackatón

**Publicación y envío detenidos por David.** No se subió ningún video a Clips ni se envió el formulario. La sesión de Clips quedó preparada por el usuario; no constituye una participación. Quedan reservados al equipo los datos del remitente, integrantes, elegibilidad, reparto del premio y aceptación de las bases.

- Corregida la suplantación del médico: el actor se deriva del caller del servidor. Los cambios con origen médico se rechazan desde tool/MCP/CLI/HTTP y otros transportes; la aprobación es `uiOnly`, fuera del catálogo del agente. La prueba de sesión, mismo origen y capacidad UI la verifica el framework.
- Propuesta, edición, adición y reajuste guardan líneas, verificación y bitácora en la misma transacción. MEGI caído o una respuesta de verificación incompleta revierten todo; no dejan planes huérfanos ni dosis a medias. Se comprueba también la cancelación antes de confirmar.
- Mutaciones serializadas con bloqueo de la fila del plan y relectura de la línea. Se rechazan cambios duplicados sobre una línea en el mismo reajuste.
- Aprobación y exportación recuperables: un reintento local devuelve el resultado ya exportado; si falló la descarga tras la aprobación remota, el adaptador comprueba que el contenido coincide y recupera los documentos sin volver a aprobar ni sobrescribir otro plan.
- El SOAP aprobado refleja el tratamiento revisado, en vez de conservar fármacos sustituidos del texto original. La medicación activa separa nombre y dosis para evitar mostrar o verificar dosis repetidas.
- Conservada la licencia de la plantilla e inventariadas las dependencias realmente instaladas: 828 paquetes Node y 57 Python. `pnpm licenses list` falló por índices ausentes del store; el inventario se obtuvo de manifiestos y avisos instalados, sin cambiar dependencias.
- El video anterior se conserva como referencia histórica; no presenta las correcciones de esta auditoría. `ENVIO_HACKATHON.md` se actualizó como borrador, sin dar el envío por realizado.

Validación final: **57/57 regresiones correctas**, `pnpm typecheck` correcto y `pnpm agent-native:doctor` sin hallazgos. Identificación del código, hashes y límites de la verificación en `evidencia/validacion-local.json`.


## 4–5 nov 2026 · revisión independiente y arreglos

Batería nueva de pruebas (`pruebas-hackathon/bateria.mts`, 33 comprobaciones de
funcionamiento, seguridad y utilidad) sobre el código de `90085a5`: **21 pasaban,
12 fallaban**. Los ocho fallos detrás de esos 12 están arreglados; detalle y
evidencia en `pruebas-hackathon/README.md`.

El grave: el id de consulta entraba sin validar en la ruta del adaptador http, y
ese id lo controla el agente. `verConsulta("../export/consultation/C-DEMO1")`
salía de `/api/consultations/` y llegaba a un GET que en MEGI **escribe**:
comprobado contra el backend de demo, dejó `C-DEMO1` en `status="exported"` con
`approved_at` y `approved_by` nulos — una consulta marcada como exportada sin
aprobación ni firma, fuera de la lista de pendientes, disparada desde
`ver-contexto-consulta`, que está declarada `readOnly`. Ahora los ids se validan
como un único segmento de ruta (`idSeguro`) y lo que no pasa el filtro no llega
a la red.

Los otros siete: alertas atribuidas por comparación literal de cadena (una
alerta que MEGI nombre distinto se descartaba en silencio y el fármaco salía
`ok`); el mismo fármaco dos veces en el plan sin aviso de dosis duplicada;
`lineasDe` truncaba en 200 y la línea 201 desaparecía del tablero y de la receta
exportada; el id real y el lógico de una consulta no encontraban el mismo plan;
las advertencias no dejaban rastro al aprobar; el adaptador repetía peticiones
dentro de una misma operación (6→4 al verificar, 10→7 al listar tres pacientes);
y seguían en el catálogo del agente dos acciones de la plantilla, `hello` y
`provider-api-request` (Slack Web API), esta última una salida al exterior en una
app con nota clínica y receta — borradas.

Sin tocar, con motivo: el usuario de servicio del adaptador es `role: admin` y
solo necesita ser médico (bajarlo antes del envío puede dejar la demo sin acceso
a sus pacientes por el modelo de propiedad de MEGI; hacerlo después); el coste de
`listarConsultasCerradas`, que necesita un endpoint de MEGI que no existe; y el
emparejado de alergias por subcadena del mock, no alcanzable con los cuatro
pacientes de la demo.

Verificación con el backend de demo arriba: **57/57** en la auditoría que ya
existía, **33/33** en la nueva, `pnpm typecheck` limpio, `pnpm agent-native:doctor`
limpio, `pnpm build` completo.


## 6 nov 2026 · integración de los arreglos de Alberto y auditoría local

Los tres commits del 5 nov de `NGZeggers/hackathons` (rama `bluiders.io`) están
integrados en la copia local con su autoría: el de código en `megi-revision`
(`ce7b474`) y los tres en la raíz (`81d26e0`, `2a2d1fc`, `9e0caff`). Antes se
commiteó lo que quedaba pendiente de la auditoría, que era idéntico a `90085a5`.

Verificado aquí con el backend de demo arriba y la semilla recién puesta:
`pnpm typecheck` limpio, `pnpm agent-native:doctor` limpio, `pnpm build` completo,
`evidencia/auditoria-hackathon.mts --http` **57/57**, `pruebas-hackathon/bateria.mts --http`
**33/33**, recorrido en navegador `evidencia/recorrido.mjs` **24/24** sin errores de red.
Comprobación nueva en navegador del único cambio de interfaz (`evidencia/advertencias.mjs`,
capturas en `evidencia/capturas/advertencias/`): naproxeno marca advertencia por
losartán, paracetamol dos veces avisa de dosis duplicada en ambas líneas, el diálogo
de aprobación lista las tres advertencias sin casilla, y el evento «aprobar» de la
bitácora las deja escritas. 6/6.

Lectura del diff: los ocho arreglos son pequeños y acotados; `idSeguro` corrige un
fallo real (lectura readOnly que escribía en MEGI por salto de ruta). Límites que
quedan: el duplicado se detecta por nombre exacto normalizado (no por «Paracetamol 500 mg»
vs «Paracetamol 1 g» si el nombre lleva la dosis); `medicacionActiva` sigue mirando solo
la última consulta aprobada; el usuario de servicio sigue siendo admin (acordado: después
del envío). Pendiente: los commits locales anteriores a `90085a5` no están en GitHub
(historias distintas); decidir si el repo de GitHub pasa a ser el oficial.

Operativo: en esta máquina el puerto 8020 lo ocupa un servicio propio de `/opt/megi`
(visor) y 8021 otro; el backend de demo corre con `MEGI_DEMO_PORT=8120 start_demo.sh`,
la app con `MEGI_MODE=http MEGI_URL=http://127.0.0.1:8120 pnpm dev`, y la auditoría y la
batería leen `MEGI_URL`. Incidente: una orden con `cd` relativo borró
`megi-demo/backend/data` (base sqlite de la demo, no el MEGI real); se regeneró con
`seed_demo.py` y `seed.json` volvió desde git. Nada del MEGI real (`:8000`) se tocó.

## 6 nov 2026 · mejoras de los criterios aplicadas

Cambios locales sobre `megi-revision`, sin publicación ni envío:

- Versiones atómicas del plan en SQL, autor/motivo/tiempo del servidor e instantáneas con fuentes. La pestaña «Comparar versiones» muestra retiradas, adiciones, cambios y pautas conservadas. Una pauta fijada conserva esa etiqueta aunque su alerta se recalcule. Historial paginado de 20 versiones.
- Selección múltiple y órdenes sobre selección. El alcance permitido se guarda mediante una acción exclusiva de la UI; el servidor lo exige en actualizar/agregar/reajustar. Un reemplazo hereda el alcance. Se rechazan versiones desactualizadas; la selección visual no concede permisos.
- `view-screen` hidrata la consulta, plan actual, versión y selección de la pestaña. Fuentes literales del SOAP y medicación histórica, con fecha/procedencia; lo que no tiene respaldo literal se marca para confirmación. «Sin alertas detectadas» sustituye «Verificado» y explica los límites del verificador.
- Conciliación longitudinal de recetas aprobadas en el adaptador HTTP, con estado, fecha y procedencia. No se supone que todo lo histórico sigue activo. El médico confirma, suspende o finaliza y puede añadir medicación referida. La verificación incluye preventivamente lo desconocido; la aprobación frena si queda medicación sin confirmar. Las alertas se actualizan antes del diálogo y una confirmación antigua no autoriza alertas diferentes.
- Demo autónoma: `pnpm demo --port 8082 --no-open`, backend mock y SQL aislado en `.demo/pglite`. El agente usa el modelo real configurado. Cuatro casos propios por usuario; restaurar está prohibido en modo HTTP, no contacta ese backend, conserva mediciones y marca intentos abiertos como interrumpidos.
- Cronómetro exploratorio manual/agente, señal de plan visible, finalización e intento interrumpido. No se presenta eficacia clínica ni ahorro inventado. El tiempo de cada versión corresponde a la operación del servidor y excluye el modelo.
- El tablero dejó de hacer sondeo cada 4–5 s: usa invalidación de acciones del chat. Progreso y cancelación aprovechan el runtime compartido con el rail; se corrigió un aviso que podía quedar activo después de detener. Cada propuesta inicial abre una conversación nueva.
- Skill `revision-clinica` explícitamente runtime y disponible mediante `docs-search --slug skill-revision-clinica`. Herramientas iniciales y catálogo externo alineados con las acciones del dominio. Comprobado el manifiesto WebMCP: las siete acciones principales requieren autenticación y las decisiones exclusivas del médico quedan fuera del catálogo.
- Migraciones aditivas v2/v3, sin modificar la v1 aplicada. Guías del agente actualizadas. La verificación de build actual se registra en la entrada PARA_EL_100 de abajo.

Validación: typecheck correcto y doctor limpio; 52/52 regresiones de auditoría, 28/28 de la batería existente y 30/30 nuevas, con PGlite en memoria, mock y transporte HTTP simulado. No se ejecutó `--http` contra el backend de demo porque no escuchaba en :8120. No equivale a una validación clínica.

La evidencia de navegador vigente se obtiene con los scripts versionados de `evidencia/`; los resultados se registran en la entrada PARA_EL_100. Las observaciones manuales anteriores no se usan como prueba de la versión actual.

Evidencia actual: `evidencia/revision-trazable-validacion.json`, `evidencia/revision-trazable-mcp.json`, `evidencia/revision-trazable-navegador.json`, `pruebas-hackathon/revision-trazable-resultados.json`. La demo queda con Mateo exportado y Luis en revisión; los otros casos permanecen disponibles. Los cambios todavía no tienen commit ni despliegue público.


## 6 noviembre · Cierre de PARA_EL_100.md

Aplicación guardada en el commit local `719a6e4`. La evidencia vigente se reproduce desde [evidencia/README.md](evidencia/README.md). Los resultados anteriores son históricos.

- A1–A6: cruce con historial vivo de MEGI y decisiones por pauta/procedencia; registros nuevos sin confirmar; versión obligatoria para toda edición del agente; caché por paciente/adaptador limitado a una acción sin recortar crónicos; hidratación legacy con 502 tipado; contexto mínimo sin transcripción, parseado por conjunto de líneas; fuentes neutras en exportaciones antiguas.
- A7–A10: confirmación abierta después de leer la versión preparada, archivo de exportadas, limpieza de skill/importación/dependencias y respaldo por foco/60 s. Migración aditiva v4.
- B: recorridos Playwright versionados, selectores actuales, conciliación previa a aprobar y espera de fin real de turno. JSON, logs y capturas en `evidencia/resultados/`, `capturas/` y `capturas-advertencias/`. Backend en :8123 con SQLite dedicado bajo `.runtime/backend`; UI en :8082 con mock y SQL en `.demo/pglite`. Se restauraron los cuatro casos propios y se comprobó la ausencia de planes; otros usuarios y mediciones permanecen.
- C: motivo abierto cuando el último cambio es del agente, diff rojo/verde/ámbar con antes → después, selección con alcance explícito, tres pasos en vacío, marca/sugerencias en español y espacio de demostración renombrado. Progreso conectado a eventos reales; fuentes cerradas y conciliación abierta cuando falta confirmar. Capturas de dosis, retirada/adición y tablero móvil a 390 px sin chat superpuesto.
- D: fijar/rechazar un fármaco con bloqueo dispara una alternativa acotada. Queda pendiente fuera de la receta; aceptar exige médico, pauta de origen intacta, desbloqueo explícito y nueva verificación de todos los fármacos. La versión conserva también sugerencias y su alcance. Alergias ausentes generan pregunta estructurada Sí/No/No sé. Métricas comparan manual/agente con n pequeño y distinguen servidor, total y modelo no instrumentado. Skill: 274 palabras frente a 538 del commit base; historial/métricas fuera del catálogo inicial.
- E: invalidación por ids y metadatos de recurso, con regresión que evita refrescar otro plan; navegación observada con versión y dos ids autorizados; servidor vuelve a validar. Manifiesto autenticado en `revision-trazable-mcp.json`, incluidas las exclusiones de decisiones médicas. Guion, README y descripción de envío actualizados.

Verificación final: **57/57 auditoría HTTP, 33/33 batería HTTP, 40/40 revisión trazable; 31/31 recorrido, 7/7 advertencias, 12/12 agente real y 2/2 restauración/manifiesto**. `pnpm typecheck`, `pnpm agent-native:doctor` sin hallazgos y `pnpm build` completos. El build registra los avisos de configuración de producción ausente en este entorno local; no acredita un despliegue.

Última medición reproducible con Grok 4.7, exploratoria n=1: plan visible en **34.4 s**, turno completo en **59.0 s** después de responder alergias. El objetivo de 35 s para el turno completo **sigue sin cumplirse**; no se presenta como tiempo puro del modelo ni como ahorro clínico. Hashes del código y límites en `evidencia/revision-trazable-validacion.json`. Sin publicación, remoto, despliegue ni Clips.

## 6 noviembre · Auditoría complementaria y cierre de código

Aplicación en commit local `43b17f6`, con árbol limpio. Se corrigieron dos detalles adicionales de la auditoría literal:

- A5: `contextoFuenteDe` comparte el objeto parseado entre verificación, snapshot y salida durante una sola acción. Una prueba cuenta un parseo en una actualización y otro en la siguiente petición, sin caché entre acciones.
- E1: una herramienta sustituye la pista del plan anterior; no acumula los planes de llamadas previas. La regresión comprueba A → B y que B deje de invalidar A.
- A1: nueva regresión con el adaptador HTTP real y transporte sintético: una receta aprobada después de crear el plan aparece en el siguiente cruce y exige conciliación.
- D4: ocho herramientas iniciales, contexto compacto del framework, reutilización del contexto fresco de la pantalla y explicación detallada en el plan con confirmación breve en el chat. El modelo sigue siendo Grok 4.7.

Verificación vigente: **57/57 auditoría HTTP, 33/33 batería HTTP y 42/42 revisión trazable**; typecheck, doctor y build correctos. Navegador: **32/32 recorrido, 7/7 advertencias, 12/12 agente real y 2/2 restauración/manifiesto**. Se comprobó también la comparación manual/agente, distinguiendo tiempo del servidor y modelo no instrumentado. La demo terminó con cuatro casos propios pendientes y sin planes.

La auditoría [punto por punto](evidencia/resultados/auditoria-para-el-100.json) conserva **D4 pendiente**. Último intento: plan visible en **40,5 s**, turno completo en **59,0 s**. La [serie de mediciones](evidencia/resultados/latencia-serie.json) incluye intentos anteriores y uno con 157,9 s; no se afirma una mejora causal ni cumplimiento del objetivo de 35 s. Durante un intento anterior se observaron dos timeouts de generación de títulos, preservados en `proveedor-latencia.json`; el último recorrido terminó sin errores de red inesperados. El verificador ahora incluye esos errores en su código de salida.

Se solicitó preferencia sobre mantener Grok 4.7 o comparar otro modelo disponible. Sin respuesta, se conserva el modelo. La documentación y la evidencia quedan guardadas **sin commit del repositorio raíz**, por instrucción del usuario. No se publicó, desplegó ni envió nada.


## 6 noviembre · Medición real del turno y contexto diferido

Aplicación en commit local `1c29f12`, con árbol limpio. Se mantiene Grok 4.7. El repositorio principal conserva los cambios sin staging ni commit, conforme a la indicación de David.

- D3: migración aditiva v5 para vincular cada versión al `runId` confiable del servidor. Se ignora cualquier id propuesto en el input; las decisiones desde UI no se atribuyen al modelo. La regresión verifica también aislamiento entre usuarios. Al abrir Mediciones después del turno, el hook público de observabilidad lee bajo demanda la traza propia vinculada al plan y muestra duraciones de API y herramientas por separado. No muestra prompts ni argumentos. La API incluye red y reintentos; no se presenta como cómputo puro del modelo.
- D4: en Core 0.222.2, `leanPrompt` desactiva el contexto diferido. La configuración final usa acciones nativas, `lazyContext`, `skipFilesContext` y herramientas de proveedores diferidas (`corpusTools: "lazy"`), además de las ocho herramientas clínicas iniciales. Las demás continúan disponibles por descubrimiento. No se cambió de proveedor ni modelo.
- Verificación vigente: **57/57 auditoría HTTP, 33/33 batería HTTP, 43/43 revisión trazable; 32/32 recorrido, 7/7 advertencias, 13/13 agente real y 2/2 restauración/manifiesto**. Typecheck, doctor y build correctos. Sin errores de red inesperados en los recorridos; permanecen avisos conocidos del render del framework y la sonda inicial 401 sin sesión.
- Última propuesta, exploratoria n=1: plan visible en **30.4 s**, turno completo en **50.2 s** tras responder alergias. Su traza registró 49,823 s en servidor, 49,780 s acumulados en llamadas de API y 0,016 s en herramientas. La serie conserva siete intentos, incluido uno de 109,1 s con contexto diferido y corpus inicial. No demuestra una mejora causal ni una garantía de latencia.
- Un intento intermedio agotó la espera de la pregunta en pantalla aunque el servidor la registró; coincidió con ediciones de documentación durante el recorrido. Se conserva en `evidencia/resultados/intentos/agente-contexto-corpus-diferido-incompleto.json`. La repetición sin ediciones pasó las trece comprobaciones.
- La demo terminó restaurada: cuatro casos propios pendientes, sin planes; mediciones y otros usuarios conservados. La lectura reproducible de metadatos de trazas está en `evidencia/diagnostico-latencia.mjs` y su JSON en `evidencia/resultados/diagnostico-latencia.json`.

La [auditoría por requisito](evidencia/resultados/auditoria-para-el-100.json) deja únicamente **D4 pendiente por el objetivo de turno completo <35 s**. Implementación, mediciones, hashes y límites actuales: [validación](evidencia/revision-trazable-validacion.json). GitHub, despliegue y Clips siguen fuera de este encargo.


## 6 noviembre · PARA_EL_100 cerrado y D4 verificado

Aplicación en commit local `b631b87`, con árbol limpio. Los cambios y evidencias del repositorio principal permanecen sin staging ni commit, conforme a la indicación de David. GitHub, despliegue y Clips siguen fuera del encargo.

- D4: `proponer-plan` entrega el control al médico con el recibo estándar después de verificar y guardar; la explicación clínica permanece en el tablero. `endsTurn` evita otra llamada al modelo para repetir el resultado. Solo el éxito cierra por esa vía; los errores siguen llegando al agente, las peticiones posteriores funcionan y la aprobación continúa siendo exclusiva de la UI médica. `mcpTool: true` conserva la creación directa por MCP con resultado completo y enlace. Skill: **268 palabras frente a 538** del commit `c2e8782`; ocho herramientas clínicas iniciales y herramientas de proveedores diferidas.
- Sincronización: el recibo conserva ids de plan/consulta. Un resultado sin ids mantiene el alcance del input de esa llamada; el inicio siguiente sustituye ese alcance. Las escrituras clínicas completadas refrescan directamente solo recursos conocidos. La regresión reproduce eventos con y sin marca de efecto, excluye lecturas/fallos y comprueba que otra consulta no se refresque. El recorrido detecta la reaparición de una espera de 60 s.
- C5: el panel vacío conserva las tres sugerencias clínicas en español mediante `dynamicSuggestions=false`. Se comprobó su visibilidad y la ausencia de los textos genéricos en inglés; captura en `evidencia/capturas/sugerencias-espanol.png`. Los selectores exactos evitan que un título de chat con «Motivo» coincida con un campo clínico.
- Configuración: identidad estable `megi-revision`; la demo usa **Grok 4.20 Non-Reasoning** mediante su configuración propia. Se guardó la preferencia específica de app. Un `AGENT_MODEL` explícito prevalece: se actualizó el valor de esta demo y se reinició únicamente su servidor en :8082. Las credenciales permanecieron intactas. La lectura del catálogo, la preferencia y la traza confirman el mismo modelo efectivo.
- Se eliminó la importación restante sin uso de A9. La migración v5 y la medición autenticada del turno por propietario se mantienen; la interfaz usa el hook público de observabilidad y no se modificó el runtime del framework.

Verificación vigente: **57/57 auditoría HTTP, 33/33 batería HTTP** (más tres registros de medición), **45/45 revisión trazable; 33/33 recorrido, 7/7 advertencias, 15/15 agente real, 2/2 restauración/manifiesto y 1/1 sugerencias**. Typecheck, doctor y build correctos. Ningún archivo ejecutable de la app se modificó después de esos controles. Los recorridos vigentes no registraron errores de red inesperados; conservan la sonda inicial 401 sin sesión y avisos conocidos del renderer.

Última propuesta, desde un navegador nuevo sin selección temporal y después de responder alergias: **plan visible 4.228 s; turno completo 3.659 s**. La traza `run-1794025580457-h9dcmq` confirma una llamada de API de **3.329 s**, herramientas de **0.023 s** y el modelo configurado. El objetivo <35 s se cumple en este caso, tanto para la visibilidad como para el fin del turno. Es una muestra exploratoria n=1, no una garantía máxima ni una medición de eficacia clínica.

La serie conserva las mediciones anteriores. El intento solicitado como Qwen se descarta como comparación: el modelo efectivo fue Grok 4.7; no acredita rendimiento de Qwen. Las selecciones temporales de proveedores fueron restauradas y se verificó su estado `default`. La demo terminó con los cuatro casos propios pendientes, sin planes, conservando mediciones y otros usuarios.

Los **36 requisitos locales** se relacionan con sus fuentes y pruebas en [la auditoría](evidencia/resultados/auditoria-para-el-100.json). La [validación](evidencia/revision-trazable-validacion.json) registra commit, hashes, resultados, configuración y límites. Los verificadores de cierre ya están en `evidencia/`, sin depender del scratchpad. El build local no acredita configuración ni despliegue de producción. La nota inicial de 77/100 de PARA_EL_100.md se conserva como auditoría histórica; no se atribuye una puntuación del jurado.

## 6 noviembre · Respuesta al dictamen independiente (84/100)

El dictamen [`evidencia/resultados/dictamen-auditoria-2026-11-06.json`](evidencia/resultados/dictamen-auditoria-2026-11-06.json) dejó cinco hallazgos. Los tres de código quedan corregidos y con regresión; los dos de evidencia y entrega dependen del equipo.

- **H1 (alta) · contrato del verificador.** `POST /safety/rx-check` se valida antes de usarse: cuerpo que no es objeto, `alerts` ausente o no lista, severidad distinta de `blocker|warn`, alerta sin mensaje o recuentos `blockers`/`warnings` que no cuadran se rechazan con 502 y código `verificador_invalido`. La capa de acción propaga ese código (distinto de `megi_no_disponible`) y no guarda nada. Una alerta sin `drug`/`against` atribuibles, o con nombres que la app no reconoce, ya no se descarta: se aplica a toda la receta propuesta. Las interacciones entre tratamientos previos siguen sin marcar la receta nueva.
- **H2 (alta multiusuario) · identidad en modo http.** Nueva variable `MEGI_MEDICOS` (correos con rol clínico, separados por comas). En `http`, `megi(email)` deniega con 403 `sin_rol_clinico` a cualquier correo fuera de la lista, y falla cerrado si la lista no existe; `exigirMedico` y las decisiones con `origen: "medico"` exigen el rol además del caller `frontend`. En `mock` la lista es opcional y, si está, también se aplica. La nota enviada a MEGI al aprobar incluye «Aprobado en MEGI Revisión por <correo>», así la auditoría de MEGI conserva la identidad real aunque `approved_by` sea la cuenta de servicio. Vincular credenciales de MEGI por usuario sigue pendiente: requiere cuentas individuales en el backend.
- **H3 (media) · coste longitudinal.** El adaptador http lee consultas aprobadas y pendientes con un límite único de 4 peticiones en vuelo por operación (sin multiplicarse al anidar), deduplica `GET /consultations/{id}` dentro de la acción, y comparte un solo login entre lecturas paralelas. Falta un endpoint de pendientes/historial paginado en MEGI; el recorrido sigue siendo lineal en pacientes.
- **H4 · evidencia clínica.** Sin cambio: cuatro pacientes sintéticos y n=1 no acreditan eficacia ni ahorro. Se mantiene declarado como límite.
- **H5 · entrega.** Clips, datos del equipo, aceptación y recibo del formulario siguen pendientes del equipo (límite 9 nov 2026, 23:59 PT).

Regresiones nuevas en `evidencia/auditoria-hackathon.mts`: 24 (contrato del verificador, atribución de alertas, rechazo en la capa de acción sin escrituras, rol clínico por lista y por modo, sandbox mock intacto, expediente grande en paralelo acotado, consulta no repetida, login único). La reproducción del auditor, [`evidencia/auditoria-independiente.mts`](evidencia/auditoria-independiente.mts), ahora escribe [`auditoria-independiente-tras-correccion.json`](evidencia/resultados/auditoria-independiente-tras-correccion.json): `{}` → rechazado 502; bloqueo sin atribución → `bloqueado`; dos correos en http → ambos 403 sin lista; frontend sin rol → `sin_rol_clinico`. El JSON original del dictamen se conserva intacto como «antes».

Verificación vigente: **81/81 auditoría (mock), 28/28 batería (mock) más dos mediciones, 45/45 revisión trazable**; typecheck y doctor limpios. Las variantes `--http` no se repitieron: el backend de demo en :8123 no estaba arrancado. Cambios de la app sin commit, en `megi-revision/` sobre `b631b87`: `server/lib/megi/megi-http.ts`, `server/lib/megi/index.ts`, `server/lib/plan.ts`, `actions/aprobar-plan.ts`, `.env.example` (y comentario en `.env`). Al pasar a modo http hay que declarar `MEGI_MEDICOS`; sin ella la app deniega el acceso a MEGI.

## 7 noviembre · Iteraciones I1–I6 de PARA_EL_100.md (88/100)

Trabajo sobre la app con cambios sin commit sobre `b631b87` (24 archivos y uno nuevo) y el backend de evidencia (`megi-demo/backend/app/routes/review.py` y `consultations.py`). Matriz con estado, pruebas y hashes: [`evidencia/resultados/iteraciones-i1-i6.json`](evidencia/resultados/iteraciones-i1-i6.json).

- **I1 · Revalidación HTTP (completado).** `node evidencia/backend.mjs` siembra ahora también una segunda médica ficticia (`demo_medica_b`, paciente P-DEMOB1, consulta C-DEMOB1 y una previa aprobada) mediante `evidencia/sembrar-medico-b.py`. `node evidencia/verificar.mjs`: 6/6 en cero. Nuevo `evidencia/recorrido-http.mjs` (con `evidencia/ui-http.mjs`, que arranca la UI en `MEGI_MODE=http` con PGlite propia; `pnpm demo` fuerza mock y no sirve): **25/25**. Fase A: cuenta de servicio autorizada por `MEGI_MEDICOS`, lista de 4, bloqueo real por alergia, fijar/rechazar, aprobación; `approved_by` es la cuenta de servicio y la línea de tiempo de auditoría de MEGI conserva «Aprobado en MEGI Revisión por dev@local.test». Fase B: el médico guarda su conexión propia desde la superficie de secretos; solo ve su pendiente; MEGI firma `approved_by = Dra. Segunda Ficticia`; el otro médico recibe 404; al retirar la conexión vuelve a la cuenta compartida solo porque la lista lo autoriza. Fase C: sin lista ni conexión, la UI recibe **403 `sin_rol_clinico`** (antes era un 500 sin contrato), muestra cómo resolverlo y el backend no recibe ninguna llamada clínica (contadas en el log). Capturas en `evidencia/capturas-http/`.
- **I2 · Identidad por médico (completado en evidencia; pendiente de cuentas reales).** `server/lib/megi/secretos.ts` registra `MEGI_USUARIO` y `MEGI_CONTRASENA` (ámbito usuario, cifradas en servidor, nunca en env ni en resultados). `megi(email)` resuelve la conexión propia (una instancia por correo; rotación → nueva; retirada → 403 y sesión olvidada; almacén caído → 503 `credenciales_no_disponibles`, reintentable) y solo cae a la cuenta de servicio si `MEGI_MEDICOS` lo autoriza. `exigirMedico` y `origenAutorizado` son asíncronos y exigen caller `frontend` más identidad clínica; `conectarMegi` traduce el acceso denegado al contrato de acción. El backend ya separaba expedientes por `doctor_id`; con cuentas propias la aprobación remota lleva la identidad individual y la nota también queda en la auditoría de MEGI (nuevo campo `note` en la línea de tiempo). Regresiones: 16 nuevas con fixtures y 11 contra backend vivo con dos cuentas (A no lee, verifica ni audita lo de B y viceversa; B firma con su nombre). Límite: el consultorio debe dar de alta cuentas individuales; mientras tanto la lista sigue siendo la mitigación.
- **I3 · Coste acotado (completado).** MEGI: `GET /review/pending?limit&offset` (pendientes del médico con la ficha del paciente, orden estable, `total` y `next_offset`) y `POST /review/medication-history` (recetas aprobadas de varios pacientes por páginas; un id ajeno responde 404 y no se mezcla nada). Adaptador: `listarPendientes({limite, desde})`, historial por lotes, página inválida/incompleta/con total cambiado → error (nunca un `ok` sobre historial truncado), respaldo al recorrido anterior solo ante 404 «Not Found». `listar-consultas` pagina (`limite`, `desde`, `total`, `siguiente`) y la lista muestra «Mostrando N de M» con «Ver más». Medición `evidencia/coste-historial.mts` (backend sintético, 1 ms por petición):

| Pacientes | Pendientes | Recorrido anterior | Primera página de 20 (nuevo) | Todas las páginas (nuevo) |
|---|---|---|---|---|
| 10 | 5 | 32 peticiones · 52 KB | 3 · 6 KB | 3 · 6 KB |
| 100 | 50 | 302 peticiones · 517 KB | 3 · 23 KB | 3 · 58 KB |
| 500 | 250 | 1502 peticiones · 2590 KB | 3 · 23 KB | 8 · 291 KB |

  Expediente de 60 recetas con un crónico antiguo en la más vieja: 5 peticiones (nuevo) frente a 63 (anterior); la warfarina antigua se conserva como `sin_confirmar` en ambos. Los resultados anterior/nuevo coinciden en los tres tamaños. Regresiones documentan el límite por página (1 GET + 1 POST por página de hasta 100 pacientes).
- **I4 · Usuarios (pendiente).** `evidencia/protocolo-usuarios.md`: tareas T1–T4, criterios de «completada correctamente», medidas, orden alternado y reglas. Sin participantes no hay resultados ni afirmación de ahorro.
- **I5 · Interacción (completado según su aceptación).** `Alergia` distingue registro de ausencia («Ninguna conocida» → «Sin alergias conocidas (registrado)» en verde), alergia registrada (rojo) y «sin registro» (ámbar en la ficha, neutro en la lista). Lista paginada. Capturas antes/después en `evidencia/capturas-comparacion/` y evaluación visual en `evidencia/evaluacion-visual-i5.md`: a 390 px lista y tablero sin desbordamiento y con la acción principal visible; dos observaciones de diseño quedan anotadas para contrastar con usuarios (I4).
- **I6 · Cierre (local).** `evidencia/cerrar-iteraciones.py` genera la matriz con hashes del código cambiado y de la evidencia. Recorridos de navegador en modo demo repetidos sobre el código final: **edición/exportación 33/33, advertencias 7/7 y agente real 15/15** (7 nov, 07:06–07:07 UTC; sin errores de red inesperados; persisten los avisos conocidos del renderer). Sin staging, commit, publicación ni Clips.

Verificación vigente: **auditoría `--http` 117/117, batería `--http` 33/33 (más 3 mediciones), revisión trazable 45/45, recorrido http 25/25, recorrido demo 33/33, advertencias 7/7, agente 15/15**; typecheck, doctor y build en cero (`evidencia/resultados/verificacion.json`). Reproducción del auditor actualizada en `evidencia/resultados/auditoria-independiente-tras-correccion.json`. Para pasar la app a http con identidad propia: cada médico guarda `MEGI_USUARIO`/`MEGI_CONTRASENA` en Ajustes → claves; sin eso, solo entra quien figure en `MEGI_MEDICOS`.

### Decisiones de David (7 nov, tras el cierre de I1–I6)

- **I4:** sin participantes disponibles. Queda pendiente y marcada en [`PENDIENTE_VALIDACION_USUARIOS.md`](PENDIENTE_VALIDACION_USUARIOS.md) para ejecutarla si aparecen médicos; ninguna afirmación de utilidad medida mientras tanto.
- **I2:** se mantiene como **mitigado**: conexión propia por médico disponible y probada en evidencia; sin cuentas individuales en el MEGI del consultorio, la cuenta de servicio con `MEGI_MEDICOS` sigue siendo el respaldo. Dependencia registrada, no cerrada por la lista de correos.
- **H5 / entrega:** sigue detenida. Sin Clips, formulario, datos del equipo, publicación ni commits hasta reanudación expresa.

## Respuesta al dictamen UX del 7 nov (90/100 → corregido)

Dictamen: `evidencia/resultados/ux-2026-11-07/dictamen.json`. Corrección y repetición de sus comprobaciones: `evidencia/resultados/ux-2026-11-07/correccion/` (`correccion.json`, `seguimiento.json` 6/6, `movil.json`, `extra.json` 6/6, capturas 09–18).

- **UX1 (media)** · A 390×844 el compositor tapaba la primera sugerencia de bienvenida. Causa: en el estado vacío con compositor centrado el toolkit deja el transcript con `overflow: visible`. Ahora el transcript se desplaza dentro de `.lienzo-chat` y la bienvenida es más compacta en móvil. Verificado por hit-test real (`elementFromPoint` + `click({trial:true})`) a 390×844 y 360×640: las tres sugerencias son clicables.
- **UX2 (media)** · El inspector heredaba el fondo de la barra de navegación (#11212D) con texto de página (1.05:1). `.agent-sidebar-panel` fija `--agent-kit-nav-surface` al fondo de la página. Contraste medido: 17.4:1 en claro, 12.9:1 en oscuro.
- **UX3 (baja)** · «Para empezar» en oscuro usa #9BA8AB (antes #4A5C6A sobre #212121).

Sin cambios en acciones, adaptador ni servidor; typecheck en verde. No se repitieron las 195 regresiones ni el backend vivo (cambios solo de interfaz).

## 7 noviembre · Respuesta al dictamen de reverificación (91/100)

Dictamen: `evidencia/resultados/ux-2026-11-07/reverificacion/dictamen.json` (UX1–UX3 cerrados, 12/12). Pedía cuatro frentes para aspirar al 100. Trabajados hoy los dos que no dependen de médicos reales ni de la entrega.

**Creatividad y diseño · fricción sin usuarios** (`evidencia/friccion-ui.mjs`, 40/40, capturas en `evidencia/capturas-friccion/`). Hallazgos y correcciones:

- F1 · Con el texto al 200 % la barra lateral mantenía 560 px fijos y dejaba 335 px al contenido. `--chat-sidebar-width: min(17.5rem, 28vw)`.
- F2 · El archivo de exportadas vacío decía «No hay consultas pendientes de revisión». Mensaje propio de exportadas.
- F3 · La cuadrícula de dos columnas dependía del ancho de la ventana; con el inspector abierto o texto ampliado aplastaba las tarjetas (nombre con ancho 0). Ahora depende del ancho del contenido (`@container` / `@xl:grid-cols-2`) y la pista única es `minmax(0,1fr)`.
- F4 · El chip largo de alergias no envolvía y ensanchaba la tarjeta. `max-w-full whitespace-normal`.
- F5 · El formulario de nueva línea mantenía seis columnas al 200 % y «Añadir» se salía. Columnas por contenedor (`@3xl`) con `minmax(0, …)`.
- F6 · Las rutas anidaban un `<main>` dentro del `<main>` del layout (dos landmarks). Las rutas usan `div`; un solo `main` por pantalla.
- Verificado sin hallazgos: foco visible y Tab/Enter en tarjetas, «Plan en blanco», formulario, «Bloquear», flechas en pestañas, foco atrapado y Escape en el diálogo de aprobación, sugerencias y enlace del chat; esqueletos en espera, mensaje con MEGI caído, consulta inexistente con «Volver a la lista», aviso y estado intacto ante una acción fallida; sin desbordamiento a 640 px ni con texto al 200 %.

**Uso de Agent-Native · demo de continuidad** (`evidencia/continuidad.mjs`, 18/18 con Grok 4.20 non-reasoning, con un reintento documentado a través del aviso R2; guion `evidencia/demo-continuidad.md`; capturas `evidencia/capturas-continuidad/`). Dos comportamientos del modelo observados durante las ejecuciones y cubiertos ahora por la interfaz:

- R1 · El agente respondió con el plan en texto, afirmó que el recibo estaba en el tablero y no llamó a `proponer-plan`. Si el médico pidió la propuesta y el turno termina sin guardar un plan, `TrabajoAgente` muestra «El agente terminó sin guardar un plan en el tablero» con «Volver a pedir la propuesta» (mensaje que exige la herramienta) y «Ver respuesta».
- R2 · Pedido en un mismo mensaje un cambio permitido y quitar la línea fijada, el servidor rechazó el reajuste atómico (`linea_bloqueada`) y el modelo informó «1 línea editada». Si un turno termina sin herramienta de escritura y la versión no cambia, el tablero avisa «El último turno del agente no cambió el plan… Lo que diga el chat no está guardado hasta que lo veas aquí». El servidor nunca aplicó nada; el aviso evita confiar en el texto.

**Innovación · valor diferencial comparable** (`evidencia/valor-diferencial.mts`, 20/20; `evidencia/valor-diferencial.md`). Misma receta inicial en los cuatro casos: 3 alertas visibles antes de aprobar, 12/12 intentos sobre fijadas y 12/12 fuera de alcance rechazados sin escribir, 2 aprobaciones detenidas por conciliación y 2 por bloqueo, 7/11 líneas con fuente, 26 versiones, 30 eventos, 4 exportaciones selladas; el chat sin mesa, 0 por construcción. No mide errores clínicos ni tiempo de médicos.

- R3 · Al probar el agente en vivo con Mateo (alergias sin registro), el aviso R1 saltó en falso: `ask-question` termina el turno a propósito para esperar la respuesta del médico. `TrabajoAgente` ya no muestra R1 ni R2 cuando el turno acabó con una pregunta pendiente.
- Prompt del sistema y petición de la UI reforzados: «crear el plan ES llamar a proponer-plan en este mismo turno; nunca escribas el plan como texto ni digas que está guardado sin el recibo». El modelo sigue siendo no determinista; el servidor y los avisos R1/R2 son la red de seguridad.

**Regresiones repetidas sobre la interfaz final:** fricción 40/40, recorrido 33/33 (su localizador del nombre de paciente se acotó al contenido porque los títulos de chats del panel también lo contienen), advertencias 7/7, agente en vivo 15/15 (plan visible en 3,2 s en esa ejecución), continuidad 18/18, reverificación del auditor repetida 12/12 en `evidencia/resultados/ux-2026-11-07/reverificacion-final/`; typecheck, doctor y build en cero (`evidencia/resultados/verificacion-ui-2026-11-07.json`). Una ejecución intermedia del recorrido falló en «alternativa automática» porque el turno del modelo tardó más de los 15 s de gracia del guion en arrancar; la repetición pasó. Los cambios son de interfaz y del texto del prompt (rutas, CSS, `TrabajoAgente`, `agente.ts`, `agent-chat.ts`); acciones, adaptador y servidor no cambiaron, así que las 195 regresiones de servidor no se repitieron. Resumen con hashes: `evidencia/resultados/respuesta-dictamen-91.json`.

**Sigue detenido por decisión de David (7 nov):** utilidad con médicos reales (I4) y cuentas individuales en la instalación destino (I2), y la entrega (Clips, formulario, commits, publicación).

## 7 noviembre · Publicación en el repo del equipo

Con autorización de David (7 nov), los cambios se subieron al monorepo privado `NGZeggers/hackathons`, rama `bluiders.io` (commits `37bb86f` y `6b087ff`). Los tres repos locales no tienen remoto y su historial no coincide con el del equipo, así que se publicó volcando los árboles de trabajo (solo archivos no ignorados, sin `.env`, bases de datos ni claves). La restricción de «sin GitHub» de PARA_EL_100.md y ENVIO_HACKATHON.md quedó levantada ese día únicamente para ese repo privado; Clips, formulario y despliegue seguían sin hacerse.

**Incidente corregido:** el primer volcado copió también el `.gitignore` del repo raíz local, que ignora `megi-revision/` y `megi-demo/` por ser repos anidados; en el monorepo eso dejó fuera los archivos nuevos de esas carpetas (13 módulos, p. ej. `server/lib/megi/secretos.ts` y varios componentes de `app/components/revision/`), con lo que el repo publicado no compilaba. Se restauró el `.gitignore` del equipo (el de `d03fdf7`), se volvieron a añadir los archivos y se verificó el typecheck sobre el clon antes de empujar. Las cifras de `iteraciones-i1-i6.json` y de la auditoría se midieron sobre el árbol local con cambios sin commit respecto a `b631b87`; ese árbol es exactamente el que quedó publicado tras esta corrección.

