# MEGI × Agent-Native Hackathon · Plan de participación

Fecha del plan original: 1 de noviembre de 2026.

**Actualización tras la auditoría:** ver `ESTADO.md` y `evidencia/auditoria-hackathon-resultados.json` para lo realmente verificado. David detuvo expresamente toda publicación y envío. El video previo es histórico; no acredita las correcciones actuales.
Fuentes: reglas oficiales (builder.io/hackathon/rules), página del evento (builder.io/hackathon), formulario (builder.io/hackathon/submit), documentación de Agent-Native (agent-native.com/docs) y el código local de `canvas-megi-ia`.

---

## 1. Decisión

**Entramos con una app nueva construida en Agent-Native** que usa el backend de MEGI (FastAPI) como fuente de datos clínicos y verificaciones de seguridad.
**No presentamos canvas-megi-ia tal cual**: no usa el framework y las reglas exigen "una aplicación funcional usando Agent-Native".

Nombre de trabajo del proyecto: **MEGI Revisión** (mesa de revisión post-consulta con agente).

Reparto en dos frentes (uno sin acceso a MEGI, otro con MEGI) y el contrato que los une: ver `REPARTO_TRABAJO.md`.

---

## 2. Fechas (hora del Pacífico, PT)

| Hito | Fecha | Nota |
|---|---|---|
| Inicio del hackatón | 27 oct 2026 | Todo lo construido desde esta fecha cuenta como trabajo del evento |
| Office hours opcionales | 3 y 5 nov, 8:30 AM PT | Útiles para dudas del framework |
| Fin de semana final | 6 al 8 nov | No es el único periodo de construcción |
| **Fecha límite de envío** | **9 nov 2026, 11:59 PM PT** | = 10 nov, 01:59 hora Ciudad de México (UTC-6) |
| Anuncio de ganadores | 13 nov 2026 | Sujeto a verificación |

Quedan **8 días**. Regla interna: el flujo completo debe funcionar el **7 de noviembre**; el 8 y 9 son solo para pruebas, video y envío.

---

## 3. Qué necesitamos

### 3.1 Herramientas y entorno (ya disponibles en la Mac)

| Pieza | Requisito | Estado local |
|---|---|---|
| Node.js | 22.22 o superior | v25.2.1 ✔ |
| pnpm | cualquier reciente | 11.6.2 ✔ |
| Backend MEGI | FastAPI :8000 con token HMAC | existe en `canvas-megi-ia/backend` ✔ |
| ASR/LLM MEGI | servicio :8010 (opcional para la demo) | existe; puede correr en `local_mock` |
| Base de datos Agent-Native | PGlite automático en local | nada que instalar |

### 3.2 Cuentas y claves

- **Clave de LLM para el agente: Grok (xAI).** Decidido el 2 de noviembre: hay 1,000 USD de crédito. La API de xAI es compatible con OpenAI, así que en Agent-Native va como `OPENAI_BASE_URL=https://api.x.ai/v1` y `OPENAI_API_KEY=<clave xAI>`. La clave se añade solo el día de la integración, no antes. Alternativas documentadas por si Grok falla en llamadas a herramientas: `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` o "Use Builder.io". Probar el día 1 que Grok ejecuta bien `defineAction` con esquemas Zod; si no, cambiar de proveedor cuesta una variable.
- **Cuenta en Clips** (clips.agent-native.com): Google, correo+contraseña o enlace por correo. El video debe quedar **público, sin login ni solicitud de acceso**.
- **Correo de contacto** para el formulario.

### 3.3 Datos

- **Solo pacientes ficticios.** Crear 3 a 5 pacientes de prueba con alergias, medicación activa y una consulta cerrada cada uno.
- Arrancar MEGI con base limpia (borrar `data/megi.sqlite`, `data/sessions/`, `data/speaker_profiles/` en una copia, nunca en la instalación de consultorio) y usuario admin de demo.
- Etiquetar en pantalla y en el video: "Datos de demostración, pacientes ficticios".

### 3.4 Lo que se construye durante el hackatón (trabajo nuevo)

1. App Agent-Native creada con `npx --yes @agent-native/core@latest create megi-revision --standalone --template chat`.
2. Capa de acciones en `actions/` que envuelven la API de MEGI:
   - `megi-login` (obtiene y guarda token de servicio)
   - `listar-pacientes`, `ver-expediente`, `ver-consulta`, `ver-soap`
   - `verificar-receta` → `POST /api/drugs/check` y `POST /api/safety/rx-check`
   - `alternativas-farmaco` → `POST /api/drugs/alternatives`
   - `proponer-plan` (compone receta + pendientes a partir de SOAP y expediente)
   - `bloquear-linea`, `editar-linea`, `rechazar-linea`, `aprobar-plan`
   - `reajustar-plan` (solo toca lo no bloqueado y explica cada cambio)
   - `exportar-plan` → `GET /api/export/consultation/{id}` o `GET /api/consultations/{id}/fhir`
3. Tablas propias en Postgres/PGlite de Agent-Native: `planes`, `lineas_plan` (estado: propuesta | editada | bloqueada | rechazada | aprobada), `eventos_revision`.
4. Interfaz React: lista de consultas pendientes de revisión, tablero del plan con líneas editables, panel de explicaciones del agente, botón de exportar.
5. Skill en `.agents/skills/revision-clinica/SKILL.md` con la política: nunca modificar líneas bloqueadas, siempre verificar con `verificar-receta` antes de proponer, explicar cambios.
6. `AGENTS.md` con instrucciones permanentes y límites.
7. Pruebas de los casos rotos (ver sección 6).

---

## 4. Flujo único que se demuestra

1. El médico abre la lista y elige una consulta cerrada de un paciente ficticio.
2. Pide al agente: "Prepara la receta y los pendientes de esta consulta".
3. El agente lee SOAP y expediente, pasa cada fármaco por el verificador de alergias y contraindicaciones, y propone un plan en el tablero.
4. El médico **edita** una dosis, **bloquea** una línea y **rechaza** otra desde la interfaz (sin el agente).
5. El médico pide: "Ajusta lo pendiente, el paciente es alérgico a X y no puede tomar Y".
6. El agente reajusta **solo** las líneas no bloqueadas, vuelve a verificar y explica cada cambio.
7. El médico aprueba y exporta.

Puntos que deben verse en el video: que la acción de la interfaz y la del agente son la misma función (mismo registro, mismo cambio en vivo), y que el agente respeta lo bloqueado.

---

## 5. Qué se puede y qué no

### 5.1 Se puede

| Acción | Base en las reglas o docs |
|---|---|
| Partir de la plantilla oficial Chat | Las plantillas existen para eso ("Cloneable SaaS") |
| Reutilizar el backend, modelos y RAG de MEGI | Permitido como trabajo previo **si se declara** qué es previo y qué es nuevo |
| Usar Claude Code / Cursor para programar | Documentado explícitamente por Agent-Native |
| Mantener el repositorio privado | El enlace a repo es opcional; no exige publicar código |
| Correr la demo en localhost | Lo obligatorio es el video en Clips, no un despliegue público |
| Participar solo o en equipo | Permitido; integrantes se listan en la descripción |
| Conservar la propiedad del código | Las reglas lo establecen; solo se otorga licencia no exclusiva para promoción del evento |

### 5.2 No se puede (descalifica)

| Prohibido | Cómo lo evitamos |
|---|---|
| Presentar código ajeno como propio | Declaramos MEGI como trabajo previo nuestro y el código MIT de Agent-Native como base |
| Demo fabricada o editada que muestre algo que no existe | Grabación continua de una sola toma, sin cortes en los pasos del flujo |
| Ocultar trabajo previo | Tabla de procedencia (sección 7) incluida en la descripción |
| App que no use Agent-Native | Todo el flujo pasa por acciones `defineAction`; el agente y la UI llaman lo mismo |
| Fraude, interferencia, acoso | No aplica |
| Entrega no verificable | Guardamos historial Git con fechas, el estado inicial y el video original |

### 5.3 Zonas grises que evitamos a propósito

- **Módulos de eco (mama/tiroides) y radiología**: están marcados como "experimentales, investigación sin uso comercial". **Quedan fuera de la demo** para no abrir preguntas de licencia ni de validación clínica.
- **Audio y voz real**: no se graba audio de consulta en la demo. Se parte de una consulta ya cerrada con texto.
- **Datos reales de pacientes**: nunca. Riesgo legal y de descalificación por "materiales de terceros sin derechos".
- **Promesas clínicas**: el video y la descripción dicen "apoyo a la decisión con revisión del médico", nunca "diagnostica" ni "prescribe".
- **Subir a los servicios alojados de Agent-Native** (Clips): lo que subamos queda bajo sus términos de servicio, que permiten usarlo para operar y mejorar el servicio. Subimos **solo el video de demo**, nunca código ni datos.

---

## 6. Cómo nos amparamos ante las reglas

### 6.1 Originalidad y trabajo previo

Las reglas aceptan "trabajo original o desarrollo nuevo significativo realizado durante el hackatón" y piden identificar trabajo previo, plantillas, bibliotecas y qué cambió. Nuestra defensa:

- **Trabajo previo (nuestro):** backend FastAPI de MEGI, modelos ASR, RAG de guías y FDA, verificador de recetas. Existía antes del 27 de octubre con historial Git en `github.com/NGZeggers/software_megi`.
- **Trabajo nuevo (hackatón):** la app Agent-Native completa, sus acciones, el modelo de datos de planes y líneas, la interfaz de revisión, la skill y las pruebas. Vive en un repositorio nuevo cuyo primer commit es posterior al 27 de octubre.
- **Plantilla:** Chat de Agent-Native (licencia MIT, se conserva el aviso de copyright).

### 6.2 Evidencia que guardamos desde el día uno

1. Repositorio nuevo con commits fechados, primer commit "estado inicial: plantilla chat sin modificar".
2. Captura del `git log` de MEGI mostrando que el backend es anterior al evento.
3. Copia de las bases y el formulario consultados (HTML originales en `evidencia/bases/`); renovar la copia al realizar una futura entrega. Los términos de Clips deberán revisarse al reanudar su uso.
4. Video original de la demo sin editar, además del publicado en Clips.
5. Lista de dependencias externas con licencia (`pnpm licenses list`).

### 6.3 Texto para el campo "Descripción del proyecto"

> MEGI Revisión es una mesa de revisión post-consulta donde un médico y un agente preparan juntos la receta y los pendientes de una consulta. El agente propone un plan verificado contra alergias y contraindicaciones; el médico edita, bloquea o rechaza líneas desde la interfaz; el agente reajusta solo lo no bloqueado y explica cada cambio. Interfaz y agente usan las mismas acciones de Agent-Native sobre los mismos registros.
>
> Equipo: [nombres].
>
> Trabajo previo: el backend clínico MEGI (FastAPI, Python) con su verificador de recetas, RAG de guías y modelos de transcripción, desarrollado por el equipo antes del 27 de octubre de 2026. Plantilla Chat de Agent-Native (MIT).
>
> Construido durante el hackatón: la aplicación Agent-Native completa (acciones, modelo de datos de planes y líneas, interfaz de revisión, skill de política clínica, pruebas) y la integración con el backend MEGI mediante acciones tipadas.
>
> Todos los pacientes mostrados son ficticios. La app es apoyo a la decisión; la aprobación final es siempre del médico.

### 6.4 Propiedad intelectual

- Conservamos la propiedad de la app y del código. Builder.io recibe licencia no exclusiva sobre descripción, demo y materiales enviados, para fines del hackatón.
- El código fuente no se publica. Si decidimos poner un repo público, será solo el de la app Agent-Native, nunca el de MEGI ni los modelos.
- Lo que se muestra en el video es público: no enseñar prompts internos, rutas de archivos, fórmulas de seguridad ni estructura de la base de MEGI. Mostrar la experiencia y los resultados.

### 6.5 Premios y fiscal

- Premios de 5,000 / 2,500 / 1,500 / 750 / 250 USD. Un premio por entrada, no por integrante.
- Ganadores no estadounidenses: posible retención de hasta 30 % salvo tratado aplicable (México tiene tratado con EE. UU.; se presenta W-8BEN). Nunca subir documentos fiscales al formulario ni a la demo.
- Rige la ley de California, salvo protecciones obligatorias del país del participante.

---

## 7. Tabla de procedencia (se mantiene al día)

| Parte | Procedencia | Aportación en el hackatón |
|---|---|---|
| Estructura de app, auth, chat, base de datos | Plantilla Chat de Agent-Native (MIT) | Configuración y adaptación |
| Backend clínico, expediente, SOAP, verificador de recetas sobre la tabla de contraindicaciones FDA (paquete FDA_movil, 2 248 fármacos) | MEGI, trabajo previo propio | Sin cambios; se consume por HTTP. **En la demo del hackatón ese verificador no se ejercita**: exige `MEGI_REAL_ASR=true` y, sin él, responde 503. La demo corre con `MEGI_MODE=mock` y el rx-check determinista del adaptador —alergia, crónico, interacción— sobre pacientes ficticios |
| Acciones `actions/*.ts` | Nuevo | Todas |
| Tablas `planes`, `lineas_plan`, `eventos_revision` | Nuevo | Todas |
| Interfaz de revisión (tablero, edición, bloqueo) | Nuevo | Todas |
| Skill `revision-clinica` y `AGENTS.md` | Nuevo | Todas |
| Lógica de reajuste que respeta bloqueos | Nuevo | Todas |
| Pacientes y consultas de prueba | Nuevo, ficticios | Todas |

---

## 8. Casos rotos que probamos antes de grabar

1. Paciente sin alergias registradas: el agente debe decirlo y pedir confirmación, no asumir.
2. Fármaco contraindicado por alergia: el verificador bloquea y el agente propone alternativa con `alternativas-farmaco`.
3. Instrucción ambigua ("quita eso"): el agente pregunta qué línea.
4. Intento de que el agente modifique una línea bloqueada: debe negarse y explicar.
5. Backend MEGI apagado: la acción devuelve error claro y la UI lo muestra; nada se guarda a medias.
6. Dos cambios seguidos (UI y agente) sobre la misma línea: el tablero refleja el último estado sin recargar.

---

## 9. Calendario

| Día | Entregable |
|---|---|
| Dom 1 nov | Decisión tomada. Crear app, primer commit "plantilla sin modificar", leer `AGENTS.md`, correr `pnpm dev`, conectar clave LLM |
| Lun 2 nov | Acción `megi-login` + acciones de lectura (pacientes, expediente, consulta, SOAP). Datos ficticios cargados en MEGI |
| Mar 3 nov | Tablas de planes y líneas. Acciones `proponer-plan`, `verificar-receta`. Asistir a office hours si hay dudas |
| Mié 4 nov | Interfaz del tablero: lista, edición, bloqueo, rechazo, aprobación |
| Jue 5 nov | `reajustar-plan` con respeto de bloqueos y explicación. Skill y `AGENTS.md` |
| Vie 6 nov | Exportar. Casos rotos 1 a 6. Pulido visual |
| Sáb 7 nov | **Congelar funciones.** Ensayo completo del guion |
| Dom 8 nov | Grabar en Clips (mínimo 3 tomas), elegir la mejor, publicar, verificar que abre sin login en ventana privada |
| Lun 9 nov | Enviar formulario antes de las 6 PM hora de México (margen de 8 h). Guardar confirmación de recepción |

---

## 10. Guion del video (3 a 4 minutos)

1. (15 s) Usuario y problema: el médico revisa receta y pendientes tras una consulta consolidada.
2. (15 s) Paciente ficticio, nota SOAP, alergias y procedencia de cada línea.
3. (40 s) Pedir propuesta. Mostrar los pasos reales del agente; si faltan alergias, responder la pregunta estructurada. Mostrar «Motivo del último cambio» abierto y los límites de «Sin alertas detectadas».
4. (15 s) Conciliar medicación: confirmar Losartán activo. Antes de hacerlo, la aprobación permanece deshabilitada.
5. (25 s) Fijar una línea. Si tiene bloqueo de seguridad, aparece una alternativa pendiente de revisión; la pauta fijada permanece intacta.
6. (30 s) Seleccionar dos líneas y solicitar reajuste acotado. Mostrar el alcance en pantalla y el rechazo del servidor si intenta tocar otra línea.
7. (15 s) Comparar versiones: retiradas rojas, añadidas verdes y antes → después de las ediciones; pauta fijada conservada.
8. (10 s) Mostrar la página de aprobación del framework para una acción HTTP con `needsApproval`. Esa regla pertenece a la acción. La aprobación clínica final sigue siendo exclusiva de la UI del médico.
9. (20 s) Revisar alertas, aprobar y exportar FHIR sellado. Abrir la pestaña Exportadas.
10. (15 s) Trabajo previo vs nuevo; mediciones exploratorias con n pequeño, tiempo de servidor separado del modelo.

Una toma por paso. La espera real se mide; no afirmar que cumple 35 s sin el resultado de `evidencia/resultados/latencia.json`. Este documento prepara el guion; no autoriza publicar ni crear Clips.

---

## 11. Lista de envío

- [ ] App corre con `pnpm dev` desde cero en una carpeta limpia
- [ ] Backend MEGI corre con datos ficticios y usuario de demo
- [ ] Video en Clips público, verificado en ventana privada sin sesión
- [ ] Descripción con equipo y trabajo previo (texto de 6.3)
- [ ] Repo privado con historial desde la plantilla sin modificar
- [ ] Evidencia de 6.2 guardada
- [ ] Formulario enviado y confirmación de recepción recibida (grabar un clip **no** es enviar)
- [ ] Nadie del equipo es empleado de Builder.io ni juez; todos mayores de 18

---

## 12. Pendientes de confirmar

- Si Clips graba sin problema una app en `localhost:8080` (probar el día 1, no el día 8).
- Duración máxima permitida del clip (la página no lo indica).
- Si la plantilla Chat trae `useDbSync` listo para el tablero o hay que habilitarlo por página.

Validación local para el guion (6 nov): con Grok 4.20 Non-Reasoning, el recorrido canónico registró 4,228 s hasta el plan y 3,659 s hasta el fin del turno, tras responder alergias. Muestra exploratoria n=1, sin garantía de latencia máxima. Referencia: `evidencia/resultados/latencia.json`; mantener esa distinción al grabar.
