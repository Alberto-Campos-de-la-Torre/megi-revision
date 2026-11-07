# I4 · Protocolo de evaluación de utilidad con médicos participantes

**Estado: pendiente de participantes.** Este documento deja el protocolo listo para ejecutarse; no contiene resultados. Cuatro pacientes sintéticos y una medición individual (n=1) **no acreditan** ahorro de tiempo ni eficacia clínica, y este protocolo tampoco valida el catálogo ni las recomendaciones: mide utilidad y usabilidad de la mesa de revisión.

## Qué se compara

Dos modalidades sobre las mismas tareas, con pacientes ficticios del modo demo (`pnpm demo`, backend simulado, sin datos reales):

| Modalidad | Cómo |
|---|---|
| Manual | El médico crea el plan en blanco y escribe cada línea; la verificación de seguridad la hace MEGI igual que siempre. |
| Con agente | El médico pide la propuesta al agente, fija/ajusta líneas y aprueba. El agente respeta líneas fijadas y el alcance seleccionado. |

Orden alternado por participante (ABAB / BABA) para repartir el efecto de aprendizaje. Cada participante hace las cuatro tareas en ambas modalidades, con pacientes distintos pero equivalentes.

## Tareas (una por caso sintético)

| # | Caso | Qué debe ocurrir para contar como «completada correctamente» |
|---|---|---|
| T1 | Alergia registrada (Alba: penicilina) | La receta final no contiene amoxicilina ni otra penicilina; el bloqueo se rechazó o sustituyó con motivo escrito; aprobada y exportada. |
| T2 | Medicación sin conciliar (Mateo: losartán previo, alergias sin registro) | El antecedente queda conciliado (activo/suspendido) antes de aprobar; la advertencia AINE × losartán se ve y queda en la bitácora; la falta de registro de alergias se confirma explícitamente. |
| T3 | Línea fijada (Rosa: anticoagulación) | El médico fija una línea antes de pedir el reajuste; la línea fijada no cambia; el reajuste solo toca lo seleccionado. |
| T4 | Instrucción ambigua (Luis: «ajusta el analgésico») | El médico pide algo ambiguo; se considera correcta la tarea si el agente pide aclaración o propone con justificación visible y el médico corrige antes de aprobar; no se aprueba con una dosis sin justificar. |

Definir estos criterios **antes** de medir y no cambiarlos después. Un plan exportado con un bloqueo confirmado sin motivo escrito cuenta como fallo.

## Qué se mide (por tarea y modalidad)

- Tiempo hasta plan visible (desde que empieza la tarea hasta que hay líneas en el tablero).
- Tiempo total hasta «Aprobado y exportado».
- Correcciones manuales sobre lo propuesto (ediciones, rechazos, líneas añadidas).
- Tarea completada correctamente (sí/no, según la tabla) y errores observados (p. ej., aprobar con bloqueo sin motivo).
- Separación de tiempos: la acción `metricas-revision` ya distingue operaciones del servidor, API del modelo y tiempo total; el tiempo del usuario es el resto. No atribuir al modelo el tiempo que el médico tarda en leer.

Las mediciones se registran con `medir-revision` (inicio, plan visible, fin) y se leen con `metricas-revision`; se guardan agregadas en `evidencia/resultados/usuarios-<fecha>.json` con: número real de participantes, años de experiencia (rango), orden de modalidades, tarea, modalidad, tiempos, correcciones, resultado y observaciones de fricción.

## Reglas

- Solo participantes que lo autoricen por escrito; sin nombres ni datos identificables en la evidencia (código P1, P2…).
- No inventar muestras, testimonios ni promedios sin los datos individuales detrás. Con pocos casos, presentar los resultados como descriptivos y exploratorios (mediana y rango, no «ahorro del X %»).
- Conservar los intentos fallidos y las sesiones interrumpidas; indicar la causa.
- Restaurar los cuatro casos entre participantes con «Restaurar mis casos»; no borrar bases ni mediciones de otras personas.
- Las observaciones de fricción alimentan I5; cada cambio de interfaz debe citar la observación concreta que lo motiva.

## Entregable

`evidencia/resultados/usuarios-<fecha>.json` + una sección en `ESTADO.md` con n, tareas, limitaciones y decisiones de producto derivadas. Mientras no haya participantes, I4 permanece **pendiente** y nada de lo anterior se presenta como resultado.
