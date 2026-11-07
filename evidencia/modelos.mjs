// Read-only model catalog. No default, thread, provider or credential changes.
import { chromium } from "playwright";
import { entrar, resultado } from "./comun.mjs";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ locale: "es-MX" });
  await entrar(page);
  const catalogo = await page.evaluate(async () => {
    const response = await fetch("/_agent-native/actions/manage-agent-engine", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }),
    });
    if (!response.ok) throw new Error(`Catálogo no disponible: ${response.status}`);
    const datos = await response.json();
    if (!Array.isArray(datos.engines)) throw new Error("Formato de catálogo inesperado");
    let ollama = { disponible: false, modelos: [] };
    try {
      const r = await fetch("/_agent-native/agent-engine/ollama-models", { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const body = await r.json();
        ollama = { disponible: body.ok === true, modelos: Array.isArray(body.models) ? body.models.filter(x => typeof x === "string") : [] };
      }
    } catch { /* A configured local engine may have no running service. */ }
    return {
      ollama,
      actual: { engine: datos.current?.engine, model: datos.current?.model },
      motores: datos.engines.map(e => ({ name: e.name, defaultModel: e.defaultModel,
        supportedModels: e.supportedModels, runtimeSupportedModels: e.runtimeSupportedModels,
        modelSelection: e.modelSelection, acceptsCustomModels: e.acceptsCustomModels, configured: e.configured,
        packageInstalled: e.packageInstalled, credentialRejected: e.credentialRejected })),
    };
  });
  resultado("modelos", [{ prueba: "catálogo autenticado de opciones, sin cambiar la selección", pasa: true }], { catalogo });
  console.log(JSON.stringify({ actual: catalogo.actual, configurados: catalogo.motores.filter(e => e.configured).map(e => e.name), ollama: catalogo.ollama }, null, 2));
} finally { await browser.close(); }
