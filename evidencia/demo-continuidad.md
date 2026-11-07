# Demo de continuidad UI–agente · guion con el código final

Qué demuestra: el médico y el agente trabajan sobre **el mismo registro** (un plan versionado en SQL), con **alcance** decidido desde la interfaz y **recuperación** ante cancelaciones, respuestas sin herramienta y reajustes rechazados. Reproducible con `MEGI_UI_URL=http://localhost:8082 node evidencia/continuidad.mjs` (modelo real; resultados en `resultados/continuidad.json`, capturas en `capturas-continuidad/`). Última ejecución: 18/18 (incluido un reintento documentado en el paso 4).

Caso: Rosa (demo-c3), 72 años, fibrilación auricular con warfarina, alergia a sulfas, gonalgia.

| Paso | Qué hace quién | Qué se ve | Captura |
|---|---|---|---|
| 1 | El médico abre la consulta sin plan y pulsa «Pedir propuesta al agente». | El tablero muestra etapas reales del turno (leyendo contexto, verificando, guardando). | `01-tablero-sin-plan.png` |
| 2 | El agente llama a `proponer-plan`; el plan aparece sin recargar. | Líneas «Propuesta por el agente», chips de verificación (el ibuprofeno sale bloqueado por la warfarina), motivo del cambio abierto. | `02-propuesta-del-agente.png` |
| 3 | El médico **fija** el ibuprofeno y **selecciona** el paracetamol; pulsa «Reajustar solo selección». | La UI avisa «El agente solo podrá editar estas 1 líneas» y el servidor guarda el alcance («Edición del agente limitada a 1 línea»). | `03-fijada-y-seleccion.png` |
| 4 | El médico escribe en el chat «cambia la duración de Paracetamol a 3 días». | El agente edita solo esa línea; nueva versión del mismo plan; el resto intacto. Si el modelo termina el turno sin aplicar el cambio, el tablero muestra «El último turno del agente no cambió el plan» y el médico repite la instrucción (en la última ejecución hizo falta una vez; `turno-sin-cambios-aviso.png`). | `04-reajuste-dentro-del-alcance.png` |
| 5 | El médico pide «quita Ibuprofeno del plan». | El servidor rechaza el reajuste entero (`linea_bloqueada`, 409): misma versión, mismas líneas. El agente explica el límite y el tablero añade «El último turno del agente no cambió el plan». | `05-fijada-intocable-aviso-sin-cambios.png` |
| 6 | Pestaña «Cambios». | Bitácora con médico y agente sobre el mismo plan, con motivo por cambio. | `06-bitacora-ambos-actores.png` |
| 7 | El médico libera el alcance, pide otro reajuste y pulsa **Detener** a mitad de turno. | Misma versión y mismas líneas: una mutación o se confirma entera o no deja nada. | `07-cancelacion-sin-parcial.png` |
| 8 | El médico concilia la medicación histórica (warfarina, metoprolol), aprueba y exporta. | Sello `sha256:` y FHIR con `MedicationRequest`; el plan queda cerrado a ediciones. | `08-exportacion-sellada.png` |

## Recuperación que la demo deja preparada

- **El agente responde en texto sin llamar a la herramienta.** Ocurrió en una ejecución del 7 nov: el modelo describió el plan y afirmó que el recibo estaba en el tablero, pero no llamó a `proponer-plan`. Ahora, si el médico pidió la propuesta y el turno termina sin guardar un plan, el tablero muestra «El agente terminó sin guardar un plan en el tablero» con «Volver a pedir la propuesta» (mensaje explícito que exige la herramienta). El script usa ese camino si hace falta y registra los reintentos.
- **El agente afirma un cambio que el servidor rechazó.** Ocurrió al pedir en un mismo mensaje un cambio permitido y quitar la línea fijada: el reajuste atómico fue rechazado y el modelo informó «1 línea editada». El servidor hizo lo correcto; el tablero ahora avisa de que el turno no cambió el plan y de que lo dicho en el chat no está guardado.

## Qué no afirma

No mide calidad clínica ni tiempo de médicos. El modelo (Grok 4.20 non-reasoning) es no determinista: los textos de las respuestas varían; lo que se comprueba son los efectos en el registro (versión, líneas, bitácora, sello) y los avisos de la interfaz.
