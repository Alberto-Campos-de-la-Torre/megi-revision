# Pendiente: validar con médicos reales

**Decisión de David, 7 nov 2026:** no hay participantes disponibles antes del cierre del hackatón. La iteración I4 de [PARA_EL_100.md](PARA_EL_100.md) queda **pendiente**, con todo preparado para ejecutarla en cuanto haya médicos.

## Qué no está demostrado mientras tanto

- Que la mesa de revisión ahorre tiempo o reduzca errores frente a la revisión manual.
- Que la jerarquía móvil, las alternativas del agente y la conciliación resulten claras para un médico que no conoce la app.
- Cualquier cifra de utilidad: la única medición existente es n=1 con pacientes sintéticos y no se presenta como evidencia.

## Qué hay listo

- Protocolo completo con tareas, criterios de «completada correctamente», medidas y reglas: [evidencia/protocolo-usuarios.md](evidencia/protocolo-usuarios.md).
- Cuatro casos sintéticos restaurables con «Restaurar mis casos» y mediciones por sesión (`medir-revision` / `metricas-revision`).
- Dos observaciones de diseño anotadas para contrastar con usuarios: [evidencia/evaluacion-visual-i5.md](evidencia/evaluacion-visual-i5.md).
- Comparación estructural mesa frente a chat sin mesa con la misma receta inicial: [evidencia/valor-diferencial.md](evidencia/valor-diferencial.md). Cuenta mecanismos (alertas visibles, rechazos, frenos, fuentes, versiones); no sustituye la utilidad medida con médicos.
- Fricción sin usuarios ya corregida (teclado, zoom, estados): `evidencia/friccion-ui.mjs`. Lo que falta observar es a médicos que no conocen la app.

## Para ejecutarla

1. Conseguir dos o más médicos con autorización escrita; sin nombres en la evidencia (P1, P2…).
2. Seguir el protocolo en modo demo (`pnpm demo`), alternando el orden manual/agente.
3. Guardar `evidencia/resultados/usuarios-<fecha>.json` y una sección en [ESTADO.md](ESTADO.md) con n, tareas, limitaciones y decisiones derivadas.
4. Revisar I5 con lo observado y volver a correr los recorridos.

Hasta entonces, ni la descripción del envío ni el guion deben afirmar beneficios medidos con usuarios.
