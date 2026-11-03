# MEGI Revisión

Mesa de revisión post-consulta construida con [Agent-Native](https://www.agent-native.com) para el hackatón de Builder.io (noviembre de 2026). Un médico y un agente preparan juntos la receta y los pendientes de una consulta ya consolidada en MEGI: el agente propone un plan verificado contra alergias, crónicos y medicación activa; el médico edita, bloquea o rechaza líneas desde la pantalla; el agente reajusta solo lo que no está bloqueado y explica cada cambio; el médico aprueba y exporta la nota FHIR sellada a MEGI.

Interfaz y agente usan las **mismas acciones** sobre los **mismos registros**. Las reglas (bloqueada = intocable, bloqueo de seguridad sin confirmar = no se aprueba) viven en las acciones, no en la pantalla ni en el prompt.

Todos los pacientes son ficticios. Es apoyo a la decisión; la aprobación final es siempre del médico.

## Correr

```bash
pnpm install
pnpm dev                 # http://localhost:8080 → /revision
```

`.env` (ver `.env.example`):

```
MEGI_MODE=mock           # datos ficticios en memoria (server/lib/megi/megi-mock.ts)
MEGI_MODE=http           # backend MEGI real: MEGI_URL, MEGI_USER, MEGI_PASSWORD
OPENAI_BASE_URL=https://api.x.ai/v1   # LLM del agente: Grok (xAI), compatible con OpenAI
OPENAI_API_KEY=...
```

Motor local alternativo con Ollama (sin internet, coherente con MEGI): el contexto por defecto de Ollama (4k) es
demasiado corto para el catálogo de herramientas, así que hay que crear una variante con 32k:

```bash
ollama pull qwen2.5:14b
printf "FROM qwen2.5:14b\nPARAMETER num_ctx 32768\n" > Modelfile && ollama create qwen2.5-14b-32k -f Modelfile
AGENT_ENGINE=ai-sdk:ollama AGENT_MODEL=qwen2.5-14b-32k pnpm dev
```

Para el modo `http` se usa la copia de demo de MEGI (`../megi-demo/backend/start_demo.sh`, puerto 8020, usuario `demo_medico`). Ver `../megi-demo/docs/api_megi_para_adaptador.md`.

## Estructura

```
actions/                 las 8 acciones del dominio (una por archivo, defineAction + zod + outputSchema)
server/db/schema.ts      planes · lineas_plan · eventos_revision (Drizzle, PGlite en local)
server/plugins/db.ts     migración v1 "mesa-de-revision"
server/lib/plan.ts       reglas compartidas: verificación, eventos, plan cerrado
server/lib/megi/         contrato MegiAdapter + implementaciones mock y http
app/routes/revision*     /revision (lista) y /revision/:consultaId (tablero)
app/components/revision/ tablero, líneas, ficha del paciente, bitácora, botones del agente
.agents/skills/revision-clinica/SKILL.md   cómo propone y reajusta el agente
server/plugins/agent-chat.ts               prompt del agente y herramientas iniciales
```

## Acciones

| Acción | Para qué | Rechaza con |
| --- | --- | --- |
| listar-consultas | Consultas pendientes de revisión con paciente y plan | |
| ver-contexto-consulta | SOAP, dx, fármacos/pendientes de la nota, ficha del paciente | not_found |
| proponer-plan | Crear el plan con todas las líneas y verificarlas | plan_existente, consulta_cerrada |
| obtener-plan | Plan, líneas, verificación, bitácora, exportación | not_found |
| actualizar-linea | Editar o cambiar estado de una línea | linea_bloqueada, solo_medico, plan_cerrado |
| agregar-linea | Añadir una línea y re-verificar | plan_cerrado |
| reajustar-plan | Varios cambios atómicos con motivo | linea_bloqueada (no aplica nada), plan_cerrado |
| aprobar-plan | Aprobar y exportar a MEGI | alertas_sin_confirmar, solo_medico, megi_rechazo |

## Verificar

```bash
pnpm typecheck && pnpm agent-native:doctor
AGENT_USER_EMAIL=tu@correo.com pnpm action listar-consultas
AGENT_USER_EMAIL=tu@correo.com pnpm action proponer-plan '{"consultaId":"demo-c1","lineas":[{"tipo":"farmaco","texto":"Amoxicilina","dosis":"500 mg","frecuencia":"cada 8 h","duracion":"10 días"}]}'
```

La segunda devuelve la amoxicilina con `verificacion: "bloqueado"` por la alergia a penicilina del caso 1.

## Trabajo previo y nuevo (para el formulario del hackatón)

- **Previo (equipo MEGI, antes del 27 de octubre de 2026):** backend clínico MEGI (FastAPI) con expediente, SOAP, verificador de recetas, aprobación y FHIR. Se consume por HTTP; no se modificó.
- **Plantilla:** Chat de Agent-Native (MIT).
- **Nuevo (hackatón):** todo lo listado en «Estructura»: modelo de datos, acciones, adaptadores, pantallas, skill, prompt, siembra de demo y pruebas.
