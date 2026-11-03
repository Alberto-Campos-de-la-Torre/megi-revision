// Ejercita al agente en vivo: abre demo-c1, pide la propuesta y espera a que cree el plan.
import { chromium } from "playwright";
const BASE = "http://localhost:8080";
const OUT = new URL("./capturas/", import.meta.url).pathname;
let fallos = 0; const ok = (c, m) => { console.log(`${c ? "✔" : "✘"} ${m}`); if (!c) fallos++; };
const red = []; const consola = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: "es-MX" });
page.on("console", (m) => { if (m.type() === "error") consola.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) red.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
const foto = (n) => page.screenshot({ path: `${OUT}${n}.png`, fullPage: true });
try {
  await page.goto(`${BASE}/revision/demo-c2`, { waitUntil: "networkidle" });
  const dev = page.getByRole("button", { name: /local dev|desarrollador local/i });
  if (await dev.count()) { await dev.first().click(); await page.waitForURL(/revision/, { timeout: 30000 }); await page.waitForLoadState("networkidle"); }
  await page.getByRole("button", { name: "Pedir propuesta al agente" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Pedir propuesta al agente" }).click();
  await page.waitForTimeout(3000);
  await foto("20-agente-peticion");
  const cuerpo = async () => page.locator("body").innerText();
  ok(/Conectar IA/.test(await cuerpo()) === false, "el agente está conectado (no aparece «Conectar IA»)");
  // Espera a que el plan aparezca en el tablero (la acción proponer-plan refresca la vista).
  const inicio = Date.now();
  let planVisible = false;
  while (Date.now() - inicio < 420000) {
    if (await page.getByText("Plan en revisión").count()) { planVisible = true; break; }
    await page.waitForTimeout(3000);
  }
  await foto("21-agente-respuesta");
  ok(planVisible, `el agente creó el plan en ${Math.round((Date.now() - inicio) / 1000)} s`);
  if (planVisible) {
    const texto = await cuerpo();
    ok(/Propuesta por el agente/.test(texto), "líneas marcadas «Propuesta por el agente»");
    ok(/Explicación del agente/.test(texto), "explicación del agente visible en el tablero");
    const nLineas = await page.locator("li[data-linea-id]").count();
    ok(nLineas >= 2, `el plan tiene ${nLineas} líneas`);
    console.log(`   advertencia AINE/HTA visible: ${/Advertencia/.test(texto) ? "sí" : "no"} · verificado: ${/Verificado/.test(texto) ? "sí" : "no"}`);
    await page.getByRole("tab", { name: /Cambios/ }).click();
    await page.waitForTimeout(500);
    ok(/Agente/.test(await cuerpo()), "la bitácora registra al agente como actor");
    await foto("22-bitacora-agente");
    // Segunda vuelta: el médico bloquea una línea y pide reajuste que la toca.
    await page.getByRole("tab", { name: "Plan" }).click();
    const primera = page.locator("li[data-linea-id]").first();
    const nombre = (await primera.locator("span.font-medium").first().innerText()).trim();
    await primera.getByRole("button", { name: "Bloquear" }).click();
    await primera.getByText("Bloqueada por el médico").waitFor({ timeout: 15000 });
    const composer = page.locator("textarea").last();
    await composer.fill(`Quita ${nombre} del plan y déjalo todo lo demás igual.`);
    await composer.press("Enter");
    const t2 = Date.now();
    let respondio = false;
    while (Date.now() - t2 < 300000) {
      const t = await cuerpo();
      if (/bloquead/i.test(t.split("Pregúntame").pop() ?? t) && Date.now() - t2 > 8000) { respondio = true; break; }
      await page.waitForTimeout(3000);
    }
    await foto("23-agente-respeta-bloqueo");
    ok(await primera.getByText("Bloqueada por el médico").count() === 1, `la línea bloqueada (${nombre}) sigue intacta tras pedir al agente que la quite`);
    ok(respondio, "el agente explica que no puede tocar la línea bloqueada");
  }
} catch (e) { fallos++; console.log("✘ excepción:", e.message.split("\n")[0]); await foto("29-error").catch(() => {}); }
const inesperados = red.filter((r) => !/favicon|\.map$|actions\/(proponer|actualizar|reajustar|aprobar)/.test(r));
console.log(`red con error: ${inesperados.length}`); inesperados.forEach((r) => console.log("  " + r));
console.log(`consola: ${consola.filter((c) => !/script tag while rendering/.test(c)).length}`);
console.log(fallos ? `${fallos} fallos` : "agente en vivo: correcto");
await browser.close(); process.exit(fallos ? 1 : 0);
