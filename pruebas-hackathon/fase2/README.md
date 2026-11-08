# Fase 2 · revisión y búsqueda de errores

Segunda vuelta sobre `NGZeggers/hackathons`, rama `bluiders.io`, partiendo del commit
`d03fdf7` (el que dejó la fase 1). Hecha el 6 de noviembre de 2026.

> **Estado al 7-nov, tras reverificar el remoto.** La rama avanzó a `6543854`. El
> cierre del 7-nov había dejado el repositorio sin trece módulos y sin arrancar
> —[`HALLAZGO-REPO-INCOMPLETO.md`](HALLAZGO-REPO-INCOMPLETO.md)—; ese commit lo
> arregló y lo comprobé desde un clon limpio: `typecheck`, `doctor` y `build` en
> cero, las rutas a 200 y los guiones del proyecto en 195/195. **Los cinco
> arreglos de esta fase siguen haciendo falta sobre ese código** (ver la tabla
> final de [`ANALISIS-PARA_EL_100.md`](ANALISIS-PARA_EL_100.md)) y ya se pueden
> rebasar, porque la base por fin compila.
>
> **Rebasados y verificados el 7-nov**: los cinco arreglos están sobre `6543854`
> y pasan todo lo del proyecto más lo propio —typecheck, doctor, build y
> `pnpm test` (30) en cero; 195/195 del proyecto; 49/49 de la app en marcha;
> 29/29 del adaptador; 29/29 de requisitos—. Qué cambió de forma, qué hubo que
> arreglar en mis propias baterías —y la corrección del hallazgo que di por
> bueno sobre la versión del plan, que era falso— en
> [`REBASE-6543854.md`](REBASE-6543854.md). Los parches, en
> [`parches/`](parches/).
>
> **Y una prueba nueva, lista para correr y aún sin correr con modelo**:
> [`agente-version.mts`](agente-version.mts) mide si el agente usa el contrato
> de versión —lee antes de escribir, manda `versionEsperada`, se recupera de un
> 409—. Tiene atajo para Grok (`--motor grok`) y entrada de clave por teclado o
> archivo, nunca por argumento. Su modo `--arnes` comprueba el montaje sin
> gastar nada: **3/3**, y es lo único que he ejecutado. El cableado hasta xAI
> está comprobado con una clave falsa.

> **8-nov · la interfaz y la conexión del modelo, con el servidor de verdad.**
> [`interfaz-y-modelo.mts`](interfaz-y-modelo.mts) levanta `agent-native dev` con
> una base desechable y habla con él por donde habla el navegador: sesión real,
> lecturas que pintan la pantalla, escritura por HTTP pelado, estado del motor y
> un turno por el endpoint del chat. **9/9** sin clave y sin coste.
> [`motor-falso.mts`](motor-falso.mts) añade un proveedor local que habla el
> protocolo de OpenAI con un guion fijo, así que el camino completo —chat →
> bucle → acción → plan → la lectura que lee la interfaz— se recorre **gratis**:
> **16/17** con el guion que trabaja y **11/11** con el guion que miente.
>
> Dos cosas salieron de ahí. Una: **la guarda de la respuesta final funciona**, y
> el «turno que afirma y desmiente» que creí ver en la tanda del 7-nov era mío:
> el framework manda `{type:"clear"}` antes de reintentar y antes del mensaje de
> respaldo, y mis dos analizadores sumaban los `text` sin mirarlo. Medido ahora
> por el transporte real, el médico lee solo «No se guardó nada en el plan en
> este turno…». Corregido en los dos, con el caso en sus arneses. Dos: **el
> catálogo que viaja al modelo trae siete herramientas que la mesa no necesita**
> —`web-request`, `web-search`, `call-agent`, `connect-file-storage`,
> `connect-builder`, `describe-workspace-apps`, `read-attachment`—, más
> `tool-search`, que alcanza el resto del registro. Es el hallazgo que
> `catalogo.mts` dejó abierto, ahora medido en la petición real y no deducido.
>
> **Cerrado el mismo día.** `server/lib/alcance-agente.ts` es una lista de
> permitidos —las once acciones de la mesa que el agente usa más siete ayudas
> del framework que solo leen, preguntan o sugieren— y `resolveActionSurface`
> la aplica en el chat. Medido otra vez por la petición real: el catálogo pasa
> de **20 a 13 herramientas**, ninguna de las sensibles. Y comprobado por donde
> se podría rodear: `--escenario busqueda` pide a `tool-search` los diez
> nombres cerrados, uno a uno y exactos, y el framework responde que no existen
> «in the current mode»; lo único que carga son acciones de la mesa. `catalogo.mts`,
> que medía el registro a secas, mide ahora las dos caras —lo que el registro
> ofrece y lo que el recorte deja pasar— y pasa de **4/7 a 13/13**: el recorte
> cierra 86 de las 91, las 5 que quedan son de la mesa, ninguna delicada y todas
> con freno. Diez pruebas unitarias nuevas fijan la lista, incluida una que
> falla si alguien añade una acción al producto y no decide si entra o no.
>
> Solo afecta al agente: la interfaz llama a las acciones por HTTP con la sesión
> del médico y sigue viendo todas las suyas, lo que comprueba la propia batería.
>
> **Y las otras dos de la lista, también medidas.** `agregar-linea` acepta ahora
> `lineas`: varias líneas en UNA llamada, UNA transacción, UNA versión y UNA
> verificación del conjunto —que además es la clínicamente honesta, porque dos
> fármacos que interaccionan entre sí solo se ven mirando el plan completo—.
> Medido con el motor falso: tres pendientes entran de golpe y el plan pasa de
> la versión 1 a la **2**, no a la 4, que es lo que costaban tres llamadas con
> dos rechazos de versión en medio.
>
> Y la guarda de la respuesta final tiene una segunda regla para la cara
> complementaria de la mentira: el turno que **promete** el cambio sin hacerlo.
> No miente sobre el pasado, así que la primera regla no lo veía, pero el médico
> pidió algo, le contestaron que sí y el tablero está igual. Si no entró ninguna
> escritura, el médico pedía un cambio, el agente no le preguntó nada y la
> respuesta no dice qué falló, la guarda devuelve el turno con la instrucción de
> hacerlo ahora; el framework vuelve al bucle con las herramientas puestas, así
> que la continuación es real. Medido con el motor falso (`--escenario promesa`):
> el modelo promete, la guarda devuelve el turno, la llamada entra, la línea
> queda en el plan y **lo que el médico lee es «Añadido el control de tensión
> arterial en 7 días»**, no la promesa. Trece pruebas unitarias nuevas fijan
> cuándo NO debe dispararse: si el agente preguntó algo, si la respuesta ya dice
> qué falló, si el médico solo preguntó, o si la escritura sí entró.

> **8-nov, con Grok de verdad: tres regresiones, las tres mías.** Las dos tandas
> con clave real salieron 12/14 (un turno por el endpoint del chat) y 10/15 (diez
> pasadas del contrato de versión). Lo que mostraron:
>
> 1. **El agente escribía antes de leer, con la versión adivinada.** En las diez
>    pasadas la primera llamada fue una escritura con `versionEsperada=1` cuando
>    la vigente era 2 → 409, y la cascada se comía el turno: **1 de 10**
>    completó. Causa: al reescribir el bullet del prompt para hablar de `lineas`
>    borré la frase «La PRIMERA lectura del turno no se salta nunca…», que
>    estaba ahí —commit `0eed789`— por exactamente este fallo. Restaurada, con
>    una cláusula más: tras un 409, la siguiente llamada lleva la versión que
>    acabas de leer.
> 2. **`agregar-linea` se podía llamar sin ninguna línea.** Al dejar `tipo` y
>    `texto` opcionales para hacer sitio a `lineas`, en 2 de 10 pasadas llamó con
>    solo `planId`, `versionEsperada` y `origen`; una de ellas **acabó sin
>    respuesta ninguna**. Puse la señal en la descripción y en el error, y no en
>    el esquema, para no romper la auditoría del proyecto (`evidencia/`), que
>    llama con la forma suelta. **La tanda siguiente demostró que eso no basta**
>    —ver abajo—.
> 3. **`j9b` marcó como contradictorias ocho respuestas honestas.** «No se guardó
>    nada: … devolvió version_desactualizada» contiene «guardó», y mi patrón lo
>    leía como afirmación. Ahora j9b busca el **formato de éxito del producto**
>    —«Plan guardado: 5 líneas, …», con sus dos puntos—, que solo aparece cuando
>    el modelo dice que guardó. Dos intentos intermedios también fallaban: «plan
>    actualizado» y «N líneas» aparecen en respuestas honestas y útiles. Los tres
>    casos están en el arnés.
>
> **8-nov, segunda tanda (12/16): lo que el esquema deja opcional, el modelo lo
> omite.** Con la regla de leer antes de escribir restaurada, el agente ya leía
> primero y mandaba `versionEsperada` —24 escrituras, 23 con versión—, pero
> **20 de esas 24 llegaron sin ninguna línea**: `agregar-linea` con solo
> `planId`, `versionEsperada` y `origen`. Ninguna de las diez pasadas completó
> el trabajo, y 6 de 10 acabaron sin respuesta. La descripción y el mensaje de
> error no sirvieron: la única señal que el modelo respetó fue el esquema.
>
> El arreglo tiene una pieza que el framework ya traía: **`agentInputSchema`**.
> `defineAction` convierte a JSON Schema *ese* esquema para lo que ve el modelo
> (`action.js`: `const agentSchema = options.agentInputSchema ?? options.schema`)
> y **valida con `schema`**. Así que `agregar-linea` declara los dos: `schema`
> sigue aceptando las dos formas —el array y los campos sueltos— porque `run`
> valida también a quien lo llama directamente, que es como llaman la auditoría
> del proyecto y las baterías; y `agentInputSchema` solo tiene `lineas`, y
> obligatorio. Medido, no deducido: `catalogo.mts` bloque I6 lee
> `action.tool.parameters` y comprueba las dos caras —el modelo ve
> `required: ["lineas","planId"]` y cuatro propiedades, sin `tipo` ni `texto`;
> la validación sigue aceptando la línea suelta de la auditoría—, y la auditoría
> del proyecto sigue en 102 PASS / 0 FAIL.
>
> Dos cosas más de esa tanda. El prompt tenía **el párrafo de la primera lectura
> dos veces** (mi restauración lo pegó duplicado): eliminado, y con una regla
> nueva, «toda llamada a agregar-linea lleva LAS DOS COSAS juntas». Y la segunda
> llamada idéntica no devuelve `invalid_input` sino un `error` sin mensaje: es el
> freno del framework a la escritura repetida, y el modelo se queda sin saber qué
> le pasó. Con el contenido obligatorio ese camino ya no se pisa.

> **8-nov, tercera tanda (12/16): el contenido ya entra, y aparecen dos cosas
> que estaban debajo.** Con `lineas` obligatorio en lo que ve el modelo, cuatro
> pasadas de diez hicieron el trabajo perfecto —leer, dos escrituras con su
> versión, y el recibo contado de verdad— y los dos pendientes acabaron en el
> plan (j6 y j7 en verde por primera vez). Las otras seis se reparten en dos
> causas, las dos del producto:
>
> 1. **El reintento correcto tras un 409 lo frenaba el bucle.** Tres pasadas
>    abrieron el turno con una escritura a ciegas, se llevaron el 409, releyeron
>    el plan y volvieron con la versión buena —exactamente lo que hay que
>    hacer— y esa segunda llamada murió. El mensaje, que mi arnés tiraba, lo
>    explicaba: «Not run: an earlier agregar-linea call in this turn may have
>    already applied, and its result is unknown». El freno es sensato en
>    general: repetir un alta a ciegas duplicaría la línea. Pero el framework
>    documenta la excepción —una clave de idempotencia— y `versionEsperada` lo
>    es: si la primera llamada entró, la versión ya cambió y el reintento se
>    rechaza solo. Las cuatro escrituras del plan declaran ahora
>    `retrySafe: reintentoSeguroPorVersion`, y la versión es obligatoria en
>    `agentInputSchema`. Medido en `--escenario reintento`, que reproduce la
>    secuencia entera: antes 13/15, ahora **15/15**, con la línea en el plan.
> 2. **La guarda se callaba ante «no se guardó nada… llamo ahora».** Tres
>    pasadas leyeron el plan, NO llamaron a ninguna escritura y cerraron
>    negando y prometiendo a la vez. La negación les daba el indulto, porque
>    contar un fallo real es la conducta que se quiere. Pero solo es un informe
>    si de verdad se intentó algo: negar sin haber intentado nada es el turno
>    sin hacer. La regla mira ahora si hubo intento de escritura, y el presente
>    con valor de futuro («Llamo a agregar-linea…») cuenta como anuncio. Cinco
>    pruebas unitarias nuevas, y las cuatro de «aquí hay que callar» siguen.
>
> Y tres arreglos del medidor, porque dos de esas causas las escondió él: el
> mensaje de un rechazo ya viaja con la llamada —el analizador lo capturaba y el
> volcado lo tiraba, de ahí los «(sin mensaje)»—; la guarda recibe la petición
> del médico, como en el chat del producto; y **cada pasada empieza igual**, con
> el plan borrado y vuelto a montar, porque antes la primera que acertaba dejaba
> el trabajo hecho para las siguientes (la versión subió de 1 a 11 y el mismo
> texto quedó cuatro veces). Además, el JSON canónico ya no lo pisa una pasada
> sin modelo: tres veces se perdió así la evidencia de una tanda pagada.

> Y una cosa que **no** era un fallo: en el turno por el chat, el agente leyó la
> habilidad, leyó la consulta y **preguntó** «¿Confirmas que no tiene alergias
> conocidas?» —la ficha de demo-c2 no tiene alergias registradas y el prompt le
> prohíbe omitir una pregunta clínica pendiente—. Mi prueba daba por malo ese
> turno porque no había plan. Ahora le contesta y mide el intercambio completo,
> que es el de la demo.
>
> La tanda de diez pasadas **hay que repetirla** con esto puesto: es la única
> cifra del producto final que falta.

La fase 1 llamó a las acciones **como funciones**, con un `ctx` escrito a mano. Eso prueba
las reglas, pero no prueba quién puede llamarlas: `ctx.caller` lo decide el transporte, y
el propio framework avisa en su código de que la cabecera de frontend «es solo lo que el
cliente afirma». Esta fase ataca lo que la primera no podía alcanzar:

1. **la aplicación en marcha**, por HTTP, autenticándose como lo hace el navegador;
2. **el adaptador con un MEGI hostil**: 500, JSON roto, campos que faltan, tipos
   equivocados, listas enormes, backend que nunca contesta;
3. **la paridad entre los dos adaptadores**, mock y http, contra el backend de verdad;
4. **el catálogo que el agente puede alcanzar**, no el que se declara;
5. **los requisitos de la revisión del hackatón**, uno por uno, leídos de las bases
   guardadas en `evidencia/bases/`.

---

## Cómo correrla

Necesita node ≥ 22.22, el backend de demo en pie (`megi-demo/backend/start_demo.sh`) y
las dependencias de la app instaladas.

```bash
# 1 · la app en marcha, por HTTP: autorización, recorrido del médico,
#     concurrencia, fugas en errores, y el mismo código con MEGI apagado.
#     Siembra la demo, arranca su propio servidor con una base desechable y lo apaga.
node pruebas-hackathon/fase2/http.mjs

# 2 · el adaptador contra un MEGI hostil + paridad mock/http + entradas hostiles
megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/adaptador.mts

# 3 · qué acciones puede alcanzar el agente de verdad
megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/catalogo.mts

# 4 · los requisitos del envío (compila, tipos, doctor, licencias, secretos, datos)
node pruebas-hackathon/fase2/requisitos.mjs

# 5 · el contrato de versión, con el agente de verdad. Las cuatro de arriba no
#     gastan nada; esta llama a un modelo, así que va aparte y pide clave.
#     --arnes comprueba el montaje sin llamar a ningún modelo.
megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/agente-version.mts --arnes
megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/agente-version.mts --motores

#     Con Grok (xAI): atajo de motor, URL y modelo del despliegue, y la clave
#     introducida sin dejarla en `ps` ni en el historial.
megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/agente-version.mts \
  --motor grok --pedir-clave --repeticiones 3
megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/agente-version.mts \
  --motor grok --clave-archivo ~/.config/xai.key

# 6 · la interfaz y la conexión del modelo, con la aplicación en marcha.
#     Arranca su propio servidor, abre sesión como el navegador y mide por la
#     frontera de datos que consume la pantalla. Sin clave no gasta nada.
node pruebas-hackathon/fase2/interfaz-y-modelo.mts --solo-interfaz

#     El camino completo del chat sin pagar: un proveedor local con guion fijo.
#     `trabajo` llama a proponer-plan; `mentira` afirma haber guardado sin
#     llamar a nada, para comprobar la guarda de la respuesta final.
node pruebas-hackathon/fase2/interfaz-y-modelo.mts --motor falso
node pruebas-hackathon/fase2/interfaz-y-modelo.mts --motor falso --escenario mentira

#     Y si el recorte del alcance se puede rodear: pide por `tool-search` los
#     nombres exactos que la lista de permitidos cerró.
node pruebas-hackathon/fase2/interfaz-y-modelo.mts --motor falso --escenario busqueda

#     Varias líneas en una sola llamada, y el turno que promete sin hacer:
node pruebas-hackathon/fase2/interfaz-y-modelo.mts --motor falso --escenario varias
node pruebas-hackathon/fase2/interfaz-y-modelo.mts --motor falso --escenario promesa
# el reintento corregido tras un conflicto de versión
node pruebas-hackathon/fase2/interfaz-y-modelo.mts --motor falso --escenario reintento

#     Y con el modelo de verdad, por el endpoint del chat:
node pruebas-hackathon/fase2/interfaz-y-modelo.mts --motor grok --pedir-clave
node pruebas-hackathon/fase2/interfaz-y-modelo.mts --arnes   # solo el analizador
```

La sexta corre con `node` ≥ 22.22 directamente (no necesita `tsx`) y pone ese
`node` al principio del `PATH` del servidor: los hijos de vite y nitro invocan
`node` del `PATH`, y con uno viejo el arranque muere con «Unknown file extension
".ts"» en `agent-native.config.ts`, que parece un fallo del producto y es solo el
`PATH`. Opciones: `--app`, `--puerto`, `--consulta`, `--servidor` (usa uno ya
levantado), `--escenario`, `--espera`, `--conserva`, `--eventos-crudos`.

La quinta necesita la clave del proveedor en el entorno o en `megi-revision/.env`;
las guardadas en Ajustes de la app no sirven, porque corre contra una base
desechable. Vale cualquiera de los once motores que registra el framework, y
cada uno lee su propia variable: `--motores` los lista y marca el que ya tiene
clave aquí. `anthropic` es el de por defecto (`ANTHROPIC_API_KEY`);
`ai-sdk:google` lee `GOOGLE_GENERATIVE_AI_API_KEY`, `ai-sdk:openrouter`
`OPENROUTER_API_KEY`, `ai-sdk:groq` `GROQ_API_KEY`, `ai-sdk:mistral`
`MISTRAL_API_KEY`, `ai-sdk:cohere` `COHERE_API_KEY`, `ai-sdk:ollama`
`OLLAMA_BASE_URL` (local, sin clave), `builder` las dos de Builder.io, y
`ai-sdk:openai` `OPENAI_API_KEY` —con `OPENAI_BASE_URL` sirve para xAI/Grok y
cualquier compatible—. Lee su cabecera: dice qué mide y qué no.

Variables: `APP_MEGI_REVISION`, `REPO_HACKATHON`, `MEGI_DEMO_DIR`, `MEGI_URL`,
`MEGI_USER`, `MEGI_PASSWORD`, `PUERTO_PRUEBA`. Opciones útiles: `--sin-sembrar`
(respeta el estado de MEGI), `--sin-red` (omite la paridad), `--rapido` (omite el build),
`--mantener` (deja el servidor en pie para mirarlo).

---

## Resultados

Mismo guion, dos veces: una sobre el código de `d03fdf7` y otra con los arreglos de esta
fase. El «antes» se midió quitando los arreglos del propio repo (`git stash`) y
volviéndolos a poner, para que las dos cifras salgan del mismo sitio.

| Comprobación | antes | después |
|---|---|---|
| `fase2/http.mjs` · la app en marcha | 43/47 | **47/47** |
| `fase2/adaptador.mts` · MEGI hostil, paridad, entradas | 26/29 | **29/29** |
| `fase2/catalogo.mts` · alcance real del agente y la forma que ve el modelo | 4/7 | **13/13** |
| `fase2/requisitos.mjs` · requisitos del envío | 26/28 | **29/29** |
| `fase2/interfaz-y-modelo.mts --solo-interfaz` · la pantalla por su frontera de datos | — | **9/9** |
| `fase2/interfaz-y-modelo.mts --motor falso` · el camino completo del chat, gratis | — | **17/17** |
| `fase2/interfaz-y-modelo.mts --motor falso --escenario mentira` · la guarda | — | **11/11** |
| `fase2/interfaz-y-modelo.mts --motor falso --escenario busqueda` · el recorte, por donde se rodea | — | **13/13** |
| `fase2/interfaz-y-modelo.mts --motor falso --escenario varias` · tres líneas en una llamada | — | **14/14** |
| `fase2/interfaz-y-modelo.mts --motor falso --escenario promesa` · el turno que promete sin hacer | — | **15/15** |
| `fase2/interfaz-y-modelo.mts --motor falso --escenario reintento` · el reintento corregido tras un 409 | 13/15 | **15/15** |
| `megi-revision` · pruebas propias (`pnpm test`) | 0 pruebas | **83 pruebas** |
| `pruebas-hackathon/bateria.mts` (fase 1, `--http`) | 33/33 | **33/33** |
| `evidencia/auditoria-hackathon.mts --http` (del proyecto) | 57/57 | **57/57** |
| `typecheck` · `doctor` · `build` | limpios | **limpios** |

> **Sobre la fila de `http.mjs`.** Las cifras de arriba son las medidas con el
> backend de demo recién sembrado y para esta copia. Al reverificar el 8-nov
> dio 27/30 —fallan `b1`, `b3` y `c1`— porque el MEGI de demo que escucha en
> 8020 lo arrancó otra sesión de la misma máquina, con su propio estado: dos de
> las cuatro consultas ya están cerradas. Comprobado con y sin el recorte del
> alcance: idéntico en los dos casos, así que no es del cambio. Para volver a
> medirla hay que parar ese backend y dejar que la batería arranque el suyo.

Resultados crudos: `*-antes.json` y `*-resultados.json` en esta carpeta.

---

## Lo que salió bien, y que no era obvio

Vale la pena anotarlo porque son las preguntas que más preocupaban antes de medir.

**El modelo de autorización aguanta sobre HTTP real.** La regla de la mesa es
`ctx.caller === "frontend" ⇒ médico`, y esa cabecera la pone el cliente. Parecía
falsificable. No lo es, por una razón que la app no documenta: al evaluar `needsApproval`
el framework degrada a `http` cualquier «frontend» que no pruebe que es la interfaz
(sesión de navegador + mismo origen + capacidad de interfaz firmada y de diez minutos).
Las cuatro escrituras de la mesa declaran `needsApproval` para `caller === "http"`, y
`aprobar-plan` es además `uiOnly`. Resultado medido: sin sesión, nada se ejecuta (401 en
las ocho acciones); con sesión pero sin capacidad de interfaz, ninguna escritura corre;
con una capacidad manipulada, tampoco; desde otro origen, tampoco; y añadir
`Authorization: Bearer …` basta para dejar de ser la interfaz.

**La fragilidad que eso deja** sí conviene saberla: la seguridad de la mesa depende de que
*toda* escritura futura lleve `needsApproval` o `uiOnly`. Una acción de escritura nueva sin
ninguno de los dos haría que la cabecera volviera a ser suficiente. El bloque A de
`http.mjs` lo vigila: si aparece una escritura sin freno, falla.

**El recorrido completo del médico funciona de punta a punta contra el MEGI real**:
agenda → propuesta verificada → bloqueo de una línea → reajuste que la pisa (409
`linea_bloqueada`, y nada más se aplica) → reajuste que la respeta → aprobación sellada →
la consulta sale de la lista. La receta que queda en MEGI son exactamente las líneas
vigentes, el sello lleva firmante, y reintentar la aprobación no vuelve a sellar.

**La concurrencia no produce estados imposibles.** Dos propuestas simultáneas sobre la
misma consulta dejan un plan y un `plan_existente`. Dos aprobaciones simultáneas dejan
**una** aprobación y **un** sello en la auditoría de MEGI. Dos cambios simultáneos sobre
la misma línea dejan uno de los dos estados, nunca un híbrido.

**El mock y el adaptador http responden con la misma forma** en los seis métodos del
contrato, y dan el mismo veredicto con el mismo motivo sobre el caso difícil (un AINE en
un hipertenso). La demo no engaña según qué adaptador esté puesto.

---

## Hallazgos y arreglos

### H1 · Los fallos de MEGI que no son 404 salían como «Internal server error»

**Prueba.** `fase2/http.mjs`, bloques D y E. Con MEGI apagado, `listar-consultas` y
`ver-contexto-consulta` devolvían **500 sin `errorCode`** y el cuerpo «Internal server
error». Con un id hostil (`../../export/consultation/C-DEMO1`), lo mismo: el id se paraba
bien —`idSeguro` hace su trabajo— pero el error subía crudo.

**Por qué importa.** Tres cosas a la vez. El médico no sabe qué pasó: no distingue «MEGI
está caído» de «la mesa está rota». El agente no recibe código al que reaccionar. Y el
contrato ya declaraba `megi_no_disponible` (502): solo se cumplía en el camino de la
verificación, no al leer la agenda ni el contexto, que es justo lo primero que se hace.

**Arreglo.** `fallaDeMegi()` en `server/lib/megi/index.ts` traduce cualquier `MegiError` al
error que la mesa sabe explicar: 404 → `not_found`, 400 (id rechazado antes de salir a la
red) → `invalid_input`, 401/403 → `megi_no_disponible` con aviso de credenciales, y el
resto → `megi_no_disponible` (502) diciendo que no se guardó nada. Aplicado en
`listar-consultas`, `ver-contexto-consulta` y `proponer-plan`.

Ahora: `502 megi_no_disponible · "No se pudo hablar con MEGI (sin respuesta). No se guardó
ningún cambio; vuelve a intentarlo cuando esté disponible."` Y la mesa sigue abriendo:
`GET /revision` responde 200 con el backend apagado.

### H2 · Un 200 que no traía JSON se convertía en una consulta vacía

**Prueba.** `fase2/adaptador.mts`, `f3`. Con un cuerpo `{"id":"C-DEMO1","motivo":`
(JSON cortado) y status 200, `verConsulta` devolvía una consulta **inventada**: fecha
vacía, motivo vacío, SOAP vacío, sin diagnósticos. Con el cuerpo vacío, un `TypeError`.

**Por qué importa.** `call()` hacía `parseJson(texto, texto)`: si el cuerpo no es JSON,
devuelve el texto tal cual, y leer propiedades de una cadena da `undefined` en todo. Una
página de error de un proxy, una respuesta cortada o un gateway de más bastaban para que
la mesa mostrara una consulta vacía **como si fuera real**. En un registro clínico eso es
peor que un error.

**Arreglo.** `call()` exige que un 200 traiga un objeto JSON; si no, lanza `MegiError`
(502) con una muestra de 120 caracteres del cuerpo para diagnosticar. Combinado con H1, el
médico ve «no se pudo hablar con MEGI».

### H3 · Un campo mal tipado en MEGI rompía la acción entera

**Prueba.** `fase2/adaptador.mts`, `f6`. Con `age: "cuarenta"`, `name: 12345`,
`allergies: "Penicilina"` (cadena, no lista) y `chronic: null`, la ficha salía con
`edad: NaN` y `nombre` numérico. El esquema de salida exige `number` y `string`, así que la
acción fallaba después, lejos de la causa.

**Arreglo.** `pacienteDeMegi` normaliza: edad finita o 0, nombre a texto, alergias y
crónicos siempre listas de cadenas no vacías.

### H4 · Un byte nulo en el texto dejaba el error crudo de la base

**Prueba.** `fase2/adaptador.mts`, `h2`. Un fármaco llamado `Paracetamol\u0000 oculto`
pasaba el esquema (es una cadena válida) y reventaba el INSERT: `Failed query: insert into
"lineas_plan" ("id", "plan_id", …)`, un `Error` sin `errorCode` → HTTP 500 y la consulta
SQL en el registro del servidor. Postgres no admite `\u0000` en una columna `text`.

**Arreglo.** `limpiaControles()` en `server/lib/plan.ts` quita los caracteres de control
—deja en paz saltos de línea, acentos y emoji— y se llama una sola vez al entrar en cada
una de las cinco acciones de escritura, antes de tocar la base. Recorre objetos y listas,
así que cubre `lineas[]`, `cambios[]`, motivos, explicaciones y notas.

### H5 · El repositorio no tenía ni una prueba propia

**Prueba.** `fase2/requisitos.mjs`, `r4`: cero archivos `*.test.*` o `*.spec.*` en
`megi-revision`, y `"test": "vitest --run --passWithNoTests"`, que pasa en verde sin
ejecutar nada. Las baterías de las dos fases viven fuera del repo de la app: quien clone
el proyecto y corra `pnpm test` no comprueba nada.

**Arreglo.** 29 pruebas unitarias, rápidas y sin base de datos, sobre las invariantes de
las que depende todo lo demás, cada una nacida de un hallazgo real:

- `server/lib/plan.test.ts` (15): `origenAutorizado` —ningún `caller` salvo `frontend`
  puede decir que es el médico, y desde la interfaz quien actúa es el médico aunque pida
  origen agente—, `exigirMedico`, `normalizaNombre` (acentos, mayúsculas, y que no
  confunda «Amoxicilina» con «Amoxicilina/Clavulánico»), `limpiaControles`, el esquema de
  línea y el techo `MAX_LINEAS`.
- `server/lib/megi/megi-http.test.ts` (14): `idSeguro` con nueve ids hostiles, ida y vuelta
  de ids lógicos y reales, el 200 sin JSON, el 200 vacío, el 500, el corte por tiempo, que
  el error no lleve la contraseña, la edad y las listas mal tipadas, el unicode, y la
  atribución de alertas cuando MEGI nombra el fármaco con su dosis («Ibuprofeno 400 mg») o
  nombra otro distinto.

Y `"test": "vitest --run"`: si alguien borra las pruebas, `pnpm test` ahora falla.

---

## Lo que queda abierto, con su motivo

### A1 · `initialToolNames` no es una lista blanca · **recomendado, no aplicado**

`server/plugins/agent-chat.ts` declara diez herramientas iniciales y deja fuera
`aprobar-plan`. Eso está bien, pero no es una frontera: `filterInitialEngineTools` del
framework **añade siempre `tool-search`**, y con ella el agente puede cargar por nombre
cualquier acción del registro estático, que es el registro completo
(`loadActionsFromStaticRegistry(actionsRegistry)`).

Medido en `fase2/catalogo.mts`:

| | |
|---|---|
| acciones en el registro | **116** |
| propias de la mesa | 8 |
| alcanzables por el agente fuera de las iniciales | **85** |
| de esas, que escriben | **46** |
| de escritura y delicadas | **11** |

Las once: `delete-api-key`, `manage-provider-key-policy`, `share-resource`,
`unshare-resource`, `bulk-update-workspace-user-groups`, `delete-workspace-user-group`,
`upsert-workspace-user-group`, `set-feature-flag`, y las de laboratorio y mensajería.

Importa porque el agente **lee texto de MEGI** (la nota SOAP de la consulta) y ese texto no
lo escribe el equipo. La fase 1 ya comprobó que una inyección en la nota no mueve el plan;
lo que esta fase añade es que el blanco de una inyección no se limita a las ocho acciones
del dominio. Que cada acción de la plantilla se niegue por su cuenta depende de sus propias
comprobaciones internas, que este proyecto no declara ni prueba.

**El arreglo existe y es de una pieza**: `createAgentChatPlugin` acepta
`resolveActionSurface`, que devuelve por petición `{ allowedActionNames }`, y el framework
filtra con `filterActionsByAllowedNames`.

```ts
// server/plugins/agent-chat.ts
export default createAgentChatPlugin({
  // …
  resolveActionSurface: () => ({ allowedActionNames: INITIAL_TOOL_NAMES }),
});
```

**No lo apliqué, y creo que no se debe aplicar antes del envío.** Esa lista recorta también
lo que el chat usa para funcionar (`tool-search`, `ask-question`, las de contexto y las de
pantalla), y comprobar que la conversación sigue entera exige correr el agente con un
motor real —Grok o un modelo local—, que no está disponible aquí. Cambiarlo a tres días
del cierre y sin poder probar el chat es peor que el riesgo que evita. Después del 9: poner
la lista, correr el guion de la demo completo con el agente y ajustar hasta que no falte
nada.

### A2 · El usuario de servicio del adaptador sigue siendo `role: admin`

Pendiente de la fase 1 (hallazgo S3), sin cambios. El motivo sigue siendo el mismo: bajarlo
a `medico` puede dejar la demo sin acceso a sus propios pacientes por el modelo de
propiedad de MEGI, y eso se prueba con calma, no la semana del envío.

### A3 · Listar la agenda cuesta dos peticiones por paciente

Medido: **101 peticiones para 50 pacientes** (2.02 por paciente), 3 ms con transporte
simulado. Con cuatro pacientes de demo no se nota; con una agenda real, sí. Sigue
necesitando un endpoint de MEGI que hoy no existe («dame las consultas consolidadas sin
aprobar»), así que sigue documentado como trampa, no arreglado.

---

## Los requisitos de la revisión del hackatón

Leídos de `evidencia/bases/reglas.html` (guardada con su sha256 el 3-nov). Las bases
verifican, antes de repartir premios: elegibilidad, originalidad, **uso del framework**,
**accesibilidad de la demo** y cumplimiento. Y «How to Enter» exige declarar el trabajo
previo, las plantillas, las librerías y los activos de terceros, y qué se construyó durante
el evento.

| Requisito | Estado |
|---|---|
| Aplicación funcional con Agent-Native | `build`, `typecheck` y `doctor` limpios; ninguna guarda del doctor desactivada |
| Pruebas propias del repositorio | 29 pruebas, `pnpm test` ya no pasa en vacío |
| Trabajo previo declarado | «Prior work» con fecha de corte (27-oct-2026) |
| Plantilla y su licencia | «Agent-Native Chat template (MIT)» + `LICENSE.agent-native.txt` |
| Lo construido durante el evento | «Built during the hackathon», con el detalle de las ocho acciones |
| Terceros inventariados | 785 paquetes con licencia; las 84 dependencias directas, cubiertas; avisos de Node y Python |
| Sin secretos en el árbol | 572 archivos versionados revisados, ninguno |
| Sin secretos en el historial | 67 MB de diffs revisados, ninguno |
| `.env` no versionado | solo `.env.example`, con los campos vacíos |
| Datos ficticios | 4/4 pacientes con marca de ficticio, identificadores de relleno, aviso en la interfaz |
| Plazo correcto | ENVIO y bases coinciden: 9-nov-2026 23:59 PT |
| Sin afirmaciones clínicas | ninguna; se declara «decision support» y aprobación final del médico |
| Procedencia registrada | `evidencia/procedencia-git.json` |
| Cómo verla | ENVIO y README explican `pnpm dev` y la siembra de demo |
| **Clips público sin sesión** | **pendiente** — sin enlace; la publicación está detenida por decisión del equipo |

El pendiente es el único requisito duro que falta, y es una decisión, no un defecto: las
bases exigen una grabación pública de Clips que se vea sin iniciar sesión, y el borrador
dice explícitamente que no se ha subido nada. Grabar el clip tampoco envía la entrada: el
formulario es un paso aparte con su confirmación de recibo.

Dos cosas que conviene saber aunque no sean fallos:

- **`agent-native start` no sirve la app con PGlite**: responde 503
  `DEPLOY_SETTINGS_REQUIRED` porque un servidor desplegado exige un Postgres gestionado. La
  demo vive en `pnpm dev`, que es lo que describen ENVIO y README, y hay camino de
  migración (`scripts/migrate-production.ts`). Si alguien espera clonar y servir en
  producción, necesita una base.
- **La contraseña del demo (`demo-megi-2026`) está en el repo**, declarada como
  `DEFAULT_PASSWORD` en `seed_demo.py`, que acepta `--password`. Para una demo local con
  datos ficticios está bien; si alguna vez se expone el puerto 8020 fuera de `127.0.0.1`,
  hay que cambiarla.

---

## Lo que no se pudo medir, y por qué

- **Las cabeceras de seguridad de la página en producción.** En `agent-native dev` el HTML
  lo sirve Vite y no pasa por el middleware de nitro, así que `x-content-type-options`,
  `referrer-policy` y `cross-origin-opener-policy` aparecen de forma inconsistente; el
  plugin de sesión sí las manda en sus respuestas. En producción el middleware va montado
  sobre nitro, pero producción no arranca sin Postgres (arriba). La comprobación quedó
  como **medición**, no como exigencia: exigirla aquí sería reportar un rasgo del entorno
  de desarrollo como defecto del producto.
- **El agente de verdad.** Todo lo que se prueba aquí entra por las acciones, que es por
  donde entra el agente, pero sin motor no se puede comprobar su conducta (que no insista
  tras un `linea_bloqueada`, que no se haga pasar por el médico). Eso lo cubre el guion de
  la demo con Grok, no esta batería.
- **La interfaz en el navegador.** El paquete `playwright` no está instalado en este equipo
  (sí el chromium de su caché), así que no hay pruebas de pantalla. Lo más cercano que hay
  es que `GET /revision/demo-c2` responde 200 y que el recorrido completo pasa por las
  mismas acciones que la pantalla llama.
- **El reparto de responsabilidad con MEGI.** `megi-demo` es trabajo previo del equipo; lo
  único que se comprobó de él es lo que la mesa necesita: que el token va firmado con HMAC
  y es revocable, que las contraseñas van con PBKDF2, y que `POST /api/review/approve`
  devuelve 409 si hay bloqueos sin `safety_ack`.
