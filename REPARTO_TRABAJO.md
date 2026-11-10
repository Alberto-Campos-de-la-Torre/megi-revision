# MEGI Revisión · Reparto en dos frentes

Complementa a `PLAN_HACKATHON_AGENT_NATIVE.md`. Fecha: 2 de noviembre de 2026.

**Idea central:** la app Agent-Native nunca habla con MEGI directamente. Habla con un **adaptador** (`lib/megi/`) que tiene dos implementaciones con la misma interfaz:

- `megi-mock.ts`: datos ficticios en memoria. Con esto trabaja el **Frente A** sin necesitar nada de MEGI.
- `megi-http.ts`: llama a la API real de FastAPI. Lo hace el **Frente B** (David).

Un interruptor `MEGI_MODE=mock | http` en `.env` elige cuál se usa. La app completa, el agente y la interfaz funcionan en ambos modos. El día de la grabación se usa `http`.

---

## Frente A · Sin datos ni acceso a MEGI (colaborador)

Lo que necesita: Node 22+, pnpm, una clave de LLM (Anthropic) y este documento. **No necesita** el backend de MEGI, modelos, ni datos reales.

### A1. Base de la app (día 1)

- Crear la app: `npx --yes @agent-native/core@latest create megi-revision --standalone --template chat`
- `pnpm install`, `pnpm dev`, verificar `http://localhost:8080`, entrar con "Continue as local dev".
- Primer commit: "estado inicial: plantilla chat sin modificar".
- Leer `AGENTS.md` del proyecto y correr `pnpm action docs-search --query "defineAction"`.
- Probar que Clips graba la app en localhost (pendiente 12 del plan).

### A2. Adaptador y mock (día 1 y 2)

- Crear `lib/megi/types.ts` con los tipos de la sección "Contrato".
- Crear `lib/megi/megi-mock.ts` con 4 pacientes ficticios y 1 consulta cerrada cada uno. Los casos deben cubrir:
  1. paciente con alergia a penicilina y SOAP que sugiere amoxicilina (choque directo),
  2. paciente sin alergias registradas (campo vacío, no "ninguna"),
  3. paciente con medicación activa que interactúa con lo propuesto,
  4. paciente limpio, sin conflictos.
- `verificarReceta` en mock: reglas simples en una tabla (fármaco × alergia, fármaco × fármaco) que devuelven `bloqueado | advertencia | ok` con motivo.
- `lib/megi/index.ts` exporta la implementación según `MEGI_MODE`.

### A3. Modelo de datos propio (día 2)

Tablas en Postgres/PGlite de Agent-Native con los helpers de `@agent-native/core/db/schema`:

- `planes`: id, consultaId, pacienteId, estado (`borrador | aprobado | exportado`), creadoEn, actualizadoEn.
- `lineas_plan`: id, planId, tipo (`farmaco | pendiente | indicacion`), texto, dosis, frecuencia, duracion, estado (`propuesta | editada | bloqueada | rechazada`), verificacion (`ok | advertencia | bloqueado`), motivoVerificacion, origen (`agente | medico`), orden.
- `eventos_revision`: id, planId, lineaId, actor (`agente | medico`), accion, detalle, creadoEn.

### A4. Acciones (día 2 a 4)

Todas en `actions/`, con `defineAction`, esquema Zod y descripción clara para el agente. Las de lectura con `http: "GET"`.

| Acción | Entrada | Qué hace |
|---|---|---|
| `listar-consultas-pendientes` | – | Consultas cerradas sin plan aprobado, vía adaptador |
| `ver-contexto-consulta` | consultaId | SOAP + expediente + alergias + medicación activa, vía adaptador |
| `proponer-plan` | consultaId | Crea `plan` y `lineas_plan` en estado `propuesta`; cada fármaco pasa por `verificarReceta` |
| `verificar-linea` | lineaId | Vuelve a verificar una línea y actualiza `verificacion` |
| `editar-linea` | lineaId, campos | Estado → `editada`, origen `medico`, re-verifica, registra evento |
| `bloquear-linea` / `desbloquear-linea` | lineaId | Estado ↔ `bloqueada`, registra evento |
| `rechazar-linea` | lineaId, motivo | Estado → `rechazada` |
| `agregar-linea` | planId, campos | Nueva línea, origen según quien llame |
| `reajustar-plan` | planId, instruccion | **Solo** toca líneas con estado `propuesta` o `editada`. Devuelve lista de cambios con explicación. Si la instrucción exige tocar una bloqueada, responde que no puede y por qué |
| `aprobar-plan` | planId | Falla si hay líneas con `verificacion = bloqueado` no rechazadas |
| `exportar-plan` | planId | Devuelve el texto/JSON del plan; en modo http llama a exportación de MEGI |

Regla de seguridad en código, no solo en prompt: `reajustar-plan`, `editar-linea` y `rechazar-linea` rechazan con error cualquier línea `bloqueada`. El agente no puede saltárselo porque usa la misma acción que la UI.

### A5. Interfaz (día 3 a 5)

- Ruta `/revision`: lista de consultas pendientes (mock o real, da igual).
- Ruta `/revision/:planId`: tablero con las líneas. Por línea: texto, dosis, chip de verificación (ok / advertencia / bloqueado con motivo), botones editar, bloquear, rechazar. Las bloqueadas se ven con candado y no son editables.
- Panel lateral con el chat del agente (viene de la plantilla) y una pestaña "Cambios" que lista `eventos_revision`.
- Banner fijo: "Datos de demostración · pacientes ficticios · apoyo a la decisión, aprueba el médico".
- La UI llama las acciones con `useActionQuery` / `useActionMutation`. Habilitar `useDbSync()` en el tablero con su justificación (el agente y el médico editan el mismo plan).
- Al cambiar de ruta se escribe `navigation` en `application_state` (lo trae la plantilla); confirmar que el agente lo lee con `view-screen`.

### A6. Agente (día 4 y 5)

- `AGENTS.md`: qué es la app, en qué pantalla está el usuario, que siempre use `ver-contexto-consulta` antes de proponer, que nunca intente modificar bloqueadas, que explique cada cambio en una frase.
- `.agents/skills/revision-clinica/SKILL.md`: pasos para proponer, para reajustar, ejemplos de respuesta ante instrucción ambigua ("¿Te refieres a la línea 2, ibuprofeno?").
- `frameworkTools.database = "read"` para que el agente no escriba SQL crudo; las escrituras van por acciones.

### A7. Pruebas y guion (día 5 y 6)

- Casos rotos 1 a 6 del plan, todos reproducibles en modo mock.
- Ensayar el guion del video completo en modo mock. Si funciona en mock, el día de grabación solo cambia el adaptador.

---

## Frente B · Con MEGI (David)

Lo que necesita: `canvas-megi-ia` corriendo, acceso a la base de datos de MEGI y conocimiento de su API y su token HMAC. **No depende** del avance del Frente A hasta el día 6.

### B1. Entorno de demo limpio (día 1)

- Copiar `canvas-megi-ia` a una carpeta nueva de demo. **No tocar** la instalación del consultorio.
- Borrar en la copia `backend/data/megi.sqlite`, `data/sessions/`, `data/speaker_profiles/` y regenerar secreto con `python -m app.gen_secret --force`.
- Arrancar backend en `local_mock` (sin ASR real) y crear admin de demo + usuario médico de demo.
- Verificar `GET /api/health` y `GET /api/health/services`.

### B2. Datos ficticios en MEGI (día 1 y 2)

Reproducir en MEGI los mismos 4 casos del mock del Frente A, con los **mismos nombres e IDs lógicos** para que el guion no cambie entre modos:

- 4 pacientes vía `POST /api/patients` y `PATCH /api/patients/{id}/profile` (alergias, medicación activa).
- 1 consulta cerrada por paciente vía `POST /api/consultations` + `POST /api/soap/update` + `POST /api/review/save`.
- Medicación activa vía `POST /api/medications`.
- Guardar un script `seed_demo.py` que lo haga de cero en un minuto (se usará el día de grabación).

### B3. Verificar la API que usará el adaptador (día 2)

Probar con curl y documentar respuesta real (forma del JSON) de:

- `POST /api/auth/login` → token
- `GET /api/patients`, `GET /api/patients/{id}`, `GET /api/patients/{id}/expediente`
- `GET /api/consultations/{id}`, `GET /api/soap/{id}`
- `POST /api/drugs/check`, `POST /api/safety/rx-check`, `POST /api/drugs/alternatives`
- `GET /api/medications`, `POST /api/medications`
- `GET /api/export/consultation/{id}`, `GET /api/consultations/{id}/fhir`

Entregable: `docs/api_megi_para_adaptador.md` con un ejemplo de petición y respuesta por endpoint. Es lo único que el Frente A necesita de MEGI, y le sirve para que el mock imite las formas reales.

### B4. Adaptador real `megi-http.ts` (día 3 y 4)

- Implementa la misma interfaz que el mock, sobre los endpoints de B3.
- Login de servicio al arrancar y renovación del token; el token vive en el servidor de Agent-Native, **nunca** en variables `VITE_`.
- Variables: `MEGI_URL=http://localhost:8000`, `MEGI_USER`, `MEGI_PASSWORD`.
- Mapeo de respuestas de MEGI a los tipos del contrato. Si un endpoint devuelve algo distinto a lo documentado, se arregla aquí, no en las acciones.
- Error claro cuando MEGI no responde (caso roto 5).

### B5. Ajustes en MEGI si hacen falta (día 4)

Solo si algún endpoint no da lo necesario. Cualquier cambio en `canvas-megi-ia` se hace en una rama `hackathon-demo` y **se declara** como trabajo del hackatón en la tabla de procedencia.

### B6. Integración y grabación (día 6 a 8)

- Día 6: cambiar `MEGI_MODE=http`, correr el guion completo. Lo que falle se arregla en el adaptador o en el seed.
- Día 7: congelar. Ensayo con cronómetro.
- Día 8: grabar en Clips con MEGI real. Tres tomas mínimo.

### B7. Documentación y envío (día 8 y 9)

- Tabla de procedencia al día (incluir rama `hackathon-demo` si existe).
- Evidencia: `git log` de MEGI anterior al 27 de octubre, PDF de reglas y términos, video original.
- Texto de descripción (sección 6.3 del plan) y formulario antes del 9 de noviembre a las 6 PM hora de México.

---

## Contrato entre frentes

Este es el acuerdo que permite trabajar en paralelo. Si uno de los dos lo cambia, avisa al otro el mismo día.

### Interfaz del adaptador (`lib/megi/types.ts`)

```ts
export type Paciente = {
  id: string; nombre: string; edad: number; sexo: "F" | "M" | "X";
  alergias: string[];            // vacío = sin registro, no "sin alergias"
  medicacionActiva: Medicamento[];
};
export type Medicamento = { nombre: string; dosis: string; frecuencia: string; desde?: string };
export type Consulta = {
  id: string; pacienteId: string; fecha: string; motivo: string;
  soap: { s: string; o: string; a: string; p: string };
  diagnosticos: { cie10?: string; texto: string }[];
};
export type Verificacion = {
  resultado: "ok" | "advertencia" | "bloqueado";
  motivo?: string;              // "Alergia registrada a penicilinas"
  alternativas?: string[];
};
export interface MegiAdapter {
  listarConsultasCerradas(): Promise<(Consulta & { paciente: Paciente })[]>;
  verConsulta(consultaId: string): Promise<Consulta>;
  verPaciente(pacienteId: string): Promise<Paciente>;
  verificarReceta(pacienteId: string, farmacos: Medicamento[]): Promise<Record<string, Verificacion>>; // clave = nombre del fármaco
  alternativas(pacienteId: string, farmaco: string): Promise<string[]>;
  exportar(consultaId: string, plan: unknown): Promise<{ formato: "texto" | "fhir"; contenido: string }>;
}
```

### Identificadores compartidos de la demo

| Caso | pacienteId | consultaId | Paciente | Conflicto |
|---|---|---|---|---|
| 1 | `demo-p1` | `demo-c1` | Alba Prueba, 34 F | Alergia a penicilina; SOAP propone amoxicilina |
| 2 | `demo-p2` | `demo-c2` | Mateo Ejemplo, 61 M | Sin alergias registradas (vacío) |
| 3 | `demo-p3` | `demo-c3` | Rosa Ficticia, 72 F | Toma warfarina; SOAP propone ibuprofeno |
| 4 | `demo-p4` | `demo-c4` | Luis Modelo, 28 M | Sin conflictos |

En MEGI los IDs reales serán los que asigne la base; el adaptador http mantiene una tabla `demo-p1 → id real` cargada desde el seed. Así el guion y las pruebas son idénticos en ambos modos.

### Variables de entorno

```
MEGI_MODE=mock            # Frente A
MEGI_MODE=http            # Frente B
MEGI_URL=http://127.0.0.1:8020      # backend de demo (megi-demo/backend/start_demo.sh)
MEGI_USER=demo_medico
MEGI_PASSWORD=demo-megi-2026
OPENAI_BASE_URL=https://api.x.ai/v1  # Grok (xAI), compatible con OpenAI
OPENAI_API_KEY=...                   # se entrega el día de la integración
```

**Estado (2 nov):** Frente B B1–B4 y B6 hechos; Frente A completo en `megi-revision/` (typecheck, doctor, build y smoke en mock e http correctos). Falta solo la clave de Grok, el recorrido manual en navegador, Clips y el envío. Detalle en `ESTADO.md`.

**Estado del Frente B (2 nov):** B1 a B4 hechos. El adaptador real vive en
`adaptador-megi/lib/megi/` y el contrato de la API en
`megi-demo/docs/api_megi_para_adaptador.md`. Avances diarios en `ESTADO.md`.

---

## Qué comparte cada frente y cuándo

| Día | Frente A entrega | Frente B entrega |
|---|---|---|
| 1 | Repo creado, commit inicial, `types.ts` propuesto | Entorno de demo limpio, usuario demo |
| 2 | Mock con 4 casos, tablas creadas | `api_megi_para_adaptador.md` con JSON reales → A ajusta el mock a esas formas |
| 3 | Acciones de lectura y `proponer-plan` | Seed de 4 casos en MEGI, `seed_demo.py` |
| 4 | Edición, bloqueo, rechazo, UI del tablero | `megi-http.ts` funcionando contra lectura |
| 5 | `reajustar-plan`, skill, `AGENTS.md` | `megi-http.ts` completo (verificación, exportación) |
| 6 | Casos rotos en mock, ensayo del guion | **Integración**: `MEGI_MODE=http`, guion completo |
| 7 | Congelado. Pulido visual | Congelado. Ensayo con cronómetro |
| 8 | Apoyo en grabación | Grabación en Clips, publicación |
| 9 | Revisión de la descripción | Envío y confirmación |

Canal único de coordinación: un archivo `ESTADO.md` en el repo que cada uno actualiza al cerrar el día con "hecho / bloqueado / necesito".


Actualización tras la auditoría: los permisos y las transacciones se corrigieron y se ampliaron las pruebas; detalle en `ESTADO.md`. La aprobación final es exclusiva de la interfaz autenticada. La publicación del Clip y el envío del formulario son pasos de persona, no de código: se registran en `ENVIO_HACKATHON.md`.
