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
AGENT_ENGINE=ai-sdk:openai
AGENT_MODEL=grok-4.20-0309-non-reasoning
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
actions/                 las 17 acciones del dominio (una por archivo, defineAction + zod + outputSchema)
server/db/schema.ts      planes · lineas_plan · eventos_revision · versiones_plan · mediciones_revision (Drizzle, PGlite en local)
server/plugins/db.ts     migraciones aditivas v1–v5
server/lib/plan.ts       reglas compartidas: verificación, eventos, plan cerrado
server/lib/megi/         contrato MegiAdapter + implementaciones mock y http
app/routes/revision*     /revision (lista) y /revision/:consultaId (tablero)
app/components/revision/ tablero, líneas, ficha del paciente, bitácora, botones del agente
.agents/skills/revision-clinica/SKILL.md   cómo propone y reajusta el agente
server/plugins/agent-chat.ts               prompt del agente y herramientas iniciales
```

## Acciones

| Acción | Para qué | Quién puede llamarla |
| --- | --- | --- |
| listar-consultas | Pendientes y archivo de exportadas | Agente / médico |
| ver-contexto-consulta | SOAP, paciente y propuestas de la nota | Agente / médico |
| proponer-plan | Crear y verificar todas las líneas de forma atómica | Agente / médico |
| obtener-plan | Plan, versión, alcance, fuentes, conciliación y sugerencias | Agente / médico |
| actualizar-linea | Editar pauta/estado; fijar y desbloquear solo desde UI | Agente / médico |
| agregar-linea | Añadir y volver a verificar | Agente / médico |
| reajustar-plan | Cambios atómicos limitados por alcance y bloqueo | Agente / médico |
| historial-plan | Versiones paginadas, fuentes, autores y tiempos | Agente / médico; solo lectura |
| metricas-revision | Comparación exploratoria y operaciones del servidor | Agente / médico; solo lectura |
| sugerir-reemplazo | Alternativa autorizada sin modificar la receta | Agente / médico |
| aprobar-plan | Confirmación clínica y exportación | Solo médico desde UI |
| preparar-aprobacion | Refrescar alertas y fijar versión a revisar | Solo médico desde UI |
| definir-alcance | Autorizar edición o sugerencias sobre ids concretos | Solo médico desde UI |
| conciliar-medicacion | Confirmar antecedentes y medicación referida | Solo médico desde UI |
| resolver-sugerencia | Aceptar/descartar; exige desbloquear antes de reemplazar | Solo médico desde UI |
| medir-revision | Iniciar, señalar visibilidad y terminar/descartar cronómetro | Solo médico desde UI |
| restaurar-demo | Restaurar los cuatro casos sintéticos propios, solo mock | Solo médico desde UI |

El servidor deriva el actor del caller. El agente siempre envía `versionEsperada`; una versión antigua falla con `version_desactualizada`. El alcance se aplica dentro de la transacción; una selección visual no concede permiso. Los fármacos nuevos del historial vivo entran sin confirmar y frenan aprobación. El caché vive solo durante una acción: no descarta recetas crónicas antiguas.

La alternativa automática queda fuera de la receta hasta la aceptación explícita del médico. No desbloquea líneas ni amplía el alcance de edición. Aceptarla verifica de nuevo el conjunto y guarda una versión. Fuentes y alertas son datos distintos; no se interpreta ausencia de alertas como garantía de seguridad clínica.

Las mutaciones HTTP compartidas requieren la aprobación del framework. La aprobación clínica no está disponible por HTTP/MCP/CLI/tool. El manifiesto MCP está conservado en [revision-trazable-mcp.json](../evidencia/revision-trazable-mcp.json), con `historial-plan` y `metricas-revision` entre las herramientas de solo lectura. Se descubren cuando hacen falta y no cargan el catálogo inicial.

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

## Demo y evidencia reproducible

`pnpm demo --port 8082` inicia mock con SQL en `.demo/pglite`, separado de `data/`. Conserva el modelo configurado. «Restaurar mis casos» elimina solo los planes/versiones/exportaciones sintéticos propios; conserva mediciones y otros usuarios. Antes de grabar, úsalo y comprueba cuatro pendientes.

Desde el repositorio padre, consulta [evidencia/README.md](../evidencia/README.md). Los recorridos Playwright ejecutan la interfaz, guardan JSON y capturas, restauran los casos antes de cada recorrido y prueban al agente real en un comando separado. Los tests de servidor usan PGlite en memoria; HTTP se verifica contra una base MEGI de demo aislada.

El tablero invalida por ids de plan y usa foco/60 s como respaldo. La navegación transmite ids, versión y alcance; el servidor los vuelve a validar. Las etapas proceden de eventos del runtime, sin temporizadores simulados. Las métricas separan el cronómetro del caso, las operaciones del servidor y la API del modelo. Al abrir el panel tras terminar el turno, el hook público de observabilidad lee la última traza del agente vinculada a ese plan; el acceso se verifica por propietario. La duración de API incluye red y reintentos, y no equivale a cómputo puro del modelo. Los tiempos son exploratorios con n pequeño. La migración v5 guarda el runId del contexto del servidor, nunca un id enviado por el modelo.

`pnpm build` genera el artefacto local. La comprobación de despliegue avisa de `BETTER_AUTH_SECRET` y Postgres persistente ausentes en este entorno de desarrollo; ese artefacto no acredita una configuración de producción. No se publica nada con este flujo.

El flujo clínico inicia con ocho herramientas y acciones nativas con contexto y herramientas de proveedores diferidos (`nativeActionsInDev`, `lazyContext`, `corpusTools: "lazy"`, `skipFilesContext`). Usa el registro fresco de `current-screen` y descubre las herramientas restantes cuando hacen falta. Los resultados detallados quedan en el tablero; el chat confirma la escritura brevemente. El contexto fuente se parsea una sola vez dentro de cada acción y se vuelve a leer en la siguiente. Las pistas de invalidación se sustituyen por llamada, sin acumular planes anteriores.

La creación entrega el plan al médico con un recibo de líneas, bloqueos, advertencias y conciliación pendiente. `proponer-plan` usa `endsTurn` después de verificar y guardar, evitando una segunda llamada al modelo solo para repetir el resultado. El motivo clínico permanece en el tablero. Los errores no producen recibo ni terminan por esa vía; las siguientes peticiones y reajustes siguen en el chat. `mcpTool: true` conserva el resultado completo para clientes externos y la aprobación continúa reservada a la UI médica.

El recibo conserva ids para sincronización. El observador contempla eventos de entrega con y sin `completedSideEffect` y refresca directamente los recursos observados de escrituras conocidas y exitosas; la siguiente llamada sustituye ese alcance. Los 60 s quedan como respaldo del transporte, sin bloquear la aparición normal del plan.

El inspector clínico mantiene sus tres sugerencias estáticas en español; se desactiva la sustitución dinámica genérica, que añadía texto en inglés al abrir un chat vacío.

La demo de xAI usa Grok 4.20 Non-Reasoning para el objetivo de latencia. En Core 0.222.2, un `AGENT_MODEL` explícito prevalece sobre la preferencia guardada de la app; reinicia `pnpm demo` después de cambiarlo. La identidad estable es `megi-revision`. Los intentos de comparación conservan el modelo efectivo de la traza y restauran sus listas temporales; una selección visual por sí sola no valida el modelo usado. Resultados y límites: [evidencia](../evidencia/README.md).

Medición final del caso sintético, después de responder alergias, exploratoria n=1: plan visible en 4,2 s y turno completo en 3,7 s con Grok 4.20 Non-Reasoning. Es una observación local, no una garantía máxima ni un resultado clínico. Fuente: [latencia del recorrido](../evidencia/resultados/latencia.json).
