# Borrador de entrega al hackatón

Formulario: https://www.builder.io/hackathon/submit · Límite: 9 nov 2026, 11:59 PM PT (10 nov, 01:59 Ciudad de México).

**Estado: publicación y envío detenidos por instrucción expresa de David.** No se ha subido video, publicado un Clip ni enviado el formulario. La cuenta de Clips se abrió únicamente para preparar la demo.

Este documento prepara una entrega futura; no acredita una inscripción. Nombre, correo, integrantes, elegibilidad y reparto del premio deben completarse con datos confirmados por el equipo. No se han inferido ni enviado.

## Campos

| Campo | Valor |
|---|---|
| Project name | MEGI Revisión |
| Project description | (bloque de abajo) |
| Project or GitHub URL | opcional; solo si se crea un remoto privado con acceso para jueces, o se deja vacío |
| Public Clips recording URL | el enlace público de Clips (ver «Grabación») |
| Slides URL | vacío |
| Agreement | pendiente de revisión y aceptación personal al enviar |

## Project description (copiar tal cual, ajustando nombres del equipo)

MEGI Revisión is a post-consultation review desk where a physician and an agent prepare the prescription and follow-ups of a consultation together. The agent proposes a plan verified against the patient's allergies, chronic conditions and active medication; the physician edits, locks or rejects lines from the UI; the agent re-adjusts only what is not locked and explains every change; the physician approves and exports a sealed FHIR note to MEGI. UI and agent call the same Agent-Native actions on the same records: the rules (a locked line is untouchable, a safety block cannot be approved without explicit physician confirmation) live in the actions, not in the prompt or the screen.

Team: [nombres].

Prior work: the MEGI clinical backend (FastAPI, Python) with patient records, SOAP notes, prescription safety checker, approval and FHIR export, built by the team before October 27, 2026. Agent-Native Chat template (MIT).

Built during the hackathon: the Agent-Native application and its domain workflow: data model (plans, plan lines, review log), eight domain actions with schemas and error codes (seven available to the agent and physician-only final approval), mock and HTTP adapters to MEGI, the review board UI, the agent prompt and skill, demo seed and automated verification (CLI, browser and live agent with Grok 4.7).

All patients shown are fictitious. The app is decision support; the final approval is always the physician's.

## Preparación local de una futura grabación

1. Trabajar en una copia de ensayo con datos ficticios. Arrancar el backend de demo con `megi-demo/backend/start_demo.sh`; sembrar solo esa copia con `seed_demo.py`. Con la app detenida, iniciar una base de ensayo nueva mediante `DATABASE_URL=pglite:./data/ensayo pnpm dev` desde `megi-revision/`. Conservar la carpeta `data/` anterior; no borrarla. La siembra vuelve a abrir las consultas ficticias y debe acompañarse de una base de planes nueva para evitar estados desincronizados.
2. Abrir `http://localhost:8080/revision` y seguir el guion de `PLAN_HACKATHON_AGENT_NATIVE.md` §10 con la consulta de Mateo (demo-c2): propuesta → bloquear una línea → pedir reajuste que la toque → el agente la respeta → aprobar y exportar.
3. Cuando David autorice reanudar la publicación: grabar la versión corregida con Clips, publicar el enlace y comprobar en ventana privada que abre sin iniciar sesión. No realizar estos pasos mientras siga vigente la pausa.
4. `evidencia/video/demo-grok.webm` y `.mp4` son referencias de la versión anterior a la auditoría. No acreditan las correcciones actuales ni sustituyen el enlace público de Clips exigido por las bases. No se han subido.

## Antes de enviar

- [ ] Clips público verificado sin sesión
- [ ] Descripción con equipo y trabajo previo pegada
- [ ] Formulario enviado y confirmación de recepción guardada (grabar el clip no es enviar)

## Validación local después de la auditoría

La regresión está en `evidencia/auditoria-hackathon.mts`; resultados actuales en `evidencia/auditoria-hackathon-resultados.json` y resultado anterior a las correcciones en `evidencia/auditoria-hackathon-antes.json`. Incluye permisos por transporte, rollback completo, verificación incompleta, concurrencia, cancelación, recuperación de exportación, consistencia del SOAP y lectura de dosis. Las escrituras de la regresión usan exclusivamente una base en memoria.

Atribuciones: `megi-revision/LICENSE.agent-native.txt`; inventarios y avisos de Node/Python en `evidencia/licencias/`. Las bases oficiales consultadas se conservan en `evidencia/bases/`. No se afirma una validación clínica del catálogo; el backend de demo trabaja en `local_mock` con datos ficticios.
