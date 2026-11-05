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
- `evidencia/video/demo-grok.mp4` (191 s, también `.webm`): grabación automática del guion completo en la app real con Grok 4.7 y MEGI de demo: lista → ficha y nota SOAP → el agente propone (sustituye el naproxeno por paracetamol, explica, pide confirmar alergias) → el médico bloquea el paracetamol → se pide al agente «quita Paracetamol y agrega tratamiento tópico» → el agente revisa el plan para no tocar lo bloqueado → bitácora → aprobar y exportar a MEGI → pestaña de exportación FHIR. Fotogramas de control en `evidencia/video/fotogramas/`.
- `ENVIO_HACKATHON.md`: campos del formulario, descripción en inglés lista para pegar (con trabajo previo y nuevo), pasos para grabar en Clips y lista final.

### Pendiente (decisión de David, 2 nov por la noche)
- Grabación pública en Clips y envío del formulario quedan **en espera hasta definir el reparto con el equipo** (nombres y quién envía). Todo lo demás está listo: video de referencia `evidencia/video/demo-grok.mp4`, pasos y texto en `ENVIO_HACKATHON.md`.
- Al retomar: `megi-demo/backend/start_demo.sh` → `seed_demo.py` → borrar `megi-revision/data/` → `pnpm dev` → grabar en Clips (día 8) → enviar y guardar la confirmación (día 9, antes de las 6 PM hora de México).


## Correcciones tras la auditoría del hackatón

**Publicación y envío detenidos por David.** No se subió ningún video a Clips ni se envió el formulario. La sesión de Clips quedó preparada por el usuario; no constituye una participación. Quedan reservados al equipo los datos del remitente, integrantes, elegibilidad, reparto del premio y aceptación de las bases.

- Corregida la suplantación del médico: el actor se deriva del caller del servidor. Los cambios con origen médico se rechazan desde tool/MCP/CLI/HTTP y otros transportes; la aprobación es `uiOnly`, fuera del catálogo del agente. La prueba de sesión, mismo origen y capacidad UI la verifica el framework.
- Propuesta, edición, adición y reajuste guardan líneas, verificación y bitácora en la misma transacción. MEGI caído o una respuesta de verificación incompleta revierten todo; no dejan planes huérfanos ni dosis a medias. Se comprueba también la cancelación antes de confirmar.
- Mutaciones serializadas con bloqueo de la fila del plan y relectura de la línea. Se rechazan cambios duplicados sobre una línea en el mismo reajuste.
- Aprobación y exportación recuperables: un reintento local devuelve el resultado ya exportado; si falló la descarga tras la aprobación remota, el adaptador comprueba que el contenido coincide y recupera los documentos sin volver a aprobar ni sobrescribir otro plan.
- El SOAP aprobado refleja el tratamiento revisado, en vez de conservar fármacos sustituidos del texto original. La medicación activa separa nombre y dosis para evitar mostrar o verificar dosis repetidas.
- Conservada la licencia de la plantilla e inventariadas las dependencias realmente instaladas: 828 paquetes Node y 57 Python. `pnpm licenses list` falló por índices ausentes del store; el inventario se obtuvo de manifiestos y avisos instalados, sin cambiar dependencias.
- Prueba manual de la versión corregida en Firefox sobre `demo-c4`, Luis Modelo Simulado: crear plan en blanco, añadir Paracetamol, bloquear/desbloquear, editar dosis, rechazar con motivo, reactivar, aprobar contra el backend local de demo y visualizar FHIR con sello. La consulta de prueba quedó aprobada; no se restauró ni borró la base existente.
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
