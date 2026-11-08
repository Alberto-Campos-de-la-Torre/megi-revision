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
 *   # 2 · ver qué motores hay registrados y cuál tiene clave en este entorno:
 *   megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/agente-version.mts --motores
 *
 *   # 3 · la prueba de verdad. Cada motor lee su propia variable:
 *   #
 *   #   --motor                 variable
 *   #   anthropic (por defecto) ANTHROPIC_API_KEY   (+ ANTHROPIC_BASE_URL opcional)
 *   #   ai-sdk:anthropic        ANTHROPIC_API_KEY
 *   #   ai-sdk:openai           OPENAI_API_KEY      (+ OPENAI_BASE_URL: con eso
 *   #                                                vale xAI/Grok y cualquier
 *   #                                                compatible con OpenAI)
 *   #   ai-sdk:openrouter       OPENROUTER_API_KEY
 *   #   ai-sdk:google           GOOGLE_GENERATIVE_AI_API_KEY
 *   #   ai-sdk:groq             GROQ_API_KEY
 *   #   ai-sdk:mistral          MISTRAL_API_KEY
 *   #   ai-sdk:cohere           COHERE_API_KEY
 *   #   ai-sdk:ollama           OLLAMA_BASE_URL     (local, sin clave)
 *   #   builder                 BUILDER_PUBLIC_KEY + BUILDER_PRIVATE_KEY
 *   #
 *   export GOOGLE_GENERATIVE_AI_API_KEY=...        # el que sea
 *   megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/agente-version.mts \
 *     --motor ai-sdk:google --repeticiones 3
 *
 *   # 4 · Grok (xAI) tiene atajo: `--motor grok` usa el motor compatible con
 *   #     OpenAI apuntando a https://api.x.ai/v1 y el modelo del despliegue
 *   #     del proyecto. La clave se introduce sin dejarla en el historial:
 *   megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/agente-version.mts \
 *     --motor grok --pedir-clave --repeticiones 3
 *   #     o desde un archivo, para no teclearla cada vez:
 *   megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/agente-version.mts \
 *     --motor grok --clave-archivo ~/.config/xai.key
 *
 * La clave NO se acepta como argumento a propósito: la línea de órdenes se ve
 * en `ps` y se queda en el historial. Se registra como secreto y se tapa en la
 * salida y en el JSON; no se escribe en ningún archivo.
 *
 * La clave tiene que venir del entorno o de `megi-revision/.env`: las que estén
 * guardadas en Ajustes > Agente de la app no sirven, porque esta prueba corre
 * contra una base de datos desechable y no ve esa configuración.
 *
 * Opcionales: `--motores` (lista los motores y cuál tiene clave aquí),
 * `--pedir-clave`, `--clave-archivo <ruta>`, `--eventos-crudos` (añade al JSON
 * los eventos del bucle, no solo las llamadas),
 * `--modelo <nombre>`, `--motor <nombre>`, `--iteraciones <n>`,
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
import { createInterface } from "node:readline";
import { inspect } from "node:util";
import { pathToFileURL } from "node:url";

// ─────────────────────────────── argumentos ───────────────────────────────
const argv = process.argv.slice(2);
const bandera = (n: string) => argv.includes(`--${n}`);
const opcion = (n: string, pordefecto?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : pordefecto;
};
const SOLO_ARNES = bandera("arnes");
const SOLO_MOTORES = bandera("motores");
const PEDIR_CLAVE = bandera("pedir-clave");
const CLAVE_ARCHIVO = opcion("clave-archivo");

/**
 * Atajos de proveedor. xAI (Grok) habla el protocolo de OpenAI, así que va por
 * el motor `ai-sdk:openai` con la URL cambiada: es la misma configuración que
 * usa el despliegue del proyecto (`OPENAI_BASE_URL=https://api.x.ai/v1`).
 */
const ATAJOS: Record<string, { motor: string; modelo: string; baseUrl?: string; host?: string }> = {
  grok: { motor: "ai-sdk:openai", modelo: "grok-4.20-0309-non-reasoning", baseUrl: "https://api.x.ai/v1", host: "api.x.ai" },
  xai: { motor: "ai-sdk:openai", modelo: "grok-4.20-0309-non-reasoning", baseUrl: "https://api.x.ai/v1", host: "api.x.ai" },
};

/** Qué variable mira cada motor del framework; sirve para el aviso y para `--motores`. */
const CLAVES: Array<[string, string[]]> = [
  ["anthropic", ["ANTHROPIC_API_KEY"]],
  ["ai-sdk:anthropic", ["ANTHROPIC_API_KEY"]],
  ["ai-sdk:openai", ["OPENAI_API_KEY"]],
  ["ai-sdk:openrouter", ["OPENROUTER_API_KEY"]],
  ["ai-sdk:google", ["GOOGLE_GENERATIVE_AI_API_KEY"]],
  ["ai-sdk:groq", ["GROQ_API_KEY"]],
  ["ai-sdk:mistral", ["MISTRAL_API_KEY"]],
  ["ai-sdk:cohere", ["COHERE_API_KEY"]],
  ["ai-sdk:ollama", ["OLLAMA_BASE_URL"]],
  ["builder", ["BUILDER_PUBLIC_KEY", "BUILDER_PRIVATE_KEY"]],
];
const conClave = () =>
  CLAVES.filter(([, vars]) => vars.every((v) => (process.env[v] ?? "").trim() !== "")).map(([m]) => m);

/**
 * Introducir la clave sin dejarla por ahí.
 *
 * NO se acepta como argumento: la línea de órdenes se ve en `ps` y se queda en
 * el historial del shell. Es la norma que ya sigue `evidencia/modelos-xai.mjs`
 * («never print, persist or accept a credential on the command line»). Caminos:
 *   · la variable del motor, ya puesta en el entorno o en `megi-revision/.env`;
 *   · `--clave-archivo <ruta>`: se lee la primera línea y no se guarda nada;
 *   · `--pedir-clave`: la pide por teclado, sin eco.
 * En los tres casos el valor se registra como secreto y se tapa en la salida y
 * en el JSON de resultados.
 */
async function porTeclado(etiqueta: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Sin terminal (tubería, CI): se lee una línea tal cual, sin prometer eco apagado.
    const rl = createInterface({ input: process.stdin });
    const it = rl[Symbol.asyncIterator]();
    const { value } = await it.next();
    rl.close();
    return String(value ?? "").trim();
  }
  process.stdout.write(`${etiqueta}: `);
  const rl: any = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = () => {}; // sin eco: no se ve lo que se teclea
  const valor: string = await new Promise((res) => rl.question("", (r: string) => res(r)));
  rl.close();
  process.stdout.write("\n");
  return valor.trim();
}

/** De dónde salió la clave que se acabó usando; va al informe. */
let fuenteClave = "ninguna";

/** Deja en el entorno la clave que necesita el motor elegido. */
async function configuraClave() {
  if (ATAJO?.baseUrl && !(process.env.OPENAI_BASE_URL ?? "").trim()) {
    process.env.OPENAI_BASE_URL = ATAJO.baseUrl;
    nota(`${MOTOR_PEDIDO}: usando ${ATAJO.baseUrl} por el motor ${ATAJO.motor}`);
  }
  if (ATAJO?.host) {
    // Antes de mandar nada: que el endpoint sea el que se espera, como comprueba
    // el propio guion de modelos del proyecto.
    const u = new URL(process.env.OPENAI_BASE_URL!);
    if (u.protocol !== "https:" || u.hostname !== ATAJO.host) {
      throw new Error(`OPENAI_BASE_URL apunta a ${u.protocol}//${u.hostname} y para ${MOTOR_PEDIDO} se espera https://${ATAJO.host}: no se envía la clave`);
    }
  }
  const vars = CLAVES.find(([m]) => m === (MOTOR ?? "anthropic"))?.[1] ?? [];
  for (const v of vars) recuerdaSecreto(process.env[v]);
  const yaPuestas = vars.filter((v) => (process.env[v] ?? "").trim() !== "");
  // Lo que se pide a mano MANDA sobre lo que ya hubiera en el entorno o en el
  // `.env`. Antes solo preguntaba si el valor faltaba, y una clave vieja
  // exportada en la sesión se usaba en silencio: la prueba decía «hay clave» sin
  // haber pedido nada y fallaba con «Incorrect API key provided» sin que se
  // viera de dónde salía.
  const aPoner = PEDIR_CLAVE || CLAVE_ARCHIVO ? vars : vars.filter((v) => !yaPuestas.includes(v));
  if (!aPoner.length) {
    fuenteClave = yaPuestas.length ? "el entorno o megi-revision/.env" : "ninguna";
    if (yaPuestas.length) nota(`clave tomada de ${fuenteClave} para ${yaPuestas.join(", ")}`);
    return;
  }
  if (CLAVE_ARCHIVO) {
    const leido = readFileSync(CLAVE_ARCHIVO, "utf8").split("\n")[0]!.trim();
    if (!leido) throw new Error(`${CLAVE_ARCHIVO} está vacío`);
    for (const v of aPoner) process.env[v] = leido;
    recuerdaSecreto(leido);
    fuenteClave = CLAVE_ARCHIVO;
    nota(`clave leída de ${CLAVE_ARCHIVO} para ${aPoner.join(", ")}${yaPuestas.length ? " (ignorando la que ya había en el entorno)" : ""}`);
    return;
  }
  for (const v of aPoner) {
    const valor = await porTeclado(`Clave para ${v} (no se verá al teclear)`);
    if (!valor) throw new Error(`No se introdujo ${v}`);
    process.env[v] = valor;
    recuerdaSecreto(valor);
  }
  fuenteClave = "el teclado";
  nota(`clave introducida por teclado para ${aPoner.join(", ")}${yaPuestas.length ? " (ignorando la que ya había en el entorno)" : ""}; solo vive en este proceso`);
}
const CONSULTA = opcion("consulta", "demo-c2")!;
const ITERACIONES = opcion("iteraciones", "14")!;
const REPETICIONES = Number(opcion("repeticiones", "1"));
const MOTOR_PEDIDO = opcion("motor");
const ATAJO = MOTOR_PEDIDO ? ATAJOS[MOTOR_PEDIDO.toLowerCase()] : undefined;
const MOTOR = ATAJO?.motor ?? MOTOR_PEDIDO;
const MODELO = opcion("modelo") ?? process.env.AGENT_MODEL ?? ATAJO?.modelo;

const aquí = new URL(".", import.meta.url);
const APP = new URL("../../megi-revision/", aquí);
const req = createRequire(new URL("package.json", APP));
const baseDir = mkdtempSync(join(tmpdir(), "fase2-agente-"));
const DATABASE_URL = `pglite:${join(baseDir, "db")}`;

// ───────────────────── la clave: nunca se imprime ni se guarda ────────────
/** Valores que no deben aparecer en pantalla ni en el JSON de resultados. */
const secretos = new Set<string>();
function tapa<T>(v: T): T {
  if (typeof v === "string") {
    let s = v;
    for (const x of secretos) if (x.length >= 8) s = s.split(x).join("«clave tapada»");
    return s as T;
  }
  if (Array.isArray(v)) return v.map(tapa) as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = tapa(x);
    return o as T;
  }
  return v;
}
function recuerdaSecreto(s: string | undefined) {
  const v = (s ?? "").trim();
  if (v.length >= 8) secretos.add(v);
}

// ─────────────────────────────── anotación ────────────────────────────────
type Check = { id: string; passed: boolean; detail: unknown };
const resultados: Array<Check | { id: string; medicion: unknown }> = [];
function anota(id: string, pasa: boolean, detalle?: unknown) {
  const d = tapa(detalle ?? null);
  resultados.push({ id, passed: !!pasa, detail: d });
  console.log(`${pasa ? "PASA " : "FALLA"} ${id}${detalle === undefined ? "" : `: ${String(JSON.stringify(d)).slice(0, 240)}`}`);
}
function mide(id: string, valor: unknown) {
  const v = tapa(valor);
  resultados.push({ id, medicion: v });
  console.log(`MIDE  ${id}: ${String(JSON.stringify(v)).slice(0, 240)}`);
}
function nota(t: string) { console.log(`  ⓘ   ${tapa(t)}`); }

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
    // El código puede venir como campo (`errorCode`) o solo dentro del texto que
    // el bucle entrega al modelo. Medido con un modelo real: diez rechazos por
    // pasada se contaban como uno porque el `done` no traía ni `isError` ni el
    // campo, solo el mensaje. Por eso también se buscan los códigos conocidos.
    const m =
      /"errorCode"\s*:\s*"([a-z_]+)"/.exec(texto) ??
      new RegExp(`\\b(${[...CODIGOS].join("|")})\\b`).exec(texto);
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
    // El modelo entrega los argumentos por partes: el bucle emite varios eventos
    // de apertura para la MISMA llamada, los primeros con los argumentos a medias
    // o vacíos y el último completo. Medido con un modelo real: cada llamada
    // aparecía cuatro veces y las tres primeras, sin `versionEsperada`, se
    // contaban como escrituras que omitían la versión. Eran fragmentos de una
    // sola llamada que sí la llevaba.
    const previa = salida[salida.length - 1];
    const esFragmentoDeLaPrevia =
      previa &&
      previa.tool === tool &&
      !previa.cerrada &&
      previa.error === null &&
      Object.keys(args).length >= Object.keys(previa.args).length &&
      Object.entries(previa.args).every(([k, v]) => JSON.stringify(args[k]) === JSON.stringify(v));
    if (esFragmentoDeLaPrevia) {
      previa.args = args;         // se queda el fragmento más completo
      previa.crudo.push(e);
      continue;
    }
    salida.push({ tool, args, error: m?.[1] ?? (esError ? "error" : null), cerrada: false, crudo: [e] });
  }
  return salida;
}

/**
 * Códigos de error de la mesa. Se usan para reconocer un rechazo cuando el
 * evento solo trae el mensaje y no el campo `errorCode`.
 */
const CODIGOS = new Set([
  "version_desactualizada", "fuera_de_alcance", "linea_bloqueada", "plan_cerrado",
  "plan_existente", "plan_demasiado_largo", "alertas_sin_confirmar", "solo_medico",
  "sin_rol_clinico", "credenciales_no_disponibles", "medicacion_sin_conciliar",
  "megi_no_disponible", "verificador_invalido", "not_found", "invalid_input",
  "consulta_cerrada", "medicion_en_curso", "plan_no_visible", "megi_rechazo",
  "verificacion_incompleta", "pagina_inconsistente",
]);

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

/**
 * Lo que dijo el proveedor, que es lo único que distingue «clave mala» de
 * «modelo que no existe» o «cuota agotada».
 *
 * El `EngineError` del framework se queda en «Bad Request» con `statusCode`;
 * el cuerpo de la respuesta viaja más abajo, en la cadena de `cause`. Sin esto,
 * un fallo de clave y uno de modelo son indistinguibles en la salida.
 */
function delProveedor(e: unknown, registro = ""): unknown {
  const visto = new Set<unknown>();
  let x: any = e;
  for (let i = 0; i < 8 && x && typeof x === "object" && !visto.has(x); i++) {
    visto.add(x);
    const cuerpo = x.responseBody ?? x.body ?? x.data;
    if (typeof cuerpo === "string" && cuerpo.trim()) {
      return { estado: x.statusCode ?? x.status ?? null, url: typeof x.url === "string" ? x.url : null, cuerpo: cuerpo.slice(0, 400) };
    }
    x = x.cause;
  }
  // El framework imprime el error del proveedor pero no lo adjunta al suyo, así
  // que se rescata del registro capturado durante el turno.
  const a: any = e;
  const estado = a?.statusCode ?? a?.status ?? null;
  const m =
    /responseBody:\s*'([^']{0,400})'/.exec(registro) ??
    /"error"\s*:\s*"([^"]{0,300})"/.exec(registro) ??
    /"message"\s*:\s*"([^"]{0,300})"/.exec(registro);
  if (m) return { estado, cuerpo: m[1] };
  return estado ? { estado, cuerpo: null } : null;
}

/**
 * Captura lo que el framework escribe durante el turno. Se restaura siempre, se
 * limita de tamaño y se tapa la clave antes de guardarlo: es el único sitio
 * donde aparece el motivo real de un rechazo del proveedor.
 *
 * Durante el turno la salida normal del framework no se reenvía a pantalla, para
 * que el informe de la prueba quede legible; el registro se muestra solo si algo
 * falla. Lo que va a stderr sí se deja pasar, por si hay un aviso que importe.
 */
function capturaRegistro() {
  const trozos: string[] = [];
  let total = 0;
  const guarda = (s: unknown) => {
    const txt = tapa(String(s));
    if (total < 20_000) { trozos.push(txt); total += txt.length; }
  };
  const consolaOriginal = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const errWrite = process.stderr.write.bind(process.stderr);
  const outWrite = process.stdout.write.bind(process.stdout);
  for (const k of ["log", "error", "warn", "info"] as const) {
    console[k] = (...args: unknown[]) => { for (const a of args) guarda(typeof a === "string" ? a : inspect(a, { depth: 4 })); };
  }
  process.stderr.write = ((c: any, ...r: any[]) => { guarda(c); return errWrite(c, ...r); }) as any;
  process.stdout.write = ((c: any, ...r: any[]) => { guarda(c); return true; }) as any;
  return {
    suelta() {
      Object.assign(console, consolaOriginal);
      process.stderr.write = errWrite as any;
      process.stdout.write = outWrite as any;
      return trozos.join("\n");
    },
  };
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
  const captura = capturaRegistro();
  let registro = "";
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
    registro = captura.suelta();
    fallo = { nombre: e?.name, mensaje: String(e?.message).slice(0, 600), proveedor: delProveedor(e, registro) };
  } finally {
    if (!registro) registro = captura.suelta();
  }
  return {
    ms: Date.now() - t0, eventos, responseText, usage, fallo,
    motor: engine?.name ?? null, modelo: model ?? null,
    ofrecidas: tools.map((x: any) => x.name).sort(),
  };
}

// ═══════════════════════════════ la prueba ═════════════════════════════════
/** Lo que se guardará en el JSON como evidencia cruda. */
let crudas: unknown[] = [];

let fallo = false;
try {
  if (SOLO_MOTORES) {
    const f = await cargaBucle();
    const lista = (f.listAgentEngines?.() ?? []).map((e: any) => e?.engine ?? e);
    const listos = new Set(conClave());
    console.log("Motores registrados por el framework (· = tiene su variable puesta aquí):\n");
    for (const e of lista) {
      const nombre = String(e?.name ?? "?");
      const vars = CLAVES.find(([m]) => m === nombre)?.[1] ?? [];
      console.log(`  ${listos.has(nombre) ? "·" : " "} ${nombre.padEnd(22)} ${String(e?.defaultModel ?? "—").padEnd(26)} ${vars.join(" + ") || "(sin variable conocida)"}`);
    }
    console.log("\nSe elige con --motor <nombre>, y el modelo con --modelo <nombre>.");
    process.exitCode = 0;
    // No se monta base ni se escribe JSON: es solo una consulta.
    process.exit(0);
  }
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
      // Los tres primeros son fragmentos de UNA llamada: así llega del modelo.
      { type: "tool_start", tool: "obtener-plan", input: {} },
      { type: "tool_start", tool: "obtener-plan", input: {} },
      { type: "tool_start", tool: "obtener-plan", input: { consultaId: CONSULTA } },
      { type: "tool_done", tool: "obtener-plan", result: { ok: true } },
      { type: "tool_start", tool: "agregar-linea", input: { planId: "p", tipo: "pendiente", texto: "x" } },
      { type: "tool_done", tool: "agregar-linea", isError: true, result: { errorCode: "version_desactualizada" } },
      // Un rechazo que solo trae el mensaje, sin `isError` ni `errorCode`: es la
      // forma que se vio con un modelo real y la que antes no se contaba.
      { type: "tool_start", tool: "agregar-linea", input: { planId: "p", tipo: "pendiente", texto: "x" } },
      { type: "tool_done", tool: "agregar-linea", result: "Falta versionEsperada: es obligatoria… (version_desactualizada)" },
      { type: "tool_start", tool: "obtener-plan", input: { consultaId: CONSULTA, otra: 1 } },
      { type: "tool_start", tool: "agregar-linea", input: { planId: "p", tipo: "pendiente", texto: "x", versionEsperada: 3 } },
      { type: "tool_done", tool: "agregar-linea", result: { id: "l" } },
      { type: "text", text: "listo" },
    ];
    const l = llamadasDe(fabricado);
    const escrituras = l.filter((x) => ESCRITURAS.has(x.tool));
    // El flujo fabricado tiene cinco llamadas: dos lecturas y tres escrituras,
    // las dos primeras rechazadas por versión —una con `errorCode`, la otra solo
    // con el mensaje— y la tercera buena.
    const ok =
      l.length === 5 &&
      escrituras.length === 3 &&
      escrituras[0]!.error === "version_desactualizada" &&
      escrituras[1]!.error === "version_desactualizada" && // reconocido solo por el mensaje
      escrituras[2]!.error === null &&
      escrituras[2]!.args.versionEsperada === 3 &&
      l.filter((x) => LECTURAS.has(x.tool)).length === 2;
    anota("j0b-el-analizador-de-eventos-lee-un-flujo-con-409-y-recuperacion", ok, {
      llamadas: l.map((x) => `${x.tool}${x.error ? `!${x.error}` : ""}`),
    });
  }

  // El tapado de la clave es una afirmación de seguridad, así que se comprueba
  // en vez de prometerse: se registra un secreto de juguete y se mira que no
  // sobreviva ni en una cadena ni dentro de un objeto anidado.
  {
    const juguete = "clave-de-juguete-para-comprobar-el-tapado";
    recuerdaSecreto(juguete);
    const anidado = tapa({ a: [{ b: `Authorization: Bearer ${juguete}` }], c: juguete });
    const plano = tapa(`la clave era ${juguete} y no debe verse`);
    const serializado = JSON.stringify(anidado) + plano;
    secretos.delete(juguete);
    anota(
      "j0c-la-clave-no-sobrevive-en-la-salida-ni-en-el-json",
      !serializado.includes(juguete) && serializado.includes("clave tapada"),
      serializado.includes(juguete) ? "se filtró" : "tapada en cadena y en objeto anidado",
    );
  }

  if (SOLO_ARNES) {
    nota("--arnes: montaje y analizador comprobados; el turno del agente no se ejecuta y no se gasta nada");
    mide("j-arnes", "sin turno de modelo");
  } else {
    await configuraClave();
    const listos = conClave();
    if (listos.length) nota(`motores con clave disponible: ${listos.join(", ")}`);
    else nota(`No hay clave de ningún proveedor. Miré: ${[...new Set(CLAVES.flatMap(([, v]) => v))].join(", ")}. Pásala con --pedir-clave o --clave-archivo, o ponla en el entorno; --motores lista los motores.`);
    if (MOTOR && !listos.includes(MOTOR) && MOTOR !== "ai-sdk:ollama") {
      nota(`Pediste --motor ${MOTOR} y no veo su variable puesta: si falla, es por eso.`);
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
      if (i === 1) { mide("j-motor", { motor: t.motor, modelo: t.modelo, claveTomadaDe: fuenteClave }); mide("j-herramientas-ofrecidas", t.ofrecidas); }
      pasadas.push({ pasada: i, ms: t.ms, llamadas: llamadas.map((x) => ({ tool: x.tool, args: x.args, error: x.error })), respuesta: t.responseText || null, fallo: t.fallo, usage: t.usage, eventos: t.eventos });
      nota(`pasada ${i}: ${t.ms} ms, ${llamadas.length} llamada(s)${t.fallo ? " · con fallo" : ""}`);
      // Si el proveedor rechaza la credencial o el modelo, repetir no aporta
      // nada: se corta y se dice qué pasa, en vez de gastar tres veces lo mismo.
      const cuerpo = String((t.fallo as any)?.proveedor?.cuerpo ?? "");
      const credencial = /api key|unauthorized|forbidden|invalid.?argument|does not exist|not found|quota|rate limit/i.test(cuerpo);
      if (llamadas.length === 0 && credencial) {
        nota(`el proveedor rechazó la petición y no se intentan más pasadas. Clave tomada de: ${fuenteClave}. Dijo: ${cuerpo.slice(0, 200)}`);
        break;
      }
    }
    mide("j-pasadas", pasadas.map((p) => ({ pasada: p.pasada, ms: p.ms, llamadas: p.llamadas.length })));
    crudas = pasadas.map((p) => ({
      pasada: p.pasada, ms: p.ms, fallo: p.fallo, usage: p.usage,
      respuesta: typeof p.respuesta === "string" ? p.respuesta.slice(0, 2000) : null,
      llamadas: p.llamadas,
      ...(bandera("eventos-crudos") ? { eventos: (p.eventos as unknown[]).slice(0, 400) } : {}),
    }));

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
        ? pasadas.map((p) => {
            const f = p.fallo as any;
            if (!f) return "el bucle no llamó a ninguna herramienta y no dio error";
            const prov = f.proveedor?.cuerpo ? ` · el proveedor dijo: ${f.proveedor.cuerpo}` : "";
            return `${f.mensaje}${f.proveedor?.estado ? ` (${f.proveedor.estado})` : ""}${prov}`;
          })
        : undefined,
    });
    mide("j1-herramientas-usadas", [...new Set(todas.map((x) => x.tool))].sort());

    anota("j2-leyo-el-plan-antes-de-escribir",
      lecturas.length > 0 && todas.findIndex((x) => LECTURAS.has(x.tool)) < todas.findIndex((x) => ESCRITURAS.has(x.tool)),
      { primeras: todas.slice(0, 4).map((x) => x.tool) });

    const sinVersion = escrituras.filter((x) => x.args.versionEsperada === undefined);
    const resumeArgs = (x: Llamada) => `${x.tool}(${Object.keys(x.args).sort().join(",") || "sin argumentos"})${x.error ? ` → ${x.error}` : ""}`;
    anota("j3-toda-escritura-llevo-versionEsperada", escrituras.length > 0 && sinVersion.length === 0,
      sinVersion.length
        ? { cuantas: sinVersion.length, de: escrituras.length, ejemplos: [...new Set(sinVersion.map(resumeArgs))].slice(0, 6) }
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

    // Cuántas pasadas llegaron a terminar. j6 mira el estado final, que es
    // acumulado: con que una pasada haga el trabajo, queda en verde. Esto
    // enseña la tasa, que es lo que importa de una conducta que varía.
    const porPasada = pasadas.map((p) => {
      const l = p.llamadas as Llamada[];
      const esc = l.filter((x) => ESCRITURAS.has(x.tool));
      return {
        pasada: p.pasada,
        llamadas: l.length,
        escrituras: esc.length,
        aplicadas: esc.filter((x) => !x.error).length,
        rechazos: esc.filter((x) => x.error).map((x) => x.error),
      };
    });
    mide("j8-por-pasada", porPasada);
    const completas = porPasada.filter((x) => x.aplicadas >= 2).length;
    mide("j8-pasadas-que-aplicaron-los-dos-pendientes", `${completas} de ${porPasada.length}`);

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
    modeloPedido: MODELO ?? null, motorPedido: MOTOR ?? null, atajo: MOTOR_PEDIDO && ATAJO ? MOTOR_PEDIDO : null, consulta: CONSULTA,
    iteracionesMax: Number(ITERACIONES), repeticiones: REPETICIONES,
    advertencia: "El turno corre el bucle del framework en proceso, con el prompt de sistema del producto y sus acciones reales, pero ofreciendo de golpe todas las acciones alcanzables y sin `<current-screen>` ni las herramientas del framework. Vale como medida del contrato de las acciones bajo las reglas del producto, no de la interfaz.",
    total: checks.length, pasan: checks.length - fallos.length,
    resultados: tapa(resultados),
    // La evidencia cruda, que es lo que permite auditar lo que el analizador no
    // viera: cada llamada con sus argumentos y su error, pasada por pasada. Los
    // eventos del bucle, solo con `--eventos-crudos`, porque abultan mucho.
    pasadas: tapa(crudas),
  }, null, 2) + "\n");
  try { rmSync(baseDir, { recursive: true, force: true }); } catch { /* da igual */ }
  console.log(`\n${checks.length - fallos.length}/${checks.length} · ${fallos.length} FALLA · ${destino.pathname}`);
  if (fallos.length) console.log(`fallan: ${fallos.map((f) => f.id).join(", ")}`);
  process.exitCode = fallo ? 1 : 0;
}
