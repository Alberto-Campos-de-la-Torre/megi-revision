// Starts a backend with an explicitly isolated SQLite database. No clinic data.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("../megi-demo/backend/", import.meta.url));
const runtime = fileURLToPath(new URL(".runtime/backend/", import.meta.url));
mkdirSync(runtime, { recursive: true });
const env = { ...process.env, MEGI_DB: `${runtime}megi.sqlite`, MEGI_STATE_DIR: `${runtime}state`, MEGI_MODE: "local_mock", MEGI_PBKDF2_ITERS: "100000", MEGI_DEMO_PORT: process.env.MEGI_DEMO_PORT ?? "8123" };
async function ejecutar(cmd, args) { return new Promise(resolve => { const p = spawn(cmd, args, { cwd, env, stdio: "inherit" }); p.on("exit", resolve); }); }
// This script seeds only the dedicated evidence path above.
if (await ejecutar(".venv/bin/python", ["seed_demo.py"]) !== 0) process.exit(1);
// Segundo médico ficticio (I2): cuenta, paciente y consultas propios, aislados del primero.
if (await ejecutar(".venv/bin/python", [fileURLToPath(new URL("sembrar-medico-b.py", import.meta.url))]) !== 0) process.exit(1);
const server = spawn("bash", ["start_demo.sh"], { cwd, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", code => process.exit(code ?? 1));
