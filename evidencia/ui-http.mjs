// Instancia de ensayo de la UI en MODO HTTP contra el backend de evidencia (:8123).
// Base SQL propia (PGlite) bajo evidencia/.runtime/ui-http/<variante>; no toca .demo/ ni data/.
// `pnpm demo` fuerza mock y NO sirve para esta prueba. Uso directo:
//   node evidencia/ui-http.mjs [--port 8084] [--sin-medicos] [--variante nombre]
// Como módulo: arrancarUi({ puerto, medicos, variante }) → { url, detener() }.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../megi-revision/", import.meta.url));
export const CORREO_DEV = "dev@local.test"; // cuenta local del framework («Continue as local dev»)

export async function arrancarUi({ puerto = 8084, medicos = CORREO_DEV, variante = "principal", limpiar = true, backend = process.env.MEGI_URL ?? "http://127.0.0.1:8123" } = {}) {
  const base = fileURLToPath(new URL(`.runtime/ui-http/${variante}/`, import.meta.url));
  if (limpiar) rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const env = {
    ...process.env,
    MEGI_MODE: "http",
    MEGI_URL: backend,
    // Cuenta de servicio compartida: la mitigación H2 solo deja usarla a MEGI_MEDICOS.
    MEGI_USER: process.env.MEGI_USER ?? "demo_medico",
    MEGI_PASSWORD: process.env.MEGI_PASSWORD ?? "demo-megi-2026",
    DATABASE_URL: `pglite:${base}pglite`,
  };
  if (medicos) env.MEGI_MEDICOS = medicos; else delete env.MEGI_MEDICOS;
  const child = spawn(process.execPath, [`${app}node_modules/@agent-native/core/bin/agent-native.js`, "dev", "--port", String(puerto), "--no-open"], { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] });
  let salida = "";
  for (const s of [child.stdout, child.stderr]) s.on("data", (d) => { salida += d; if (process.env.MEGI_UI_VERBOSE) process.stdout.write(d); });
  const url = `http://localhost:${puerto}`;
  const limite = Date.now() + 120_000;
  while (Date.now() < limite) {
    if (child.exitCode !== null) throw new Error(`La UI terminó antes de arrancar (código ${child.exitCode}):\n${salida.slice(-2000)}`);
    try { const r = await fetch(url, { redirect: "manual" }); if (r.status < 500) break; } catch { /* todavía no escucha */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (Date.now() >= limite) { child.kill("SIGTERM"); throw new Error(`La UI no respondió en ${url}:\n${salida.slice(-2000)}`); }
  return {
    url,
    variante,
    medicos,
    salida: () => salida,
    detener: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once("exit", () => r()); child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 10_000).unref(); }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const ui = await arrancarUi({ puerto: Number(arg("--port", 8084)), medicos: process.argv.includes("--sin-medicos") ? null : arg("--medicos", CORREO_DEV), variante: arg("--variante", "manual") });
  console.log(`UI http en ${ui.url} · MEGI_MEDICOS=${ui.medicos ?? "(sin lista)"} · Ctrl+C para detener`);
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, async () => { await ui.detener(); process.exit(0); });
}
