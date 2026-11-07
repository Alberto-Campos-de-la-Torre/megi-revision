import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { BASE, restaurar, resultado } from "./comun.mjs";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "es-MX" });
try {
  await restaurar(page);
  const cuatro = await page.locator("main ul > li").count();
  if (cuatro !== 4) throw new Error(`Se esperaban cuatro casos, llegaron ${cuatro}`);
  if (await page.getByText("Plan en revisión", {exact: true}).count()) throw new Error("Quedó un plan abierto en la demo");
  await page.screenshot({ path: new URL("capturas/demo-lista-para-grabar.png", import.meta.url).pathname, fullPage: true });
  const manifest = await page.evaluate(async () => {
    const r = await fetch("/_agent-native/webmcp/manifest");
    if (!r.ok) throw new Error(`Manifiesto: ${r.status}`);
    return r.json();
  });
  const nombres = new Set(manifest.map(t => t.name));
  const ui = ["aprobar-plan", "preparar-aprobacion", "definir-alcance", "conciliar-medicacion", "medir-revision", "restaurar-demo", "resolver-sugerencia"];
  const primarias = ["listar-consultas", "ver-contexto-consulta", "obtener-plan", "proponer-plan", "reajustar-plan", "historial-plan", "metricas-revision", "sugerir-reemplazo"];
  if (ui.some(n => nombres.has(n)) || primarias.some(n => !nombres.has(n))) throw new Error("Catálogo MCP no coincide con los permisos esperados");
  writeFileSync(new URL("revision-trazable-mcp.json", import.meta.url), JSON.stringify({ fecha: new Date().toISOString(), tipo: "Manifiesto WebMCP leído del servidor autenticado", primarias_presentes: Object.fromEntries(primarias.map(n => [n, nombres.has(n)])), decisiones_ui_fuera_catalogo: Object.fromEntries(ui.map(n => [n, !nombres.has(n)])), herramientas: manifest.filter(t => primarias.includes(t.name)) }, null, 2) + "\n");
  resultado("demo-final", [{ prueba: "cuatro casos propios sin planes, listos para grabar", pasa: true }, { prueba: "manifiesto de herramientas y exclusiones UI", pasa: true }], { url: BASE });
  console.log("Demo restaurada: cuatro casos; manifiesto MCP verificado.");
} finally { await browser.close(); }
