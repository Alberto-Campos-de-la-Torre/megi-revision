import { mkdirSync, writeFileSync } from "node:fs";
export const VARIANTE = process.env.MEGI_EVIDENCIA_SUFIJO ?? "";
if (VARIANTE && !/^[a-z0-9-]+$/.test(VARIANTE)) throw new Error("Sufijo de evidencia inválido");
export const BASE = process.env.MEGI_UI_URL ?? "http://localhost:8082";
export async function entrar(page, ruta = "/revision") {
  await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
  const dev = page.getByRole("button", { name: /local dev|desarrollador local/i });
  if (await dev.count()) { await dev.first().click(); await page.waitForURL(/revision|home/, { timeout: 30000 }); await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" }); }
}
export async function restaurar(page) {
  await entrar(page);
  await page.getByRole("button", { name: "Restaurar mis casos" }).click();
  await page.getByRole("button", { name: "Restaurar casos", exact: true }).click();
  await page.getByText("Tus cuatro casos de demo están listos").waitFor({ timeout: 30000 });
  await page.getByRole("link", { name: /Alba Prueba Ficticia/ }).waitFor();
  if ((await page.locator("body").innerText()).includes("Dev's workspace")) {
    // Rename only this synthetic local developer workspace through the public,
    // authenticated organization route. Never rename a real user's organization.
    const nombre = await page.evaluate(async () => { const r = await fetch("/_agent-native/org", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Demostración MEGI" }) }); return r.ok; });
    if (!nombre) throw new Error("No se pudo renombrar el espacio de demostración");
    await page.reload({ waitUntil: "networkidle" });
  }
}
export async function finAgente(page, timeout = 240000) {
  // Observe the runtime's actual stop control, including the short handoff before it appears.
  const detener = page.getByRole("button", { name: /Stop generating|Stop response|Detener respuesta|Detener generación|Stop agent|Detener agente/i });
  await detener.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await detener.first().waitFor({ state: "hidden", timeout });
  await page.locator('main [role="status"]').waitFor({ state: "hidden", timeout });
}
export async function cancelarAgenteSiEnCurso(page) {
  const detener = page.getByRole("button", { name: /Stop generating|Stop response|Detener respuesta|Detener generación|Stop agent|Detener agente/i }).first();
  if (!(await detener.isVisible())) return false;
  await detener.click();
  await detener.waitFor({ state: "hidden", timeout: 30000 });
  await page.locator('main [role="status"]').waitFor({ state: "hidden", timeout: 30000 });
  console.log("Turno de prueba cancelado y control de detener oculto.");
  return true;
}
export function resultado(nombre, resultados, extra = {}) {
  mkdirSync(new URL("./resultados/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`./resultados/${nombre}${VARIANTE ? `-${VARIANTE}` : ""}.json`, import.meta.url), JSON.stringify({ fecha: new Date().toISOString(), url: BASE, resultados, ...extra }, null, 2) + "\n");
}
