# MEGI Revisión — proyecto Agent-Native

Mesa de revisión posconsulta donde un médico y un agente preparan juntos la receta y los
pendientes. El agente propone un plan verificado contra las alergias, las condiciones
crónicas y la medicación activa del paciente; el médico edita, bloquea o rechaza líneas
desde la interfaz; el agente reajusta solo lo que no está bloqueado y explica cada cambio;
el médico concilia la medicación histórica antes de aprobar y exportar la nota a MEGI.

Las reglas —una línea bloqueada no se toca, un bloqueo de seguridad no se aprueba sin
confirmación explícita del médico— viven en las acciones del servidor, no en el prompt ni
en la pantalla. Interfaz y agente llaman a las mismas acciones sobre los mismos registros.

> **In English** — MEGI Revisión is a post-consultation review desk where a physician and an
> agent prepare the prescription and follow-ups of a consultation together. Every change has
> an atomic version and a source per line; selection scopes are enforced on the server. UI
> and agent call the same Agent-Native actions on the same records. All patients shown are
> fictitious. The app is decision support; the final approval is always the physician's.

## Qué hay en este repositorio

Este repositorio es **solo el proyecto del hackatón Agent-Native**, separado del clon de
revisión donde se desarrolló. Conserva los 34 commits de su historia, con sus autores y
fechas originales.

| Carpeta | Qué es |
|---|---|
| `megi-revision/` | La aplicación Agent-Native: 17 acciones de dominio, 8 herramientas iniciales, modelo de datos (planes, líneas, bitácora), interfaz de revisión, prompt y habilidad del agente, adaptadores mock y HTTP a MEGI. **Construido durante el hackatón.** |
| `adaptador-megi/` | El cliente HTTP a MEGI aislado, con su prueba. |
| `pruebas-hackathon/` | Las baterías de verificación: catálogo, adaptador, requisitos, HTTP, y `fase2/agente-version.mts`, que mide al agente real contra la aplicación real. |
| `evidencia/` | Resultados, capturas, licencias, bases oficiales del hackatón (`bases/`, con su SHA-256 y fecha de descarga) y la procedencia del código. |
| `megi-demo/` | **Trabajo previo del equipo**, anterior al 27 de octubre de 2026: el backend clínico de MEGI (FastAPI) con expediente, nota SOAP, verificador de recetas, aprobación y exportación FHIR. Aquí no se modificó; se consume por HTTP. Se publica el código que el adaptador necesita, no la operación del servidor (ver abajo). |
| Documentos raíz | `PLAN_HACKATHON_AGENT_NATIVE.md` (plan y procedencia), `ESTADO.md`, `PARA_EL_100.md`, `GUION-GRABACION.md` y los subtítulos de la demo, `ENVIO_HACKATHON.md` (borrador de entrega). |

La procedencia completa —qué es previo, qué es nuevo, qué se tomó de la plantilla
Agent-Native Chat (MIT)— está en `evidencia/procedencia-git.json`, legible en
`evidencia/procedencia.html`.

## Arrancar la demo

Requiere Node ≥ 22.22 y pnpm 10.29.

```bash
cd megi-revision
pnpm install --frozen-lockfile
pnpm demo --port 8082
```

`pnpm demo` fija `MEGI_MODE=mock` y una base PGlite propia en `.demo/`, con los cuatro
pacientes ficticios. En la interfaz, «Continuar como desarrollador local» entra sin
registro. Para que el agente proponga planes hace falta una clave en `megi-revision/.env`
(`OPENAI_BASE_URL`, `OPENAI_API_KEY`, `AGENT_ENGINE`, `AGENT_MODEL`); el ejemplo de
variables está en `megi-revision/.env.example` y el fichero `.env` está ignorado por git.

No copies `node_modules/` de otra copia del repositorio: la caché de dependencias de Vite
guarda rutas relativas a su propia carpeta y, movida de sitio, sirve módulos corruptos y la
interfaz no monta. Instala en limpio.

## Lo medido, y lo que no

- `pruebas-hackathon/fase2/agente-version.mts --motor grok --repeticiones 10`: **10 de 10
  pasadas**, 14 comprobaciones puntuadas en cada una, 20 escrituras, ningún rechazo y ningún
  409. Las dos comprobaciones de recuperación tras un 409 son condicionales: solo puntúan si
  llega a producirse un conflicto de versión, y en esta tanda no se produjo. Ese camino está
  cubierto aparte, con motor falso, en el escenario `reintento`.
- El verificador de recetas de MEGI sobre la tabla de contraindicaciones FDA (2 248
  fármacos) **no se ejercita en la demo**: exige `MEGI_REAL_ASR=true` y sin él responde 503.
  La demo corre en `MEGI_MODE=mock`, con el rx-check determinista del adaptador —alergia,
  crónico, interacción— sobre pacientes ficticios.
- No se afirma validación clínica del catálogo. Todos los pacientes son ficticios.

## Estado de la entrega

**Publicación y envío detenidos por instrucción expresa de David.** No se ha subido video,
publicado un Clip ni enviado el formulario. `evidencia/video/` conserva una grabación de
referencia anterior a la auditoría, que no acredita las correcciones actuales. El detalle
está en `ENVIO_HACKATHON.md`.

## Qué no se publica aquí

Este repositorio no incluye el material de operación del backend previo, que no hace falta
para el hackatón y no debe circular: los guiones de instalación, copia, restauración y
rotación de registros del servidor, las plantillas de despliegue (túnel y servicios), el
documento de empaquetado con el dominio de producción, las dos auditorías internas de
seguridad de MEGI y su hoja de ruta comercial. Están fuera de todos los commits, no solo
del último.

La contraseña `demo-megi-2026` que aparece en los guiones de prueba no es un secreto: es el
valor por defecto que siembra `megi-demo/backend/seed_demo.py` en una instalación local con
pacientes ficticios, y `pruebas-hackathon/fase2/requisitos.mjs` comprueba que siga siendo
ese y no otro. Ninguna clave real —ni de xAI, ni de MEGI, ni de ningún servicio— está en el
repositorio ni en su historia: `.env` está ignorado y solo se versionan los `.env.example`
con nombres de variable.

## Licencias

La plantilla Agent-Native Chat es MIT: `megi-revision/LICENSE.agent-native.txt`. Los
inventarios y avisos de dependencias de Node y Python están en `evidencia/licencias/`.
