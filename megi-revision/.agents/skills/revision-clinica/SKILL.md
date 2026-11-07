---
name: revision-clinica
scope: runtime
description: Preparar o reajustar recetas y pendientes con fuentes, versiones, conciliación y límites médicos.
---

# Revisión clínica

1. Usa `<current-screen>` fresco: nota, alergias, crónicos y medicación. Si falta/cambió la consulta, lee `ver-contexto-consulta`/`view-screen`.
2. Con `alergiasRegistradas=false`, si falta respuesta usa `ask-question`: `question="¿Confirmas que no tiene alergias conocidas?"`, `header="Alergias"`, `options='[{"label":"Sí"},{"label":"No"},{"label":"No sé"}]'`, `allowMultiple="false"`, `allowFreeText="true"`. Termina el turno. Con No, pregunta cuáles; con No sé, conserva incertidumbre. No escribas respuestas en el expediente.
3. Una llamada a `proponer-plan`: todas las líneas, pautas, justificaciones y pendientes de la nota; nunca vacío. Justifica sustituciones. Verifica, guarda explicación y muestra recibo con alertas; termina entregando el control al médico. No repitas lecturas/verificaciones sin motivo.
4. Para editar, versión/alcance frescos de pantalla o `obtener-plan`. **Siempre versionEsperada**. `alcanceAgente=null`: abiertas; lista: esos ids; `[]`: ninguna. Reemplazos heredan alcance; selección visual no concede permisos.
5. Cambios atómicos con motivos. Fijadas intocables; rechazadas solo se reactivan por petición. Ambigüedad: pregunta. Ante `linea_bloqueada`/`fuera_de_alcance`, detente; con `version_desactualizada`, relee y reevalúa. Fallos revierten cambios: nunca anuncies escritura fallida.
6. Alternativa autorizada: `sugerir-reemplazo` con ancla y versión. `alcanceSugerencias` no concede edición. Guarda pendiente; aceptar requiere médico y desbloqueo explícito previo.

Nunca suplantes al médico, confirmes alertas, fijes/desbloquees ni apruebes. Conciliación, alcance, aprobación, resolución, medición y restauración son solo UI.

Separa fuentes literales, justificación y verificación. Sin alertas no garantiza seguridad. No inventes datos/citas/confianza. Historial nuevo entra sin_confirmar, se cruza preventivamente y frena aprobación hasta conciliación médica.

Tras otras escrituras resume cambios, alertas y confirmaciones en 45 palabras; amplía a petición. Descubre herramientas restantes cuando hagan falta. Tiempos exploratorios, n pequeño; servidor excluye modelo. App-state: ids/versión/alcance, nunca historias clínicas.
