#!/usr/bin/env node
/**
 * Batería 2 · bloque R — los requisitos de la revisión del hackatón.
 *
 * Las bases (`evidencia/bases/reglas.html`) dicen qué se verifica antes de
 * repartir premios: elegibilidad, originalidad, **uso del framework**,
 * **accesibilidad de la demo** y cumplimiento. Y «How to Enter» exige declarar
 * el trabajo previo, las plantillas, las librerías y los activos de terceros,
 * y qué se construyó durante el evento.
 *
 * Este bloque comprueba, uno por uno, lo que se puede comprobar con el repo
 * delante. Lo que depende de una persona (enviar el formulario, publicar el
 * Clip) se marca como pendiente declarado, no como fallo.
 *
 * Uso, desde la raíz del repo del hackatón:
 *   node pruebas-hackathon/fase2/requisitos.mjs
 *   node pruebas-hackathon/fase2/requisitos.mjs --rapido   # sin build
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aquí = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const rápido = args.includes("--rapido");
const REPO = resolve(opt("--repo", process.env.REPO_HACKATHON ?? join(aquí, "../..")));
const APP = resolve(
  opt("--app", process.env.APP_MEGI_REVISION ?? join(REPO, "megi-revision")),
);

const checks = [];
const medidas = {};
const pendientes = [];
function anota(id, pasa, detalle) {
  checks.push({ id, pasa: !!pasa, detalle: String(detalle ?? "") });
  console.log(`${pasa ? "PASA" : "FALLA"}  ${id}  ${detalle ?? ""}`);
}
function mide(id, v) {
  medidas[id] = v;
  console.log(`  ·   ${id} = ${JSON.stringify(v)?.slice(0, 200)}`);
}
function pendiente(id, texto) {
  pendientes.push({ id, texto });
  console.log(`  ⏳  ${id}  ${texto}`);
}
const lee = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
};
const corre = (cmd, argv, cwd = APP, env = {}) => {
  const r = spawnSync(cmd, argv, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
  };
};
const node = process.env.NODE_BIN ?? process.execPath;
const bin = join(APP, "node_modules/.bin/agent-native");

// ═════════════════ R1–R4 · «una aplicación funcional, con el framework» ═════════════════
console.log("\n── R1–R4 · la aplicación compila, pasa tipos y el doctor ──");
if (rápido) {
  mide("r1-build", "omitido (--rapido)");
} else {
  const b = corre(bin, ["build"]);
  anota("r1-build-limpio", b.code === 0, b.code === 0 ? "`agent-native build` termina" : b.out.slice(-300));
}
const t = corre(bin, ["typecheck"]);
anota("r2-typecheck-limpio", t.code === 0, t.code === 0 ? "sin errores de tipos" : t.out.slice(-300));

const d = corre(bin, ["doctor"]);
anota(
  "r3-doctor-limpio",
  d.code === 0 && /clean|no findings|sin hallazgos/i.test(d.out),
  d.out.trim().split("\n").slice(-2).join(" · ").slice(0, 200),
);
const manifiesto = (() => {
  try {
    return JSON.parse(lee(join(APP, "agent-native.json")));
  } catch {
    return {};
  }
})();
mide("r3-guardas-desactivadas", manifiesto?.doctor?.disabledGuards ?? []);
anota(
  "r3b-ninguna-guarda-del-doctor-desactivada",
  (manifiesto?.doctor?.disabledGuards ?? []).length === 0,
  JSON.stringify(manifiesto?.doctor ?? {}),
);

// R4 · el repo no tiene pruebas propias: `pnpm test` pasa porque las omite.
const archivosPrueba = [];
(function busca(dir, prof = 0) {
  if (prof > 4) return;
  let entradas = [];
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entradas) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) busca(p, prof + 1);
    else if (/\.(test|spec)\.(m?[jt]sx?)$/.test(e.name)) archivosPrueba.push(p);
  }
})(APP);
mide("r4-archivos-de-prueba-en-la-app", archivosPrueba.length);
const scriptTest = (() => {
  try {
    return JSON.parse(lee(join(APP, "package.json"))).scripts?.test ?? "";
  } catch {
    return "";
  }
})();
anota(
  "r4-pnpm-test-ejecuta-pruebas-de-verdad",
  archivosPrueba.length > 0,
  archivosPrueba.length === 0
    ? `0 archivos *.test.* / *.spec.*; \`pnpm test\` = "${scriptTest}" pasa en vacío`
    : `${archivosPrueba.length} archivos`,
);

// ═════════════════ R5–R6 · «identificar trabajo previo y terceros» ═════════════════
console.log("\n── R5–R6 · trabajo previo, plantilla y licencias ──");
const envío = lee(join(REPO, "ENVIO_HACKATHON.md"));
anota(
  "r5-declara-el-trabajo-previo",
  /Prior work/i.test(envío) && /before October 27, 2026/i.test(envío),
  /Prior work/i.test(envío) ? "«Prior work» con fecha de corte" : "no encontré la declaración",
);
anota(
  "r5b-declara-la-plantilla-y-su-licencia",
  /Agent-Native Chat template \(MIT\)/i.test(envío) &&
    existsSync(join(APP, "LICENSE.agent-native.txt")),
  `texto: ${/template \(MIT\)/i.test(envío)} · LICENSE.agent-native.txt: ${existsSync(join(APP, "LICENSE.agent-native.txt"))}`,
);
anota(
  "r5c-declara-lo-construido-durante-el-evento",
  /Built during the hackathon/i.test(envío),
  /Built during the hackathon/i.test(envío) ? "«Built during the hackathon» presente" : "falta",
);

// R6 · el inventario de licencias cubre las dependencias directas.
let inventario = { packages: [] };
try {
  inventario = JSON.parse(lee(join(REPO, "evidencia/licencias/dependencias-node.json")));
} catch {}
const enInventario = new Set((inventario.packages ?? []).map((p) => p.name));
let pkg = {};
try {
  pkg = JSON.parse(lee(join(APP, "package.json")));
} catch {}
/** "typescript-7": "npm:typescript@^7" se inventaría por su nombre real. */
const nombreReal = (nombre, rango) => {
  const m = /^npm:(@?[^@]+(?:\/[^@]+)?)@/.exec(String(rango ?? ""));
  return m ? m[1] : nombre;
};
const directas = [
  ...Object.entries(pkg.dependencies ?? {}),
  ...Object.entries(pkg.devDependencies ?? {}),
].map(([n, r]) => nombreReal(n, r));
const sinLicencia = directas.filter((n) => !enInventario.has(n));
mide("r6-paquetes-en-el-inventario", enInventario.size);
mide("r6-dependencias-directas", directas.length);
anota(
  "r6-el-inventario-cubre-las-dependencias-directas",
  sinLicencia.length === 0,
  sinLicencia.length ? `faltan ${sinLicencia.length}: ${sinLicencia.slice(0, 8).join(", ")}` : "todas presentes",
);
const sinCampoLicencia = (inventario.packages ?? []).filter((p) => !p.license);
anota(
  "r6b-todo-paquete-inventariado-dice-su-licencia",
  sinCampoLicencia.length === 0,
  sinCampoLicencia.length
    ? `${sinCampoLicencia.length} sin campo license: ${sinCampoLicencia.slice(0, 5).map((p) => p.name).join(", ")}`
    : "todos con licencia",
);
anota(
  "r6c-avisos-de-terceros-presentes",
  existsSync(join(REPO, "evidencia/licencias/THIRD_PARTY_NOTICES.txt")) &&
    existsSync(join(REPO, "evidencia/licencias/dependencias-python.json")),
  "THIRD_PARTY_NOTICES.txt y dependencias-python.json",
);

// ═════════════════ R7–R9 · secretos y datos ═════════════════
console.log("\n── R7–R9 · secretos, historial y datos ficticios ──");
/**
 * `\s*` cruzaría el salto de línea y haría coincidir un `VAR=` vacío con la
 * línea siguiente: de ahí dos falsos positivos en la primera pasada. Aquí los
 * valores se exigen en la misma línea y sin empezar por `#`.
 * La contraseña del demo (`demo-megi-2026`) no es un secreto: la declara
 * `seed_demo.py` como `DEFAULT_PASSWORD` para una demo local y ficticia. Lo
 * que se busca es cualquier OTRA contraseña, que sí sería de una instalación.
 */
const DEMO_PW = "demo-megi-2026";
/** `VAR=valor` pegado, al principio de línea o tras un espacio, con valor. */
const asignada = (nombre, salvo) =>
  new RegExp(
    `(?:^|\\s)(?:export\\s+)?${nombre}=(?!${salvo ? `${salvo}(?:\\s|$)|` : ""}[ \\t]*$)[^\\s#]+`,
    "m",
  );
const PATRONES = [
  ["clave de OpenAI/xAI", /\b(sk|xai)-[A-Za-z0-9_-]{16,}/],
  ["clave de Anthropic", /\bsk-ant-[A-Za-z0-9_-]{16,}/],
  ["clave de Google", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["token de GitHub", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["clave privada", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  // La forma importa: `VAR=valor` de un .env o de una línea de shell. Un
  // `const MEGI_PASSWORD = process.env.MEGI_PASSWORD` de JavaScript no es una
  // credencial, y en la primera pasada el buscador se señalaba a sí mismo.
  ["secreto de better-auth", asignada("BETTER_AUTH_SECRET")],
  ["contraseña de MEGI que no es la del demo", asignada("MEGI_PASSWORD", DEMO_PW)],
  ["secreto de MEGI asignado", asignada("MEGI_SECRET")],
];
const rastrea = (texto) =>
  PATRONES.filter(([, re]) => re.test(texto)).map(([n]) => n);

// Árbol versionado (sin node_modules ni binarios).
const versionados = corre("git", ["-C", REPO, "ls-files"], REPO).out.trim().split("\n").filter(Boolean);
const fugasÁrbol = [];
for (const rel of versionados) {
  if (/\.(png|jpg|jpeg|webm|mp4|woff2?|ico|pdf|sqlite)$/i.test(rel)) continue;
  const p = join(REPO, rel);
  let st;
  try {
    st = statSync(p);
  } catch {
    continue;
  }
  if (st.size > 2_000_000) continue;
  const hits = rastrea(lee(p));
  if (hits.length) fugasÁrbol.push({ archivo: rel, hits });
}
anota(
  "r7-sin-secretos-en-el-arbol-versionado",
  fugasÁrbol.length === 0,
  fugasÁrbol.length ? JSON.stringify(fugasÁrbol).slice(0, 220) : `${versionados.length} archivos revisados`,
);
anota(
  "r7b-el-env-no-esta-versionado",
  !versionados.some((f) => /(^|\/)\.env$/.test(f)),
  versionados.filter((f) => /\.env/.test(f)).join(", ") || "solo .env.example",
);
const ejemplo = lee(join(APP, ".env.example"));
const ejemploVacío = /MEGI_PASSWORD=[ \t]*$/m.test(ejemplo);
anota(
  "r7c-el-env-de-ejemplo-no-trae-valores",
  ejemploVacío,
  ejemploVacío ? "MEGI_PASSWORD y BETTER_AUTH_SECRET vacíos o comentados" : "trae un valor",
);
anota(
  "r7d-la-contrasena-del-demo-esta-declarada-como-tal",
  /DEFAULT_PASSWORD\s*=\s*"demo-megi-2026"/.test(
    lee(join(REPO, "megi-demo/backend/seed_demo.py")),
  ),
  "seed_demo.py la declara y acepta --password para cambiarla",
);

// R8 · historial.
const tam = corre("git", ["-C", REPO, "count-objects", "-vH"], REPO).out;
const mb = Number((tam.match(/size-pack: ([\d.]+) MiB/) ?? [])[1] ?? 0);
mide("r8-tamano-del-paquete-git-mib", mb);
if (mb > 400) {
  pendiente("r8-historial", `paquete de ${mb} MiB: revisión del historial omitida por tamaño`);
} else {
  const hist = corre("git", ["-C", REPO, "log", "--all", "-p", "--no-color"], REPO);
  const hits = rastrea(hist.out);
  anota(
    "r8-sin-secretos-en-el-historial",
    hits.length === 0,
    hits.length ? hits.join(", ") : `${(hist.out.length / 1e6).toFixed(1)} MB de diffs revisados`,
  );
}

// R9 · datos ficticios.
const seed = lee(join(REPO, "megi-demo/backend/seed_demo.py"));
const nombres = [...seed.matchAll(/"name":\s*"([^"]+)"/g)].map((m) => m[1]);
const ficticios = nombres.filter((n) =>
  /ficticia|ficticio|demo|ejemplo|prueba|muestra|simulado|modelo/i.test(n),
);
mide("r9-nombres-en-la-siembra", nombres);
anota(
  "r9-todos-los-pacientes-son-declaradamente-ficticios",
  nombres.length > 0 && ficticios.length === nombres.length,
  `${ficticios.length}/${nombres.length} con marca de ficticio`,
);
const nss = [...seed.matchAll(/"nss":\s*"(\d+)"/g)].map((m) => m[1]);
anota(
  "r9b-los-identificadores-son-de-relleno",
  nss.every((n) => /^(\d)\1*$/.test(n) || /0123456789|1234567890|12345678901|23456789012|34567890123|45678901234/.test(n)),
  nss.join(", ") || "sin NSS en la siembra",
);
anota(
  "r9c-la-app-avisa-de-que-la-demo-es-ficticia",
  /ficticio|ficticia/i.test(lee(join(APP, "app/components/revision/BannerDemo.tsx"))),
  "BannerDemo.tsx menciona datos ficticios",
);

// ═════════════════ R10–R13 · plazos, demo y procedencia ═════════════════
console.log("\n── R10–R13 · plazo, demo accesible, afirmaciones y procedencia ──");
const reglas = lee(join(REPO, "evidencia/bases/reglas.html"));
anota(
  "r10-el-plazo-declarado-coincide-con-las-bases",
  /9 nov 2026, 11:59 PM PT/.test(envío) &&
    /November 9, 2026, at 11:59 PM PT/.test(reglas.replace(/<[^>]+>/g, " ")),
  "ENVIO y bases dicen 9-nov-2026 23:59 PT",
);
anota(
  "r10b-las-bases-quedaron-guardadas-con-su-huella",
  existsSync(join(REPO, "evidencia/bases/fuentes.json")) &&
    /sha256/.test(lee(join(REPO, "evidencia/bases/fuentes.json"))),
  "fuentes.json con sha256 de reglas, formulario y evento",
);

// Accesibilidad de la demo: las bases exigen un Clips público sin sesión.
const clip = /Public Clips recording URL\s*\|\s*([^|]*)\|/.exec(envío)?.[1]?.trim() ?? "";
const enlaceClip = /https?:\/\/\S+/.test(clip);
if (!enlaceClip) {
  pendiente(
    "r11-clips-publico",
    "sin enlace de Clips en ENVIO_HACKATHON.md: la demo accesible que exigen las bases está pendiente (publicación detenida por decisión del equipo)",
  );
}
anota(
  "r11b-el-borrador-no-finge-que-ya-se-envio",
  /publicación y envío detenidos/i.test(envío) && /no acredita una inscripción/i.test(envío),
  "el documento dice explícitamente que no se ha enviado",
);
anota(
  "r11c-el-video-viejo-esta-marcado-como-no-valido",
  /No acreditan las correcciones actuales/i.test(envío),
  "evidencia/video/demo-grok.* marcado como anterior a la auditoría",
);

// R12 · nada de afirmaciones clínicas.
const textos = ["ESTADO.md", "ENVIO_HACKATHON.md", "megi-revision/README.md", "evidencia/README.md"]
  .map((f) => lee(join(REPO, f)))
  .join("\n");
const afirmaciones = [
  /validad[oa] clínicamente/i,
  /aprobad[oa] por (la )?(COFEPRIS|FDA)/i,
  /uso clínico real/i,
  /sustituye (el|al) (juicio|criterio) (del|médico)/i,
].filter((re) => re.test(textos));
anota(
  "r12-sin-afirmaciones-de-validacion-clinica",
  afirmaciones.length === 0,
  afirmaciones.length ? `${afirmaciones.length} afirmación(es) por revisar` : "ninguna",
);
anota(
  "r12b-se-declara-apoyo-a-la-decision",
  /decision support/i.test(envío) && /aprobación final.*médico|final approval is always the physician/i.test(envío),
  "«decision support» y aprobación final del médico",
);

// R13 · procedencia.
let proc = {};
try {
  proc = JSON.parse(lee(join(REPO, "evidencia/procedencia-git.json")));
} catch {}
const head = corre("git", ["-C", REPO, "rev-parse", "HEAD"], REPO).out.trim();
mide("r13-head-del-repo", head.slice(0, 12));
anota(
  "r13-la-procedencia-esta-registrada",
  Object.keys(proc).length > 0,
  Object.keys(proc).slice(0, 6).join(", ") || "procedencia-git.json ausente o ilegible",
);
// Correr una batería reescribe su propio JSON de resultados, así que esos
// archivos no cuentan: lo que se exige es que no haya código ni documentos sin
// commitear.
const sueltos = corre("git", ["-C", REPO, "status", "--porcelain"], REPO)
  .out.trim()
  .split("\n")
  .filter(Boolean)
  .filter((l) => !/pruebas-hackathon\/.*-(resultados|antes)\.json$/.test(l));
anota(
  "r13b-el-arbol-no-tiene-cambios-sueltos",
  sueltos.length === 0,
  sueltos.slice(0, 4).join(" · ") || "sin código ni documentos sin commitear",
);

// ═════════════════ R14 · cómo se sirve la demo ═════════════════
console.log("\n── R14 · cómo puede verla un juez ──");
mide(
  "r14-arranque-de-produccion",
  "`agent-native start` con PGlite responde 503 (DEPLOY_SETTINGS_REQUIRED): producción exige un Postgres gestionado",
);
anota(
  "r14-el-repo-explica-como-verla",
  /pnpm dev|start_demo\.sh/i.test(lee(join(REPO, "megi-revision/README.md")) + envío),
  "ENVIO/README describen el arranque local con `pnpm dev` y la siembra de demo",
);
anota(
  "r14b-hay-un-camino-de-migracion-a-postgres",
  existsSync(join(APP, "scripts/migrate-production.ts")) &&
    /migrate:production/.test(JSON.stringify(pkg.scripts ?? {})),
  "scripts/migrate-production.ts + script `migrate:production`",
);

// ═════════════════ resumen ═════════════════
const fallos = checks.filter((c) => !c.pasa);
const salida = {
  bateria: "fase 2 · bloque R (requisitos de la revisión del hackatón)",
  cuando: new Date().toISOString(),
  repo: REPO,
  app: APP,
  head,
  node: process.version,
  total: checks.length,
  pasan: checks.length - fallos.length,
  fallan: fallos.length,
  medidas,
  pendientes,
  checks,
};
const destino = join(aquí, "requisitos-resultados.json");
writeFileSync(destino, JSON.stringify(salida, null, 2) + "\n");
console.log(
  `\n${salida.pasan}/${salida.total} · ${fallos.length} FALLA · ${pendientes.length} pendiente(s) · ${destino}`,
);
if (fallos.length) console.log("fallan: " + fallos.map((f) => f.id).join(", "));
if (pendientes.length)
  console.log("pendientes: " + pendientes.map((p) => p.id).join(", "));
if (fallos.length) process.exitCode = 1;
