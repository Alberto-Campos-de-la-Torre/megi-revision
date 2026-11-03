// ¿El 401 de agent-engine/status ocurre solo antes de iniciar sesión?
import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "es-MX" });
const page = await ctx.newPage();
const antes = [], despues = [];
let fase = antes;
page.on("response", (r) => { if (r.url().includes("agent-engine/status")) fase.push(`${r.status()} ${new URL(r.url()).pathname}`); });
await page.goto("http://localhost:8080/revision", { waitUntil: "networkidle" });
const dev = page.getByRole("button", { name: /local dev|desarrollador local/i });
if (await dev.count()) { await dev.first().click(); await page.waitForURL(/revision/, { timeout: 30000 }); await page.waitForLoadState("networkidle"); }
fase = despues;
for (const u of ["/revision", "/revision/demo-c3", "/revision"]) { await page.goto("http://localhost:8080" + u, { waitUntil: "networkidle" }); await page.waitForTimeout(1500); }
await page.getByRole("button", { name: "Pedir propuesta al agente" }).click().catch(() => {});
await page.waitForTimeout(4000);
console.log("antes de iniciar sesión:", antes.join(", ") || "ninguna llamada");
console.log("con sesión iniciada  :", despues.join(", ") || "ninguna llamada");
await browser.close();
