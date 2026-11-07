// Read-only: only timing/token metadata from this signed-in user's traces.
// No prompts, tool arguments, results, credentials or patient data are saved.
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { entrar, resultado } from "./comun.mjs";
const idsMedidos = [];
for (const name of ["latencia.json", "latencia-grok-420.json", "latencia-qwen-local.json"]) {
  const path = new URL(`resultados/${name}`, import.meta.url);
  if (!existsSync(path)) continue;
  const data = JSON.parse(readFileSync(path, "utf8"));
  const eventos = data.etapas ?? [];
  const tabId = eventos.find(e => e.tool === "proponer-plan" && e.fecha >= data.inicioPropuesta)?.tabId;
  const runId = eventos.find(e => e.runId && e.isRunning && e.fecha >= data.inicioPropuesta && (!tabId || e.tabId === tabId))?.runId;
  if (runId) idsMedidos.push(runId);
}
const browser = await chromium.launch();
const page = await browser.newPage({ locale: "es-MX" });
try {
  await entrar(page);
  const trazas = await page.evaluate(async idsMedidos => {
    const base = "/_agent-native/observability/traces";
    const list = await fetch(`${base}?limit=8`);
    if (!list.ok) throw new Error(`No se pudieron leer las trazas propias: ${list.status}`);
    const rows = await list.json();
    if (!Array.isArray(rows)) throw new Error("Formato de trazas inesperado");
    const datos = [];
    for (const runId of new Set([...rows.map(row => row.runId), ...idsMedidos])) {
      const response = await fetch(`${base}/${encodeURIComponent(runId)}`);
      if (!response.ok) throw new Error(`No se pudo leer una traza propia: ${response.status}`);
      const { summary, spans } = await response.json();
      datos.push({ runId: summary.runId, modelo: summary.model, totalMs: summary.totalDurationMs, llamadasModelo: summary.llmCalls,
        spans: spans.map(s => ({ tipo: s.spanType, ms: s.durationMs, inputTokens: s.inputTokens, outputTokens: s.outputTokens, cacheReadTokens: s.cacheReadTokens, estado: s.status, metadataKeys: Object.keys(s.metadata ?? {}) })) });
    }
    return datos;
  }, idsMedidos);
  resultado("diagnostico-latencia", [{ prueba: "lectura autenticada de metadatos de trazas propias", pasa: true }], { trazas });
  console.log(JSON.stringify(trazas.map(t => ({ modelo: t.modelo, totalMs: t.totalMs, llamadasModelo: t.llamadasModelo, modeloMs: t.spans.filter(s => s.tipo === "llm_call").map(s => s.ms), herramientasMs: t.spans.filter(s => s.tipo === "tool_call").map(s => s.ms) })), null, 2));
} finally { await browser.close(); }
