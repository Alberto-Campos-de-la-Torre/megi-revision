/**
 * Batería 2 · bloque I — qué puede llamar el agente, de verdad.
 *
 * `server/plugins/agent-chat.ts` declara ocho `initialToolNames`. Eso no era una
 * lista blanca: `filterInitialEngineTools` del framework añade siempre
 * `tool-search`, y con esa herramienta el agente podía cargar cualquier acción
 * del registro estático — las del dominio y las noventa y una de la plantilla.
 * Desde el 8-nov sí hay lista blanca: `resolveActionSurface` recorta el
 * registro con `server/lib/alcance-agente.ts`, y este bloque mide las dos
 * caras: cuánto ofrece el registro y cuánto sobrevive al recorte. Lo mismo,
 * medido sobre la petición que de verdad sale al proveedor, está en
 * `interfaz-y-modelo.mts --motor falso --escenario busqueda`.
 *
 * Este bloque inventaría el registro real y clasifica cada acción: ¿la ve el
 * agente?, ¿escribe?, ¿exige la interfaz?, ¿toca secretos, compartición,
 * usuarios, banderas o la terminal? El resultado es un número, no una
 * impresión: cuántas acciones quedan al alcance de una inyección de prompt.
 *
 * Uso:
 *   megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/catalogo.mts
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const dir = process.env.APP_MEGI_REVISION ?? "../../megi-revision/";
const app = dir.startsWith("/")
  ? pathToFileURL(dir.endsWith("/") ? dir : `${dir}/`)
  : new URL(dir, import.meta.url);
process.env.DATABASE_URL = "pglite:memory://";
process.env.MEGI_MODE = "mock";

const registro: any = (await import(new URL(".generated/actions-registry.ts", app).href))
  .default;

/**
 * La lista de permitidos del propio producto, no una copia.
 *
 * `resolveActionSurface` del chat recorta el registro antes de que viaje al
 * modelo (`server/lib/alcance-agente.ts`). Medir el registro a secas decía
 * «noventa y una acciones al alcance» cuando ya no lo están; medir solo lo
 * filtrado escondería el registro entero detrás de un filtro. Así que aquí se
 * miden las dos cosas: lo que el registro ofrece y lo que el filtro deja pasar.
 */
const { alcanceDelAgente } = await import(new URL("server/lib/alcance-agente.ts", app).href);

const resultados: any[] = [];
function anota(id: string, pasa: boolean, detalle?: unknown) {
  resultados.push({ id, passed: !!pasa, detail: detalle ?? null });
  console.log(
    `${pasa ? "PASA " : "FALLA"} ${id}${detalle === undefined ? "" : `: ${JSON.stringify(detalle)?.slice(0, 260)}`}`,
  );
}
function mide(id: string, valor: unknown) {
  resultados.push({ id, medicion: valor });
  console.log(`MIDE  ${id}: ${JSON.stringify(valor)?.slice(0, 260)}`);
}

// ── el registro, normalizado ────────────────────────────────────────────────
const entradas: Array<{
  nombre: string;
  uiOnly: boolean;
  agentTool: boolean | undefined;
  readOnly: boolean;
  tieneAuthorize: boolean;
  necesitaAprobacion: boolean;
}> = [];
for (const [clave, mod] of Object.entries<any>(registro)) {
  const a = mod?.default ?? mod;
  if (!a || typeof a !== "object") continue;
  const nombre = a.name ?? clave;
  entradas.push({
    nombre,
    uiOnly: a.uiOnly === true,
    agentTool: a.agentTool,
    readOnly: a.readOnly === true,
    tieneAuthorize: typeof a.authorize === "function",
    necesitaAprobacion: typeof a.needsApproval === "function" || a.needsApproval === true,
  });
}
entradas.sort((x, y) => x.nombre.localeCompare(y.nombre));

/**
 * Las acciones propias de la mesa son los archivos de `actions/`; el resto del
 * registro viene de la plantilla. Se lee del directorio y no de una lista
 * escrita a mano: así una acción nueva entra sola en las comprobaciones de I5
 * —que es donde se mira si una escritura lleva freno— en vez de quedarse fuera
 * sin que nadie se dé cuenta. (Era una lista de ocho; el cierre del 7-nov
 * añadió diez acciones que esa lista no veía.)
 *
 * Se descuentan las tres que vienen con la plantilla y también viven en
 * `actions/`: `navigate` y `run` no guardan nada —`navigate` mueve la pantalla y
 * por eso no declara freno— y `view-screen` es de lectura. Si la plantilla trae
 * una cuarta, aparecerá aquí sin freno, que es la señal que se quiere.
 */
const DE_LA_PLANTILLA = new Set(["navigate", "run", "view-screen"]);
const PROPIAS = readdirSync(new URL("actions/", app))
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
  .map((f) => f.replace(/\.ts$/, ""))
  .filter((n) => !DE_LA_PLANTILLA.has(n))
  .sort();
const INICIALES = (() => {
  const txt = readFileSync(new URL("server/plugins/agent-chat.ts", app), "utf8");
  const m = txt.match(/INITIAL_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]/);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
})();

mide("i0-acciones-en-el-registro", entradas.length);
mide("i0-acciones-propias-de-la-mesa", PROPIAS.length);
mide("i0-herramientas-iniciales-declaradas", INICIALES);

// I1 · el agente no arranca con la aprobación final.
anota(
  "i1-aprobar-plan-no-esta-entre-las-iniciales",
  !INICIALES.includes("aprobar-plan"),
  INICIALES.includes("aprobar-plan") ? "está" : "no está",
);
const aprobar = entradas.find((e) => e.nombre === "aprobar-plan");
anota(
  "i1b-aprobar-plan-es-uiOnly-y-no-es-herramienta",
  !!aprobar?.uiOnly && aprobar?.agentTool === false,
  aprobar,
);

// I2 · ¿el resto del registro queda fuera del alcance del agente?
// `tool-search` se añade siempre, así que «fuera de las iniciales» no es
// «fuera de alcance»: solo lo son uiOnly o agentTool:false.
const delRegistro = entradas.filter(
  (e) => !e.uiOnly && e.agentTool !== false && !INICIALES.includes(e.nombre),
);
// Lo que el recorte del producto deja pasar, calculado con su propia función.
const permitidas = new Set<string>(
  alcanceDelAgente(entradas.map((e) => e.nombre)).permitidas,
);
/**
 * Las ayudas del framework que el recorte deja pasar: leen, preguntan o
 * sugieren. Se nombran aquí para que una nueva no entre sin que se note.
 */
const AYUDAS = new Set(["docs-search", "ask-question", "suggest-follow-ups", "tool-search",
  "resources", "framework-search", "get-framework-context", "view-screen"]);
const deLaMesa = (n: string) => PROPIAS.includes(n) || AYUDAS.has(n);
const alcanzables = delRegistro.filter((e) => permitidas.has(e.nombre));
const cerradas = delRegistro.filter((e) => !permitidas.has(e.nombre));
const escriben = alcanzables.filter((e) => !e.readOnly);
mide("i2-en-el-registro-fuera-de-las-iniciales", delRegistro.length);
mide("i2-cerradas-por-el-recorte-del-producto", cerradas.length);
mide("i2-alcanzables-por-tool-search-tras-el-recorte", alcanzables.map((e) => e.nombre));
mide("i2-de-esas-que-escriben", escriben.length);
anota(
  "i2-el-agente-clinico-solo-alcanza-la-mesa",
  alcanzables.every((e) => deLaMesa(e.nombre)),
  alcanzables.every((e) => deLaMesa(e.nombre))
    ? `${alcanzables.length} alcanzables, todas de la mesa; el recorte cerró ${cerradas.length}`
    : `ajenas a la mesa aún alcanzables: ${alcanzables.filter((e) => !deLaMesa(e.nombre)).map((e) => e.nombre).join(", ")}`,
);

// I3 · de lo alcanzable, qué toca cosas delicadas.
const DELICADAS: Array<[string, RegExp]> = [
  ["secretos y claves", /secret|api-key|credential|provider-key|token/i],
  ["compartición y acceso", /share|unshare|resource-access|public|invite/i],
  ["usuarios y organización", /member|offboard|user-group|org-|workspace-user/i],
  ["banderas y laboratorio", /feature-flag|^set-lab$|launchdarkly/i],
  ["terminal y código", /^run$|run-code|terminal|script|deploy/i],
  ["correo y mensajería", /email|messaging|slack|notification/i],
];
const porGrupo: Record<string, string[]> = {};
for (const [etiqueta, re] of DELICADAS) {
  porGrupo[etiqueta] = alcanzables
    .filter((e) => re.test(e.nombre) && !e.readOnly)
    .map((e) => e.nombre);
}
mide("i3-alcanzables-delicadas-por-grupo", porGrupo);
const totalDelicadas = Object.values(porGrupo).flat().length;
anota(
  "i3-nada-delicado-al-alcance-del-agente",
  totalDelicadas === 0,
  totalDelicadas
    ? `${totalDelicadas} acciones de escritura delicadas alcanzables: ${Object.values(porGrupo).flat().slice(0, 8).join(", ")}…`
    : "ninguna",
);

// I4 · las que escriben sin `authorize` ni aprobación: nada les pregunta.
const sinFreno = escriben.filter((e) => !e.tieneAuthorize && !e.necesitaAprobacion);
mide("i4-escriben-sin-authorize-ni-aprobacion", sinFreno.length);
anota(
  "i4-toda-escritura-alcanzable-tiene-algun-freno",
  sinFreno.length === 0,
  sinFreno.length
    ? `${sinFreno.length} sin authorize ni needsApproval: ${sinFreno.slice(0, 8).map((e) => e.nombre).join(", ")}…`
    : "todas con authorize o needsApproval",
);

// I5 · las del dominio sí llevan freno donde toca, todas, también las nuevas.
const propias = entradas.filter((e) => PROPIAS.includes(e.nombre));
const propiasEscriben = propias.filter((e) => !e.readOnly);
anota(
  "i5-las-escrituras-del-dominio-tienen-freno",
  propiasEscriben.every((e) => e.uiOnly || e.necesitaAprobacion),
  propiasEscriben.map((e) => ({
    n: e.nombre,
    uiOnly: e.uiOnly,
    aprobacion: e.necesitaAprobacion,
  })),
);
anota(
  "i5b-las-lecturas-del-dominio-estan-marcadas-readOnly",
  propias.filter((e) => !propiasEscriben.includes(e)).every((e) => e.readOnly),
  propias.filter((e) => e.readOnly).map((e) => e.nombre),
);

const checks = resultados.filter((r) => "passed" in r);
const fallos = checks.filter((r) => !r.passed);
const salida = {
  bateria: "fase 2 · bloque I (qué puede llamar el agente)",
  cuando: new Date().toISOString(),
  app: new URL(".", app).pathname,
  total: checks.length,
  pasan: checks.length - fallos.length,
  fallan: fallos.length,
  registro: entradas,
  resultados,
};
writeFileSync(
  new URL("catalogo-resultados.json", import.meta.url),
  JSON.stringify(salida, null, 2) + "\n",
);
console.log(`\n${salida.pasan}/${salida.total} · ${fallos.length} FALLA`);
if (fallos.length) {
  console.log("fallan: " + fallos.map((f) => f.id).join(", "));
  process.exitCode = 1;
}
