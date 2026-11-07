import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { entrar, resultado } from "./comun.mjs";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ locale: "es-MX" });
  await entrar(page);
  const configuracion = await page.evaluate(async () => {
    const r = await fetch("/_agent-native/actions/manage-agent-engine", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get-app-default", appId: "megi-revision" }),
    });
    if (!r.ok) throw new Error(`Lectura del modelo de app: ${r.status}`);
    const data = await r.json();
    if (data.ok !== true) throw new Error("Configuración de modelo no disponible");
    return data;
  });
  if (process.env.MEGI_APLICAR_MODELO_APP) {
    writeFileSync(new URL("resultados/modelo-app-antes.json", import.meta.url), JSON.stringify(configuracion, null, 2));
    const model = process.env.MEGI_APLICAR_MODELO_APP;
    const guardada = await page.evaluate(async model => {
      const call = async args => {
        const r = await fetch("/_agent-native/actions/manage-agent-engine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
        if (!r.ok) throw new Error(`Configuración del modelo: ${r.status}`);
        const data = await r.json();
        if (data.ok !== true) throw new Error("El framework no confirmó la configuración del modelo");
        return data;
      };
      await call({ action: "set-app-default", appId: "megi-revision", engine: "ai-sdk:openai", model });
      return call({ action: "get-app-default", appId: "megi-revision" });
    }, model);
    if (guardada.engine !== "ai-sdk:openai" || guardada.model !== model) throw new Error("El modelo leído no coincide con el solicitado");
    resultado("modelo-app", [{ prueba: "modelo predeterminado de MEGI guardado y verificado por lectura", pasa: true }], { anterior: configuracion, configuracion: guardada });
    console.log(JSON.stringify(guardada, null, 2));
  } else {
  resultado("modelo-app", [{ prueba: "lectura autenticada del modelo predeterminado de MEGI", pasa: true }], { configuracion });
  console.log(JSON.stringify(configuracion, null, 2));
  }
} finally { await browser.close(); }
