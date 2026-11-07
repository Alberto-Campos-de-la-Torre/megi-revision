import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const agenteFast = process.argv.includes("--agente-fast");
if (agenteFast) { process.env.MEGI_EVIDENCIA_SUFIJO = "grok-420"; process.env.MEGI_BENCH_MODEL = "grok-4.20-0309-non-reasoning"; process.env.MEGI_BENCH_PROVIDER = "openai"; }
const agenteLocal = process.argv.includes("--agente-local");
if (agenteLocal) { process.env.MEGI_EVIDENCIA_SUFIJO = "qwen-local"; process.env.MEGI_BENCH_MODEL = "qwen2.5-14b-32k:latest"; }
const configurarApp = process.argv.includes("--modelo-app-fast");
if (configurarApp) process.env.MEGI_APLICAR_MODELO_APP = "grok-4.20-0309-non-reasoning";
const modeloApp = configurarApp || process.argv.includes("--modelo-app");
const sugerencias = process.argv.includes("--sugerencias");
const xai = process.argv.includes("--modelos-xai");
const proveedor = process.argv.includes("--modelos-proveedor");
const modelos = process.argv.includes("--modelos");
const diagnostico = process.argv.includes("--diagnostico");
const scripts = modeloApp ? ["modelo-app"] : sugerencias ? ["sugerencias"] : xai ? ["modelos-xai"] : proveedor ? ["modelos-proveedor"] : modelos ? ["modelos"] : diagnostico ? ["diagnostico-latencia"] : (agenteFast || agenteLocal || process.argv.includes("--agente")) ? ["agente"] : ["recorrido", "advertencias"];
const resultados = [];
for (const s of scripts) {
  let salida = "";
  const codigo = await new Promise(resolve => {
    const p = spawn(process.execPath, [new URL(`${s}.mjs`, import.meta.url).pathname], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [p.stdout, p.stderr]) stream.on("data", d => { salida += d; process.stdout.write(d); });
    p.on("exit", resolve);
  });
  resultados.push({ script: s, codigo });
  mkdirSync(new URL("resultados/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`resultados/${s}${process.env.MEGI_EVIDENCIA_SUFIJO ? `-${process.env.MEGI_EVIDENCIA_SUFIJO}` : ""}.log`, import.meta.url), salida);
}
writeFileSync(new URL(`resultados/${modeloApp ? "modelo-app-suite" : sugerencias ? "sugerencias-suite" : agenteFast ? "agente-fast-suite" : xai ? "xai-suite" : proveedor ? "proveedor-suite" : agenteLocal ? "agente-local-suite" : modelos ? "modelos-suite" : diagnostico ? "diagnostico-suite" : process.argv.includes("--agente") ? "agente-suite" : "ui-suite"}.json`, import.meta.url), JSON.stringify({ fecha: new Date().toISOString(), resultados }, null, 2));
process.exitCode = resultados.some(r => r.codigo !== 0) ? 1 : 0;
