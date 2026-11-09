# Guion de grabación — MEGI Revisión

Material para grabar la demo y el video del hackatón Agent-Native (Builder.io). Acompaña a
`ENVIO_HACKATHON.md` (campos del formulario) y a `PLAN_HACKATHON_AGENT_NATIVE.md` §4 y §10
(flujo y guion originales), de los que esto es la versión ejecutable: rótulos reales de la
pantalla, resultados comprobados y texto para leer en voz alta.

**Este documento no autoriza publicar nada.** La pausa de publicación sigue vigente por
instrucción expresa de David: no se sube video, no se publica un Clip y no se envía el
formulario hasta que él lo diga. Grabar en local no publica; publicar un Clip no envía la
entrada.

**Plazo** (de las bases guardadas en `evidencia/bases/`): lunes **9 nov 2026, 11:59 PM PT**
= 10 nov, 01:59 en Ciudad de México. Lo que exigen, literal: *«Record a public Clips
demonstration showing the actual application in use. The recording must be viewable without
a login or access request»*, más el formulario enviado y la recepción confirmada. No fijan
duración; el guion dura **3:37**, con los subtítulos ya cuadrados a esos tiempos.

**Lo que puntúan** (una sola rúbrica, 0–10 por criterio): Usefulness and Execution 40 % ·
Creativity and Design 20 % · Innovation 20 % · Cleverness and Use of Agent-Native 20 %.
Cada toma de abajo dice a qué criterio sirve.

---

## 0. Antes de encender la cámara

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"   # node ≥ 22.22
cd megi-revision
node -v                                   # v22.22.x
pnpm typecheck && pnpm agent-native:doctor # limpios · "Clean — no findings"
pnpm demo --port 8082                      # mock + .demo/pglite, aislado de data/
```

`pnpm demo` es el modo de grabación: fuerza `MEGI_MODE=mock` y una base SQL propia en
`.demo/pglite`, así que **no toca `data/`** ni necesita el backend de MEGI en 8020. Abre
`http://localhost:8082/revision` y comprueba que hay **cuatro consultas pendientes**.

El agente sí necesita modelo: en `.env`, `OPENAI_BASE_URL=https://api.x.ai/v1`,
`AGENT_ENGINE=ai-sdk:openai`, `AGENT_MODEL=grok-4.20-0309-non-reasoning` y `OPENAI_API_KEY`.
Medido ayer con ese modelo: **el turno tarda entre 2,6 y 4,3 segundos**, así que no hay
esperas que cortar.

Antes de cada toma, en la pantalla del caso: **«Restaurar mis casos»** (botón de la tarjeta
«Prueba con cuatro pacientes sintéticos»). Borra solo los planes, versiones y exportaciones
sintéticos propios; conserva mediciones y otros usuarios.

**Lo que no puede aparecer en pantalla**

- La clave de la API. No abras `.env` ni un terminal que la muestre; no la pases como
  argumento (queda en `ps` y en el historial). Si grabas terminal, arranca el servidor
  antes de empezar a grabar.
- La contraseña del demo (`demo-megi-2026`, declarada en `seed_demo.py`).
- Pestañas, notificaciones y correo. Modo «no molestar», una sola ventana, 1920×1080.
- Datos de pacientes reales. Los cuatro casos son ficticios y lo dicen en pantalla; no
  escribas nombres reales en ningún campo.

---

## 1. El caso que se graba: Rosa Ficticia Muestra (`demo-c3`)

Es el único de los cuatro donde **todas las reglas disparan en una sola toma**. Comprobado
hoy por CLI contra el motor real del producto (`agent-native action`, mock, base
desechable), no supuesto:

| Lo que se verá | Valor exacto |
|---|---|
| Paciente | Rosa Ficticia Muestra · alergia a **Sulfas** · crónicos: **fibrilación auricular, hipertensión** |
| Medicación del expediente | **Warfarina 5 mg** y **Metoprolol 50 mg** |
| Nota SOAP (lo que el médico dictó) | Ibuprofeno 400 mg c/8 h 7 días · Paracetamol 1 g c/8 h · Rx de rodilla · INR en 2 semanas |
| Línea **Ibuprofeno** → | `verificacion: bloqueado`, con tres motivos encadenados: AINE que eleva la presión en hipertensión · **+ Warfarina (grave)**: «Los AINE inhiben la función plaquetaria y lesionan la mucosa gástrica; potencian el sangrado con anticoagulantes → Evitar la combinación; usar paracetamol para el dolor» · + Metoprolol (leve) |
| Línea **Paracetamol** → | `ok` |
| Pendientes → | `verificacion: pendiente` (no son fármacos: no se verifican) |
| Conciliación | Warfarina y Metoprolol **sin confirmar** → la aprobación queda deshabilitada |
| Recibo de la propuesta, literal | «Plan creado con **N** líneas: 1 bloqueo(s), 0 advertencia(s). Revisión médica pendiente: confirma las fuentes y concilia la medicación antes de aprobar.» · N son **cuatro o cinco** según si el agente copia también «Fisioterapia» de la nota; con el modelo real, el 8-nov, fueron cinco. El bloqueo es siempre uno: el ibuprofeno |

Lo que esto cuenta solo: **el agente propone lo que el médico dictó, y la capa de acciones
lo bloquea.** No hay que forzar nada ni escribir un fármaco a mano para provocarlo.

Reservas, si una toma se cae: `demo-c1` (Alba, alergia a penicilina → amoxicilina bloqueada,
con azitromicina y clindamicina como alternativas) y `demo-c2` (Mateo: naproxeno + losartán
da **advertencia**, no bloqueo; sirve si quieres mostrar el caso suave).

---

## 2. Guion por tomas · 3:37

Una toma por paso, como en §10. La narración en español es la que se lee; la inglesa es la
misma frase para subtítulo o doblaje, por si la entrega se presenta en inglés.

### Toma 1 · 0:00–0:20 · El problema · *Usefulness*
**En pantalla:** `/revision`, la lista con cuatro consultas pendientes y la pestaña
«Exportadas» vacía.
**ES:** «Después de una consulta, alguien tiene que convertir la nota en receta y
pendientes. Es trabajo de minutos, repetido, y es donde se cuelan los errores de
medicación. Esta es la mesa donde el médico y el agente lo hacen juntos.»
**EN:** “After a consultation, someone must turn the note into orders and follow-ups. It is minutes of repetitive work, and it is where medication errors slip in.
This is the desk where the physician and the agent do it together.”

### Toma 2 · 0:20–0:35 · El caso · *Usefulness*
**En pantalla:** abre Rosa (`demo-c3`). Ficha: alergia a Sulfas, fibrilación auricular,
hipertensión, y **«Medicación del expediente»** con Warfarina y Metoprolol. Nota SOAP a la
vista.
**ES:** «Rosa es ficticia, como los cuatro casos. Toma warfarina por una fibrilación y
metoprolol. En la nota, el médico dictó ibuprofeno.»
**EN:** “Rosa is fictitious, like all four cases. She is on warfarin for atrial fibrillation
and on metoprolol. In the note, the physician dictated ibuprofen.”

### Toma 3 · 0:35–1:10 · La propuesta · *Cleverness · Innovation*
**En pantalla:** en el chat, **escribe a mano** *«Prepara la receta y los pendientes de esta
consulta»*. Se ven los pasos reales del agente; el plan aparece en el tablero; el recibo
contado sale como tarjeta de cambio. Abre **«Motivo del último cambio»**.

**ES:** «El agente lee la nota y el expediente, pasa cada fármaco por el verificador de
MEGI y guarda el plan en una sola operación. Lo que contesta no es un resumen: es el recibo
de lo que quedó escrito, con las líneas y los bloqueos contados.»
**EN:** “The agent reads the note and the record, runs every drug through MEGI's checker and
writes the plan in one atomic operation. What it says back is not a summary: it is a receipt
of what was actually written, with every line counted. One safety block. Physician review pending.”
**Debe aparecer:** la tarjeta **«Plan listo para revisión médica»** con «1 bloqueo(s)» y
«Revisión médica pendiente».
**Y debajo saldrá esto, que no es del producto:** «Waiting for your answer before
continuing.» La pone el framework cuando una acción marcada `endsTurn` devuelve el turno al
médico —para `ask-question` es correcta; aquí es una frase hecha—. No te detengas en ella:
narra la tarjeta, que es el recibo, y pasa a la toma 4.

### Toma 4 · 1:10–1:40 · El bloqueo y la alternativa · *Usefulness · Innovation*
**En pantalla:** la línea de Ibuprofeno en rojo con su motivo. Pulsa **«Rechazar»** (o
**«Bloquear»**) en esa línea: la pantalla autoriza el alcance de sugerencias **solo para esa
línea** y el agente propone la alternativa, que aparece **pendiente de revisión** con
«Aceptar alternativa» / «Descartar alternativa».
**ES:** «El agente propuso lo que el médico dictó, y la acción lo bloqueó: ibuprofeno con
warfarina es sangrado. Al rechazarla, el médico autoriza al agente a sugerir **para esa
línea y ninguna otra**. La alternativa queda fuera de la receta hasta que el médico la
acepta.»
**EN:** “The agent proposed what the physician dictated, and the action blocked it: ibuprofen
with warfarin means bleeding. By rejecting the line, the physician authorises the agent to
suggest **for that line and no other**. The alternative stays out of the prescription until
the physician accepts it.”

### Toma 5 · 1:40–2:10 · Lo bloqueado es intocable, y el alcance · *Cleverness*
**En pantalla:** **«Bloquear»** en la línea de Paracetamol. Selecciona dos líneas con la
casilla → aparece «El agente solo podrá editar estas 2 líneas al pedir el reajuste» →
**«Reajustar solo selección»**. Pide en el chat un reajuste que toque también la línea
bloqueada. El servidor lo rechaza y la pauta bloqueada queda intacta. Muestra «Edición del
agente limitada a N línea(s)» y **«Liberar alcance»**.
**ES:** «Bloqueada quiere decir intocable, y eso no está en el prompt: está en la acción,
dentro de la transacción. La selección visual tampoco concede permiso; el médico autoriza
identificadores concretos y el servidor los vuelve a validar. El médico puede hacer
cualquier paso a mano, y el agente ve el mismo estado.»
**EN:** “Locked means untouchable, and that rule is not in the prompt: it is in the action,
inside the transaction. A visual selection grants nothing either; the physician authorises
specific ids and the server revalidates them. The physician can do any step by hand, and
the agent sees the same state.”

### Toma 6 · 2:10–2:25 · Las versiones · *Creativity · Execution*
**En pantalla:** **«Comparar versiones»**: retiradas en rojo, añadidas en verde, antes →
después de las ediciones; la línea bloqueada conservada. Menciona que cada línea trae su
fuente.
**ES:** «Cada cambio es una versión atómica con su autor y su hora. Se ve qué se retiró, qué
se añadió y de dónde salió cada línea.»
**EN:** “Every change is an atomic version with its author and time. You can see what was
removed, what was added, and where each line came from.”

### Toma 7 · 2:25–2:45 · Conciliar antes de aprobar · *Usefulness*
**En pantalla:** la tarjeta de conciliación con Warfarina y Metoprolol en **«Sin
confirmar»**; el botón de aprobar, deshabilitado. Marca **«Lo sigue tomando»** en las dos.
El botón se habilita.
**ES:** «Los fármacos que vienen del expediente entran sin confirmar y frenan la aprobación.
El agente no puede saltarse esto: conciliar es del médico, por la interfaz, y la regla vive
en la acción.»
**EN:** “Drugs coming from the record arrive unconfirmed and hold the approval. The agent
cannot skip this: reconciliation belongs to the physician, through the UI, and the rule
lives in the action.”

### Toma 8 · 2:45–3:05 · Aprobar y exportar · *Execution*
**En pantalla:** revisa alertas → **«Aprobar y exportar a MEGI»** → aparece **«Aprobado y
exportado»**, el **«Sello:»** y la pestaña **«Exportadas»** con el caso dentro.
**ES:** «El médico aprueba, confirma las alertas que quedan y la nota sale sellada a MEGI en
FHIR. La aprobación clínica solo existe desde aquí: no está expuesta por HTTP, ni por MCP,
ni por línea de comandos.»
**EN:** “The physician approves, confirms the remaining alerts, and the note leaves sealed to
MEGI as FHIR. Clinical approval exists only here: it is not exposed over HTTP, MCP or the
CLI.”

### Toma 9 · 3:05–3:20 · Por qué es Agent-Native · *Cleverness · Innovation*
**En pantalla:** el tablero con el panel del agente abierto al lado; si quieres, la página
de aprobación del framework para una escritura por HTTP con `needsApproval`.
**ES:** «Interfaz y agente llaman a las mismas diecisiete acciones sobre los mismos
registros. Toda escritura del agente manda la versión que leyó; si llega tarde, se rechaza
y relee.»
**EN:** “The UI and the agent call the same seventeen actions on the same records. Every
agent write carries the version it read; if it arrives late, it re-reads.”

### Toma 10 · 3:20–3:37 · Qué es previo y qué es nuevo · *reglas de las bases*
**En pantalla:** el README o la tabla de procedencia.
**ES:** «El backend clínico de MEGI es trabajo previo y no se modificó. La aplicación entera
se construyó en el hackatón. Todos los pacientes son ficticios: esto es apoyo a la decisión,
y la aprobación final es siempre del médico.»
**Para el formulario, no para la voz:** modelo de datos, las diecisiete acciones, los
adaptadores, la pantalla, el prompt y las pruebas.
**EN:** “The MEGI clinical backend is prior work and was not modified. The whole application
was built during the hackathon. All patients are fictitious. This is decision support: the
final approval is always the physician's.”

---

## 3. Lo que se puede afirmar, y con qué

Decir solo esto, y solo así:

| Frase | Evidencia |
|---|---|
| «Toda escritura del agente lleva la versión que leyó» | `pruebas-hackathon/fase2/historico/agente-version-2026-11-08T21-39-42-250Z-modelo.json`: 20 escrituras, 20 con versión, 0 rechazos |
| «Diez pasadas de diez completaron el trabajo» | el mismo archivo, `j8b: 10 de 10`; Grok 4.20 non-reasoning, tarea de dos escrituras |
| «Las reglas están en las acciones» | `evidencia/auditoria-hackathon-resultados.json` (102 comprobaciones) y las 83 pruebas de `megi-revision` |
| «El agente no puede aprobar» | `aprobar-plan` es `uiOnly`; comprobado en la auditoría y en `pruebas-hackathon/fase2/catalogo.mts` |
| «El turno tarda unos 3 segundos» | las diez pasadas: 2,6 a 4,3 s |

No decir, en ninguna toma: que el catálogo está validado clínicamente; que está aprobado por
alguna autoridad; una cifra de latencia que no salga de `evidencia/resultados/latencia.json`;
«listo para producción» (producción exige un Postgres gestionado y eso no se ha probado); ni
atribuir a MEGI nada que no se haya medido.

Las bases descalifican por **demostración fabricada**. Nada de recortar un resultado y
narrarlo como si hubiera pasado, ni montar una pantalla que no sea la app corriendo.

---

## 4. Si el agente se sale del guion

Es un modelo: varía. Lo que sigue ya se ha visto, y casi todo **conviene** que se vea.

| Lo que pasa | Qué es | Qué hacer en cámara |
|---|---|---|
| Pregunta algo clínico («¿confirmas que no tiene alergias conocidas?») | El prompt le prohíbe omitir una pregunta pendiente | Contéstale y sigue. Es la demo, no un tropiezo: enséñalo |
| Una escritura se va en `version_desactualizada` | Alguien cambió el plan antes; el 409 es la protección | Déjalo: relee y vuelve con la versión nueva. Nárralo en una frase |
| Dice que guardó algo y no hay recibo | La guarda de respuesta reescribe ese turno | Es una función; muéstrala si ocurre |
| El turno acaba sin escribir nada | Visto el 8-nov con el botón: el modelo leyó la habilidad y cerró. La guarda contesta «No he hecho el cambio que me pediste: este turno terminó sin ninguna escritura en el plan…» y el tablero ofrece **«Volver a pedir la propuesta»** | Pulsa ese botón: manda una instrucción más dura. En cámara es un buen plano —la app se da cuenta de que el modelo no hizo su trabajo—, pero si buscas la toma limpia, repítela |
| Intenta tocar una línea bloqueada o fuera del alcance | El servidor lo rechaza dentro de la transacción | Es la toma 5; aprovéchala |
| El proveedor del modelo falla (429, timeout) | Nada que ver con la app | Corta la toma y repite. No la narres como si hubiera funcionado |
| El tablero no refresca | Respaldo de 60 s / foco | Vuelve a la lista y entra otra vez; si pasa dos veces, reinicia `pnpm demo` |

Antes de la toma buena: **dos ensayos completos** del caso de Rosa, con «Restaurar mis
casos» entre ellos. Si los dos salen, graba.

---

## 5. Después de grabar — solo cuando David autorice

1. Publicar el Clip y **comprobarlo en una ventana privada, sin sesión**. Si pide iniciar
   sesión o solicitar acceso, no cumple las bases.
2. Pegar el enlace en `ENVIO_HACKATHON.md`, campo «Public Clips recording URL».
3. Pegar la descripción en inglés de `ENVIO_HACKATHON.md` con los nombres del equipo
   puestos, y el trabajo previo tal como está redactado.
4. Enviar el formulario (`https://www.builder.io/hackathon/submit`) y **guardar la
   confirmación de recepción**: grabar el clip no envía la entrada.
5. `evidencia/video/demo-grok.webm` y `.mp4` son de antes de la auditoría: no sirven como
   entrega ni sustituyen al Clip público.

Las tres casillas de `ENVIO_HACKATHON.md` («Antes de enviar») son las mismas de aquí; no
hacen falta dos listas.

---

## 6. Subtítulos

`subtitulos-demo-en.srt` y `subtitulos-demo-en.vtt`: la narración inglesa en 34 rótulos
cuadrados a los tiempos de arriba, de 00:00,400 a 03:37,000. Dos líneas como máximo, 42
caracteres por línea y 18,6 car/s de lectura en el rótulo más apretado, que es el límite
habitual para que se lean sin pausar. Carga el `.vtt` si la plataforma deja elegir; el `.srt`
lo acepta cualquiera.

Dos tomas no cabían en su ventana y se recortaron en los dos idiomas: la **9** cedió la
frase del médico que hace los pasos a mano, que se fue a la **5** —donde encaja mejor,
porque ahí acaba de hacerlo—, y la **10** dejó el inventario de lo construido para el
formulario, que es donde se lee con calma. La toma 5 pasa a treinta segundos y las
siguientes corren cinco.

Si la grabación se desvía de los tiempos —y se desviará—, ajusta el desplazamiento, no el
texto: casi todos los rótulos empiezan al principio de su toma, así que mover el bloque de
una toma entera suele bastar.

Si prefieres narrar en inglés y subtitular en español, dímelo: los rótulos en español salen
del mismo guion.

---

## 7. Chuleta de una página

Para tener al lado mientras grabas.

```
0:00  lista /revision · 4 pendientes
0:20  abrir Rosa demo-c3 · Sulfas · FA + HTA · Warfarina y Metoprolol en el expediente
0:35  chat: "Prepara la receta y los pendientes de esta consulta"
      → recibo: 4 líneas, 1 bloqueo · abrir "Motivo del último cambio"
1:10  Ibuprofeno en rojo → "Rechazar" → alternativa PENDIENTE, fuera de la receta
1:40  "Bloquear" en Paracetamol · marcar 2 líneas → "Reajustar solo selección"
      → pedir un reajuste que toque la bloqueada → el servidor lo rechaza
2:10  "Comparar versiones" · retiradas rojas, añadidas verdes
2:25  conciliación: Warfarina y Metoprolol "Sin confirmar" → aprobar deshabilitado
      → "Lo sigue tomando" en las dos → se habilita
2:45  "Aprobar y exportar a MEGI" → "Aprobado y exportado" + Sello + pestaña Exportadas
3:05  mismas 17 acciones para pantalla y agente · toda escritura lleva su versión
3:20  previo: backend MEGI · nuevo: la app entera · pacientes ficticios · apoyo a la decisión
```
