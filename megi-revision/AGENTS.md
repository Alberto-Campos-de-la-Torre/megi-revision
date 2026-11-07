# Chat — Agent Guide

Chat is the minimal chat-first agent-native app. `/` redirects to shared sign-in, then `/home`, the editable Get started page. Chat lives at `/chat`; new chats start there. Actions carry capabilities; screens exist only for durable workflows.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. `.agents/skills/build-an-app/SKILL.md` — start here for vague requests to create a domain app. `.agents/skills/adding-a-feature/SKILL.md` — cross-area feature checklist. Data/integrations: `.agents/skills/actions/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`. UI: `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`. Agent context/workflows: `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`. Framework: `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"`, `pnpm action docs-search --slug "<slug>"`, `pnpm action docs-search --list`, `pnpm action source-search --query "<pattern>"`, `pnpm action source-search --path <path>`, or `pnpm action source-search --list`. For external-agent integrations, read `pnpm action docs-search --slug "external-agents"`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Normal app data must flow through actions. Keep actions deterministic and focused; use agent chat/AgentSidebar for AI work and follow-ups in the same thread. Keep structured state in SQL and large files in configured storage; persist references only.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Never hardcode credentials, webhook URLs, or private/customer data.
- Never fabricate. Report failures and recover; verify writes by reading the row or screen. Navigation is in `<current-screen>`; use `view-screen` for fresh visible-record details.

For custom branding, keep `server/plugins/agent-native-email-branding.ts` aligned: `app.name` appears in transactional email and optional `app.logoUrl` must be an absolute HTTPS URL.

## Application state

- `navigation` describes the view and selected ids. Chat is `chat` at `/chat` and `/chat/<threadId>`; the Get started page is `home` at `/home`; `/` opens shared sign-in/signup.
- Use `navigate` when supported and `view-screen` for a fresh read of visible details; basic navigation is already in `<current-screen>`.

## Building a domain app

Choose the primary workflow and route before editing. Add a domain route under `app/routes/` and set `app.homePath` in `server/plugins/agent-native-email-branding.ts` with `defineAppConfig`. The default Get started page lives at `/home`, and Chat stays at `/chat`; edit `app/routes/home.tsx` when replacing that page with a domain-specific home. Add a static link in `app/components/layout/Sidebar.tsx` before `ChatThreadsSection`; `Header.tsx` uses `APP_TITLE` elsewhere. Shared sidebar and AgentInspector remain.

Use `adding-a-feature` for functional parity and `frontend-design` for a user-facing screen. Keep feature guidance here; do not rewrite `README.md` or `DESIGN.md`. After all edits, run one typecheck, one doctor check, and one browser smoke of the primary workflow, including overlap rejection, cancellation freeing the slot, and authenticated landing. Skip production build and extra test suites.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.

## MEGI Revisión

Mesa de revisión post-consulta: el médico y el agente preparan juntos la receta y los pendientes de una consulta consolidada en MEGI. `/revision` lista consultas pendientes; `/revision/:consultaId` es el tablero del plan. Chat sigue en `/chat`. Guía detallada: skill `revision-clinica`.

- Lo clínico (nota, alergias, medicación activa, verificación de seguridad, aprobación, FHIR) vive en MEGI y se consume por el adaptador (`MEGI_MODE` mock|http). Aquí vive el plan: líneas con estado `propuesta|editada|bloqueada|rechazada`, verificación `ok|advertencia|bloqueado` y bitácora.
- **Bloqueada = intocable.** `actualizar-linea` y `reajustar-plan` responden `linea_bloqueada` (409) y no escriben nada; repórtalo, no reintentes. Solo el médico desde la interfaz autenticada bloquea, desbloquea y confirma alertas (`confirmaAlertas`). El actor se deriva del `caller` del servidor: `origen` no concede permisos; tool/MCP/CLI/HTTP no pueden suplantar al médico.
- `aprobar-plan` falla con `alertas_sin_confirmar` si queda un fármaco vigente con bloqueo; MEGI aplica el mismo gate en el servidor.
- `aprobar-plan` es `uiOnly` y no se expone al modelo; si el médico pide aprobar, indícale el botón de la pantalla. El framework verifica sesión de navegador, mismo origen y capacidad UI.
- Todo cambio lleva motivo; `proponer-plan` y `reajustar-plan` son atómicos: líneas, verificación y bitácora se confirman juntas o se revierten. Las mutaciones bloquean el plan en SQL y releen las líneas tras adquirir el bloqueo. MEGI caído o verificación incompleta no dejan cambios. La exportación puede recuperarse tras una descarga interrumpida; no se vuelve a aprobar un plan cerrado.
- En `/revision/:consultaId`, `navigation` trae `consultaId`.
- El adaptador http valida el contrato de `/safety/rx-check`: cuerpo inválido, `alerts` ausente, severidad desconocida, alerta sin mensaje o recuentos incoherentes → 502 `verificador_invalido` (no es `megi_no_disponible`; no se reintenta igual y nunca significa «sin alertas»). Una alerta sin fármaco atribuible se aplica a toda la receta propuesta.
- Identidad clínica en `http`: cada médico conecta SU cuenta de MEGI en Ajustes → claves (`MEGI_USUARIO` / `MEGI_CONTRASENA`, ámbito usuario, `server/lib/megi/secretos.ts`); `megi(email)` crea una conexión por correo (rotación → conexión nueva; retirada → 403 y sesión olvidada) y MEGI firma `approved_by` con esa identidad. Sin conexión propia solo entra la cuenta de servicio (`MEGI_USER/MEGI_PASSWORD`) si el correo está en `MEGI_MEDICOS`; si no, 403 `sin_rol_clinico`; almacén de secretos caído → 503 `credenciales_no_disponibles` (reintentable). Las acciones usan `conectarMegi(email)` para devolver ese contrato, no un 500. `exigirMedico`/`origenAutorizado` son asíncronos y exigen caller `frontend` + identidad clínica. La nota de aprobación lleva el correo de la sesión; MEGI la muestra en la línea de tiempo de auditoría. En mock la lista es opcional.
- Lecturas paginadas (I3): `listarPendientes({limite, desde})` usa `GET /review/pending` (filtrado por médico en el servidor, con ficha del paciente) y `POST /review/medication-history` (historial de varios pacientes por páginas); una página inválida, incompleta o con total cambiado se rechaza (`pagina_invalida` / `pagina_inconsistente`), nunca un historial truncado. Backend anterior (404 Not Found) → recorrido paciente a paciente (`listarRecorriendoPacientes`). `listar-consultas` acepta `limite`/`desde` y devuelve `total`/`siguiente`. Medición: `evidencia/coste-historial.mts`.

- Tablero: `TrabajoAgente` muestra el progreso real del turno y dos estados de recuperación. Si el médico pidió la propuesta y el turno termina sin `proponer-plan`, ofrece «Volver a pedir la propuesta» (`pedirPropuesta(..., true)` exige la herramienta). Si un turno termina sin ninguna herramienta de escritura y la versión no cambia, avisa de que lo dicho en el chat no está guardado. Ninguno de los dos avisos aparece si el turno terminó con `ask-question` (el agente espera al médico). Las rutas no anidan `<main>` (el layout aporta el landmark) y las cuadrículas usan consultas de contenedor (`@container`), no el ancho de la ventana. Comprobación: `evidencia/friccion-ui.mjs`.
| Acción | Para qué |
| --- | --- |
| listar-consultas | Consultas pendientes de revisión con paciente y plan |
| ver-contexto-consulta | SOAP, dx, fármacos/pendientes de la nota y ficha del paciente |
| proponer-plan | Crear el plan con todas las líneas, verificadas (409 plan_existente) |
| obtener-plan | Plan, líneas, verificación y bitácora |
| actualizar-linea | Editar o cambiar estado de una línea (409 linea_bloqueada) |
| agregar-linea | Añadir una línea y re-verificar |
| reajustar-plan | Varios cambios atómicos con motivo; respeta bloqueos |
| aprobar-plan | Aprobar y exportar a MEGI (409 alertas_sin_confirmar) |

Verificación de regresión: desde el repo raíz, `megi-revision/node_modules/.bin/tsx evidencia/auditoria-hackathon.mts --http`. Escribe únicamente en PGlite en memoria; el modo http solo lee y verifica pacientes ficticios. Comprueba suplantación por todos los transportes, rollback, verificación incompleta, contrato del verificador y alertas sin atribución, rol clínico por `MEGI_MEDICOS`, lecturas en paralelo acotadas, concurrencia, cancelación, recuperación de exportación y coherencia del SOAP.


## Revisión trazable

- Cada mutación guarda versión e instantánea en su misma transacción. `obtener-plan.plan.version` se pasa como `versionEsperada`; una confirmación clínica debe quedar ligada a la versión que el médico vio, no a una consulta refrescada después.
- `alcanceAgente` vive en SQL: null permite líneas abiertas, una lista delimita ids y [] congela toda edición del agente. Solo `definir-alcance` desde UI cambia esa autorización. La selección de la pestaña no concede permisos.
- `view-screen` hidrata consulta, selección, líneas actuales y fuentes. La UI guarda solo ids en `revision-selection:<browserTabId>` y los limpia al salir.
- `conciliar-medicacion` conserva procedencia/fecha y vuelve a verificar con los tratamientos activos o sin confirmar. No se aprueba con antecedentes sin confirmar. No se fusiona el historial en una lista de activos supuestos.
- Invalidación por recurso/plan al completar herramientas. Por petición explícita de PARA_EL_100.md, el tablero añade foco y 60 s como respaldo ante caída de sincronización; no hay sondeo de progreso del modelo. Comprobar que las propuestas aparecen sin recargar.
- `revision-clinica` es explícitamente runtime. El agente usa `docs-search` para cargarla antes del trabajo clínico; sus reglas también están en el prompt y los invariantes se exigen en servidor.

| Acción nueva | Para qué |
| --- | --- |
| historial-plan | Páginas de versiones, fuentes, autores y tiempos de servidor |
| metricas-revision | Lectura de mediciones exploratorias del caso y usuario |
| preparar-aprobacion | Solo UI: actualizar alertas y fijar la versión visible de la confirmación |
| definir-alcance | Solo UI: delimitar o liberar líneas editables por el agente |
| conciliar-medicacion | Solo UI: confirmar antecedentes y medicación referida |
| medir-revision | Solo UI: iniciar, señalar plan visible y terminar cronómetro |
| restaurar-demo | Solo UI y mock: restaurar los cuatro casos propios; conserva mediciones |

Demo autónoma: `pnpm demo` arranca mock con SQL en `.demo/pglite`, separado de `data/`, y conserva el agente configurado. Requiere un modelo conectado para propuestas reales. No publica la app ni utiliza el backend privado. La restauración no afecta a otros usuarios; las exportaciones de mock son sintéticas.

## Cierre PARA_EL_100

- El agente siempre envía versionEsperada, incluso sin alcance. MEGI vivo se fusiona con decisiones por pauta y fuente; recetas nuevas entran sin_confirmar. El caché por paciente/adaptador dura una sola acción y conserva el historial crónico.
- contextoFuente contiene solo SOAP, propuestas, pendientes e historial mínimo (sin transcripción). Legacy abierto se hidrata con fallo 502 tipado; exportado sin fuentes permanece neutro.
- sugerir-reemplazo guarda una alternativa pendiente para alcanceSugerencias, sin tocar la receta. resolver-sugerencia es solo UI; requiere desbloqueo médico explícito y pauta de origen intacta. La sugerencia tiene máquina de estados pendiente→aceptada/descartada.
- La petición de PARA_EL_100.md autoriza build, README, pruebas Playwright reproducibles y commit local, además de los checks habituales. No autoriza publicación/GitHub/Clips. Evidencia: ../evidencia/README.md.

- Rendimiento: `contextoFuenteDe` reutiliza el JSON fuente únicamente dentro de `enPeticionMegi`. No conservarlo entre acciones. Las pistas de invalidación de una herramienta sustituyen las del objetivo anterior. El prompt clínico usa ocho herramientas iniciales, acciones nativas, `lazyContext`, `corpusTools: "lazy"` y `skipFilesContext`; conserva el modelo seleccionado y reutiliza el contexto fresco de la pantalla. En Core 0.222.2, `leanPrompt` desactiva el contexto diferido; no combinarlo con esta configuración. Las métricas vinculan la versión al runId del contexto confiable del servidor (v5); el hook público de observabilidad lee la traza propia bajo demanda y muestra solo duraciones.

- `proponer-plan` entrega el control al médico tras guardar y verificar: `endsTurn` y recibo `core.record-change`. Solo el éxito termina el turno; los fallos siguen llegando al agente. `mcpTool: true` conserva la creación directa externa con resultado completo y enlace. Las ediciones posteriores continúan en el chat; aprobar sigue siendo solo UI.

- Un recibo proyectado conserva id de plan/consulta. El observador de tool-done refresca solo recursos conocidos de escrituras transaccionales exitosas, con o sin completedSideEffect; no extiende el alcance a consultas ajenas ni a lecturas/fallos. Resultados sin ids conservan el alcance del input de esa llamada, nunca el de una llamada anterior.

- En el inspector clínico, `dynamicSuggestions={false}` conserva las sugerencias en español: la lista genérica dinámica del framework sustituye las estáticas con textos en inglés. Comprobarlo con el panel vacío abierto.

- Identidad de despliegue: `app.id = megi-revision`. La demo xAI mide D4 con `AGENT_MODEL=grok-4.20-0309-non-reasoning`; un valor explícito tiene prioridad sobre la preferencia de app. Reiniciar el servidor tras cambiar el archivo de entorno y verificar el modelo efectivo en el selector y su traza. Nunca mostrar credenciales al revisar esta configuración.
