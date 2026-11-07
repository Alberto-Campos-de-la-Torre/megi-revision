import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const app = `${root}megi-revision`;
const checks = [
  ["typecheck", "pnpm", ["typecheck"], app],
  ["doctor", "pnpm", ["agent-native:doctor"], app],
  ["build", "pnpm", ["build"], app],
  ["auditoria-http", `${app}/node_modules/.bin/tsx`, ["evidencia/auditoria-hackathon.mts", "--http"], root],
  ["bateria-http", `${app}/node_modules/.bin/tsx`, ["pruebas-hackathon/bateria.mts", "--http"], root],
  ["revision-trazable", `${app}/node_modules/.bin/tsx`, ["pruebas-hackathon/revision-trazable.mts"], root],
];
mkdirSync(new URL("resultados/", import.meta.url), { recursive: true });
const resultados = [];
for (const [nombre, cmd, args, cwd] of checks) {
  const inicio = Date.now(); let salida = "";
  const codigo = await new Promise(resolve => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, MEGI_URL: process.env.MEGI_URL ?? "http://127.0.0.1:8123" }, stdio: ["ignore", "pipe", "pipe"] });
    for (const s of [p.stdout, p.stderr]) s.on("data", d => { salida += d; });
    p.on("exit", resolve); p.on("error", e => { salida += e.message; resolve(1); });
  });
  writeFileSync(new URL(`resultados/${nombre}.log`, import.meta.url), salida);
  resultados.push({ nombre, codigo, duracionMs: Date.now() - inicio });
  console.log(`${nombre}: ${codigo === 0 ? "OK" : "FALLO"}`);
}
writeFileSync(new URL("resultados/verificacion.json", import.meta.url), JSON.stringify({ fecha: new Date().toISOString(), resultados }, null, 2) + "\n");
process.exitCode = resultados.some(r => r.codigo !== 0) ? 1 : 0;
