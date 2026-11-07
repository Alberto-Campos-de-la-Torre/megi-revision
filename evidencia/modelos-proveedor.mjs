// Uses the framework's read-only saved-provider model check; never reads a key.
import { chromium } from "playwright";
import { entrar, resultado } from "./comun.mjs";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ locale: "es-MX" });
  await entrar(page);
  const catalogo = await page.evaluate(async () => {
    const r = await fetch("/_agent-native/actions/check-provider-key", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "openai" }),
    });
    if (!r.ok) throw new Error(`No se pudo consultar el proveedor guardado: ${r.status}`);
    const d = await r.json();
    return { ok: d.ok === true, provider: d.provider, code: d.code,
      modelos: Array.isArray(d.models) ? d.models.filter(x => typeof x === "string") : [], checkedAt: d.checkedAt };
  });
  resultado("modelos-proveedor", [{ prueba: "catálogo del proveedor configurado consultado sin exponer credenciales", pasa: true }], { catalogo });
  console.log(JSON.stringify(catalogo, null, 2));
} finally { await browser.close(); }
