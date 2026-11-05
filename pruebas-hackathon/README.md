# Revisión del producto del hackatón · MEGI Revisión

Revisión hecha el 3 y 4 de noviembre de 2026 sobre `bluiders.io` en el commit **`90085a5`**
(«MEGI Revisión: proyecto Agent-Native y auditoría corregida»).

**Los ocho arreglos de este informe ya están aplicados en el código** (commit `3d3ecb8`).
Lo que aquí se describe como «fallo» es lo que había en `90085a5`; lo que se
describe como «arreglo» es lo que hay ahora. La batería queda como regresión:
vuelve a fallar si alguno de los ocho reaparece.

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `bateria.mts` | 33 pruebas nuevas de funcionamiento, seguridad y utilidad |
| `bateria-resultados-antes.json` | La batería sobre `90085a5`, antes de los arreglos: **21 pasan, 12 fallan** |
| `bateria-resultados.json` | La batería sobre el código actual: **33 pasan, 0 fallan** |

El parche con los ocho arreglos, por si hace falta verlos por separado, está en
`canvas-megi-ia/pruebas-hackathon/correcciones-megi-revision.patch`.

## Cómo se corre

```bash
# 1. MEGI de demo (necesario solo para el bloque 4)
cd megi-demo/backend && ./start_demo.sh &          # 127.0.0.1:8020
MEGI_MODE=local_mock .venv/bin/python seed_demo.py

# 2. la batería, desde la raíz del repo del hackatón
megi-revision/node_modules/.bin/tsx pruebas-hackathon/bateria.mts        # bloques 1-3
megi-revision/node_modules/.bin/tsx pruebas-hackathon/bateria.mts --http # + bloque 4
```

Aislada igual que `evidencia/auditoria-hackathon.mts`: PGlite en memoria,
adaptador mock, transporte http simulado. No lee `.env`, no llama a ningún LLM
y no toca la demo. El bloque 4 solo lee del MEGI de demo y provoca un 409; no
aprueba, no exporta y no escribe.

## Estado de verificación

| Comprobación | Antes | Después |
|---|---|---|
| `evidencia/auditoria-hackathon.mts --http` (la que ya existía) | 57/57 | **57/57** |
| `pruebas-hackathon/bateria.mts --http` (nueva) | 21/33 | **33/33** |
| `pnpm typecheck` | limpio | limpio |
| `pnpm agent-native:doctor` | limpio | limpio |

Sobre el 57/57 que afirma `ESTADO.md`: es correcto, pero **52 de esas 57 corren
en mock y las 5 restantes solo existen si el backend de demo está arriba**
(`--http`). Sin backend el script dice 52/52, no 57/57. Lo comprobé con el
backend levantado: las 57 pasan.

---

# Fallos encontrados

## S1 · El id de una consulta se sale de su ruta en MEGI · **grave**

`server/lib/megi/megi-http.ts` metía el id en la URL sin validarlo:

```ts
await this.call("GET", `/consultations/${aReal(consultaId)}`)
```

El agente controla ese id por completo (`ver-contexto-consulta`,
`proponer-plan`), y `aReal()` deja pasar tal cual cualquier cosa que no sea un
id de demo. `fetch` normaliza los `..`, así que:

```
verConsulta("../users")                        → GET /api/users
verConsulta("../../api/patients/P-OTRO")       → GET /api/patients/P-OTRO
verConsulta("demo-c1/../../me")                → GET /api/me
verConsulta("../export/consultation/C-DEMO1")  → GET /api/export/consultation/C-DEMO1
```

Todo con la sesión del usuario de servicio del adaptador. **Comprobado en vivo
contra el MEGI de demo**, no solo en teoría:

- `GET /api/me` devolvió la ficha del usuario de servicio.
- `GET /api/users` devolvió 200.
- Y lo peor: `GET /api/export/consultation/{id}` **escribe** en MEGI. Después
  de esa llamada, `C-DEMO1` quedó así:

  ```
  status = "exported"   approved_at = null   approved_by = null
  ```

  Una consulta consolidada quedó marcada como exportada **sin que nadie la
  aprobara y sin firma**, y además desapareció de la lista de pendientes
  (`listarConsultasCerradas` filtra las `exported`). El disparador fue
  `ver-contexto-consulta`, una acción declarada `readOnly: true`.

**Arreglo.** `idSeguro()`: un id tiene que ser un único segmento de ruta
(`/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`, sin `..`) y se codifica con
`encodeURIComponent`. Se aplica en las once rutas del adaptador. Lo que no pasa
el filtro no llega a la red: `MegiError` 400.

Pruebas: `seg-id-no-se-sale-de-su-ruta`, `seg-readonly-no-escribe-en-megi`,
`http-id-rechazado-antes-de-salir-a-la-red`.

## S2 · Una alerta que MEGI nombre distinto se perdía en silencio · latente

`verificarReceta` emparejaba las alertas con el fármaco comparando cadenas
exactas (`a.farmaco === etiqueta`, donde `etiqueta` es `"Ibuprofeno 400 mg"`).
Si MEGI nombra la alerta de otra forma —el nombre del catálogo sin la dosis, o
normalizado—, la alerta no se atribuye a ninguna línea, **se descarta sin
rastro y el fármaco se informa como `ok`**.

Lo medí contra el MEGI real antes de tocar nada: este backend devuelve la
etiqueta tal cual (`drug: "Ibuprofeno 400 mg"`), así que **hoy no es
explotable**. Es una dependencia no declarada de un detalle de implementación
de MEGI: se rompe el día que MEGI normalice nombres, o cuando la interacción
venga del catálogo con su nombre canónico. Y el modo de fallo es el peor
posible: silencioso y en dirección insegura.

**Arreglo.** Atribución normalizada (sin acentos ni mayúsculas) contra la
etiqueta y contra el nombre a secas. La medición
`http-como-nombra-megi-el-farmaco` queda en la batería para que, si MEGI cambia,
se vea en el informe.

Pruebas: `seg-alerta-con-otro-nombre-si-bloquea`, `http-la-alerta-llega-atribuida`.

## S3 · El usuario de servicio del adaptador es administrador · **no lo toqué**

`GET /api/me` con las credenciales del adaptador:

```json
{"username":"demo_medico","role":"admin","name":"Dra. Demo Ficticia"}
```

`seed_demo.py` lo crea con `create_admin`. El adaptador solo necesita leer
pacientes y consultas y llamar a `/review/approve`: no necesita ser admin. Ser
admin es lo que convirtió S1 en algo que además lista usuarios.

No lo cambié **a propósito**: en MEGI el expediente se lee por propiedad
(`patients.doctor_id`) y bajar el rol a `medico` antes del envío puede dejar la
demo sin acceso a sus propios pacientes. Es una línea en `seed_demo.py`, pero
hay que probar la demo entera después. Mi recomendación es hacerlo **después
del envío**, no antes.

## F1 · Los dos ids de una misma consulta no apuntaban al mismo plan

El plan se guarda con el id lógico (`demo-c1`), pero `obtener-plan` y
`ver-contexto-consulta` buscaban con el argumento crudo. Pedir la consulta por
su id real de MEGI (`C-DEMO1`) daba «esta consulta todavía no tiene plan»
aunque el plan existiera, y `ver-contexto-consulta` devolvía `planId: null`.
Crear uno nuevo sí se frenaba, pero por la restricción `UNIQUE (consulta_id,
owner_email)` de la migración, no por la comprobación de la acción.

**Arreglo.** `obtener-plan` normaliza con `aLogico`; `ver-contexto-consulta` y
`proponer-plan` usan `consulta.id`, que es el id con el que se guarda.

Pruebas: `fn-id-real-encuentra-el-plan`, `fn-contexto-ve-el-plan-con-id-real`,
`fn-id-real-no-duplica-plan`.

## F2 · Un plan largo perdía líneas en silencio

`lineasDe` tenía `.limit(200)`. Pasado ese número, una línea añadida
desaparecía del tablero, **no se verificaba** y **no salía en la receta
exportada**. Nada avisaba.

**Arreglo.** El tope de lectura sube a 400 y las escrituras se paran antes con
`exigirEspacio` → `plan_demasiado_largo` (409). Nunca se trunca sin decirlo.

Pruebas: `fn-plan-largo-no-pierde-lineas`, `fn-plan-largo-verifica-el-farmaco`.

## F3 · El mismo fármaco dos veces en el plan no avisaba · clínico

MEGI verifica por nombre de fármaco. Dos líneas del mismo fármaco reciben el
mismo resultado, así que **Paracetamol 1 g cada 8 h + Paracetamol 500 mg cada
6 h** pasaba como `ok` en las dos líneas, sin una palabra sobre la dosis
duplicada.

**Arreglo.** `verificarPlan` detecta nombres repetidos entre las líneas
vigentes y sube el `ok` a `advertencia` con el motivo escrito. No bloquea: hay
pautas legítimas con el mismo fármaco (una reducción escalonada), así que lo
correcto es que se vea, no que se impida.

Prueba: `fn-farmaco-duplicado-avisa`.

## U1 · Las advertencias no quedaban escritas al aprobar

Los bloqueos tienen casilla de confirmación, texto en el diálogo y línea en la
bitácora. Las advertencias solo salían como un chip en la tabla: el diálogo de
aprobación no las mencionaba y **no quedaba ningún rastro de que existieran**.
Un plan con una interacción moderada (naproxeno × losartán, el caso demo-c2) se
aprobaba y exportaba sin constancia de la advertencia.

**Arreglo.** El diálogo las lista en ámbar (informativo, sin casilla: no frenan
la aprobación) y el evento `aprobar` y las notas que van a MEGI las incluyen.

Prueba: `uti-la-advertencia-queda-en-la-bitacora`.

## U2 · El adaptador repetía peticiones dentro de una misma operación

- Verificar un fármaco bloqueado pedía **dos veces** el paciente y **dos veces**
  su lista de consultas, porque `alternativas()` volvía a leer el paciente que
  `verificarReceta()` acababa de leer: 6 peticiones → **4**.
- `listarConsultasCerradas` pedía la lista de consultas de cada paciente y
  luego `medicacionActiva` la volvía a pedir: 10 peticiones para 3 pacientes →
  **7**.

**Arreglo.** Pasar lo ya leído. Prueba: `uti-sin-peticiones-repetidas-al-verificar`.

## U3 · Dos acciones de la plantilla seguían en el catálogo del agente

`actions/hello.ts` (saludo de ejemplo, expuesto como `mcpTool`) y
`actions/provider-api-request.ts` (**Slack Web API** con la conexión del
espacio de trabajo). La segunda no es solo ruido: en una app que maneja nota
clínica, alergias y receta, deja una salida al exterior en el catálogo del
agente. Las escrituras piden aprobación y Slack no está conectado, pero no hay
razón para que esté ahí.

**Arreglo.** Borradas. `pnpm agent-native:doctor` sigue limpio y nada del
código las referenciaba.

Prueba: `uti-catalogo-sin-acciones-de-plantilla`.

---

# Lo que no toqué, y por qué

- **Listar consultas no escala.** `listarConsultasCerradas` recorre todos los
  pacientes y todas sus consultas: ~2 peticiones por paciente más una por
  consulta pendiente. Con los 4 de la demo son 7–10; con 500 pacientes son más
  de mil peticiones **cada vez que el agente lista**. Lo que hace falta es un
  endpoint en MEGI que devuelva las consultas consolidadas sin aprobar — y su
  ausencia ya está documentada como trampa 6 en
  `megi-demo/docs/api_megi_para_adaptador.md`. Es trabajo de MEGI, no del
  adaptador, y no cabe antes del 9-nov.
- **`medicacionActiva` mira solo la última consulta aprobada.** Un crónico
  recetado dos consultas atrás no se cruza contra la receta de hoy. Es el
  contrato declarado en `types.ts`, pero es un hueco clínico real.
- **El mock empareja alergias por subcadena.** Una alergia registrada como
  «beta-lactámicos» (con guion) no dispara sobre amoxicilina. No es alcanzable
  con los cuatro pacientes de la demo, cuyas alergias son «Penicilina»,
  «Sulfas» y «Ninguna conocida». No lo toco antes del envío.
- **`exportar` llama a MEGI dentro de la transacción**, con la fila del plan
  bloqueada. Funciona y la recuperación está probada (57/57), pero si MEGI
  tarda, el plan queda bloqueado ese tiempo.
- **Las advertencias no exigen confirmación.** Decisión de diseño; ahora al
  menos quedan escritas (U1).

# Cómo volver a verificar

```bash
cd megi-demo/backend && ./start_demo.sh &
MEGI_MODE=local_mock .venv/bin/python seed_demo.py
cd ../.. && megi-revision/node_modules/.bin/tsx evidencia/auditoria-hackathon.mts --http
megi-revision/node_modules/.bin/tsx pruebas-hackathon/bateria.mts --http
cd megi-revision && pnpm typecheck && pnpm agent-native:doctor && pnpm build
```

Las cuatro comprobaciones, con los arreglos puestos y el backend de demo
arriba: **57/57**, **33/33**, typecheck limpio, doctor limpio, build completo.

## Cómo se obtuvo el «antes»

`bateria-resultados-antes.json` sale de correr la misma batería con el código de
la app revertido al commit auditado, sin tocar nada más:

```bash
git checkout 90085a5 -- megi-revision
megi-revision/node_modules/.bin/tsx pruebas-hackathon/bateria.mts --http
cp pruebas-hackathon/bateria-resultados.json pruebas-hackathon/bateria-resultados-antes.json
git checkout HEAD -- megi-revision
```

Por eso ese archivo anota `cambiosSinCommitear: true`: el árbol estaba revertido
a propósito cuando se ejecutó. Los dos archivos de resultados lo anotan también,
porque cuentan como cambios sin commitear ellos mismos mientras se escriben.
