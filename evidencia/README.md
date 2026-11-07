# Evidencia reproducible

Usar los pacientes sintéticos y la base aislada de la demo. Instalar la app con pnpm y, en esta carpeta, `npm ci` y `npx playwright install chromium`.

1. Desde la raíz: `node evidencia/backend.mjs`. Siembra exclusivamente `evidencia/.runtime/backend/megi.sqlite` (médico de demo y, con `sembrar-medico-b.py`, una segunda médica ficticia con su propio paciente) y escucha en 8123. Requiere `megi-demo/backend/.venv`. Reiniciarlo resiembra: hazlo antes de cada recorrido que apruebe.
2. En `megi-revision/.env`, configurar xAI con `OPENAI_BASE_URL=https://api.x.ai/v1`, su clave privada, `AGENT_ENGINE=ai-sdk:openai` y `AGENT_MODEL=grok-4.20-0309-non-reasoning`. La clave nunca se guarda en estos resultados. Un `AGENT_MODEL` explícito prevalece sobre la preferencia de app.
3. En otra terminal: `cd megi-revision` y `pnpm demo --port 8082 --no-open`. Usa `.demo/pglite`. Reiniciar este proceso después de cambiar el modelo del archivo de entorno.
4. `node evidencia/verificar.mjs`: typecheck, doctor, build y tres regresiones. HTTP usa `http://127.0.0.1:8123`, configurable con `MEGI_URL`. La auditoría `--http` aprueba C-DEMOB1 con la segunda cuenta: resiembra (paso 1) antes de repetirla.
4b. `MEGI_URL=http://127.0.0.1:8123 node evidencia/recorrido-http.mjs` (opcional `MEGI_BACKEND_LOG=<log del backend>` para contar llamadas): arranca la UI en **modo http** con `ui-http.mjs` (PGlite propia en `.runtime/ui-http/`, puertos 8084/8085) y recorre cuenta compartida, conexión propia por médico y denegación. Capturas en `capturas-http/`, resultado en `resultados/recorrido-http.json`.
4c. `megi-revision/node_modules/.bin/tsx evidencia/coste-historial.mts`: coste anterior/posterior de I3 con backends sintéticos (sin red) → `resultados/coste-historial.json`.
4d. `python3 evidencia/cerrar-iteraciones.py`: matriz I1–I6 con estado, pruebas y hashes → `resultados/iteraciones-i1-i6.json`.
4e. `MEGI_UI_URL=http://localhost:8082 node evidencia/friccion-ui.mjs`: fricción sin usuarios: teclado (foco visible, Enter, flechas en pestañas, foco atrapado y Escape en el diálogo), zoom (texto al 200 % y ventana de 640 px) y estados de espera/error/vacío con respuestas interceptadas; un solo `<main>` por pantalla. Capturas en `capturas-friccion/`, resultado en `resultados/friccion-ui.json`.
4f. `megi-revision/node_modules/.bin/tsx evidencia/valor-diferencial.mts`: la misma receta inicial en los cuatro casos, mesa frente a chat sin mesa; cuenta alertas visibles, rechazos sobre líneas fijadas y fuera de alcance, frenos de aprobación, fuentes, versiones y eventos → `resultados/valor-diferencial.json`, resumen en `valor-diferencial.md`. Sin LLM, sin red.
4g. `MEGI_UI_URL=http://localhost:8082 node evidencia/continuidad.mjs`: demo de continuidad UI–agente con modelo real sobre demo-c3 (propuesta, fijar y acotar desde la UI, reajuste dentro del alcance, rechazo atómico, cancelación sin parcial, conciliación y exportación). Guion en `demo-continuidad.md`; capturas en `capturas-continuidad/`; resultado en `resultados/continuidad.json`.
5. `node evidencia/ejecutar.mjs`: edición, alternativa automática real, español, versiones, selección, exportación y advertencias. Restaura los cuatro casos propios antes de cada recorrido.
6. `node evidencia/ejecutar.mjs --agente`: cancelación, recuperación, pregunta estructurada de alergias, propuesta, recibo, sincronización, métricas y bloqueo respetado. Usa el predeterminado real de la app; genera consumo en el proveedor.
7. `node evidencia/ejecutar.mjs --diagnostico`: metadatos de ocho trazas propias recientes y de los turnos medidos identificados en los JSON. Conserva duración, tokens, estado y nombres de claves; excluye prompts, argumentos, resultados clínicos y credenciales.
8. `node evidencia/finalizar.mjs`: restaura los cuatro casos propios, comprueba la ausencia de planes y captura el manifiesto MCP. Conserva mediciones y otros usuarios.
9. Con la app guardada en un commit local, ejecutar `python3 evidencia/auditar-para-el-100.py` y después `python3 evidencia/cerrar-validacion.py`. Generan la matriz de requisitos, los hashes y el índice de evidencia. El repositorio principal queda sin staging ni commit por indicación del usuario.

`MEGI_UI_URL` cambia la URL del navegador (por defecto :8082). JSON y logs están en `resultados/`; capturas en `capturas/`, `capturas-advertencias/`, `capturas-friccion/` y `capturas-continuidad/`. Un código distinto de cero indica un fallo. Se registra por separado una única sonda 401 de `agent-engine/status` sin sesión; los demás errores de red permanecen visibles. Los recorridos esperan el fin del runtime, y verifican que el plan no dependa del respaldo de sincronización de 60 s.

Los tests de servidor usan PGlite en memoria. El backend HTTP de demo solo se lee/verifica; la UI exporta en el mock aislado. El build local no acredita un despliegue: este entorno carece de la configuración de producción de autenticación y Postgres persistente. Permanecen avisos conocidos del renderer del framework.

## Resultado vigente

- 117/117 auditoría `--http` (57 originales + 24 de H1–H3 + 36 de I2/I3, 13 de ellas contra backend vivo con dos cuentas); 33/33 batería `--http` más mediciones; 45/45 revisión trazable; recorrido http 25/25. Typecheck, doctor y build en cero (`resultados/verificacion.json`, 7 nov). Matriz de iteraciones: `resultados/iteraciones-i1-i6.json`.
- `auditoria-independiente.mts` reproduce H1/H2 del dictamen y escribe `resultados/auditoria-independiente-tras-correccion.json`; `resultados/auditoria-independiente-2026-11-06.json` conserva el estado anterior a corregir. El dictamen está en `resultados/dictamen-auditoria-2026-11-06.json`.
- Navegador (modo demo, repetido el 7 nov sobre el código final): 33/33 edición/exportación, 7/7 advertencias y 15/15 agente; 2/2 restauración/manifiesto y 1/1 sugerencias en español son de ejecuciones anteriores.
- Respuesta al dictamen UX de 91/100 (7 nov): fricción 40/40 (`resultados/friccion-ui.json`), valor diferencial 20/20 (`resultados/valor-diferencial.json`), continuidad UI–agente 18/18 con modelo real (`resultados/continuidad.json`); recorrido 33/33, advertencias 7/7 y agente 15/15 repetidos sobre la interfaz final; reverificación del auditor 12/12 en `resultados/ux-2026-11-07/reverificacion-final/`; typecheck, doctor y build en cero (`resultados/verificacion-ui-2026-11-07.json`). Resumen con hashes: `resultados/respuesta-dictamen-91.json`. Correcciones de interfaz derivadas en ESTADO.md.
- Grok 4.20 Non-Reasoning, desde un navegador nuevo con el predeterminado real: **plan visible 4,228 s; turno completo 3,659 s**, tras responder alergias. La traza confirma el modelo, una llamada de API de 3,329 s y herramientas de 0,023 s.

El objetivo de menos de 35 s se verificó en ese caso. Es una muestra exploratoria n=1; no demuestra eficacia clínica ni garantiza una latencia máxima. La API incluye red y reintentos y no equivale al cómputo puro del modelo. La serie conserva intentos anteriores, incluidos fallos y esperas mayores; un tiempo inicial de la variante rápida se conserva redondeado a 0,1 s y así se identifica.

La [auditoría por requisito](resultados/auditoria-para-el-100.json), la [validación](revision-trazable-validacion.json), la [serie](resultados/latencia-serie.json), la [comparación de modelos](resultados/comparacion-modelos.json) y el [manifiesto MCP](revision-trazable-mcp.json) son las referencias vigentes. Capturas útiles: [sugerencias en español](capturas/sugerencias-espanol.png), [API y herramientas separadas](capturas/21-medicion-api-modelo.png) y [demo restaurada](capturas/demo-lista-para-grabar.png).

## Comparaciones y configuración

`--agente-fast` compara Grok 4.20 mediante selección temporal y guarda resultados con sufijo `grok-420`. `--agente-local` solicita el Qwen instalado y usa sufijo `qwen-local`; requiere un servidor de prueba configurado para Ollama y 32k. Las listas de modelos se conservan antes de modificarlas y se restauran al terminar, incluso ante fallos. El comprobador valida el modelo efectivo de la traza: el nombre del selector no basta.

El intento local archivado **no es una comparación válida de Qwen**: la traza mostró Grok 4.7 por la configuración del motor. Se conserva explícitamente como inválido y no se utiliza para elegir el modelo. Los intentos de navegación/selección fallidos están en `resultados/intentos/`.

`--modelos` lee opciones y disponibilidad; `--modelo-app` lee la preferencia de MEGI. `--modelo-app-fast` guarda esa preferencia específica, pero no reemplaza un `AGENT_MODEL` forzado. `--modelos-xai` consulta solo `/models` del endpoint xAI configurado, manteniendo la clave dentro del proceso y fuera de los resultados. xAI documenta [herramientas y salidas estructuradas para esta variante](https://docs.x.ai/developers/models/grok-4.20-0309-non-reasoning).

Los artefactos anteriores son históricos. GitHub, despliegue y Clips siguen fuera de este encargo.
