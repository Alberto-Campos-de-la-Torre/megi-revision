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

Verificación de regresión: desde el repo raíz, `megi-revision/node_modules/.bin/tsx evidencia/auditoria-hackathon.mts --http`. Escribe únicamente en PGlite en memoria; el modo http solo lee y verifica pacientes ficticios. Comprueba suplantación por todos los transportes, rollback, verificación incompleta, concurrencia, cancelación, recuperación de exportación y coherencia del SOAP.
