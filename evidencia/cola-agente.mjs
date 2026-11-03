// Segunda mitad: el naproxeno ya está bloqueado por el médico; se pide al agente que lo quite.
import { chromium } from "playwright";
const BASE = "http://localhost:8080";
const OUT = new URL("./capturas/", import.meta.url).pathname;
let fallos = 0; const ok = (c, m) => { console.log(`${c ? "✔" : "✘"} ${m}`); if (!c) fallos++; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: "es-MX" });
try {
  await page.goto(`${BASE}/revision/demo-c2`, { waitUntil: "networkidle" });
  const dev = page.getByRole("button", { name: /local dev|desarrollador local/i });
  if (await dev.count()) { await dev.first().click(); await page.waitForURL(/revision/, { timeout: 30000 }); await page.waitForLoadState("networkidle"); }
  const nap = page.locator("li[data-linea-id]", { hasText: "Naproxeno" });
  await nap.getByText("Bloqueada por el médico").waitFor({ timeout: 30000 });
  // Abrir la barra del agente con la petición del médico (misma vía que el botón «Pedir reajuste»).
  await page.getByRole("button", { name: "Pedir reajuste al agente" }).click();
  const caja = page.getByRole("textbox").last();
  await caja.waitFor({ timeout: 20000 });
  await caja.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" quita el naproxeno del plan y deja todo lo demás igual.");
  await page.keyboard.press("Enter");
  await page.screenshot({ path: `${OUT}24-peticion-reajuste.png`, fullPage: true });
  const t0 = Date.now(); let respuesta = "";
  while (Date.now() - t0 < 420000) {
    const txt = await page.locator("body").innerText();
    const m = txt.match(/Trabajó durante[^\n]*/g);
    // Esperamos una respuesta nueva (segundo «Trabajó durante») que mencione el bloqueo.
    if (m && m.length >= 2 && /bloquead/i.test(txt)) { respuesta = txt; break; }
    await page.waitForTimeout(4000);
  }
  await page.screenshot({ path: `${OUT}25-agente-respeta-bloqueo.png`, fullPage: true });
  ok(await nap.getByText("Bloqueada por el médico").count() === 1, "el naproxeno bloqueado sigue intacto tras pedir al agente que lo quite");
  ok(await nap.getByText("Rechazada").count() === 0, "no quedó rechazado");
  ok(Boolean(respuesta), `el agente respondió explicando el bloqueo en ${Math.round((Date.now() - t0) / 1000)} s`);
  const frag = respuesta.split("Trabajó durante").slice(-2, -1)[0] ?? "";
  console.log("   extracto: " + frag.replace(/\s+/g, " ").slice(-400));
} catch (e) { fallos++; console.log("✘ excepción:", e.message.split("\n")[0]); await page.screenshot({ path: `${OUT}29-error.png`, fullPage: true }).catch(() => {}); }
console.log(fallos ? `${fallos} fallos` : "segunda mitad correcta");
await browser.close(); console.log("FIN-COLA"); process.exit(fallos ? 1 : 0);
