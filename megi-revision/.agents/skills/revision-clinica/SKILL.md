---
name: revision-clinica
description: >-
  Cómo proponer y reajustar la receta y los pendientes de una consulta en MEGI
  Revisión respetando alergias, interacciones y las líneas que el médico
  bloqueó. Úsala cuando te pidan preparar, revisar, ajustar, reemplazar o
  aprobar un plan, receta, fármacos o pendientes de una consulta.
---

# Revisión clínica con el médico

## Proponer (consulta sin plan)

1. `ver-contexto-consulta` con el `consultaId` (viene en `navigation.consultaId` o en la lista).
2. Lee alergias, crónicos y medicación activa. Si `alergiasRegistradas` es `false`, dilo en la respuesta y pide confirmación; no asumas.
3. Parte de `medicamentosPropuestos` y `pendientes` de la nota, pero cada fármaco lo decides tú con dosis, frecuencia y duración explícitas. Un fármaco de la nota que choca con una alergia o con la medicación activa NO lo propongas tal cual: propón la alternativa y explica por qué.
4. Una sola llamada a `proponer-plan` con TODAS las líneas dentro del array `lineas` (fármacos y pendientes) y una `explicacion` de dos o tres frases. Cada fármaco: `{"tipo":"farmaco","texto":"Paracetamol","dosis":"1 g","frecuencia":"cada 8 h","duracion":"5 días","justificacion":"…"}`; cada pendiente: `{"tipo":"pendiente","texto":"Control en 2 semanas"}`. Nunca mandes `lineas` vacío.
5. Lee el `resumen` del resultado. Si quedó algún `bloqueado`, corrígelo ahora con `reajustar-plan` antes de responder.
6. Responde: qué propusiste, qué verificación quedó (bloqueos, advertencias) y qué pendientes.

## Reajustar (el médico pidió cambios)

1. `obtener-plan` para ver estados actuales. Las líneas `bloqueada` son intocables; las `rechazada` solo se reactivan si el médico lo pide.
2. Convierte la petición en cambios concretos: `reemplazar` (un fármaco por otro), `quitar`, `editar` (dosis o duración) o `agregar`. Cada cambio con su `motivo`.
3. Una sola llamada a `reajustar-plan` con todos los cambios y una `explicacion`.
4. Si responde `linea_bloqueada`: no reintentes. Di qué querías cambiar y por qué, y ofrece una alternativa que no toque lo bloqueado.
5. Responde con el resumen de cambios y la verificación resultante.

## Ambigüedad

"Quita eso", "cámbialo", "lo de la rodilla": si hay más de una línea candidata, pregunta cuál (nómbralas con texto y dosis). No adivines.

## Lo que nunca haces

- `origen: "medico"` o `confirmaAlertas: true`: son decisiones del médico.
- Bloquear líneas: solo el médico bloquea.
- Ejecutar `aprobar-plan`: es exclusiva de la interfaz autenticada y no está disponible al modelo. Si el médico pide aprobar, indícale que revise las líneas y use «Aprobar y exportar». Los bloqueos requieren su confirmación en pantalla.
- Reintentar con `origen: "medico"` un rechazo: el servidor deriva el actor del caller y devuelve 403.
- Dar por guardado un cambio si la acción devuelve `megi_no_disponible` o `verificacion_incompleta`: la transacción completa se revierte; informa del fallo y reintenta solo cuando MEGI vuelva a estar disponible.
- Inventar alergias, dosis o estudios que no estén en el contexto o en la petición.

## Ejemplos de respuesta

- Propuesta: «Propuse 2 fármacos y 3 pendientes. Cambié la amoxicilina de la nota por azitromicina 500 mg cada 24 h 3 días porque hay alergia a penicilina registrada. Verificación: 0 bloqueos, 0 advertencias.»
- Bloqueo: «No pude cambiar el paracetamol: lo bloqueaste. Si quieres que lo ajuste, desbloquéalo en la pantalla. Mientras, reemplacé el ibuprofeno por tratamiento tópico por la interacción con la warfarina.»
- Ambigua: «¿Te refieres al ibuprofeno 400 mg o al paracetamol 1 g?»
