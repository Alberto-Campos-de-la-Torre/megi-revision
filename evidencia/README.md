# Evidencia de verificación · 2 nov 2026

`capturas/` son las pantallas reales del recorrido automatizado en navegador (Playwright, Chromium sin cabeza)
contra la app `megi-revision` en modo `http`, es decir, con el backend MEGI de demo en el puerto 8020.

Orden del recorrido: lista de consultas → demo-c1 sin plan → plan en blanco → amoxicilina bloqueada por alergia →
diálogo de aprobación con bloqueo (botón deshabilitado) → línea bloqueada por el médico → rechazo con motivo →
bitácora → aprobado y exportado → pestaña de exportación FHIR → lista sin demo-c1 → demo-c2 con aviso de alergias
sin registro → botón que abre la barra del agente.

Para repetirlo:

```bash
mkdir pw && cd pw && npm i playwright@1.52.0 && npx playwright install chromium
cp ../recorrido.mjs ../cola.mjs . && node recorrido.mjs     # requiere la app en :8080 y MEGI demo en :8020
```

`recorrido.mjs` aprueba demo-c1 en MEGI: después hay que volver a sembrar (`megi-demo/backend/seed_demo.py`)
y borrar `megi-revision/data/` para repetirlo desde cero.

## Agente en vivo

`agente.mjs` (propuesta) y `cola-agente.mjs` (línea bloqueada) ejercitan al agente real por el chat de la app.
`capturas/20…25` son con el motor local Ollama (`qwen2.5-14b-32k`); `capturas/grok/` con Grok 4.7, el motor de la demo.
En ambos casos el agente propone el plan, y ante «quita la línea bloqueada» no la toca y lo explica.


## Auditoría y regresión

`auditoria-hackathon-antes.json` conserva los 19 resultados iniciales (14 correctos, 5 fallos). `auditoria-hackathon.mts` ahora prueba las correcciones; `auditoria-hackathon-resultados.json` contiene la ejecución más reciente. Ejecutar desde la raíz:

```bash
megi-revision/node_modules/.bin/tsx evidencia/auditoria-hackathon.mts --http
```

Las escrituras se ejecutan en PGlite en memoria. `--http` añade solo consultas y verificaciones al MEGI ficticio local, sin aprobarlo. Las pruebas de recuperación HTTP usan transporte simulado. Los resultados indican el commit de referencia y si existían cambios sin commit; el hash del código comprobado se conserva en `validacion-local.json`.

La prueba manual posterior a las correcciones se hizo en Firefox con `demo-c4`; la aprobación y el FHIR solo se enviaron al backend de demo en localhost. Las capturas y el video de las secciones anteriores son evidencia histórica previa a esta auditoría. Ningún video se subió a Clips ni se envió la participación; David detuvo expresamente la publicación.

`licencias/` contiene los manifiestos y avisos de las dependencias instaladas, además de la licencia oficial de Agent-Native. `bases/` conserva las páginas oficiales consultadas como HTML. Estos archivos son evidencia local.
