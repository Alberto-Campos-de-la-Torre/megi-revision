#!/usr/bin/env node
/**
 * Batería 2 · bloque HTTP — la superficie real de la aplicación en marcha.
 *
 * La fase 1 llamó a las acciones como funciones, con un `ctx` escrito a mano.
 * Eso no prueba quién puede llamarlas de verdad: `ctx.caller` lo decide el
 * transporte, y el propio framework documenta que la cabecera de frontend «es
 * solo lo que el cliente afirma». Este bloque levanta la app, se autentica
 * como lo hace el navegador y ataca el endpoint `/_agent-native/actions/*`.
 *
 * Qué hace, en orden:
 *   1. Vuelve a sembrar el backend de demo (4 consultas por revisar).
 *   2. Arranca `agent-native dev` con una base de datos nueva y desechable.
 *   3. Corre los bloques A (autorización), B (flujo del médico de punta a
 *      punta), C (concurrencia) y D (fugas en errores y registros).
 *   4. Apaga el servidor y escribe el JSON de resultados.
 *
 * Uso:
 *   node http.mjs                        # siembra, arranca, prueba, apaga
 *   node http.mjs --sin-sembrar          # respeta el estado actual de MEGI
 *   node http.mjs --app <dir>            # otra copia de megi-revision
 *   node http.mjs --mantener             # deja el servidor en pie al salir
 *
 * Variables: APP_MEGI_REVISION, MEGI_DEMO_DIR, MEGI_PY, MEGI_URL,
 * MEGI_USER, MEGI_PASSWORD, PUERTO_PRUEBA.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aquí = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, def) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const flag = (n) => args.includes(n);

const APP = resolve(
  opt("--app", process.env.APP_MEGI_REVISION ?? join(aquí, "../../megi-revision")),
);
const PUERTO = Number(opt("--puerto", process.env.PUERTO_PRUEBA ?? "8186"));
const BASE = `http://127.0.0.1:${PUERTO}`;
const MEGI_URL = process.env.MEGI_URL ?? "http://127.0.0.1:8020";
const MEGI_USER = process.env.MEGI_USER ?? "demo_medico";
const MEGI_PASSWORD = process.env.MEGI_PASSWORD ?? "demo-megi-2026";
const DEMO_DIR =
  process.env.MEGI_DEMO_DIR ?? resolve(APP, "../megi-demo/backend");
const PY =
  process.env.MEGI_PY ?? "/home/ttech-main/megi-final/backend/.venv/bin/python";
/**
 * Correo de la sesión local del framework («Continue as local dev»), y la lista
 * de correos con rol clínico. Desde el cierre del 7-nov, en modo http no hay
 * decisión médica sin identidad clínica: sin esto toda la mesa responde 403
 * `sin_rol_clinico` y el recorrido del bloque B no llega a empezar.
 */
const CORREO_DEV = process.env.CORREO_DEV ?? "dev@local.test";
const MEGI_MEDICOS = process.env.MEGI_MEDICOS ?? CORREO_DEV;

// ─────────────────────────────── anotación ───────────────────────────────
const checks = [];
const medidas = {};
let notas = [];
function anota(id, pasa, detalle) {
  checks.push({ id, pasa: !!pasa, detalle: String(detalle ?? "") });
  console.log(`${pasa ? "PASA" : "FALLA"}  ${id}  ${detalle ?? ""}`);
}
function mide(id, valor) {
  medidas[id] = valor;
  console.log(`  ·   ${id} = ${JSON.stringify(valor)}`);
}
function nota(t) {
  notas.push(t);
  console.log(`  ⓘ   ${t}`);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ──────────────────────────── cliente HTTP ────────────────────────────
/**
 * Cliente con tarro de galletas propio. Cada instancia es un «quién»
 * distinto: anónimo, con sesión, o con sesión + capacidad de interfaz.
 */
class Cliente {
  constructor(nombre) {
    this.nombre = nombre;
    this.galletas = new Map(); // nombre -> { valor, path }
  }
  #guarda(res) {
    const crudas = res.headers.getSetCookie?.() ?? [];
    for (const c of crudas) {
      const [par, ...attrs] = c.split(";");
      const i = par.indexOf("=");
      if (i < 0) continue;
      const nombre = par.slice(0, i).trim();
      const valor = par.slice(i + 1).trim();
      const path =
        attrs
          .map((a) => a.trim())
          .find((a) => a.toLowerCase().startsWith("path="))
          ?.slice(5) ?? "/";
      const maxAge = attrs
        .map((a) => a.trim())
        .find((a) => a.toLowerCase().startsWith("max-age="))
        ?.slice(8);
      if (!valor || maxAge === "0") this.galletas.delete(nombre);
      else this.galletas.set(nombre, { valor, path });
    }
  }
  #cabeceraGalletas(path) {
    const out = [];
    for (const [n, g] of this.galletas) {
      if (path.startsWith(g.path)) out.push(`${n}=${g.valor}`);
    }
    return out.join("; ");
  }
  /** Sustituye el valor de una galleta: sirve para manipular la capacidad. */
  manipula(nombre, fn) {
    const g = this.galletas.get(nombre);
    if (!g) return false;
    this.galletas.set(nombre, { ...g, valor: fn(g.valor) });
    return true;
  }
  tiene(nombre) {
    return this.galletas.has(nombre);
  }

  async crudo(path, o = {}) {
    const metodo = o.metodo ?? "GET";
    const cab = { ...(o.cabeceras ?? {}) };
    if (o.cuerpo !== undefined && !cab["content-type"])
      cab["content-type"] = "application/json";
    if (o.origen !== null) cab["origin"] = o.origen ?? BASE;
    if (o.secFetchSite !== null)
      cab["sec-fetch-site"] = o.secFetchSite ?? "same-origin";
    if (o.frontend) cab["x-agent-native-frontend"] = "1";
    if (o.auth) cab["authorization"] = o.auth;
    if (o.galletas !== false) {
      const g = this.#cabeceraGalletas(path);
      if (g) cab["cookie"] = g;
    }
    const res = await fetch(`${BASE}${path}`, {
      method: metodo,
      headers: cab,
      body:
        o.cuerpo === undefined
          ? undefined
          : typeof o.cuerpo === "string"
            ? o.cuerpo
            : JSON.stringify(o.cuerpo),
      redirect: "manual",
    });
    this.#guarda(res);
    const texto = await res.text();
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {}
    return { status: res.status, texto, json, cab: res.headers };
  }

  /** Llama una acción. `lectura: true` usa GET con query, como la interfaz. */
  async accion(nombre, argumentos = {}, o = {}) {
    const ruta = `/_agent-native/actions/${nombre}`;
    if (o.lectura) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(argumentos))
        q.set(k, typeof v === "string" ? v : JSON.stringify(v));
      const qs = q.toString();
      return this.crudo(qs ? `${ruta}?${qs}` : ruta, { ...o, metodo: "GET" });
    }
    return this.crudo(ruta, { ...o, metodo: o.metodo ?? "POST", cuerpo: argumentos });
  }

  async entra() {
    const r = await this.crudo("/_agent-native/auth/local-dev", {
      metodo: "POST",
      cuerpo: {},
    });
    if (r.status !== 200)
      throw new Error(`local-dev devolvió ${r.status}: ${r.texto.slice(0, 200)}`);
    return r;
  }
  async capacidad() {
    const r = await this.crudo("/_agent-native/ui-capability");
    if (r.status !== 200)
      throw new Error(`ui-capability devolvió ${r.status}`);
    return r;
  }
}

/** La interfaz: sesión + capacidad + cabecera de frontend. */
function comoInterfaz(cli) {
  return (nombre, argumentos, o = {}) =>
    cli.accion(nombre, argumentos, { frontend: true, ...o });
}

const código = (r) => r.json?.errorCode ?? r.json?.error ?? `HTTP ${r.status}`;
const falló = (r) => r.status >= 400 || !!r.json?.error;

// ──────────────────────────── MEGI de demo ────────────────────────────
async function megiToken() {
  const r = await fetch(`${MEGI_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: MEGI_USER, password: MEGI_PASSWORD }),
  });
  if (!r.ok) throw new Error(`login MEGI ${r.status}`);
  return (await r.json()).token;
}
async function megiAudit(id, token) {
  const r = await megiGet(`/consultations/${id}/audit`, token);
  const j = r.json ?? {};
  const sello = j.signer ?? {};
  const kinds = (j.timeline ?? []).map((t) => String(t.kind ?? t.tipo ?? ""));
  const cuenta = (re) => kinds.filter((k) => re.test(k)).length;
  const aprobaciones = cuenta(/^approve$/i);
  const sellos = cuenta(/sello|export/i);
  const hitos = aprobaciones + sellos;
  return {
    status: r.status,
    estado: j.consultation?.status ?? null,
    firmadoPor: sello.by ?? null,
    selloEn: sello.seal_at ?? null,
    selloHash: sello.seal_hash ?? null,
    receta: j.prescription ?? [],
    aprobaciones,
    sellos,
    hitos,
    cruda: j,
  };
}

async function megiGet(path, token) {
  const r = await fetch(`${MEGI_URL}/api${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const t = await r.text();
  try {
    return { status: r.status, json: JSON.parse(t) };
  } catch {
    return { status: r.status, json: null, texto: t };
  }
}

function siembra() {
  if (flag("--sin-sembrar")) {
    nota("siembra omitida (--sin-sembrar): el estado de MEGI es el que haya");
    return "omitida";
  }
  if (!existsSync(join(DEMO_DIR, "seed_demo.py")))
    throw new Error(`no encuentro seed_demo.py en ${DEMO_DIR}`);
  const r = spawnSync(PY, ["seed_demo.py"], {
    cwd: DEMO_DIR,
    env: { ...process.env, MEGI_MODE: "local_mock" },
    encoding: "utf8",
  });
  if (r.status !== 0)
    throw new Error(`seed_demo.py falló: ${r.stderr?.slice(0, 400)}`);
  return (r.stdout ?? "").trim().split("\n")[0];
}

// ─────────────────────────── servidor de la app ───────────────────────────
let servidor = null;
let logApp = "";
const LOG = join(mkdtempSync(join(tmpdir(), "fase2-")), "dev-server.log");

async function arranca(megiUrl = MEGI_URL) {
  const dbDir = mkdtempSync(join(tmpdir(), "fase2-db-"));
  const bin = join(APP, "node_modules/.bin/agent-native");
  if (!existsSync(bin)) throw new Error(`falta ${bin} (¿pnpm install?)`);
  servidor = spawn(
    bin,
    ["dev", "--port", String(PUERTO), "--strictPort", "--host", "127.0.0.1"],
    {
      cwd: APP,
      env: {
        ...process.env,
        DATABASE_URL: `pglite:${join(dbDir, "db")}`,
        MEGI_MODE: "http",
        MEGI_URL: megiUrl,
        MEGI_USER,
        MEGI_PASSWORD,
        MEGI_MEDICOS,
        PORT: String(PUERTO),
        BROWSER: "none",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    },
  );
  servidor.stdout.on("data", (d) => (logApp += d.toString()));
  servidor.stderr.on("data", (d) => (logApp += d.toString()));

  const límite = Date.now() + 120_000;
  while (Date.now() < límite) {
    try {
      const r = await fetch(`${BASE}/`, { redirect: "manual" });
      if (r.status < 500) return dbDir;
    } catch {}
    await dormir(700);
  }
  throw new Error(`el servidor no respondió en ${BASE}\n${logApp.slice(-2000)}`);
}

function apaga() {
  if (!servidor || flag("--mantener")) return;
  try {
    servidor.kill("SIGTERM");
  } catch {}
}

// ═══════════════════════════════ pruebas ═══════════════════════════════
/**
 * Las acciones propias de la mesa, leídas del directorio y no de una lista
 * escrita a mano: el bloque A comprueba que ninguna se ejecute sin sesión, y
 * una acción nueva tiene que entrar sola en esa comprobación. (Eran ocho; el
 * cierre del 7-nov añadió diez.) Se descuentan `navigate`, `run` y
 * `view-screen`, que vienen con la plantilla.
 */
const LAS_NUESTRAS = readdirSync(join(APP, "actions"))
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
  .map((f) => f.replace(/\.ts$/, ""))
  .filter((n) => !["navigate", "run", "view-screen"].includes(n))
  .sort();
const ESCRITURAS = [
  "proponer-plan",
  "reajustar-plan",
  "agregar-linea",
  "actualizar-linea",
];

async function bloqueA(anon, sesion, ui, uiCli) {
  // A1 · sin sesión no se ejecuta nada, ni leer ni escribir.
  const sinSesion = [];
  for (const n of LAS_NUESTRAS) {
    const r = await anon.accion(n, {}, { frontend: true });
    sinSesion.push({ accion: n, status: r.status, código: código(r) });
  }
  anota(
    "a1-sin-sesion-no-ejecuta-nada",
    sinSesion.every((x) => x.status === 401 || x.status === 403),
    sinSesion.map((x) => `${x.accion}:${x.status}`).join(" "),
  );
  anota(
    "a1b-la-cabecera-sola-no-autentica",
    sinSesion.every((x) => x.status !== 200),
    "ninguna acción responde 200 solo con x-agent-native-frontend: 1",
  );

  // A2 · con sesión pero sin la capacidad de interfaz, las escrituras no corren.
  const sinCap = [];
  for (const n of ESCRITURAS) {
    const r = await sesion.accion(
      n,
      n === "proponer-plan"
        ? { consultaId: "demo-c1", lineas: [], explicacion: "x", origen: "medico" }
        : n === "reajustar-plan"
          ? { planId: "x", cambios: [{ accion: "quitar", lineaId: "y", motivo: "m" }], explicacion: "x", origen: "medico" }
          : n === "agregar-linea"
            ? { planId: "x", lineas: [{ tipo: "pendiente", texto: "t" }], origen: "medico" }
            : { lineaId: "x", estado: "bloqueada", motivo: "m", origen: "medico" },
      { frontend: true },
    );
    sinCap.push({ accion: n, status: r.status, código: código(r) });
  }
  anota(
    "a2-escritura-sin-capacidad-ui-no-corre",
    sinCap.every((x) => falló({ status: x.status, json: {} })),
    sinCap.map((x) => `${x.accion}:${x.código}`).join(" · "),
  );

  // A3 · aprobar-plan es uiOnly: ni con sesión ni con la cabecera.
  const ap = await sesion.accion(
    "aprobar-plan",
    { planId: "x", confirmaAlertas: true, notas: "", origen: "medico" },
    { frontend: true },
  );
  anota(
    "a3-aprobar-exige-interfaz-probada",
    ap.status === 403,
    `${ap.status} ${código(ap)}`,
  );

  // A4 · con capacidad pero sin la cabecera, el médico no existe.
  const sinCabecera = await uiCli.accion("proponer-plan", {
    consultaId: "demo-c1",
    lineas: [{ tipo: "pendiente", texto: "control" }],
    explicacion: "sin cabecera",
    origen: "medico",
  });
  anota(
    "a4-sin-cabecera-no-hay-medico",
    falló(sinCabecera),
    `${sinCabecera.status} ${código(sinCabecera)}`,
  );

  // A5 · petición de otro origen: la capacidad no basta.
  const cruzado = await ui(
    "proponer-plan",
    {
      consultaId: "demo-c1",
      lineas: [{ tipo: "pendiente", texto: "control" }],
      explicacion: "origen cruzado",
      origen: "medico",
    },
    { origen: "http://malicioso.invalid", secFetchSite: "cross-site" },
  );
  anota(
    "a5-origen-cruzado-rechazado",
    falló(cruzado),
    `${cruzado.status} ${código(cruzado)}`,
  );

  // A6 · con cabecera Authorization la petición ya no es la interfaz.
  const conBearer = await ui(
    "proponer-plan",
    {
      consultaId: "demo-c1",
      lineas: [{ tipo: "pendiente", texto: "control" }],
      explicacion: "bearer",
      origen: "medico",
    },
    { auth: "Bearer no-es-un-token-real" },
  );
  anota(
    "a6-token-bearer-no-se-vuelve-medico",
    falló(conBearer),
    `${conBearer.status} ${código(conBearer)}`,
  );

  // A7 · capacidad manipulada: la firma manda.
  const falsa = new Cliente("capacidad-falsa");
  await falsa.entra();
  await falsa.capacidad();
  const tenía = falsa.manipula("agent-native-ui-capability", (v) => {
    const [p, s] = v.split(".");
    return `${p}.${(s ?? "").split("").reverse().join("")}`;
  });
  const conFalsa = await falsa.accion(
    "proponer-plan",
    {
      consultaId: "demo-c1",
      lineas: [{ tipo: "pendiente", texto: "control" }],
      explicacion: "capacidad manipulada",
      origen: "medico",
    },
    { frontend: true },
  );
  anota(
    "a7-capacidad-manipulada-rechazada",
    tenía && falló(conFalsa),
    `${conFalsa.status} ${código(conFalsa)}`,
  );

  // A8 · los métodos no se cruzan: una lectura no escribe y una escritura no se cuela por GET.
  const lecturaPorPost = await ui("listar-consultas", {});
  const escrituraPorGet = await ui(
    "aprobar-plan",
    { planId: "x", confirmaAlertas: true, notas: "", origen: "medico" },
    { lectura: true },
  );
  anota(
    "a8-metodos-no-se-cruzan",
    lecturaPorPost.status === 405 && escrituraPorGet.status >= 400,
    `lectura por POST: ${lecturaPorPost.status} · escritura por GET: ${escrituraPorGet.status} ${código(escrituraPorGet)}`,
  );

  // A9 · un cuerpo enorme no tumba al servidor.
  const enorme = await ui("proponer-plan", undefined, {
    cuerpo: JSON.stringify({
      consultaId: "demo-c1",
      origen: "medico",
      explicacion: "x".repeat(3_000_000),
      lineas: [],
    }),
  });
  const vivo = await fetch(`${BASE}/`, { redirect: "manual" }).then(
    (r) => r.status < 500,
    () => false,
  );
  anota(
    "a9-cuerpo-enorme-se-rechaza-sin-caer",
    falló(enorme) && vivo,
    `${enorme.status} ${código(enorme)} · servidor en pie: ${vivo}`,
  );
}

async function bloqueB(ui, token) {
  // B1 · la lista de pendientes sale del MEGI real.
  const lista = await ui("listar-consultas", {}, { lectura: true });
  const consultas = lista.json?.consultas ?? [];
  anota(
    "b1-lista-pendientes-desde-megi",
    lista.status === 200 && consultas.length === 4,
    `${consultas.length} consultas: ${consultas.map((c) => c.id).join(", ")}`,
  );
  anota(
    "b1b-la-lista-trae-contexto-del-paciente",
    consultas.every(
      (c) => c.paciente?.nombre && Array.isArray(c.paciente?.alergias),
    ),
    "nombre, alergias, crónicos y medicación activa en cada fila",
  );

  // B2 · la pantalla de revisión responde y nombra al paciente.
  const html = await fetch(`${BASE}/revision/demo-c2`, {
    headers: { cookie: "" },
    redirect: "manual",
  });
  anota(
    "b2-la-ruta-de-revision-responde",
    html.status === 200 || html.status === 302,
    `GET /revision/demo-c2 -> ${html.status}`,
  );

  // B3 · propuesta con un fármaco que debe saltar: ibuprofeno sobre hipertensión.
  const prop = await ui("proponer-plan", {
    consultaId: "demo-c2",
    lineas: [
      {
        tipo: "farmaco",
        texto: "Ibuprofeno",
        dosis: "400 mg",
        frecuencia: "cada 8 h",
        duracion: "5 días",
        justificacion: "Dolor lumbar",
      },
      {
        tipo: "farmaco",
        texto: "Paracetamol",
        dosis: "1 g",
        frecuencia: "cada 8 h",
        duracion: "5 días",
        justificacion: "Analgesia de base",
      },
      { tipo: "pendiente", texto: "Control de presión en 2 semanas" },
    ],
    explicacion: "Propuesta de la batería 2 para el recorrido del médico.",
    origen: "medico",
  });
  const plan = prop.json;
  anota(
    "b3-propuesta-creada-y-verificada",
    prop.status === 200 && !!plan?.id && plan?.lineas?.length === 3,
    prop.status === 200
      ? `plan ${plan.id} · bloqueos ${plan.resumen?.bloqueos} advertencias ${plan.resumen?.advertencias}`
      : `${prop.status} ${código(prop)}`,
  );
  if (prop.status !== 200) return null;

  const ibu = plan.lineas.find((l) => /ibuprofeno/i.test(l.texto));
  const para = plan.lineas.find((l) => /paracetamol/i.test(l.texto));
  anota(
    "b4-el-aine-sale-marcado-con-motivo",
    ibu && ibu.verificacion !== "ok" && !!ibu.motivoVerificacion,
    ibu
      ? `${ibu.verificacion}: ${String(ibu.motivoVerificacion).slice(0, 120)}`
      : "no encontré la línea del ibuprofeno",
  );
  mide("b4-verificacion-del-ibuprofeno", ibu?.verificacion ?? null);
  anota(
    "b4b-si-bloquea-ofrece-alternativas",
    ibu?.verificacion !== "bloqueado" ||
      (Array.isArray(ibu.alternativas) && ibu.alternativas.length > 0),
    JSON.stringify(ibu?.alternativas ?? null),
  );

  // B5 · el médico bloquea una línea.
  const bloqueo = await ui("actualizar-linea", {
    lineaId: para.id,
    estado: "bloqueada",
    motivo: "La dejo fija: el paciente ya la tolera.",
    origen: "medico",
  });
  anota(
    "b5-el-medico-bloquea-una-linea",
    bloqueo.status === 200 && bloqueo.json?.linea?.estado === "bloqueada",
    `${bloqueo.status} ${bloqueo.json?.linea?.estado ?? código(bloqueo)}`,
  );

  // B6 · un reajuste que toca lo bloqueado no se aplica en nada.
  const antes = await ui("obtener-plan", { consultaId: "demo-c2" }, { lectura: true });
  const choque = await ui("reajustar-plan", {
    planId: plan.id,
    cambios: [
      { accion: "quitar", lineaId: para.id, motivo: "quiero quitarla" },
      { accion: "agregar", tipo: "pendiente", texto: "Radiografía", motivo: "descartar fractura" },
    ],
    explicacion: "Reajuste que pisa una línea bloqueada.",
    origen: "medico",
  });
  const después = await ui("obtener-plan", { consultaId: "demo-c2" }, { lectura: true });
  anota(
    "b6-reajuste-sobre-bloqueada-no-aplica-nada",
    choque.json?.errorCode === "linea_bloqueada" &&
      JSON.stringify(antes.json?.lineas) === JSON.stringify(después.json?.lineas),
    `${choque.status} ${código(choque)} · líneas intactas: ${
      JSON.stringify(antes.json?.lineas) === JSON.stringify(después.json?.lineas)
    }`,
  );

  // B7 · un reajuste que la respeta sí se aplica.
  const limpio = await ui("reajustar-plan", {
    planId: plan.id,
    cambios: [
      {
        accion: "editar",
        lineaId: ibu.id,
        dosis: "200 mg",
        motivo: "bajo la dosis mientras se decide",
      },
      {
        accion: "agregar",
        tipo: "pendiente",
        texto: "Control de creatinina",
        motivo: "vigilar función renal",
      },
    ],
    explicacion: "Reajuste que no toca la línea bloqueada.",
    origen: "medico",
  });
  anota(
    "b7-reajuste-respetuoso-se-aplica",
    limpio.status === 200 && limpio.json?.aplicados === 2,
    `${limpio.status} aplicados ${limpio.json?.aplicados ?? "-"} ${código(limpio)}`,
  );

  // B8 · con bloqueos pendientes, aprobar sin confirmar falla.
  const estado = await ui("obtener-plan", { consultaId: "demo-c2" }, { lectura: true });
  const hayBloqueos = (estado.json?.resumen?.bloqueos ?? 0) > 0;
  const sinConfirmar = await ui("aprobar-plan", {
    planId: plan.id,
    confirmaAlertas: false,
    notas: "",
    origen: "medico",
  });
  anota(
    "b8-no-se-aprueba-con-alertas-sin-confirmar",
    !hayBloqueos || sinConfirmar.json?.errorCode === "alertas_sin_confirmar",
    hayBloqueos
      ? `${sinConfirmar.status} ${código(sinConfirmar)}`
      : "el plan no quedó con bloqueos: comprobación no aplicable",
  );
  mide("b8-bloqueos-antes-de-aprobar", estado.json?.resumen?.bloqueos ?? null);

  // B8b · conciliar la medicación histórica, que desde el cierre del 7-nov es
  // requisito para aprobar: con un solo candidato `sin_confirmar` el plan
  // responde 409 `medicacion_sin_conciliar`. Es el paso que da el médico en la
  // pantalla de conciliación, y aquí se da por el mismo camino: leer los
  // candidatos y la versión de `obtener-plan` —ambos vienen en la misma lectura:
  // `conciliacion` y `plan.version`— y decidir sobre todos.
  const porConciliar = (estado.json?.conciliacion ?? []).filter(
    (m) => m.estado === "sin_confirmar",
  );
  const versionActual = estado.json?.plan?.version;
  const conciliado = porConciliar.length
    ? await ui("conciliar-medicacion", {
        planId: plan.id,
        versionEsperada: versionActual,
        decisiones: porConciliar.map((m) => ({ id: m.id, estado: "activo" })),
        adicionales: [],
      })
    : { status: 200, json: { version: versionActual }, omitido: true };
  anota(
    "b8b-el-medico-concilia-la-medicacion-historica",
    conciliado.status === 200,
    conciliado.omitido
      ? "no había medicación sin confirmar"
      : `${conciliado.status} ${porConciliar.length} decidida(s) ${código(conciliado)}`,
  );
  const trasConciliar = await ui(
    "obtener-plan",
    { consultaId: "demo-c2" },
    { lectura: true },
  );
  anota(
    "b8c-y-queda-marcada-como-confirmada",
    trasConciliar.json?.conciliacionConfirmada === true,
    String(trasConciliar.json?.conciliacionConfirmada),
  );

  // B9 · aprobación con confirmación: sello y firma.
  const aprobado = await ui("aprobar-plan", {
    planId: plan.id,
    confirmaAlertas: true,
    notas: "Confirmo el bloqueo tras hablar con el paciente.",
    origen: "medico",
  });
  anota(
    "b9-aprobacion-sella-y-firma",
    aprobado.status === 200 &&
      !!aprobado.json?.sello &&
      !!aprobado.json?.aprobadoPor,
    aprobado.status === 200
      ? `sello ${String(aprobado.json.sello).slice(0, 24)}… por ${aprobado.json.aprobadoPor}`
      : `${aprobado.status} ${código(aprobado)}`,
  );

  // B10 · MEGI quedó con la consulta aprobada y la receta de las vigentes.
  const aud = await megiAudit("C-DEMO2", token);
  const vigentes = (estado.json?.lineas ?? []).filter(
    (l) => l.tipo === "farmaco" && l.estado !== "rechazada",
  );
  anota(
    "b10-megi-registra-la-aprobacion",
    aud.status === 200 &&
      ["approved", "exported"].includes(aud.estado) &&
      !!aud.firmadoPor,
    `status ${aud.estado} · firmado por ${aud.firmadoPor ?? "null"} · sello ${
      aud.selloHash ? String(aud.selloHash).slice(0, 12) + "…" : "ninguno"
    }`,
  );
  anota(
    "b10b-la-receta-en-megi-son-las-vigentes",
    Array.isArray(aud.receta) && aud.receta.length === vigentes.length,
    `MEGI ${Array.isArray(aud.receta) ? aud.receta.length : "?"} fármacos · plan ${vigentes.length} vigentes`,
  );
  mide("b10-farmacos-en-megi", Array.isArray(aud.receta) ? aud.receta.length : null);
  mide("b10-farmacos-vigentes-en-el-plan", vigentes.length);

  // B11 · reintentar la aprobación no vuelve a exportar ni re-sella.
  const otraVez = await ui("aprobar-plan", {
    planId: plan.id,
    confirmaAlertas: true,
    notas: "reintento",
    origen: "medico",
  });
  const aud2 = await megiAudit("C-DEMO2", token);
  anota(
    "b11-reintentar-no-vuelve-a-aprobar",
    otraVez.status === 200 || otraVez.json?.errorCode === "plan_cerrado",
    `${otraVez.status} ${código(otraVez)}`,
  );
  anota(
    "b11b-el-sello-no-cambia-al-reintentar",
    aud.selloHash === aud2.selloHash && aud.selloEn === aud2.selloEn && aud.hitos === aud2.hitos,
    `sello ${aud.selloHash === aud2.selloHash ? "igual" : "CAMBIÓ"} · aprobaciones ${aud.aprobaciones} -> ${aud2.aprobaciones} · sellos ${aud.sellos} -> ${aud2.sellos}`,
  );

  // B12 · la consulta sale de la lista de pendientes.
  const lista2 = await ui("listar-consultas", {}, { lectura: true });
  anota(
    "b12-la-consulta-aprobada-sale-de-la-lista",
    !(lista2.json?.consultas ?? []).some((c) => c.id === "demo-c2"),
    (lista2.json?.consultas ?? []).map((c) => c.id).join(", ") || "lista vacía",
  );

  // B13 · la bitácora cuenta la historia completa, con actor.
  const final = await ui("obtener-plan", { consultaId: "demo-c2" }, { lectura: true });
  const bit = final.json?.eventos ?? [];
  const tipos = bit.map((e) => e.accion);
  anota(
    "b13-la-bitacora-registra-todo-el-recorrido",
    tipos.includes("proponer") &&
      tipos.some((t) => /bloque|actualiz/i.test(String(t))) &&
      tipos.includes("reajustar") &&
      tipos.includes("aprobar"),
    tipos.join(" → ") || "bitácora vacía",
  );
  anota(
    "b13b-cada-evento-dice-quien-lo-hizo",
    bit.length > 0 && bit.every((e) => e.actor === "medico" || e.actor === "agente"),
    [...new Set(bit.map((e) => e.actor))].join(", ") || "sin eventos",
  );
  return { planId: plan.id };
}

async function bloqueC(ui, token) {
  // C1 · dos propuestas simultáneas sobre la misma consulta: un solo plan.
  const payload = (t) => ({
    consultaId: "demo-c3",
    lineas: [
      { tipo: "pendiente", texto: `Control ${t}` },
      {
        tipo: "farmaco",
        texto: "Paracetamol",
        dosis: "500 mg",
        frecuencia: "cada 8 h",
        duracion: "3 días",
        justificacion: "Dolor de rodilla",
      },
    ],
    explicacion: `Carrera ${t}`,
    origen: "medico",
  });
  const [p1, p2] = await Promise.all([
    ui("proponer-plan", payload("A")),
    ui("proponer-plan", payload("B")),
  ]);
  const ok = [p1, p2].filter((r) => r.status === 200);
  const choques = [p1, p2].filter((r) => r.json?.errorCode === "plan_existente");
  const plan = await ui("obtener-plan", { consultaId: "demo-c3" }, { lectura: true });
  anota(
    "c1-dos-propuestas-a-la-vez-dejan-un-plan",
    ok.length === 1 && choques.length === 1 && !!plan.json?.id,
    `ok ${ok.length} · plan_existente ${choques.length} · plan ${plan.json?.id ?? "ninguno"}`,
  );
  const planId = plan.json?.id;
  const lineas = plan.json?.lineas ?? [];

  // C2 · dos cambios simultáneos sobre la misma línea: estado coherente.
  if (lineas[0]) {
    const [r1, r2] = await Promise.all([
      ui("actualizar-linea", {
        lineaId: lineas[0].id,
        estado: "bloqueada",
        motivo: "carrera A",
        origen: "medico",
      }),
      ui("actualizar-linea", {
        lineaId: lineas[0].id,
        estado: "rechazada",
        motivo: "carrera B",
        origen: "medico",
      }),
    ]);
    const tras = await ui("obtener-plan", { consultaId: "demo-c3" }, { lectura: true });
    const estadoFinal = (tras.json?.lineas ?? []).find(
      (l) => l.id === lineas[0].id,
    )?.estado;
    anota(
      "c2-dos-cambios-a-la-vez-dejan-un-estado-valido",
      ["bloqueada", "rechazada"].includes(estadoFinal),
      `${r1.status}/${r2.status} → estado final "${estadoFinal}"`,
    );
  }

  // Preparación de C3: aprobar exige la medicación histórica conciliada (desde
  // el cierre del 7-nov). No es una comprobación, es el paso que da el médico
  // antes de la confirmación final; se apunta como medida para que, si falla,
  // se vea aquí y no disfrazado de fallo de la carrera.
  if (planId) {
    const previo = await ui("obtener-plan", { consultaId: "demo-c3" }, { lectura: true });
    const pendientes = (previo.json?.conciliacion ?? []).filter(
      (m) => m.estado === "sin_confirmar",
    );
    let resultado = "no había medicación sin confirmar";
    if (pendientes.length) {
      const c = await ui("conciliar-medicacion", {
        planId,
        versionEsperada: previo.json?.plan?.version,
        decisiones: pendientes.map((m) => ({ id: m.id, estado: "activo" })),
        adicionales: [],
      });
      resultado = `${c.status} ${pendientes.length} decidida(s)`;
    }
    mide("c3-preparacion-conciliacion", resultado);
  }

  // C3 · dos aprobaciones simultáneas: una sola exportación.
  if (planId) {
    const audAntes = await megiAudit("C-DEMO3", token);
    const [a1, a2] = await Promise.all([
      ui("aprobar-plan", {
        planId,
        confirmaAlertas: true,
        notas: "carrera A",
        origen: "medico",
      }),
      ui("aprobar-plan", {
        planId,
        confirmaAlertas: true,
        notas: "carrera B",
        origen: "medico",
      }),
    ]);
    const audDespués = await megiAudit("C-DEMO3", token);
    anota(
      "c3-dos-aprobaciones-a-la-vez-aprueban-una-vez",
      audDespués.aprobaciones - audAntes.aprobaciones === 1 &&
        audDespués.sellos - audAntes.sellos === 1 &&
        ["approved", "exported"].includes(audDespués.estado),
      `${a1.status}/${a2.status} · aprobaciones ${audAntes.aprobaciones} -> ${audDespués.aprobaciones} · sellos ${audAntes.sellos} -> ${audDespués.sellos} · status ${audDespués.estado}`,
    );
    anota(
      "c3b-nadie-recibe-un-exito-a-medias",
      [a1, a2].every(
        (r) => r.status === 200 || (r.json?.errorCode ?? "").length > 0,
      ),
      [a1, a2].map((r) => `${r.status} ${código(r)}`).join(" · "),
    );
  }
}

async function bloqueD(ui) {
  // D1 · un id que no existe: error claro, sin tripas.
  const noExiste = await ui("proponer-plan", {
    consultaId: "demo-c99",
    lineas: [{ tipo: "pendiente", texto: "x" }],
    explicacion: "x",
    origen: "medico",
  });
  anota(
    "d1-consulta-inexistente-es-404-claro",
    noExiste.status === 404 || noExiste.json?.errorCode === "not_found",
    `${noExiste.status} ${código(noExiste)}`,
  );

  // D2 · un id hostil se para antes de salir a la red.
  const hostil = await ui(
    "ver-contexto-consulta",
    { consultaId: "../../export/consultation/C-DEMO1" },
    { lectura: true },
  );
  anota(
    "d2-id-hostil-no-llega-a-la-red",
    falló(hostil) && !/exported/i.test(hostil.texto),
    `${hostil.status} ${String(hostil.json?.error ?? hostil.texto).slice(0, 140)}`,
  );
  anota(
    "d2b-id-hostil-devuelve-error-controlado",
    hostil.status >= 400 && hostil.status < 500 && !!hostil.json?.errorCode,
    `${hostil.status} ${hostil.json?.errorCode ?? "sin errorCode"} · "${String(hostil.json?.error ?? "").slice(0, 80)}"`,
  );

  // D3 · ningún error devuelve credenciales, URLs internas ni pila.
  const sospechas = [];
  for (const r of [noExiste, hostil]) {
    const t = r.texto ?? "";
    if (t.includes(process.env.MEGI_PASSWORD ?? "demo-megi-2026"))
      sospechas.push("contraseña");
    if (/Bearer\s+ey/i.test(t)) sospechas.push("token");
    if (/\n\s+at\s/.test(t)) sospechas.push("pila");
    if (t.includes("127.0.0.1:8020")) sospechas.push("url interna");
  }
  anota(
    "d3-los-errores-no-filtran-nada",
    sospechas.length === 0,
    sospechas.length ? sospechas.join(", ") : "sin credenciales, pilas ni URLs internas",
  );

  // D4 · cabeceras de seguridad. El middleware del framework va montado en
  // nitro, así que se comprueba en una ruta del framework. La página HTML en
  // `dev` la sirve Vite y no pasa por ahí: se mide, no se exige.
  const básicas = [
    "x-content-type-options",
    "referrer-policy",
    "cross-origin-opener-policy",
  ];
  const marco = await fetch(`${BASE}/_agent-native/ui-capability`, {
    redirect: "manual",
  });
  // Se mide, no se exige: en `dev` estas cabeceras aparecen de forma
  // inconsistente porque el HTML y parte de las rutas los sirve Vite, fuera
  // del middleware de nitro. Exigirlo aquí sería un fallo del entorno de
  // desarrollo, no del producto.
  const faltanMarco = básicas.filter((h) => !marco.headers.get(h));
  mide("d4-cabeceras-que-no-trae-una-ruta-del-framework-en-dev", faltanMarco);
  const pág = await fetch(`${BASE}/`, { redirect: "manual" });
  const faltanPág = básicas.filter((h) => !pág.headers.get(h));
  mide("d4-cabeceras-que-no-trae-la-pagina-en-dev", faltanPág);
  const auth = await fetch(`${BASE}/_agent-native/auth/local-dev`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: "{}",
    redirect: "manual",
  });
  anota(
    "d4-el-plugin-de-sesion-si-manda-las-cabeceras",
    básicas.every((h) => auth.headers.get(h)),
    básicas.map((h) => `${h}=${auth.headers.get(h) ? "sí" : "no"}`).join(" · "),
  );
  if (faltanPág.length)
    nota(
      "en `agent-native dev` el HTML lo sirve Vite y no pasa por el middleware de nitro: " +
        `le faltan ${faltanPág.join(", ")}. En producción el middleware sí va montado sobre nitro, ` +
        "pero `agent-native start` no arranca con PGlite (503 DEPLOY_SETTINGS_REQUIRED), así que no se pudo medir.",
    );

  // D5 · el registro del servidor no escribe la contraseña de MEGI.
  const pw = process.env.MEGI_PASSWORD ?? "demo-megi-2026";
  anota(
    "d5-el-registro-no-guarda-la-contrasena",
    !logApp.includes(pw),
    `${logApp.length} bytes de registro revisados`,
  );
  const trazas = (logApp.match(/\n\s+at\s/g) ?? []).length;
  mide("d5-trazas-de-pila-en-el-registro", trazas);
}

async function bloqueE(ui) {
  // Con MEGI apagado, la mesa tiene que decir qué pasa, no "Internal server error".
  const lista = await ui("listar-consultas", {}, { lectura: true });
  anota(
    "e1-sin-megi-la-lista-da-error-legible",
    lista.status >= 400 && lista.status < 600 && !!lista.json?.errorCode,
    `${lista.status} ${lista.json?.errorCode ?? "sin errorCode"} · "${String(lista.json?.error ?? "").slice(0, 90)}"`,
  );
  const ctx = await ui("ver-contexto-consulta", { consultaId: "demo-c1" }, { lectura: true });
  anota(
    "e2-sin-megi-el-contexto-da-error-legible",
    !!ctx.json?.errorCode,
    `${ctx.status} ${ctx.json?.errorCode ?? "sin errorCode"} · "${String(ctx.json?.error ?? "").slice(0, 90)}"`,
  );
  const prop = await ui("proponer-plan", {
    consultaId: "demo-c1",
    lineas: [{ tipo: "pendiente", texto: "control" }],
    explicacion: "con MEGI caído",
    origen: "medico",
  });
  anota(
    "e3-sin-megi-no-se-crea-un-plan-a-ciegas",
    falló(prop) && !prop.json?.id,
    `${prop.status} ${prop.json?.errorCode ?? código(prop)}`,
  );
  anota(
    "e3b-y-el-error-trae-codigo",
    !!prop.json?.errorCode,
    prop.json?.errorCode ?? "sin errorCode",
  );
  const fugas = [lista, ctx, prop].filter(
    (r) =>
      /127\.0\.0\.1:9\b/.test(r.texto ?? "") ||
      /\n\s+at\s/.test(r.texto ?? "") ||
      (r.texto ?? "").includes(MEGI_PASSWORD),
  );
  anota(
    "e4-el-fallo-de-megi-no-filtra-interioridades",
    fugas.length === 0,
    fugas.length ? `${fugas.length} respuesta(s) con URL interna, pila o credencial` : "sin URL interna, pila ni credencial",
  );
  const pág = await fetch(`${BASE}/revision`, { redirect: "manual" });
  anota(
    "e5-la-mesa-sigue-abriendo-sin-megi",
    pág.status < 500,
    `GET /revision -> ${pág.status}`,
  );
}

// ═══════════════════════════════ ejecución ═══════════════════════════════
const t0 = Date.now();
let sembrado = "no intentada";
try {
  sembrado = siembra();
  nota(`siembra: ${sembrado}`);
  const token = await megiToken();
  anota("pre-megi-de-demo-en-pie", !!token, `${MEGI_URL} responde al login`);

  await arranca();
  anota("pre-app-en-pie", true, `${BASE} responde`);

  const anon = new Cliente("anónimo");
  const sesion = new Cliente("con-sesión");
  await sesion.entra();
  const uiCli = new Cliente("interfaz");
  await uiCli.entra();
  await uiCli.capacidad();
  const ui = comoInterfaz(uiCli);
  anota(
    "pre-sesion-y-capacidad",
    sesion.tiene("an_session_megi_revision") &&
      uiCli.tiene("agent-native-ui-capability"),
    "sesión de desarrollo local y capacidad de interfaz obtenidas por HTTP",
  );

  await bloqueA(anon, sesion, ui, uiCli);
  await bloqueB(ui, token);
  await bloqueC(ui, token);
  await bloqueD(ui);

  // Bloque E: el mismo código, con MEGI apagado. Puerto 9 = descartar.
  apaga();
  await dormir(1500);
  servidor = null;
  await arranca("http://127.0.0.1:9");
  const uiSinMegi = new Cliente("interfaz-sin-megi");
  await uiSinMegi.entra();
  await uiSinMegi.capacidad();
  await bloqueE(comoInterfaz(uiSinMegi));
} catch (e) {
  anota("error-de-la-bateria", false, e?.stack?.split("\n").slice(0, 3).join(" | ") ?? String(e));
} finally {
  if (logApp) {
    try {
      writeFileSync(LOG, logApp);
    } catch {}
  }
  apaga();
}

const fallos = checks.filter((c) => !c.pasa);
const salida = {
  bateria: "fase 2 · bloque HTTP (superficie real de la app)",
  cuando: new Date().toISOString(),
  app: APP,
  base: BASE,
  megi: MEGI_URL,
  siembra: sembrado,
  node: process.version,
  appCommit: (() => {
    const r = spawnSync("git", ["-C", APP, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    });
    return r.status === 0 ? r.stdout.trim() : null;
  })(),
  segundos: Math.round((Date.now() - t0) / 1000),
  total: checks.length,
  pasan: checks.length - fallos.length,
  fallan: fallos.length,
  medidas,
  notas,
  registro: existsSync(LOG) ? LOG : null,
  checks,
};
const destino = join(aquí, "http-resultados.json");
writeFileSync(destino, JSON.stringify(salida, null, 2) + "\n");
console.log(
  `\n${salida.pasan}/${salida.total} · ${fallos.length} FALLA · ${salida.segundos}s · ${destino}`,
);
if (fallos.length) {
  console.log("fallan: " + fallos.map((f) => f.id).join(", "));
  process.exitCode = 1;
}
