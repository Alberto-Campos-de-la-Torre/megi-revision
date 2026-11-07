// Recorrido del guion en navegador sin cabeza contra http://localhost:8080.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

import { BASE, restaurar, finAgente, resultado } from "./comun.mjs";
const OUT = new URL("./capturas/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const resultados = [];
let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "✔" : "✘"} ${m}`); resultados.push({ prueba: m, pasa: Boolean(c) }); if (!c) fallos++; };
const consola = [];
const redFallida = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "es-MX" });
page.on("console", (m) => { if (m.type() === "error") consola.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) redFallida.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
const navegacion = [];
page.on("requestfinished", async req => {
  if (req.method() !== "PUT" || !/app-state|application-state/.test(req.url())) return;
  try { const valor = req.postDataJSON(); if (valor?.consultaId && valor?.version) { const response = await req.response(); if (response?.ok()) navegacion.push({ consultaId: valor.consultaId, planId: valor.planId, version: valor.version, alcanceAgente: valor.alcanceAgente }); } } catch { /* only JSON navigation */ }
});
let n = 0;
const foto = async (nombre) => { n++; await page.screenshot({ path: `${OUT}${String(n).padStart(2, "0")}-${nombre}.png`, fullPage: true }); };

try {
  await restaurar(page);
  await page.goto(`${BASE}/revision`, { waitUntil: "networkidle" });
  // Pantalla de acceso del framework en local: "Continue as local dev".
  const dev = page.getByRole("button", { name: /local dev|desarrollador local/i });
  if (await dev.count()) {
    await dev.first().click();
    await page.waitForURL(/\/revision/, { timeout: 20000 }).catch(() => {});
    await page.goto(`${BASE}/revision`, { waitUntil: "networkidle" });
  }
  await page.getByText("Consultas pendientes de revisión").waitFor({ timeout: 30000 });
  await page.locator("main").getByText("Alba Prueba Ficticia", { exact: true }).waitFor({ timeout: 30000 });
  await foto("lista");
  const tarjetas = await page.locator("main ul > li").count();
  ok(tarjetas === 4, `lista: ${tarjetas} consultas pendientes`);
  ok(await page.getByText("MEGI conectado").count() > 0, "indicador de conexión con MEGI");
  ok(await page.getByText("Sin registro de alergias").count() > 0, "caso 2 muestra «Sin registro de alergias»");

  // Entrar a demo-c1 (Alba, alergia a penicilina)
  await page.getByRole("link", { name: /Alba Prueba Ficticia/ }).click();
  await page.waitForURL(/\/revision\/demo-c1/);
  await page.getByText("Pedir propuesta al agente").waitFor({ timeout: 30000 });
  const abrirAgente = page.locator('header[data-mobile-app-bar] button[aria-pressed="false"]');
  if (await abrirAgente.count()) await abrirAgente.click();
  await page.getByRole("button", { name: "Ayúdame con esta revisión", exact: true }).waitFor({ state: "visible", timeout: 30000 });
  ok(await page.getByRole("button", { name: /Help me with this|Explain what I am looking at/ }).count() === 0, "panel vacío usa las sugerencias en español sin reemplazo dinámico en inglés");
  await foto("consulta-sin-plan");
  ok(await page.getByText("Penicilina").count() > 0, "ficha muestra la alergia a penicilina");
  ok(await page.getByText("Pedir propuesta al agente").count() === 1, "botón que delega al agente visible");

  await page.getByRole("button", { name: "Plan en blanco" }).click();
  await page.getByRole("button", { name: /Aprobar y exportar/ }).waitFor({ timeout: 30000 });
  await foto("plan-en-blanco");
  ok(await page.getByText(/Plan en revisión · v/).count() > 0, "plan en blanco creado");

  // Añadir amoxicilina → bloqueo por alergia
  await page.getByLabel("Fármaco", { exact: true }).fill("Amoxicilina");
  await page.getByLabel("Dosis", { exact: true }).fill("500 mg");
  await page.getByLabel("Frecuencia", { exact: true }).fill("cada 8 h");
  await page.getByLabel("Duración", { exact: true }).fill("10 días");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await page.getByText("Bloqueo de seguridad").waitFor({ timeout: 30000 });
  await foto("amoxicilina-bloqueada");
  ok(true, "amoxicilina añadida con chip «Bloqueo de seguridad»");
  ok(await page.getByText(/alergia a Penicilina/).count() > 0, "motivo del bloqueo visible");
  ok(await page.getByText(/Alternativas sugeridas/).count() > 0, "alternativas visibles");
  ok(await page.getByRole("button", { name: /Pedir reemplazo al agente/ }).count() === 1, "botón «Pedir reemplazo al agente»");

  // Aprobar con bloqueo → el diálogo exige confirmación explícita
  await page.getByRole("button", { name: /Aprobar y exportar/ }).click();
  await page.getByText(/con bloqueo de seguridad:/).waitFor({ timeout: 10000 });
  const accion = page.getByRole("button", { name: /^Aprobar y exportar$/ }).last();
  ok(await accion.isDisabled(), "aprobar deshabilitado hasta marcar la confirmación");
  await foto("dialogo-aprobar-con-bloqueo");
  await page.getByRole("button", { name: "Volver" }).click();

  // Bloquear y desbloquear
  const lineaAmox = page.locator("li[data-linea-id]", { hasText: "Amoxicilina" }).first();
  await lineaAmox.getByRole("button", { name: "Bloquear" }).click();
  await lineaAmox.getByText("Bloqueada por el médico").waitFor({ timeout: 15000 });
  await foto("linea-bloqueada");
  await finAgente(page);
  ok(await page.getByRole("region", { name: "Alternativa propuesta" }).count() > 0 || await page.getByText("Alternativa del agente · pendiente de tu revisión").count() > 0, "alternativa automática queda pendiente sin tocar la línea fijada");
  ok(await lineaAmox.getByRole("button", { name: "Editar" }).count() === 0, "línea bloqueada no se puede editar");
  await lineaAmox.getByRole("button", { name: "Desbloquear" }).click();
  await lineaAmox.getByRole("button", { name: "Editar" }).waitFor({ timeout: 15000 });
  ok(true, "desbloqueada: vuelve a ser editable");

  // Editar dosis en línea
  await lineaAmox.getByRole("button", { name: "Editar" }).click();
  await lineaAmox.getByLabel("Dosis", { exact: true }).fill("875 mg");
  await lineaAmox.getByRole("button", { name: "Guardar" }).click();
  await lineaAmox.getByText("875 mg").first().waitFor({ timeout: 15000 });
  ok(await lineaAmox.getByText("Editada por el médico").count() > 0, "edición inline guardada y marcada como editada por el médico");

  await page.getByRole("tab", { name: "Comparar versiones", exact: true }).click();
  await page.getByText(/Dosis:/).waitFor();
  await foto("comparacion-dosis-antes-despues");
  ok(await page.locator("li.border-amber-500").count() > 0, "edición en ámbar con dosis antes y después");
  await page.getByRole("tab", { name: "Plan", exact: true }).click();

  // Añadir paracetamol → ok
  await page.getByLabel("Fármaco", { exact: true }).fill("Paracetamol");
  await page.getByLabel("Dosis", { exact: true }).fill("500 mg");
  await page.getByLabel("Frecuencia", { exact: true }).fill("cada 8 h");
  await page.getByLabel("Duración", { exact: true }).fill("5 días");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  const lineaPara = page.locator("li[data-linea-id]", { hasText: "Paracetamol" });
  await lineaPara.getByText("Sin alertas detectadas").waitFor({ timeout: 30000 });
  ok(true, "paracetamol añadido con chip «Sin alertas detectadas»");

  // Añadir pendiente
  await page.getByLabel("Tipo", { exact: true }).selectOption("pendiente");
  await page.getByLabel("Pendiente", { exact: true }).fill("Revalorar en 72 h");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await page.locator("li[data-linea-id]", { hasText: "Revalorar en 72 h" }).waitFor({ timeout: 15000 });
  ok(true, "pendiente añadido");

  // Rechazar amoxicilina con motivo
  await lineaAmox.getByRole("button", { name: "Rechazar" }).first().click();
  await page.getByLabel("Motivo", { exact: true }).fill("Paciente alérgica a penicilina; prefiero macrólido");
  await page.getByRole("button", { name: "Rechazar", exact: true }).last().click();
  await lineaAmox.getByText("Rechazada").waitFor({ timeout: 15000 });
  await lineaAmox.getByRole("button", { name: "Reactivar" }).waitFor({ timeout: 15000 });
  await foto("amoxicilina-rechazada");
  await finAgente(page);
  ok(await lineaAmox.getByText(/Motivo: Paciente alérgica/).count() === 1, "rechazada con motivo y botón de reactivar");

  // Selection must authorize two ids on the server and surface that scope.
  await page.getByRole("checkbox", { name: "Seleccionar Paracetamol", exact: true }).check();
  await page.getByRole("checkbox", { name: "Seleccionar Revalorar en 72 h", exact: true }).check();
  ok(await page.getByText("El agente solo podrá editar estas 2 líneas al pedir el reajuste.").count() === 1, "selección explica el límite de dos líneas");
  await page.getByRole("button", { name: "Reajustar solo selección", exact: true }).click();
  await page.getByText("Edición del agente limitada a 2 línea(s).").waitFor();
  await foto("seleccion-acotada");
  await page.getByRole("tab", { name: "Comparar versiones", exact: true }).click();
  await page.getByText(/Operación del servidor:/).waitFor();
  await page.getByLabel("Versión de referencia").selectOption({ label: "Versión 2" });
  await foto("comparacion-versiones");
  ok(await page.locator("li.border-red-500").count() > 0 && await page.locator("li.border-emerald-500").count() > 0, "comparación muestra retiradas rojas y adiciones verdes");
  ok(await page.getByText(/Versión de referencia|Comparar con/).count() > 0, "comparación de versiones disponible");
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "Liberar alcance", exact: true }).click();
  await page.getByText("El agente puede reajustar las líneas no fijadas.").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const fondo = page.locator(".agent-sidebar-backdrop");
  if (await fondo.isVisible()) { await fondo.click({ position: { x: 10, y: 400 } }); await fondo.waitFor({ state: "hidden" }); }
  await foto("movil");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "tablero sin desbordamiento horizontal a 390 px");
  await page.setViewportSize({ width: 1280, height: 900 });

  // Pestaña cambios
  await page.getByRole("tab", { name: /Cambios/ }).click();
  await page.getByText("Bloqueó").first().waitFor({ timeout: 10000 });
  await foto("bitacora");
  const eventos = await page.locator("ol > li").count();
  ok(eventos >= 7, `bitácora con ${eventos} eventos (médico)`);
  await page.getByRole("tab", { name: "Plan", exact: true }).click();

  // Aprobar y exportar (sin bloqueos vigentes)
  await page.getByRole("button", { name: /Aprobar y exportar/ }).click();
  await page.getByText("Aprobar y exportar a MEGI").waitFor({ timeout: 10000 });
  ok(await page.getByText(/con bloqueo de seguridad:/).count() === 0, "sin bloqueos pendientes en el diálogo");
  await page.getByRole("button", { name: /^Aprobar y exportar$/ }).last().click();
  await page.getByText("Aprobado y exportado", { exact: true }).first().waitFor({ timeout: 60000 });
  await foto("exportado");
  ok(true, "plan aprobado y exportado");
  await page.getByRole("tab", { name: "Exportación" }).click();
  await page.getByText(/sha256:/).first().waitFor({ timeout: 10000 });
  ok(await page.getByText(/MedicationRequest/).count() > 0, "FHIR con MedicationRequest y sello sha256 visibles");
  await foto("exportacion");
  ok(await page.getByRole("button", { name: "Bloquear" }).count() === 0, "plan cerrado: sin botones de edición");

  // La lista ya no muestra demo-c1
  await page.goto(`${BASE}/revision`, { waitUntil: "networkidle" });
  await page.getByText("Consultas pendientes de revisión").waitFor({ timeout: 30000 });
  await page.locator("main").getByText("Rosa Ficticia Muestra", { exact: true }).waitFor({ timeout: 30000 });
  ok(await page.locator("main").getByText("Alba Prueba Ficticia", { exact: true }).count() === 0, "demo-c1 desaparece de pendientes");
  await foto("lista-final");
  await page.getByRole("button", { name: "Exportadas", exact: true }).click();
  await page.getByRole("link", { name: /Alba Prueba Ficticia/ }).waitFor();
  ok(true, "consulta exportada accesible en el archivo");
  await foto("archivo-exportadas");

  // Navegación: estado para el agente
  await page.goto(`${BASE}/revision/demo-c2`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Mateo Ejemplo Demo", exact: true }).waitFor({ timeout: 30000 });
  ok(await page.getByText("Sin registro: confirmar con el paciente").count() > 0, "caso 2 avisa que no hay registro de alergias");
  await page.getByText("Mediciones exploratorias", { exact: false }).first().click();
  await page.getByText("Manual vs agente · exploratorio, n pequeño", { exact: true }).waitFor();
  ok(await page.getByText(/Operaciones del servidor: media/).count() > 0 && await page.getByText(/API del modelo:/).count() > 0, "comparación exploratoria distingue servidor y API del modelo sin atribuirle el total");
  await foto("mediciones-manual-agente");
} catch (e) {
  fallos++; resultados.push({ prueba: "excepción", pasa: false, detalle: e.message });
  console.log("✘ excepción:", e.message.split("\n")[0]);
  await foto("error").catch(() => {});
}

const esperados = /favicon|\.map$/;
const iniciales = redFallida.filter(r => /401 GET .*\/_agent-native\/agent-engine\/status$/.test(r));
const inesperados = redFallida.filter((r) => !esperados.test(r) && !(iniciales.length === 1 && r === iniciales[0]));
const consolaReal = consola.filter((c) => !/favicon|hydrat|sourcemap|Download the React DevTools/i.test(c));
console.log(`\nred con error (no esperados): ${inesperados.length}`); inesperados.forEach((r) => console.log("  " + r));
console.log(`consola con error: ${consolaReal.length}`); consolaReal.slice(0, 8).forEach((c) => console.log("  " + c.slice(0, 200)));
console.log(`\n${fallos ? `${fallos} fallos` : "recorrido completo correcto"} · capturas en ${OUT}`);
resultado("recorrido", resultados, { fallos, redInesperada: inesperados, avisosFramework: consolaReal, sondaSinSesion: iniciales, navegacion });
await browser.close();
process.exit(fallos || inesperados.length ? 1 : 0);
