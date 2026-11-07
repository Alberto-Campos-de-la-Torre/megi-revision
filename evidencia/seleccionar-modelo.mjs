import { mkdirSync, writeFileSync } from "node:fs";
import { BASE, VARIANTE, resultado } from "./comun.mjs";
const ruta = new URL(`.runtime/seleccion-${VARIANTE || "modelo"}.json`, import.meta.url);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function leer(page, provider) {
  return page.evaluate(async providerId => {
    const r = await fetch(`/_agent-native/actions/get-provider-models?provider=${providerId}`);
    if (!r.ok) throw new Error(`Lectura de selección: ${r.status}`);
    const body = await r.json();
    const provider = body.providers?.find(p => p.provider === providerId);
    if (!provider || provider.state === "unreadable" || !provider.scope) throw new Error("Selección local no legible");
    return provider;
  }, provider);
}
async function escribir(page, args) {
  await page.evaluate(async args => {
    const r = await fetch("/_agent-native/actions/manage-provider-models", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`Escritura de selección temporal: ${r.status}`);
  }, args);
}
export async function prepararComparacion(page, model, provider = "ollama") {
  if (!["ollama", "openai"].includes(provider)) throw new Error("Proveedor de comparación inválido");
  if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname) || !(await page.locator("body").innerText()).includes("dev@local.test")) throw new Error("La comparación solo se ejecuta en la demo local del usuario sintético");
  const previa = await leer(page, provider);
  const scope = previa.scope;
  const original = previa.rows[scope]?.models;
  if (original !== null && !Array.isArray(original)) throw new Error("No se pudo conservar la selección anterior");
  const aplicada = [...new Set([...(original ?? []), model])];
  mkdirSync(new URL(".runtime/", import.meta.url), { recursive: true });
  const estado = { provider, scope, original, aplicada, restaurada: false };
  writeFileSync(ruta, JSON.stringify(estado, null, 2));
  const restaurar = async () => {
    const actual = (await leer(page, provider)).rows[scope].models;
    if (!igual(actual, original)) {
      if (!igual(actual, aplicada)) throw new Error("La selección cambió fuera de la comparación; no se sobrescribe");
      await escribir(page, { action: original === null ? "reset" : "set", provider, scope, ...(original === null ? {} : { models: original }) });
    }
    if (!igual((await leer(page, provider)).rows[scope].models, original)) throw new Error("La selección anterior no quedó restaurada");
    estado.restaurada = true;
    writeFileSync(ruta, JSON.stringify(estado, null, 2));
    resultado("seleccion-comparacion", [{ prueba: "lista de modelos anterior restaurada tras la comparación", pasa: true }], { modelo: model, scope });
  };
  try { await escribir(page, { action: "set", provider, scope, models: aplicada }); }
  catch (e) { await restaurar(); throw e; }
  return {
    restaurar,
    seleccionar: async () => {
      const catalogo = page.waitForResponse(r => r.url().includes("/_agent-native/actions/manage-agent-engine") && r.status() < 400, { timeout: 30000 });
      await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
      await catalogo;
      const boton = page.locator("button.agent-composer-model-button").last();
      const normalizar = value => value.toLowerCase().replace(/[^a-z0-9]/g, "");
      await boton.waitFor({ timeout: 30000 });
      if (!normalizar(await boton.innerText()).includes(normalizar(model))) {
        await boton.click();
        const fila = page.locator(`[data-agent-composer-model-row="${model}"]`);
        if (!(await fila.count())) await page.locator('[data-agent-composer-model-section="more"]').hover();
        await fila.waitFor({ state: "visible", timeout: 30000 });
        await fila.click();
      }
      await page.waitForFunction(model => {
        const normalizar = value => value.toLowerCase().replace(/[^a-z0-9]/g, "");
        return [...document.querySelectorAll("button.agent-composer-model-button")].some(b => normalizar(b.textContent).includes(normalizar(model)));
      }, model, { timeout: 10000 });
      console.log(`Modelo seleccionado en el navegador de prueba: ${model}`);
    },
  };
}
