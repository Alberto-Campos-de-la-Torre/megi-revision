import { chromium } from "playwright";
import { entrar, resultado } from "./comun.mjs";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: "es-MX" });
  await entrar(page, "/revision/demo-c2");
  const boton = page.locator('header[data-mobile-app-bar] button[aria-pressed="false"]');
  if (await boton.count()) await boton.click();
  await page.getByRole("button", { name: "Ayúdame con esta revisión", exact: true }).waitFor({ state: "visible", timeout: 30000 });
  const ingles = await page.getByRole("button", { name: /Help me with this|Explain what I am looking at/ }).count();
  if (ingles) throw new Error("El panel sustituyó las sugerencias en español");
  await page.screenshot({ path: new URL("capturas/sugerencias-espanol.png", import.meta.url).pathname, fullPage: true });
  resultado("sugerencias", [{ prueba: "panel vacío conserva las sugerencias clínicas en español", pasa: true }]);
  console.log("Sugerencias clínicas en español: correctas.");
} finally { await browser.close(); }
