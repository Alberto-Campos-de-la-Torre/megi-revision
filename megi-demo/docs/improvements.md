# Mejoras de producto — seguimiento

> Lista pedida el **2026-09-04**. Este archivo es el **tablero vivo** de esas
> mejoras: se actualiza conforme se avanza, junto con
> [`master_roadmap.md`](../master_roadmap.md) §7. Cada punto lleva lo que se pidió
> (tal cual), **lo que ya hay en el código** (verificado, no supuesto) y lo que
> falta de verdad.
>
> Estado: `pendiente` · `en curso` · `hecho`.

| # | Mejora | Estado | Tamaño | Notas |
|---|---|---|---|---|
| M1 | Botón «atrás» del navegador | ✅ **hecho** (4-sep) | chico | `lib/nav_history.js` + `lib/leave_guard.js`, 12 pruebas |
| M2 | Contexto del paciente antes de la consulta | ✅ **hecho** (4-sep) | chico-medio | `motivo_engine.py` + panel a la vista |
| M3 | Sugerencias de qué preguntar durante la consulta | ✅ **hecho** (9-sep) | medio | determinista: **no toca la GPU** |
| M4 | Especialidad de anestesiología | 🟡 **calculadoras hechas** (4-sep) | **grande** | falta la nota anestésica y el vocabulario del ASR |
| M5 | Especialidad de radiología | ✅ **hecho** (9-sep) | **grande** | flujo propio: dictar → estructurar → firmar |

**Orden de trabajo acordado (4-sep):** `M1` → **calculadoras de M4** → `M2` → `M3`,
y `M5` después. Rige salvo que cambie: M3 depende de M2, y las calculadoras se
adelantan al resto de la especialidad por ser baratas y de valor inmediato.

---

## M1 · Arreglar la navegación con el botón de regreso

> «Arreglar navegación, cuando usamos la flecha de regreso del navegador, que
> mande a la ventana anterior.»

**Qué hay hoy.** La vista activa es estado de React con persistencia en
`localStorage`, no una ruta: `frontend/src/App.jsx:53` (`const [view, setView]`)
y `App.jsx:62` (`localStorage.setItem("megi.view", view)`). No hay router ni uso
de la History API en todo el frontend. Consecuencia: **el botón atrás abandona la
aplicación** en vez de volver a la pantalla anterior, y al reentrar reaparece la
última vista guardada.

Ya existe la mitad del trabajo: `App.jsx:69-71` mantiene un `prevViewRef` para el
comando de voz «MEGI, volver». Hay a dónde volver; lo que falta es engancharlo al
historial del navegador.

**Hecho el 4-sep.** `frontend/src/lib/nav_history.js` (hook `useBrowserHistory`),
enganchado en `App.jsx`. Lo que se registra en el historial es el estado completo
—**vista + paciente + overlay**—, no solo la vista: volver de «Revisión» a
«Consulta» sin el paciente dejaba una pantalla rota. El arranque *sella* la
entrada existente con `replaceState` en vez de crear una, para que el primer
«atrás» salga del sitio como debe, y atender un `popstate` no empuja entradas
nuevas (si lo hiciera, el usuario quedaría atrapado pulsando atrás sin avanzar).
También se cierran con el atrás «Mi perfil» y el cambio de contraseña, que antes
se saltaban la vista por completo.

**Aviso al salir grabando (añadido el 4-sep, a petición).** Los dos caminos de
salida —el botón «← Agenda» y la flecha del navegador— consultan **una sola
guardia**, `frontend/src/lib/leave_guard.js`, para que no puedan divergir en el
mensaje ni en el criterio. La pantalla de consulta la registra mientras
`anyRecording` (grabación general, streaming o identificador) y la retira sola al
detenerse.

Dos detalles que costaron más que el aviso en sí:

- **Cancelar el «atrás» repone la entrada del historial.** Cuando nos enteramos
  del `popstate` el navegador ya retrocedió; si el médico decide quedarse hay que
  volver a empujar la entrada abandonada, o el siguiente «atrás» saltaría dos
  pantallas. Por eso `confirmLeave()` es síncrono: un modal propio (asíncrono)
  obligaría a rehacer la navegación.
- **El micrófono se quedaba abierto.** Cerrarlo ocurría dentro de `rec.onstop`,
  que no llega si el componente se desmonta: al salir de la consulta el navegador
  seguía escuchando en segundo plano. Se cierra ahora en el cleanup de
  `useRecorder`. Avisar y dejar el micro grabando habría sido peor que no avisar.

12 pruebas en `frontend/src/test/nav_history.test.jsx` (frontend: 83 → 95).

**Queda un caso parecido, sin cubrir:** salir con una grabación **ya terminada
pero sin enviar** (el blob vive en memoria hasta que se pulsa «Enviar») tampoco
avisa, porque la guardia mira `anyRecording`. Es la misma pérdida de audio por
otra vía; se puede cubrir cuando se quiera.

---

## M2 · Dar contexto del paciente antes de empezar la consulta

> «Agregar lo de dar contexto del paciente antes de empezar la consulta, esto
> para poder otorgar preguntas más acertadas antes de empezar la consulta.»

**Qué hay hoy — más de lo que parece.** Existe una pre-consulta completa:

- Motor determinista por edad e historial: `backend/app/services/age_engine.py`
  (`preconsulta_base`), reglas MX + USPSTF, con pruebas en
  `backend/tests/test_age_engine.py`.
- Endpoint `GET /api/patients/{id}/preconsulta` (`backend/app/routes/patients.py:148`),
  con personalización opcional por gemma (`/v1/preconsulta/personalize`,
  `asr_service/megi_asr/routers/notes.py:191`).
- Panel en pantalla: `frontend/src/components/preconsulta_panel.jsx`, mostrado en
  el expediente (`pacientes.jsx:145`) y **como preámbulo colapsable al iniciar la
  consulta** (`real_consulta.jsx:224`).

Es decir: MEGI ya sugiere qué preguntar según **edad, sexo, crónicos y consultas
previas**, priorizado y con fuente.

**Qué falta.** Lo que hoy NO entra en esa sugerencia es **el motivo de la visita**:
el paciente que viene por dolor de rodilla recibe las mismas sugerencias que el
que viene por tos. Falta que el médico pueda **dar contexto** (escrito o dictado,
una línea: «viene por disnea de dos días») antes de arrancar, y que la
pre-consulta se recalcule con ese motivo además de la edad y el historial.

**Decidido (4-sep): las dos cosas.** El panel deja de estar escondido en un
desplegable y, además, el médico puede añadir el **motivo de la visita** —escrito
o dictado— para que las sugerencias se recalculen con él.

### Hecho el 4-sep

**Motor del motivo** — `backend/app/services/motivo_engine.py`, determinista como
`age_engine`: normaliza el texto, reconoce 17 motivos frecuentes (dolor torácico,
disnea, tos, fiebre, cefalea, dolor abdominal, diarrea/vómito, urinario,
lumbalgia, mareo/síncope, faringitis, control de crónico, embarazo, ánimo,
trauma, dermatosis, palpitaciones) y aporta preguntas dirigidas **con sus
banderas rojas**, que se ordenan siempre arriba. Las alarmas las decide el
código, nunca el LLM.

**El panel a la vista** — en la consulta ya no está dentro de un `<details>`
plegado (`real_consulta.jsx`): es lo que hay que leer ANTES de dar al micrófono,
y plegado no lo leía nadie.

**Dictado** — el botón «Dictar» reusa `POST /api/voice/command/transcribe`, que
acepta audio corto **sin consulta creada**; así no hubo que romper la creación
diferida de la consulta ni inventar un endpoint. El grabador se extrajo a
`frontend/src/lib/use_recorder.js` para no duplicarlo entre pantallas.

Tres decisiones que conviene no deshacer:

1. **El motivo viaja en el cuerpo de un POST, no en la URL.** Es dato clínico
   del paciente: en la query string acabaría en los registros de acceso del
   servidor **y en los de Cloudflare**. El `GET` de siempre se queda intacto y
   sin motivo.
2. **Un motivo no reconocido no inventa nada.** Devuelve lista vacía y el panel
   lo dice; el médico se queda con las sugerencias por edad. Inventar preguntas
   a partir de un texto que no entendemos sería peor que no aportar.
3. **El LLM prioriza, no decide.** El prompt de personalización ahora sabe que
   `motivo_de_hoy` manda sobre la edad, pero se le prohíbe expresamente
   descartar o minimizar una bandera roja ya listada.

Al probarlo apareció algo que habría fallado en consulta: las expresiones
naturales. Los médicos no dictan «dolor de pecho», dictan «**me duele el
pecho**». Se añadieron esas formas para pecho, cabeza, garganta, estómago y
espalda.

32 pruebas nuevas en backend (**214 → 246**) y 5 de la pantalla (**100 → 105**).

**Sigue abierto:** el motivo **no se guarda**. Alimenta las sugerencias y se
pierde al salir. Llevarlo al motivo de consulta de la nota (la S del SOAP) es el
paso natural siguiente, pero es otra cosa: implica tocar el expediente.

---

## M3 · Sugerencias en vivo de qué preguntar

> «Agregar que conforme pase la consulta vaya dándote sugerencias de qué
> preguntarle al paciente.»

**Qué hay hoy.** No existe. Lo que sí hay es la infraestructura donde encaja: el
SOAP incremental (`backend/app/routes/live.py`, `POST /live/soap/update`) ya recibe
transcript confirmado por chunks de ~10 s y llama a gemma para actualizar la nota
(`asr_service/megi_asr/routers/soap.py`). La pantalla que lo pinta es
`frontend/src/components/live_soap.jsx`.

**Qué falta.** Que ese mismo ciclo devuelva, además del parche SOAP, **lo que aún
no se ha preguntado**: cruzar la pre-consulta (M2) contra el transcript confirmado
y señalar los huecos («no se ha explorado fiebre», «falta preguntar por
tabaquismo»). La parte determinista —qué sugerencia sigue sin aparecer en el
texto— no necesita LLM y es la más fiable; el LLM añadiría lo específico del caso.

**Restricción medida, no teórica.** La GPU es una sola y Metal serializa el
trabajo: mientras gemma consolida una nota, la transcripción de otro médico se
degrada (roadmap §5). Cada llamada extra al LLM **durante** la consulta compite
con la transcripción en vivo, que hoy ya va justa (2 parciales, el primero a los
9.2 s). Por eso la capa determinista debe ir primero y cualquier refinamiento con
LLM debe medirse antes de dejarlo encendido.

### Hecho el 9-sep — capa determinista, sin LLM

`backend/app/services/cobertura.py` cruza las sugerencias del motivo contra el
**transcript ya confirmado** y separa lo cubierto de lo pendiente.
`POST /api/live/pendientes` lo expone, y el panel «Falta preguntar»
(`frontend/src/components/pendientes_panel.jsx`) lo muestra durante la consulta,
recalculándose con cada chunk.

Para que esto fuera posible, las 57 sugerencias de `motivo_engine` ganaron
**`claves`**: no describen la sugerencia, describen **cómo suena el tema en la
conversación** («irradia», «bajado de peso», «suda en la noche»). Es la
diferencia entre buscar la pregunta y reconocer que ya se hizo.

Cuatro decisiones, todas del mismo lado:

1. **No toca la GPU.** Es aritmética de cadenas: se puede llamar en cada chunk
   sin robarle tiempo a la transcripción, que es el recurso escaso. La
   preocupación del plan original queda resuelta por diseño, no por medición.
2. **Va aparte del SOAP.** Endpoint propio: si gemma falla o está caído, el
   médico sigue viendo sus recordatorios.
3. **Sesgo al falso pendiente.** Dar por preguntado algo que no se preguntó
   esconde una bandera roja; dejar de más solo hace ruido. Por eso una **alarma
   necesita DOS claves distintas** para darse por cubierta: que se mencione
   «brazo» no significa que se haya interrogado la irradiación del dolor.
4. **No se vigila lo que no se sabe reconocer.** Una sugerencia sin claves queda
   fuera del seguimiento en vez de adivinarse.

La lista en vivo se acota a 6 y dice cuántas oculta: veinte recordatorios
mientras se habla con el paciente no los lee nadie.

13 pruebas nuevas en backend (**246 → 259**) y 5 del panel (**105 → 110**).

**Falta:** las sugerencias del **motor de edad** todavía no tienen claves, así
que una consulta sin motivo reconocido no muestra nada en vivo. Se pueden ir
añadiendo por grupo etario. Y el refinamiento con LLM sigue sin hacerse **a
propósito**: habría que medir antes qué le cuesta a la transcripción.

---

## M4 · Especialidad de anestesiología

> «Agregar especialidad de anestesio: Ventilación · Gasometrías (conyugales a
> pacientes críticos) · Tiva · Electros · Línea arterial · Electrolitos · Fórmula
> de Winter.»

**Qué hay hoy.** `specialty` existe **solo como texto en el perfil del médico**
(`backend/app/db.py:213`, `backend/app/routes/me.py:20`), y sirve para imprimir el
encabezado de la receta. **No modifica nada clínico**: el prompt SOAP
(`asr_service/megi_asr/routers/soap.py`, `SOAP_SYSTEM`) es único para toda la app,
la pre-consulta es de medicina general y no hay ninguna calculadora clínica en el
proyecto (búsqueda de `winter`, `gasometr`, `anestesi`, `radiolog`: **cero
coincidencias** en `backend`, `asr_service` y `frontend/src`).

**Qué falta — y por qué es lo más grande de la lista.** No es «añadir una
especialidad» a una lista: hay que **crear el concepto**. Lo pedido mezcla tres
cosas de naturaleza distinta:

1. **Nota estructurada distinta.** Un registro anestésico no es un SOAP: es
   valoración preanestésica, técnica (TIVA/regional/general), manejo de vía aérea,
   ventilación, monitoreo y eventos con hora. Implica un formato de nota
   seleccionable, no un prompt más.
2. **Calculadoras deterministas.** La **fórmula de Winter** (PCO₂ esperada =
   1.5 × HCO₃⁻ + 8 ± 2) y la interpretación de gasometrías y electrolitos son
   **aritmética con reglas**, no trabajo de LLM: deben ir en código, con pruebas,
   y jamás depender de que gemma calcule bien. Es además la pieza más barata y de
   mayor valor inmediato.
3. **Vocabulario del ASR.** «TIVA», «línea arterial», «gasometría», los fármacos
   anestésicos y las cifras (FiO₂, PEEP, volumen corriente) tienen que
   transcribirse bien. El normalizador ya convierte cantidades habladas a cifras;
   habrá que verificar con audio real que este vocabulario sobrevive.

**Aclarado el 4-sep:** «gasometrías conyugales» era **seriadas** — el seguimiento
de un paciente crítico con varias gasometrías en el tiempo. Así que además de
interpretar una gasometría hay que poder **guardar la serie y ver la tendencia**
(pH, PCO₂, HCO₃, lactato). La interpretación aislada es el primer paso.

**Decidido (4-sep): las calculadoras primero.** Winter, gasometrías y
electrolitos, en código y con pruebas. La nota anestésica con formato propio
queda para después, cuando exista el concepto de nota por especialidad.

### Hecho el 4-sep — calculadoras

`backend/app/services/gasometria.py` (aritmética pura, **sin LLM**),
`backend/app/routes/calculo.py` (`POST /api/calculo/gasometria` y
`/tendencia`) y la pantalla **Calculadoras** en la barra
(`frontend/src/components/calculadoras.jsx`). Cubre:

- **Winter** (PCO₂ esperada = 1.5 × HCO₃⁻ + 8 ± 2) y las demás compensaciones:
  alcalosis metabólica, y respiratorias con el rango que va de aguda a crónica
  porque el dato no dice cuál es.
- **Trastorno primario** y si la compensación es adecuada o hay un segundo
  trastorno añadido.
- **Anión gap** corregido por albúmina y **Δ/Δ**, que delata la acidosis
  hiperclorémica o la alcalosis escondidas detrás de un AG elevado.
- **Electrolitos**: Na⁺ corregido por hiperglucemia (Katz y Hillier, ambos: no
  hay consenso y cambian la conducta) y Ca²⁺ corregido por albúmina.
- **PaO₂/FiO₂** con la clasificación de Berlín, lactato y K⁺.
- **Serie** de gasometrías seriadas con la tendencia por parámetro.

Tres decisiones que conviene no deshacer sin pensarlo:

1. **Sin estado.** El endpoint no recibe paciente, no consulta la base y no
   guarda nada: es aritmética sobre lo que el médico teclea, así que no abre
   superficie nueva de PHI ni necesita las guardas de pertenencia.
2. **Los datos absurdos se rechazan con 400**, no se interpretan. Un pH de 14
   mal tecleado tiene que fallar de forma ruidosa; una lectura con aire de
   certeza sobre un dato erróneo es peor que no dar ninguna.
3. **Cada resultado viaja con su fórmula**, para que el médico pueda comprobar
   la cuenta en vez de creerse el número.

Al escribir las pruebas apareció un hueco de verdad: con el **pH dentro de
rango** el módulo se rendía y no analizaba la compensación, que es justo donde
más sirve —es lo que delata el trastorno mixto—. Ahora deduce el primario
probable (marcado como tal) y sí calcula.

29 pruebas en `backend/tests/test_gasometria.py` con casos clínicos y la cuenta
hecha a mano en el comentario (backend: 185 → 214), y 5 de la pantalla
(frontend: 95 → 100).

**Falta de M4:** la nota anestésica con formato propio (preanestésica, técnica,
vía aérea, ventilación, monitoreo, eventos con hora), el vocabulario del ASR
(TIVA, línea arterial, FiO₂, PEEP) verificado con audio real, y decidir si las
calculadoras deben aparecer solo a quien tenga la especialidad en su perfil —hoy
la pantalla la ve todo el mundo—.

---

## M5 · Especialidad de radiología

> «Agregar especialidad de radiología.»

**Qué hay hoy.** Nada, y conviene decir que **no encaja en el flujo actual**. Toda
la app asume *médico y paciente hablando en una consulta*: audio de consulta →
transcripción → SOAP → receta. El radiólogo casi nunca tiene al paciente delante:
dicta un **informe** sobre un estudio (técnica, hallazgos, impresión
diagnóstica), a menudo comparándolo con estudios previos.

**Qué falta.** Antes de código, la decisión de producto: si MEGI debe ser un
**dictáfono de informes radiológicos** (un flujo nuevo: elegir estudio, dictar,
estructurar en técnica/hallazgos/impresión, firmar) o simplemente ofrecer al
médico general un mejor manejo de las **órdenes e interpretaciones de imagen**
que ya se mencionan en consulta (`doc_suggest.py` ya detecta radiografía,
ultrasonido, tomografía y resonancia dictados). Son dos productos distintos con
esfuerzos muy distintos.

**Decidido (4-sep): dictado de informes.** Es un flujo nuevo —elegir estudio,
dictar, estructurar en técnica/hallazgos/impresión, firmar— y por eso va **el
último** de la lista.

### Hecho el 9-sep

Pantalla **Radiología** completa: elegir paciente, modalidad (radiografía,
ultrasonido, TAC, resonancia, mastografía) y región → dictar o escribir →
revisar las cinco secciones → firmar. Piezas:

- `backend/app/services/radiologia.py` — catálogo de modalidades con la técnica
  que se propone por defecto, y el **reparto determinista del dictado**: si el
  radiólogo nombró los encabezados («técnica…, hallazgos…, impresión…»), se
  reparte **sin LLM**, incluidos sinónimos («protocolo», «conclusión»).
- `POST /v1/radiologia/estructurar` (gemma) — **solo** si el dictado no trae
  encabezados, y con la instrucción dura de ORDENAR lo dictado, no interpretarlo:
  nada de añadir hallazgos que nadie dijo.
- Tabla `informes_radiologia` + rutas en `backend/app/routes/radiologia.py`.

Cuatro decisiones que sostienen el diseño:

1. **El dictado crudo nunca se descarta.** Se guarda íntegro y se puede consultar
   desde la pantalla. Si nada se reconoce, va entero a Hallazgos. Perder lo
   dictado sería mucho peor que no repartirlo.
2. **El informe cuelga del PACIENTE, no de una consulta.** El radiólogo no tiene
   al paciente delante, así que no hay consulta que lo sostenga; la pertenencia
   se hereda del paciente, que es la raíz en toda la app. Verificado con pruebas
   de aislamiento entre dos médicos: ni leer, ni editar, ni firmar lo ajeno.
3. **Firmado = inmutable.** Se sella con sha256 y deja de admitir cambios; para
   corregir, un informe nuevo (adenda), como en la práctica real.
4. **No se firma sin hallazgos ni impresión**, pero sí sin técnica ni
   recomendaciones: hay estudios normales que se resuelven en dos líneas.

Al probarlo apareció un fallo silencioso que habría partido informes por donde no
toca: los cortes se calculan sobre el texto normalizado y se aplican sobre el
original, y **`NFKD` no conserva la longitud** («½» se expande a tres caracteres,
las ligaduras a dos). La normalización es ahora carácter a carácter, 1:1, con una
prueba que usa «½», «cm²» y «ﬁ».

22 pruebas nuevas en backend (**259 → 276**, incluidas las de aislamiento) y 6 de
la pantalla (**110 → 116**).

**Limitación conocida:** el informe exige que el paciente esté en la agenda del
radiólogo. Con el modelo de pertenencia actual —el paciente es de un médico— un
radiólogo no puede informar el estudio de un paciente de otro médico. Compartir
un paciente entre médicos es una decisión de producto pendiente, no un olvido.

Fuera de alcance salvo que se diga lo contrario: leer imágenes (PACS/DICOM). El
roadmap ya lista la integración PACS/LIS como pendiente heredado, y ver imágenes
no es lo mismo que dictar el informe.

---

## Decisiones y dudas

Resueltas el 4-sep (ver cada punto): M2 = panel visible **más** motivo de visita ·
M4 = calculadoras antes que la nota anestésica · M5 = dictado de informes, al
final · orden M1 → M4-calculadoras → M2 → M3.

Sigue abierta una, que no bloquea nada todavía:

~~«Gasometrías - conyugales a pacientes críticos»~~ **Resuelto (4-sep): eran
gasometrías *seriadas* en paciente crítico** — varias a lo largo del tiempo para
seguir la tendencia, no una aislada. Implica que la interpretación no basta: hay
que poder registrar una serie y ver cómo evoluciona.
