// Backend sintético y base SQL aislada; reutiliza la configuración del agente.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(new URL("../.demo/", import.meta.url), { recursive: true });
const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/@agent-native/core/bin/agent-native.js", import.meta.url)), "dev", ...process.argv.slice(2)], {
  cwd, stdio: "inherit", env: { ...process.env, MEGI_MODE: "mock", DATABASE_URL: `pglite:${fileURLToPath(new URL("../.demo/pglite", import.meta.url))}` },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 1));
