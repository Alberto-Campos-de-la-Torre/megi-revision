# Análisis de `PARA_EL_100.md`

Leído en `6b087ff` (297 líneas, actualizado el 7-nov-2026), contrastado con las
bases guardadas en `evidencia/bases/reglas.html`, con `ESTADO.md`, con los JSON
de evidencia que cita y con el código publicado. 7-nov-2026.

> **Al día siguiente del análisis, dos de sus ocho puntos están resueltos.** El
> commit `6543854` restauró los trece archivos, así que el «195/195» del punto 1
> **ya se reproduce desde el repositorio** —lo medí: 117 + 33 + 45— y el punto 2
> está contestado por escrito: `ESTADO.md` registra que David autorizó los
> commits al repo privado el 7-nov y que la pausa sigue en pie para Clips,
> formulario y despliegue. Lo marco en cada punto. Los seis restantes siguen
> vigentes.

Es el documento que organiza el tramo final del proyecto: una autocalificación
de 94/100 contra la rúbrica del hackatón, seis intervenciones (G1–G6) para los
seis puntos que faltan, el cierre de seis iteraciones (I1–I6), un guion de vídeo
y el histórico del plan de 77/100.

---

## Lo que hace bien, y conviene no perder

**Separa el mecanismo del resultado, una y otra vez.** Es la virtud central del
documento y la más difícil de mantener cuando se persigue una nota:

- «`valor-diferencial.md` sigue siendo evidencia estructural; un cero por
  construcción no prueba que la mesa supere empíricamente a otros productos. No
  afirmar “menos errores” ni “más rápido” a partir de esa tabla.»
- «Cuenta mecanismos, no errores clínicos.»
- «No estimar tiempo humano restándolas del total sin demostrar que cubren
  intervalos distintos y sin solapamiento.»

**Se niega a fabricar evidencia.** «No inventar muestras o testimonios», «si no
hay participantes, dejar la iteración pendiente», «un LLM que simula un médico o
una revisión propia no sustituye la muestra», «no seleccionar solo ejecuciones
buenas», «no simular recibos ni presentar una ejecución fabricada». Y la
investigación de antecedentes marca su propia debilidad: los comentarios de
jueces que cita son «el relato del autor, no una transcripción verificada aquí».

**Lee bien las bases.** Comprobé su lectura contra `evidencia/bases/reglas.html`:
40/20/20/20, desempate por utilidad y ejecución, repositorio público y despliegue
opcionales, Clips público y formulario obligatorios. Todo correcto, incluida la
advertencia de que las pruebas con médicos **no** son un requisito oficial sino
evidencia de calidad.

**Mantiene la pausa de entrega explícita** y distingue «completado», «mitigado» y
«pendiente» en la matriz de iteraciones, con el motivo de cada uno.

---

## Los problemas, en orden de importancia

### 1 · Su «punto de partida verificado» no se podía verificar desde el repositorio · **resuelto**

El documento abre con: «**Vigente tras el cierre (7 nov): 195/195 automatizadas**
(auditoría `--http` 117/117, batería `--http` 33/33, revisión trazable 45/45) y
recorrido http 25/25; typecheck, doctor y build en cero».

Esas cifras no se pueden reproducir con el repositorio delante. Tres hechos:

- El propio JSON de la auditoría que cita dice
  `"appCommit": "b631b872117404d6d6b90232bf70c36506d49007"` y
  `"uncommittedChanges": true`. El documento también lo admite: «App con cambios
  sin commit sobre `b631b87`».
- **`b631b87` no existe en el historial publicado.** `git cat-file -e b631b87`
  falla en un clon de `bluiders.io`.
- Desde un clon limpio, **ni la auditoría ni la batería arrancan**: las dos
  mueren en el import con
  `ERR_MODULE_NOT_FOUND: megi-revision/server/lib/megi/peticion.js`, y
  `pnpm typecheck` da 29 errores por trece módulos que el código importa y que
  nunca se subieron (detalle en [`HALLAZGO-REPO-INCOMPLETO.md`](HALLAZGO-REPO-INCOMPLETO.md)).

**Cerrado el 7-nov en `6543854`.** Con los trece archivos publicados corrí el
guion maestro del propio proyecto, `evidencia/verificar.mjs`, desde un clon de
`bluiders.io` con el árbol limpio y sin variables de entorno: `typecheck`,
`doctor` y `build` en cero, y **117 + 33 + 45 = 195 comprobaciones, cero
fallos**. La cifra del documento era cierta y ahora además es reproducible, que
es lo único que le faltaba. Queda un detalle cosmético: el JSON publicado sigue
declarando `appCommit b631b87` con `uncommittedChanges: true`, porque el commit
no volvió a correr el guion; una pasada de `evidencia/verificar.mjs` sobre el
árbol publicado lo dejaría apuntando a `6543854`.

No es que las cifras sean falsas: son ciertas en la máquina donde se midieron.
El problema es que el documento funciona como fuente de verdad del proyecto y su
base material vive en un disco, no en el repositorio. Para un hackatón que
verifica originalidad y uso del framework antes de pagar premios, y para un
equipo que usa GitHub como respaldo, esa diferencia es el riesgo más grande que
tiene hoy el proyecto. Es, además, la misma causa raíz: el `.gitignore` nuevo
ignora `megi-revision/` y `megi-demo/` enteros.

### 2 · El documento se contradecía sobre los commits · **contestado**

Dice dos veces que no autoriza commits:

> «**No autoriza publicación, despliegue, GitHub, Clips, envío del formulario o
> commits.**»
> «Publicación, Clips, formulario y commits siguen detenidos (H5).»

Y `ESTADO.md` registra la decisión de David del 7 de noviembre: «Sin Clips,
formulario, datos del equipo, publicación ni commits hasta reanudación expresa».

Mientras eso estaba escrito, `bluiders.io` recibió dos commits y un push:
`37bb86f` («Cierre del 7 nov…») y `6b087ff` («PARA_EL_100.md: actualización de
David tras el cierre del 7 nov»). O la pausa se levantó y ningún documento lo
dice, o el push ocurrió contra ella. **Contestado el 7-nov.** `ESTADO.md` añade una sección que lo dice con fecha:
David autorizó los commits al monorepo privado ese mismo día, la restricción de
«sin GitHub» queda levantada solo para ese repositorio, y Clips, formulario y
despliegue siguen detenidos. `PARA_EL_100.md` cambió su frase para no
contradecirlo. La pausa no se saltó: se levantó en parte y ahora está escrito
dónde empieza y dónde acaba. Era la respuesta correcta a la pregunta.

### 3 · La autocalificación está haciendo un trabajo que no puede hacer

El 94/100 lo produce el mismo equipo que hizo el trabajo, contra una rúbrica
reconstruida de las bases públicas, sin evaluador externo. El documento lo avisa
(«la nota oficial corresponde al jurado», «completar este plan no garantiza una
puntuación concreta») y aun así organiza todo alrededor del número: 38/40, 18/20,
«seis puntos pendientes», «94 → 100», «se recalifica con evidencia nueva».

El riesgo no es la honestidad, es el incentivo: a tres días del cierre, un número
interno empuja a cerrar lo que sube la nota y no lo que reduce el riesgo real.
La lista G1–G6 ya dice lo mismo sin el número, y sin él no se puede confundir
«94» con una predicción de premio.

### 4 · «Uso de Agent-Native 20/20» es el 20/20 más difícil de defender

La rúbrica premia «uso ingenioso de Agent-Native para unir interfaz, conducta del
agente y capacidades de la aplicación». Es exactamente donde la fase 2 encontró
el hueco: `initialToolNames` declara diez herramientas pero no es una frontera,
porque el framework añade siempre `tool-search`. Medido sobre el registro real:
**116** acciones, **85** alcanzables por el agente clínico, **46** de ellas
escriben, **11** tocan claves, compartición, grupos de usuarios o banderas.

El agente lee la nota SOAP que viene de MEGI, es decir texto que el equipo no
escribe. Que una inyección no pueda mover el plan ya está probado; que no pueda
alcanzar `delete-api-key` o `share-resource`, no. Con eso abierto, 20/20 en ese
criterio es una afirmación fuerte. El arreglo está en el propio framework
(`resolveActionSurface` con `allowedActionNames`) y cuesta una línea, pero hay
que probar que el chat sigue entero, y eso pide el agente con motor real.

### 5 · De lo que falta, solo dos cosas dependen del equipo

Mirando G1–G6 por dependencia, no por prioridad:

| | depende de | ¿se puede cerrar antes del 9? |
|---|---|---|
| G1 utilidad con médicos | médicos voluntarios | no, si no aparecen |
| G2 cuentas individuales | el consultorio | no, si no las dan |
| G3 primera revisión sin guía | un usuario nuevo | parcial (vale alguien ajeno al proyecto, declarado como tal) |
| **G4 guion del vídeo** | **el equipo** | **sí** |
| G5 contraste honesto | datos de G1 | no |
| **G6 consistencia del agente (20 ejecuciones)** | **decidir gastar** | **sí** |

G4 y G6 son los únicos dos que no esperan a nadie. Y G6 es el que más mueve la
aguja de lo que el jurado va a ver: «los límites del agente sobreviven a intentos
repetidos» es la promesa central del producto, y hoy se apoya en una continuidad
con **un** reintento documentado. Veinte ejecuciones dan una tasa; una ejecución
da una anécdota. Si hubiera que elegir una sola tarea esta semana, sería G6.

### 6 · El vídeo es el único requisito duro que sigue sin cumplirse

Las bases exigen una grabación pública de Clips que se vea **sin iniciar
sesión**, y que el formulario se envíe con su recibo. Grabar no es enviar. El
documento lo sabe y lo mantiene detenido, pero el plazo es el 9-nov 23:59 PT: a
48 horas, el riesgo ya no es la nota, es no tener entrada. El guion de G4 está
pensado para 150–180 s, que es una decisión editorial sana (las bases no imponen
duración), y el cambio que propone —terminar el recorrido sin bloqueos de
seguridad pendientes, dejando el override como prueba secundaria— es acertado:
el final actual enseña al médico saltándose una alerta, que es la peor imagen
posible de un producto de apoyo a la decisión.

### 7 · D4 aparece como pendiente y como verificado en el mismo cuerpo de documentos

`ESTADO.md` tiene una sección «PARA_EL_100 cerrado y D4 verificado» y otra que
dice que la auditoría «conserva **D4 pendiente**», con 40,5 s de plan visible y
59,0 s de turno completo frente al objetivo de 35 s. El documento es honesto con
los números (incluido el intento de 157,9 s y los dos timeouts de títulos), pero
el estado del punto debería decir una sola cosa. Hoy, leído de corrido, parece
cerrado en un sitio y abierto en otro.

### 8 · Detalles menores, pero que cuestan poco

- `ENVIO_HACKATHON.md` «todavía menciona Grok 4.7»: el propio documento lo
  apunta como pendiente en el paso 5. Es un minuto y evita una incoherencia que
  un juez puede ver.
- «195 automatizadas» son tres guiones propios (117 + 33 + 45), no pruebas
  unitarias. No hay ni una prueba en el corredor del proyecto: `pnpm test` era
  `vitest --run --passWithNoTests` y pasaba en verde sin ejecutar nada. La fase 2
  añade 29 unitarias y quita ese `--passWithNoTests`.
- La disciplina de «`pnpm demo` fuerza mock y **no acredita** la prueba HTTP» es
  buena y conviene repetirla en `evidencia/README.md`, donde un lector externo
  mira primero.

---

## Qué sigue haciendo falta de la fase 2 sobre su código

Comprobado contra `6543854`, no contra el código de la fase 1. **Los cinco
siguen haciendo falta**, y el quinto dejó de ser una incógnita:

| Arreglo de la fase 2 | ¿Lo cubre ya su cierre? |
|---|---|
| Un 200 cuyo cuerpo no es JSON devuelve una consulta inventada | **No.** `call()` sigue con `parseJson(texto, texto)`. Su H1 endurece la respuesta del verificador (`verificador_invalido`), que es el mismo problema en otro endpoint: los dos arreglos se complementan |
| `age` no numérico → `edad: NaN` rompe el esquema de salida | **No.** Sigue `Number(p.age ?? 0)` y `nombre: p.name ?? ""` |
| Byte nulo en el texto → error crudo del driver y SQL en el registro | **No.** No hay limpieza de caracteres de control |
| El repositorio no tiene pruebas propias | **No.** Sigue `--passWithNoTests` y cero archivos de prueba |
| Fallos de MEGI que no son 404 → 500 opaco sin `errorCode` | **No.** Ya se puede saber: `peticion.ts` está publicado y resultó ser solo una caché por petición (`AsyncLocalStorage`), sin traducción de errores. `conectarMegi` sigue traduciendo únicamente `sin_rol_clinico` y `credenciales_no_disponibles`, y un `MegiError` sin código «se propaga tal cual» por decisión explícita del comentario. Donde la acción no lo envuelve —`ver-contexto-consulta`, `medir-revision`, `sugerir-reemplazo`— sale como 500 sin `errorCode` |

---

## Cómo lo medí

- Bases: `evidencia/bases/reglas.html` del propio repo, con su `sha256` en
  `fuentes.json`.
- `git cat-file -e b631b87` en un clon de `bluiders.io`.
- `evidencia/auditoria-hackathon-resultados.json` publicado: 117 resultados,
  117 `passed`, `appCommit b631b87…`, `uncommittedChanges: true`.
- `pnpm typecheck` sobre `6b087ff`: 29 errores TS2307, trece módulos ausentes.
- `tsx evidencia/auditoria-hackathon.mts` y `tsx pruebas-hackathon/bateria.mts`
  sobre `6b087ff`: las dos terminan en `ERR_MODULE_NOT_FOUND`.
- Registro del catálogo del agente: `pruebas-hackathon/fase2/catalogo.mts`
  (116 acciones, 85 alcanzables, 46 de escritura, 11 delicadas).
