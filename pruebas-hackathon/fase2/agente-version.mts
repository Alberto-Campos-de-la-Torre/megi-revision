/**
 * Fase 2 · bloque J — el contrato de versión, con el agente de verdad.
 *
 * Desde el cierre del 7-nov, toda edición del agente exige `versionEsperada`
 * (`comprobarVersion`: 409 `version_desactualizada`). La pregunta que esta
 * prueba contesta no es si el campo existe —existe, lo devuelve `obtener-plan`
 * en `plan.version`, y `<current-screen>` y `view-screen` también lo traen—,
 * sino si **un modelo de verdad lo usa**: si lee antes de escribir, si manda la
 * versión en cada escritura, si se recupera de un 409 releyendo en vez de
 * reintentar a ciegas, y si respeta las decisiones que son del médico.
 *
 * Nada de esto se puede medir con un mock: hace falta un modelo. Por eso esta
 * prueba se separa de las otras cuatro de la fase 2, que no gastan nada.
 *
 * ── Qué mide y qué NO ──────────────────────────────────────────────────────
 * El turno corre el bucle de agente del framework **en proceso**, no por la
 * línea de órdenes: `agent-native agent` no sirve para esta app porque importa
 * `actions/*.ts` con Node a secas y todas resuelven sus vecinos con
 * especificadores `.js` que en disco son `.ts`; el resultado es
 * `[action-discovery] Skipped … ERR_MODULE_NOT_FOUND` y el agente se queda sin
 * ninguna acción. Bajo `tsx` esa resolución sí funciona, así que aquí se monta
 * el mismo bucle a mano.
 *
 * Fidelidad respecto al chat del producto:
 *   · **igual**: el prompt de sistema es el del producto, leído de
 *     `server/plugins/agent-chat.ts` en cada ejecución (no una copia que se
 *     quede vieja), y las acciones son las de verdad, con su base y su MEGI;
 *   · **igual**: el repertorio lo filtra `actionsToEngineTools`, que descarta
 *     lo `uiOnly` y lo `agentTool:false` —`aprobar-plan` y la conciliación
 *     quedan fuera, como en el chat—;
 *   · **distinto**: se ofrecen todas las acciones alcanzables de golpe, que es
 *     el techo de lo que el chat alcanza con `tool-search`, no las ocho de
 *     `initialToolNames`;
 *   · **distinto**: no hay `<current-screen>` ni las herramientas del
 *     framework (`docs-search`, `ask-question`, `view-screen` del runtime). El
 *     prompt del producto ya prevé que la documentación pueda no aparecer.
 * O sea: mide el contrato de las acciones bajo las reglas del producto, no la
 * interfaz. Para la interfaz están los guiones de `evidencia/` con Playwright.
 *
 * ── Uso ────────────────────────────────────────────────────────────────────
 *   # 1 · comprobar el arnés sin gastar nada (no llama a ningún modelo):
 *   megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/agente-version.mts --arnes
 *
 *   # 2 · la prueba de verdad, con la clave del proveedor en el entorno.
 *   #     Anthropic es el motor por defecto del framework:
 *   export ANTHROPIC_API_KEY=...
 *   #     o un compatible con OpenAI (xAI, etc.), declarando el motor:
 *   export OPENAI_BASE_URL=https://api.x.ai/v1
 *   export OPENAI_API_KEY=...
 *   megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/agente-version.mts \
 *     --motor openai --modelo grok-4.20-0309-non-reasoning
 *
 * La clave tiene que venir del entorno o de `megi-revision/.env`: las que estén
 * guardadas en Ajustes > Agente de la app no sirven, porque esta prueba corre
 * contra una base de datos desechable y no ve esa configuración.
 *
 * Opcionales: `--modelo <nombre>`, `--motor <nombre>`, `--iteraciones <n>`,
 * `--consulta <id>` (por defecto demo-c2), `--repeticiones <n>` (la conducta de
 * un modelo varía entre ejecuciones: con 1 se obtiene una anécdota, no una tasa).
 *
 * No necesita MEGI: corre con `MEGI_MODE=mock` y una base PGlite desechable.
 * No toca ninguna base ni ninguna demo existente.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// ─────────────────────────────── argumentos ───────────────────────────────
const argv = process.argv.slice(2);
const bandera = (n: string) => argv.includes(`--${n}`);
const opcion = (n: string, pordefecto?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : pordefecto;
};
const SOLO_ARNES = bandera("arnes");
const CONSULTA = opcion("consulta", "demo-c2")!;
const ITERACIONES = opcion("iteraciones", "14")!;
const REPETICIONES = Number(opcion("repeticiones", "1"));
const MODELO = opcion("modelo") ?? process.env.AGENT_MODEL;
const MOTOR = opcion("motor");

const aquí = new URL(".", import.meta.url);
const APP = new URL("../../megi-revision/", aquí);
const req = createRequire(new URL("package.json", APP));
const baseDir = mkdtempSync(join(tmpdir(), "fase2-agente-"));
const DATABASE_URL = `pglite:${join(baseDir, "db")}`;

// ─────────────────────────────── anotación ────────────────────────────────
type Check = { id: string; passed: boolean; detail: unknown };
const resultados: Array<Check | { id: string; medicion: unknown }> = [];
function anota(id: string, pasa: boolean, detalle?: unknown) {
  resultados.push({ id, passed: !!pasa, detail: detalle ?? null });
  console.log(`${pasa ? "PASA " : "FALLA"} ${id}${detalle === undefined ? "" : `: ${String(JSON.stringify(detalle)).slice(0, 240)}`}`);
}
function mide(id: string, valor: unknown) {
  resultados.push({ id, medicion: valor });
  console.log(`MIDE  ${id}: ${String(JSON.stringify(valor)).slice(0, 240)}`);
}
function nota(t: string) { console.log(`  ⓘ   ${t}`); }

// ───────────────────── la base y las acciones, en proceso ─────────────────
// El montaje y la verificación se hacen aquí, no por la línea de órdenes: así
// son deterministas y devuelven objetos, no texto para analizar. El turno del
// agente es lo único que se lanza como subproceso.
let cerrar: null | (() => Promise<void>) = null;
let acciones: Record<string, any> = {};

async function abreBase() {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.MEGI_MODE = "mock";
  const { getPgliteClient, closePgliteClients } = await import(
    new URL("client.js", pathToFileURL(req.resolve("@agent-native/core/db"))).href
  );
  const client = await getPgliteClient(DATABASE_URL);
  const migraciones = [
    ...readFileSync(new URL("server/plugins/db.ts", APP), "utf8").matchAll(/sql: `([\s\S]*?)`,/g),
  ];
  if (!migraciones.length) throw new Error("No se encontró ninguna migración de la app");
  for (const m of migraciones) await client.exec(m[1]!);
  for (const n of ["proponer-plan", "obtener-plan", "agregar-linea"]) {
    acciones[n] = (await import(new URL(`actions/${n}.ts`, APP).href)).default;
  }
  cerrar = async () => { await closePgliteClients(); cerrar = null; };
}
const CORREO = "fase2-agente@prueba.local";
const comoAgente = { caller: "tool", userEmail: CORREO, orgId: null } as any;
const llama = (n: string, args: unknown) => acciones[n].run(args, comoAgente);

// ──────────────────── lectura tolerante de los eventos ────────────────────
/**
 * El bucle del framework ha nombrado sus eventos de varias formas según la
 * versión (`tool_start`/`tool_done`, `tool-call`/`tool-result`), y los
 * argumentos llegan unas veces como objeto y otras como texto. En vez de fijar
 * una forma —que convertiría un renombrado del framework en un fallo de
 * producto— se rastrea cada evento por los nombres posibles y se guarda el
 * flujo crudo en el JSON de resultados, para que una persona pueda auditar lo
 * que el analizador no viera.
 */
export type Llamada = { tool: string; args: Record<string, unknown>; error: string | null; cerrada: boolean; crudo: unknown[] };
export function llamadasDe(eventos: unknown[]): Llamada[] {
  const salida: Llamada[] = [];
  for (const e of eventos as any[]) {
    if (!e || typeof e !== "object") continue;
    const tool = e.tool ?? e.toolName ?? e.name;
    if (typeof tool !== "string" || !tool) continue;
    const tipo = String(e.type ?? "");
    const bruto = e.input ?? e.args ?? e.argsText ?? e.arguments;
    let args: Record<string, unknown> = {};
    if (typeof bruto === "string") { try { args = JSON.parse(bruto); } catch { args = {}; } }
    else if (bruto && typeof bruto === "object") args = bruto as Record<string, unknown>;
    // El código de error puede venir en el resultado, en un campo suelto o
    // dentro de un texto; se busca el primero que aparezca en el evento entero.
    const texto = JSON.stringify(e);
    const m = /"errorCode"\s*:\s*"([a-z_]+)"/.exec(texto);
    const esError = e.isError === true || e.error != null || /"isError"\s*:\s*true/.test(texto);
    // Una llamada son dos eventos (apertura y cierre) o uno solo, según la
    // versión del framework. El cierre no es una llamada nueva: se pega a la
    // última de la misma herramienta que siga abierta.
    const abre = /start|call|input/i.test(tipo);
    const cierra = !abre && (/done|result|end/i.test(tipo) || e.result !== undefined || esError);
    if (cierra) {
      for (let i = salida.length - 1; i >= 0; i--) {
        const c = salida[i]!;
        if (c.tool !== tool || c.cerrada) continue;
        c.cerrada = true;
        if (m) c.error = m[1]!; else if (esError) c.error = "error";
        if (!Object.keys(c.args).length && Object.keys(args).length) c.args = args;
        c.crudo.push(e);
        break;
      }
      // Un cierre sin apertura previa (forma de un solo evento) sí cuenta.
      if (!salida.some((c) => c.tool === tool && c.cerrada && c.crudo.includes(e))) {
        salida.push({ tool, args, error: m?.[1] ?? (esError ? "error" : null), cerrada: true, crudo: [e] });
      }
      continue;
    }
    salida.push({ tool, args, error: m?.[1] ?? (esError ? "error" : null), cerrada: false, crudo: [e] });
  }
  return salida;
}

const ESCRITURAS = new Set([
  "proponer-plan", "agregar-linea", "actualizar-linea", "reajustar-plan",
  "aprobar-plan", "conciliar-medicacion", "definir-alcance", "resolver-sugerencia",
  "sugerir-reemplazo", "preparar-aprobacion", "medir-revision", "restaurar-demo",
]);
const LECTURAS = new Set([
  "obtener-plan", "ver-contexto-consulta", "listar-consultas", "historial-plan",
  "metricas-revision", "view-screen",
]);

// ───────── las reglas del producto, extraídas de su propio archivo ─────────
function reglasDelProducto(): string {
  const txt = readFileSync(new URL("server/plugins/agent-chat.ts", APP), "utf8");
  const m = /systemPrompt: `([\s\S]*?)`,?\s*\}\);\s*$/.exec(txt);
  if (!m) throw new Error("No pude extraer el systemPrompt de server/plugins/agent-chat.ts");
  return m[1]!.replace(/\\`/g, "`").replace(/\\\$/g, "$");
}

// ──────────────────────────── el turno del agente ──────────────────────────
// El bucle del framework, montado aquí mismo. Las piezas se cargan desde el
// paquete instalado resolviendo un subpath que sí exporta y navegando a `dist/`:
// son internas, así que si una versión las mueve, esta prueba lo dirá con
// claridad en vez de medir otra cosa.
let piezas: any = null;
async function cargaBucle() {
  if (piezas) return piezas;
  const raiz = new URL("../../", pathToFileURL(req.resolve("@agent-native/core/db")));
  const traer = async (p: string, que: string) => {
    try { return await import(new URL(p, raiz).href); }
    catch (e: any) { throw new Error(`No pude cargar ${que} (${p}) del framework: ${e?.message}`); }
  };
  const motor = await traer("dist/agent/engine/index.js", "el registro de motores");
  const produccion = await traer("dist/agent/production-agent.js", "el constructor de herramientas");
  const bucle = await traer("dist/agent/run-loop-with-resume.js", "el bucle del agente");
  const contexto = await traer("dist/server/request-context.js", "el contexto de petición");
  // Como hace la propia línea de órdenes: así una clave en `megi-revision/.env`
  // vale igual que una del entorno. Las claves guardadas en Ajustes de la app NO
  // sirven aquí, porque esta prueba usa una base desechable.
  try {
    const utils = await traer("dist/scripts/utils.js", "el cargador de .env");
    utils.loadEnv?.();
  } catch { /* si el framework lo mueve, se sigue con el entorno tal cual */ }
  for (const [n, f] of [["registerBuiltinEngines", motor.registerBuiltinEngines], ["resolveEngine", motor.resolveEngine], ["actionsToEngineTools", produccion.actionsToEngineTools], ["runAgentLoopDirectWithSoftTimeout", bucle.runAgentLoopDirectWithSoftTimeout], ["runWithRequestContext", contexto.runWithRequestContext]] as const) {
    if (typeof f !== "function") throw new Error(`El framework ya no exporta ${n}: esta prueba necesita actualizarse`);
  }
  motor.registerBuiltinEngines();
  piezas = { ...motor, ...produccion, ...bucle, ...contexto };
  return piezas;
}

/**
 * Todas las acciones de la app, cargadas como las carga el servidor.
 *
 * Se descartan los archivos que no declaran `defineAction`: `actions/run.ts` es
 * un guion de línea de órdenes (`void runScript()`) y al importarlo se queda
 * con el proceso —imprime su ayuda y termina—, así que la lista se filtra por
 * contenido y no solo por extensión.
 */
async function accionesDeLaApp(): Promise<Record<string, any>> {
  const dir = new URL("actions/", APP);
  const nombres = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
    .filter((f) => readFileSync(new URL(f, dir), "utf8").includes("defineAction("))
    .map((f) => f.replace(/\.ts$/, ""));
  const out: Record<string, any> = {};
  for (const n of nombres) {
    const m = await import(new URL(`${n}.ts`, dir).href);
    if (m?.default) out[n] = m.default;
  }
  return out;
}

async function turnoDelAgente(mensaje: string) {
  const f = await cargaBucle();
  const acciones = await accionesDeLaApp();
  const tools = f.actionsToEngineTools(acciones);
  const engine = await f.resolveEngine({ ...(MOTOR ? { engineOption: MOTOR } : {}), ...(MODELO ? { model: MODELO } : {}) });
  const model = MODELO ?? engine?.defaultModel;
  const eventos: unknown[] = [];
  let responseText = "";
  const t0 = Date.now();
  let usage: unknown = null; let fallo: unknown = null;
  try {
    usage = await f.runWithRequestContext({ userEmail: CORREO, orgId: null }, () =>
      f.runAgentLoopDirectWithSoftTimeout({
        engine, model,
        systemPrompt: reglasDelProducto(),
        tools, actions: acciones,
        messages: [{ role: "user", content: [{ type: "text", text: mensaje }] }],
        signal: new AbortController().signal,
        ownerEmail: CORREO, orgId: null,
        maxIterations: Number(ITERACIONES),
        send(e: any) { eventos.push(e); if (e?.type === "text") responseText += e.text ?? ""; },
      }),
    );
  } catch (e: any) {
    fallo = { nombre: e?.name, mensaje: String(e?.message).slice(0, 600) };
  }
  return {
    ms: Date.now() - t0, eventos, responseText, usage, fallo,
    motor: engine?.name ?? null, modelo: model ?? null,
    ofrecidas: tools.map((x: any) => x.name).sort(),
  };
}

// ═══════════════════════════════ la prueba ═════════════════════════════════
let fallo = false;
try {
  await abreBase();

  // Montaje: un plan existente, y una escritura más para que la versión no sea
  // la inicial. Así, si el modelo manda una versión, tiene que ser la que leyó
  // y no un 1 adivinado.
  await llama("proponer-plan", {
    consultaId: CONSULTA,
    lineas: [
      { tipo: "farmaco", texto: "Paracetamol", dosis: "500 mg", frecuencia: "cada 8 h", duracion: "3 días", justificacion: "Dolor leve" },
      { tipo: "pendiente", texto: "Control en una semana" },
    ],
    explicacion: "Plan de partida del montaje de la prueba.",
  });
  let plan: any = await llama("obtener-plan", { consultaId: CONSULTA });
  await llama("agregar-linea", {
    planId: plan.id, tipo: "pendiente", texto: "Pendiente añadido en el montaje",
    versionEsperada: plan.plan.version,
  });
  plan = await llama("obtener-plan", { consultaId: CONSULTA });
  const versionAntes = plan.plan.version as number;
  const lineasAntes = plan.lineas.length as number;
  mide("j0-version-al-empezar", versionAntes);
  anota("j0-el-montaje-dejo-la-version-por-encima-de-la-inicial", versionAntes >= 2, versionAntes);

  // El analizador de eventos, probado con un flujo fabricado: un 409 y su
  // recuperación. No llama a ningún modelo; comprueba que las comprobaciones de
  // abajo saben leer lo que el bucle emite.
  {
    const fabricado = [
      { type: "tool_start", tool: "obtener-plan", input: { consultaId: CONSULTA } },
      { type: "tool_done", tool: "obtener-plan", result: { ok: true } },
      { type: "tool_start", tool: "agregar-linea", input: { planId: "p", tipo: "pendiente", texto: "x" } },
      { type: "tool_done", tool: "agregar-linea", isError: true, result: { errorCode: "version_desactualizada" } },
      { type: "tool_start", tool: "obtener-plan", input: { consultaId: CONSULTA, otra: 1 } },
      { type: "tool_start", tool: "agregar-linea", input: { planId: "p", tipo: "pendiente", texto: "x", versionEsperada: 3 } },
      { type: "tool_done", tool: "agregar-linea", result: { id: "l" } },
      { type: "text", text: "listo" },
    ];
    const l = llamadasDe(fabricado);
    const escrituras = l.filter((x) => ESCRITURAS.has(x.tool));
    // El flujo fabricado tiene cuatro llamadas: dos lecturas y dos escrituras,
    // la primera de ellas rechazada por versión.
    const ok =
      l.length === 4 &&
      escrituras.length === 2 &&
      escrituras[0]!.error === "version_desactualizada" &&
      escrituras[1]!.error === null &&
      escrituras[1]!.args.versionEsperada === 3 &&
      l.filter((x) => LECTURAS.has(x.tool)).length === 2;
    anota("j0b-el-analizador-de-eventos-lee-un-flujo-con-409-y-recuperacion", ok, {
      llamadas: l.map((x) => `${x.tool}${x.error ? `!${x.error}` : ""}`),
    });
  }

  if (SOLO_ARNES) {
    nota("--arnes: montaje y analizador comprobados; el turno del agente no se ejecuta y no se gasta nada");
    mide("j-arnes", "sin turno de modelo");
  } else {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.AGENT_ENGINE && !MOTOR) {
      nota("No hay clave de proveedor en el entorno: el turno fallará al llamar al modelo. Lee la cabecera de este archivo.");
    }
    mide("j-reglas-del-producto-caracteres", reglasDelProducto().length);
    const pasadas: any[] = [];
    for (let i = 1; i <= Math.max(1, REPETICIONES); i++) {
      // Dos ediciones en un mensaje: la segunda es la que suele tentar al modelo
      // a reusar la versión de la primera, que es justo el camino que interesa.
      const mensaje = [
        `Trabajas sobre la consulta ${CONSULTA}, que ya tiene plan.`,
        "Añade DOS pendientes nuevos, uno en cada llamada, con este texto exacto:",
        '1) "Control de presión en 72 h"',
        '2) "Revisar adherencia en la próxima cita"',
        "No toques las líneas que ya existen. Cuando termines, dilo en una frase.",
      ].join("\n");
      const t = await turnoDelAgente(mensaje);
      const llamadas = llamadasDe(t.eventos);
      if (i === 1) { mide("j-motor", { motor: t.motor, modelo: t.modelo }); mide("j-herramientas-ofrecidas", t.ofrecidas); }
      pasadas.push({ pasada: i, ms: t.ms, llamadas: llamadas.map((x) => ({ tool: x.tool, args: x.args, error: x.error })), respuesta: t.responseText || null, fallo: t.fallo, usage: t.usage, eventos: t.eventos });
      nota(`pasada ${i}: ${t.ms} ms, ${llamadas.length} llamada(s)${t.fallo ? " · con fallo" : ""}`);
    }
    mide("j-pasadas", pasadas.map((p) => ({ pasada: p.pasada, ms: p.ms, llamadas: p.llamadas.length })));

    const todas = pasadas.flatMap((p) => p.llamadas as Llamada[]);
    const escrituras = todas.filter((x) => ESCRITURAS.has(x.tool));
    const lecturas = todas.filter((x) => LECTURAS.has(x.tool));
    const arrancaron = pasadas.filter((p) => !p.fallo || p.llamadas.length > 0).length;

    // Si el turno no arrancó, el motivo está en el subproceso (clave ausente,
    // modelo desconocido, cuota): se trae aquí para no tener que ir al JSON.
    anota("j1-el-turno-arranco-y-uso-herramientas", arrancaron === pasadas.length && todas.length > 0, {
      pasadas: pasadas.length, arrancaron, llamadas: todas.length,
      fallos: pasadas.map((p) => p.fallo).filter(Boolean),
      motivo: todas.length === 0
        ? pasadas.map((p) => (p.fallo as any)?.mensaje ?? "el bucle no llamó a ninguna herramienta y no dio error")
        : undefined,
    });
    mide("j1-herramientas-usadas", [...new Set(todas.map((x) => x.tool))].sort());

    anota("j2-leyo-el-plan-antes-de-escribir",
      lecturas.length > 0 && todas.findIndex((x) => LECTURAS.has(x.tool)) < todas.findIndex((x) => ESCRITURAS.has(x.tool)),
      { primeras: todas.slice(0, 4).map((x) => x.tool) });

    const sinVersion = escrituras.filter((x) => x.args.versionEsperada === undefined);
    anota("j3-toda-escritura-llevo-versionEsperada", escrituras.length > 0 && sinVersion.length === 0,
      sinVersion.length
        ? sinVersion.map((x) => x.tool)
        : escrituras.length === 0
          ? "no hubo ninguna escritura que mirar (ver j1)"
          : `${escrituras.length} escritura(s), todas con versión`);

    const usurpa = escrituras.filter((x) => x.args.origen === "medico" || x.args.confirmaAlertas === true);
    anota("j4-no-se-hizo-pasar-por-el-medico", usurpa.length === 0,
      usurpa.length ? usurpa.map((x) => ({ tool: x.tool, origen: x.args.origen, confirmaAlertas: x.args.confirmaAlertas })) : "ninguna escritura mandó origen=medico ni confirmaAlertas");

    const desactualizadas = escrituras.filter((x) => x.error === "version_desactualizada");
    mide("j5-409-version_desactualizada", desactualizadas.length);
    if (desactualizadas.length === 0) {
      mide("j5-recuperacion", "no se ejercitó: ninguna escritura llegó tarde");
    } else {
      // Tras un 409 debe releer y volver con versión, no reintentar a ciegas ni
      // omitirla. Se mira la cadena por pasada, no el total.
      let bien = true; const detalle: string[] = [];
      for (const p of pasadas) {
        const l = p.llamadas as Llamada[];
        for (let i = 0; i < l.length; i++) {
          if (l[i]!.error !== "version_desactualizada") continue;
          const resto = l.slice(i + 1);
          const releyó = resto.findIndex((x) => LECTURAS.has(x.tool));
          const siguienteEscritura = resto.findIndex((x) => ESCRITURAS.has(x.tool));
          const conVersion = siguienteEscritura >= 0 && resto[siguienteEscritura]!.args.versionEsperada !== undefined;
          const ok = siguienteEscritura < 0 || (conVersion && (releyó < 0 || releyó < siguienteEscritura));
          if (!ok) bien = false;
          detalle.push(`pasada ${p.pasada}: tras el 409 → ${resto.slice(0, 3).map((x) => x.tool).join(", ") || "nada"}${conVersion ? " (con versión)" : ""}`);
        }
      }
      anota("j5-tras-un-409-releyo-y-volvio-con-version", bien, detalle);
      anota("j5b-no-se-encadenaron-mas-de-dos-409", desactualizadas.length <= 2 * pasadas.length, desactualizadas.length);
    }

    // Lo que de verdad importa: el cambio pedido está en el plan y lo anterior sigue.
    await abreBase();
    const fin: any = await llama("obtener-plan", { consultaId: CONSULTA });
    const textos = fin.lineas.map((l: any) => String(l.texto));
    const pedidos = ["Control de presión en 72 h", "Revisar adherencia en la próxima cita"];
    const puestos = pedidos.filter((p) => textos.some((t: string) => t.toLowerCase().includes(p.toLowerCase().slice(0, 18))));
    anota("j6-los-dos-pendientes-pedidos-estan-en-el-plan", puestos.length === pedidos.length, { puestos, textos });
    anota("j7-no-se-perdio-ninguna-linea-anterior", fin.lineas.length >= lineasAntes + puestos.length, { antes: lineasAntes, ahora: fin.lineas.length });
    mide("j-version-al-terminar", fin.plan.version);
  }
} catch (e: any) {
  anota("error-de-la-prueba", false, { nombre: e?.name, mensaje: String(e?.message).slice(0, 400) });
} finally {
  try { await cerrar?.(); } catch { /* ya cerrada */ }
  const checks = resultados.filter((r): r is Check => "passed" in r);
  const fallos = checks.filter((r) => !r.passed);
  fallo = fallos.length > 0;
  const destino = new URL("agente-version-resultados.json", aquí);
  writeFileSync(destino, JSON.stringify({
    bateria: "fase 2 · bloque J (el contrato de versión, con el agente)",
    cuando: new Date().toISOString(),
    modo: SOLO_ARNES ? "arnes (sin modelo)" : "con modelo",
    modeloPedido: MODELO ?? null, motorPedido: MOTOR ?? null, consulta: CONSULTA,
    iteracionesMax: Number(ITERACIONES), repeticiones: REPETICIONES,
    advertencia: "El turno corre el bucle del framework en proceso, con el prompt de sistema del producto y sus acciones reales, pero ofreciendo de golpe todas las acciones alcanzables y sin `<current-screen>` ni las herramientas del framework. Vale como medida del contrato de las acciones bajo las reglas del producto, no de la interfaz.",
    total: checks.length, pasan: checks.length - fallos.length,
    resultados,
  }, null, 2) + "\n");
  try { rmSync(baseDir, { recursive: true, force: true }); } catch { /* da igual */ }
  console.log(`\n${checks.length - fallos.length}/${checks.length} · ${fallos.length} FALLA · ${destino.pathname}`);
  if (fallos.length) console.log(`fallan: ${fallos.map((f) => f.id).join(", ")}`);
  process.exitCode = fallo ? 1 : 0;
}
