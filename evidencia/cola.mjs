// Reanuda el recorrido desde el plan ya exportado de demo-c1 (sin repetir el flujo).
import { chromium } from "playwright";
const BASE = "http://localhost:8080";
const OUT = new URL("./capturas/", import.meta.url).pathname;
let fallos = 0; const ok = (c, m) => { console.log(`${c ? "✔" : "✘"} ${m}`); if (!c) fallos++; };
const redFallida = []; const consola = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "es-MX" });
page.on("console", (m) => { if (m.type() === "error") consola.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) redFallida.push(`${r.status()} ${r.url()}`); });
try {
  await page.goto(`${BASE}/revision/demo-c1`, { waitUntil: "networkidle" });
  const dev = page.getByRole("button", { name: /local dev|desarrollador local/i });
  if (await dev.count()) { await dev.first().click(); await page.goto(`${BASE}/revision/demo-c1`, { waitUntil: "networkidle" }); }
  await page.getByText("Aprobado y exportado", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${OUT}09-exportado.png`, fullPage: true });
  ok(await page.getByRole("button", { name: "Bloquear" }).count() === 0, "plan cerrado: sin botones de edición");
  await page.getByRole("tab", { name: "Exportación" }).click();
  await page.getByText(/sha256:/).first().waitFor({ timeout: 10000 });
  ok(await page.getByText(/MedicationRequest/).count() > 0, "FHIR con MedicationRequest y sello sha256 visibles");
  ok(await page.getByRole("button", { name: /Descargar FHIR/ }).count() === 1, "botón de descarga del FHIR");
  await page.screenshot({ path: `${OUT}10-exportacion.png`, fullPage: true });
  await page.getByRole("tab", { name: /Cambios/ }).click();
  await page.getByText("Aprobó y exportó").first().waitFor({ timeout: 10000 });
  ok(true, "bitácora registra la aprobación");
  await page.screenshot({ path: `${OUT}11-bitacora-final.png`, fullPage: true });
  await page.goto(`${BASE}/revision`, { waitUntil: "networkidle" });
  await page.getByText("Rosa Ficticia Muestra").waitFor({ timeout: 30000 });
  ok(await page.getByText("Alba Prueba Ficticia").count() === 0, "demo-c1 desaparece de pendientes");
  await page.screenshot({ path: `${OUT}12-lista-final.png`, fullPage: true });
  await page.goto(`${BASE}/revision/demo-c2`, { waitUntil: "networkidle" });
  await page.getByText("Mateo Ejemplo Demo").waitFor({ timeout: 30000 });
  ok(await page.getByText("Sin registro: confirmar con el paciente").count() > 0, "caso 2 avisa que no hay registro de alergias");
  await page.getByRole("button", { name: "Pedir propuesta al agente" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}13-agente-abierto.png`, fullPage: true });
  const textoLateral = await page.locator("body").innerText();
  ok(/Prepara la receta y los pendientes de la consulta demo-c2/.test(textoLateral), "el botón abre la barra del agente con la petición redactada");
} catch (e) { fallos++; console.log("✘ excepción:", e.message.split("\n")[0]); await page.screenshot({ path: `${OUT}99-error.png`, fullPage: true }).catch(() => {}); }
const inesperados = redFallida.filter((r) => !/favicon|\.map$|_agent-native\/actions\/(proponer|actualizar|aprobar)/.test(r));
console.log(`red con error (no esperados): ${inesperados.length}`); inesperados.forEach((r) => console.log("  " + r));
console.log(`consola con error: ${consola.filter((c) => !/script tag while rendering/.test(c)).length} (sin contar el aviso de la plantilla)`);
console.log(fallos ? `${fallos} fallos` : "cola del recorrido correcta");
await browser.close(); process.exit(fallos ? 1 : 0);
