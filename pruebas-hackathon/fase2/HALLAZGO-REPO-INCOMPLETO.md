# El repositorio publicado no compila: faltan 13 archivos de código

> **RESUELTO el 7-nov-2026 en el commit `6543854`**, «Restaurar los 23 archivos
> de megi-revision omitidos por el .gitignore copiado». Comprobado por mí desde
> un clon limpio: `.gitignore` del equipo restaurado, los once módulos presentes,
> `typecheck` limpio (de 29 errores a cero), `build` en cero, las tres rutas a
> 200 y los guiones propios del proyecto en **195/195** (auditoría `--http`
> 117/117, batería `--http` 33/33, revisión trazable 45/45) más `doctor` en
> cero. El detalle de esa reverificación está al final, en «Cómo se cerró».
> Lo que sigue se conserva como registro de lo que pasó y de cómo se diagnosticó.

Encontrado el 7-nov-2026 al comprobar el remoto antes de empujar la fase 2.
Afecta a `NGZeggers/hackathons`, rama `bluiders.io`, commit **`6b087ff`** (el
«Cierre del 7 nov»). **No es un fallo del producto: es un fallo de publicación.**
El código funciona en el equipo donde se escribió; lo que está en GitHub, no.

## Qué pasó

El commit `37bb86f` reemplazó `.gitignore` entero. Antes tenía 26 reglas
cuidadas (entornos, credenciales, `node_modules`, `.output`, bases de datos…).
Ahora tiene tres líneas:

```gitignore
megi-revision/
megi-demo/
.DS_Store
```

Eso ignora **la aplicación completa** y **el backend de demo completo**. Git
sigue versionando los archivos que ya seguía, así que nada desapareció del
repositorio y los cambios sobre archivos existentes se commitearon bien. Pero
cualquier archivo **nuevo** bajo esas dos carpetas se volvió invisible para
`git add`, sin aviso.

El resultado se ve en el propio commit del cierre:

| Carpeta | Archivos nuevos que añadió |
|---|---|
| `evidencia/` | 266 |
| `pruebas-hackathon/` | 2 |
| raíz (`PARA_EL_100.md`, `PENDIENTE_VALIDACION_USUARIOS.md`) | 2 |
| **`megi-revision/`** | **0** |
| **`megi-demo/`** | **0** |

Cero archivos nuevos en las dos carpetas ignoradas, mientras el código
modificado en ellas sí entró y **importa trece módulos que nunca se subieron**.

## Los trece que faltan

Servidor:

- `megi-revision/server/lib/megi/peticion.ts` — `enPeticionMegi`, importado por
  **nueve** acciones (`listar-consultas`, `proponer-plan`, `aprobar-plan`,
  `agregar-linea`, `actualizar-linea`, `reajustar-plan`, `obtener-plan`,
  `ver-contexto-consulta`, `view-screen`)
- `megi-revision/server/lib/megi/secretos.ts` — `CLAVE_USUARIO_MEGI`,
  `CLAVE_CONTRASENA_MEGI`, que `megi/index.ts` usa para la identidad por médico
- `megi-revision/server/lib/revision.ts` — importado por ocho archivos
- `megi-revision/server/lib/sugerencias.ts`

Interfaz:

- `megi-revision/app/lib/revision-sync.ts`
- `megi-revision/app/components/revision/EstadoAgente.tsx`
- `megi-revision/app/components/revision/TrabajoAgente.tsx`
- `megi-revision/app/components/revision/ConciliacionMedicacion.tsx`
- `megi-revision/app/components/revision/MedicionesRevision.tsx`
- `megi-revision/app/components/revision/DemoAutonoma.tsx`
- `megi-revision/app/components/revision/ComparacionPlan.tsx`

(Y las dos resoluciones relativas `./peticion.js` y `./revision.js` desde dentro
de `server/lib/`, que son los mismos archivos.)

Ninguno está en el repositorio con ningún otro nombre: `git ls-tree -r` sobre
`6b087ff` no los encuentra.

## Cómo se comprueba, en treinta segundos

```bash
git clone https://github.com/NGZeggers/hackathons.git && cd hackathons
git checkout bluiders.io
cd megi-revision && pnpm install --ignore-scripts
pnpm typecheck
```

Resultado en `6b087ff`: **29 errores TS2307**, «Cannot find module», uno por cada
importación que no existe. La aplicación no arranca desde un clon limpio.

## Por qué importa ahora

Las bases del hackatón verifican el envío antes de repartir premios, y entre lo
que verifican está el uso del framework y la accesibilidad de la demo. Un
repositorio que no compila es un repositorio que un juez no puede ejecutar. El
borrador de envío dice que el enlace al repositorio es opcional; aun así, el
equipo depende de este repositorio como copia de seguridad del trabajo: hoy no
lo es. Si el disco donde viven esos trece archivos se pierde, el proyecto pierde
la identidad por médico, cuatro módulos de servidor y siete componentes de
pantalla.

## Comprobado en ejecución, no deducido (7-nov)

Para no quedarse en el `typecheck`, levanté la aplicación tal y como está en el
repositorio: clon en `6b087ff`, árbol limpio, base de datos nueva, el backend de
demo en pie y `MEGI_MEDICOS` con el correo de la sesión.

```
agent-native dev --port 8190
GET /                  → 500
GET /revision          → 500
GET /revision/demo-c2  → 500
```

En el registro del servidor:

```
Error: Failed to load url ../server/lib/megi/peticion.js
(resolved id: ../server/lib/megi/peticion.js) in .../actions/actualizar-linea.ts.
Does the file exist?
```

**Quinientos en todas las rutas, incluida la portada.** No es que falte una
pantalla: el registro de acciones se carga al arrancar, una de ellas no resuelve
su importación y el servidor no sirve nada. La aplicación del repositorio no se
puede abrir, ni grabar, ni enseñar.

### Qué sí sobrevive

| | |
|---|---|
| `megi-demo/` (341 archivos) | **funciona.** `import app.main` entra sin error: el backend de demo arranca desde el repositorio |
| `evidencia/` (315 archivos) | completa, incluidos los 266 que añadió el cierre |
| `pruebas-hackathon/` | completa, pero sus guiones no pueden correr porque importan la app |
| documentos (`ESTADO.md`, `PARA_EL_100.md`, …) | completos |
| **`megi-revision/` (168 archivos)** | **no arranca:** faltan 13 módulos que su propio código importa |

Dicho de otro modo: lo que cuenta la historia está entero y lo que la demuestra,
no. El producto vive en un disco.

### Lo que esto no es

No es pérdida de trabajo *si* los trece archivos siguen en la máquina donde se
escribieron: son 13 de 181, el resto del código sí está versionado, y basta
añadirlos. Tampoco es un fallo del producto: el mismo código, completo, pasa sus
propias pruebas. Es un fallo de publicación, y se arregla en dos comandos. Lo
que no se puede es dejarlo así: hoy el repositorio no sirve ni como copia de
seguridad ni como demostración.

### Si los trece archivos se hubieran perdido

El proyecto no se queda sin producto. El repositorio todavía contiene una
aplicación **completa y que arranca**: la de `d03fdf7`, que es la que verifiqué
en la fase 2 (47/47 en HTTP, 29/29 en el adaptador, 33/33 en la batería de la
fase 1 y 57/57 en la auditoría del proyecto, con `typecheck`, `doctor` y `build`
en cero). Volver a esa base cuesta un `git checkout d03fdf7 -- megi-revision`.

Lo que se perdería es el trabajo del 7 de noviembre sobre la app: identidad por
médico (I2), la paginación de la agenda y el historial (I3) y el pulido de
interfaz (I5). Nada de eso está en el repositorio, ni en forma de código ni en
forma suficiente para reconstruirlo desde los documentos: `peticion.ts` y
`revision.ts` son el centro de la primera, y los seis componentes son la
tercera. Reescribirlos no sería recuperarlos.

Por eso el orden importa: **primero subir los trece archivos**, y solo después
pensar en cualquier otra cosa, incluidos mis arreglos de la fase 2.

## Cómo se arregla

Lo tiene que hacer quien tenga esos archivos en su disco; no se pueden
reconstruir desde el repositorio. Dos pasos, en este orden:

```bash
# 1 · devolver un .gitignore que ignore lo que hay que ignorar, no el proyecto
git show d03fdf7:.gitignore > .gitignore

# 2 · añadir lo que quedó fuera y comprobar que ya compila
git add megi-revision megi-demo
git status --short | head -40        # revisar que no entre .env, data/, .output/
cd megi-revision && pnpm typecheck  # debe quedar limpio antes del commit
```

El primer paso importa tanto como el segundo: con `megi-revision/` ignorado, el
mismo accidente se repite con el siguiente archivo nuevo.

Conviene revisar también, con el `.gitignore` antiguo restaurado, que no se cuele
nada que no deba: `megi-revision/data/`, `megi-demo/backend/data/megi_secret.key`,
las sesiones y los perfiles de voz del backend de demo estaban excluidos a
propósito.

## Dos cosas más que aparecieron de paso

- **`pnpm build` falla en `6b087ff`** —medido, código de salida 1—, pero no por
  lo que escribí primero. Junto al fallo aparecen dos «production configuration
  errors» (`BETTER_AUTH_SECRET is not set for production`, «Production has no
  persistent database URL») y los atribuí a ellos. No es así: `agent-native build`
  imprime esos dos avisos también cuando termina bien, y lo que rompe la
  construcción es «Build failed with 7 errors: No such file or directory», es
  decir los mismos archivos ausentes. En `6543854` el `build` termina en cero con
  los dos avisos intactos y sin ninguna variable de entorno. **La causa era una
  sola todo el tiempo.**
- **La batería de la fase 2 detecta esto sola.** `pruebas-hackathon/fase2/requisitos.mjs`
  comprueba precisamente el `build` (r1) y el `typecheck` (r2) del árbol
  publicado. Correrla antes de cada push habría avisado.

## Cómo se cerró · reverificación del 7-nov sobre `6543854`

Clon nuevo de `bluiders.io`, árbol limpio, sin `.env` y sin ninguna variable de
entorno de autenticación o base de datos en el ambiente:

| Comprobación | Antes (`6b087ff`) | Ahora (`6543854`) |
|---|---|---|
| `.gitignore` | tres líneas, ignora la app entera | las 26 reglas del equipo, restauradas |
| Los once módulos que el código importa | ninguno | **los once presentes** |
| `pnpm typecheck` | 29 errores TS2307 | **cero** |
| `pnpm build` | código 1, «7 errors: No such file or directory» | **cero**, `Build complete` |
| `pnpm agent-native:doctor` | no medido | **cero** |
| `GET /` · `/revision` · `/revision/demo-c2` | 500 · 500 · 500 | **200 · 200 · 200** |
| `evidencia/auditoria-hackathon.mts --http` | `ERR_MODULE_NOT_FOUND` | **117 pasan · 0 fallan** |
| `pruebas-hackathon/bateria.mts --http` | `ERR_MODULE_NOT_FOUND` | **33 pasan · 0 fallan** |
| `pruebas-hackathon/revision-trazable.mts` | `ERR_MODULE_NOT_FOUND` | **45 pasan · 0 fallan** |
| Secretos colados al añadir las carpetas | — | **ninguno**: ni `.env`, ni `data/`, ni `megi_secret.key`, ni sesiones, ni perfiles de voz |

117 + 33 + 45 = **195**, que es exactamente la cifra que `PARA_EL_100.md`
declaraba y que hasta hoy no se podía reproducir fuera del disco donde se midió.
Ahora se reproduce desde el repositorio, que era el fondo del asunto.

Lo corrí con `node evidencia/verificar.mjs` —el guion maestro del propio
proyecto— contra `evidencia/backend.mjs` en el puerto 8123, con su SQLite
aislado y sembrado por `seed_demo.py` y `sembrar-medico-b.py`. Los seis pasos
del guion dieron código cero.

Dos avisos sobre el método, para que nadie tome mis cifras por más de lo que son:

- El `pnpm install` del clon nuevo quedó bloqueado en mi entorno, así que corrí
  las comprobaciones en un clon que ya tenía `node_modules`, colocado en
  `6543854`. Las dependencias de `package.json` son idénticas entre los dos
  árboles —el commit solo cambió `displayName`, `description` y tres guiones—,
  y el árbol de trabajo estaba limpio salvo los JSON de resultados que los
  propios guiones reescriben.
- La primera pasada dio 116/117: falló `http-vivo-megi-registra-approved-by-de-b`
  porque el backend de demo que tenía en pie era el del 5-nov y le faltaba el
  `consultations.py` nuevo, el que expone la nota de la aprobación en la
  auditoría. Era mi entorno, no el repositorio. Con el backend publicado, 117.
