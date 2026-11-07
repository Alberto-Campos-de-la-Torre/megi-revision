# Valor diferencial medible · mesa de revisión frente a un chat sin mesa

Ejecución: `megi-revision/node_modules/.bin/tsx evidencia/valor-diferencial.mts` → `evidencia/resultados/valor-diferencial.json` (20/20 comprobaciones, 2026-11-07).

Qué se compara: la **misma receta inicial** para los cuatro casos sintéticos, en dos modalidades. En la mesa, la receta pasa por acciones reales (PGlite en memoria, MEGI mock, sin LLM). En un chat sin mesa la receta es texto libre: los mecanismos de la tabla no existen, así que valen 0 por construcción. Se cuentan **mecanismos observables**, no errores clínicos ni tiempo de médicos: esa evidencia sigue pendiente de sesiones con usuarios ([PENDIENTE_VALIDACION_USUARIOS.md](../PENDIENTE_VALIDACION_USUARIOS.md)).

| Mecanismo (cuatro casos) | Mesa de revisión | Chat sin mesa |
|---|---|---|
| Alertas del verificador visibles antes de aprobar | 3 | 0 |
| Intentos del agente sobre líneas fijadas rechazados sin escribir nada | 12/12 | no existe el concepto de línea fijada: una nueva respuesta sustituye toda la receta |
| Intentos fuera del alcance autorizado rechazados | 12/12 | no existe alcance: el texto completo es editable |
| Aprobaciones detenidas hasta conciliar medicación histórica | 2 | 0 |
| Aprobaciones detenidas hasta confirmar un bloqueo de seguridad | 2 | 0 |
| Líneas con fuente en la nota o en la medicación registrada | 7/11 | 0: el texto no enlaza con la nota ni con la medicación registrada |
| Versiones del plan guardadas | 26 | 0 |
| Eventos de bitácora (médico y agente) | 30 | 0 |
| Exportaciones FHIR selladas | 4 | 0 |

## Por caso

| Caso | Alertas antes de aprobar | Fijada intocable | Alcance | Frenos en la aprobación | Versiones / eventos |
|---|---|---|---|---|---|
| Alba (alergia a penicilina) | 1 bloqueo(s), 0 advertencia(s) | 3/3 rechazados, plan intacto | 3/3 fuera rechazados; 1 dentro aplicado | bloqueo → `alertas_sin_confirmar` | 6 / 7 |
| Mateo (HTA con losartán; alergias sin registro) | 0 bloqueo(s), 1 advertencia(s) | 3/3 rechazados, plan intacto | 3/3 fuera rechazados; 1 dentro aplicado | conciliación → `medicacion_sin_conciliar`;  | 7 / 8 |
| Rosa (FA con warfarina; alergia a sulfas) | 1 bloqueo(s), 0 advertencia(s) | 3/3 rechazados, plan intacto | 3/3 fuera rechazados; 1 dentro aplicado | conciliación → `medicacion_sin_conciliar`; bloqueo → `alertas_sin_confirmar` | 7 / 8 |
| Luis (sin alergias, sin medicación) | 0 bloqueo(s), 0 advertencia(s) | 3/3 rechazados, plan intacto | 3/3 fuera rechazados; 1 dentro aplicado | ninguno necesario | 6 / 7 |

Las líneas «sin respaldo» (4 de 11) son pendientes o fármacos que la nota no menciona; la mesa lo marca en lugar de presentarlo como respaldado. Luis (sin alergias ni medicación) muestra el caso límite: cero alertas y una aprobación sin frenos, igual de trazable.

## Lectura honesta

- Las cifras describen lo que la mesa **hace visible o impide** con la misma receta de partida. No afirman que un médico cometa menos errores ni tarde menos: no se ha medido.
- El verificador es el de MEGI (mock con la misma tabla de reglas en esta ejecución; el contrato HTTP se valida en `auditoria-hackathon.mts --http`).
- La comparación con «chat sin mesa» es estructural: ese chat no tiene líneas, estados, alcance ni bitácora, por lo que sus valores son 0 por definición, no por medición.
