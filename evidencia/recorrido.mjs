// Recorrido del guion en navegador sin cabeza contra http://localhost:8080.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:8080";
const OUT = new URL("./capturas/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "✔" : "✘"} ${m}`); if (!c) fallos++; };
const consola = [];
const redFallida = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "es-MX" });
page.on("console", (m) => { if (m.type() === "error") consola.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) redFallida.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
let n = 0;
const foto = async (nombre) => { n++; await page.screenshot({ path: `${OUT}${String(n).padStart(2, "0")}-${nombre}.png`, fullPage: true }); };

try {
  await page.goto(`${BASE}/revision`, { waitUntil: "networkidle" });
  // Pantalla de acceso del framework en local: "Continue as local dev".
  const dev = page.getByRole("button", { name: /local dev|desarrollador local/i });
  if (await dev.count()) {
    await dev.first().click();
    await page.waitForURL(/\/revision/, { timeout: 20000 }).catch(() => {});
    await page.goto(`${BASE}/revision`, { waitUntil: "networkidle" });
  }
  await page.getByText("Consultas pendientes de revisión").waitFor({ timeout: 30000 });
  await page.getByText("Alba Prueba Ficticia").waitFor({ timeout: 30000 });
  await foto("lista");
  const tarjetas = await page.locator("main ul > li").count();
  ok(tarjetas === 4, `lista: ${tarjetas} consultas pendientes`);
  ok(await page.getByText("MEGI conectado").count() > 0, "indicador de conexión con MEGI");
  ok(await page.getByText("Sin registro de alergias").count() > 0, "caso 2 muestra «Sin registro de alergias»");

  // Entrar a demo-c1 (Alba, alergia a penicilina)
  await page.getByRole("link", { name: /Alba Prueba Ficticia/ }).click();
  await page.waitForURL(/\/revision\/demo-c1/);
  await page.getByText("Pedir propuesta al agente").waitFor({ timeout: 30000 });
  await foto("consulta-sin-plan");
  ok(await page.getByText("Penicilina").count() > 0, "ficha muestra la alergia a penicilina");
  ok(await page.getByText("Pedir propuesta al agente").count() === 1, "botón que delega al agente visible");

  await page.getByRole("button", { name: "Plan en blanco" }).click();
  await page.getByRole("button", { name: /Aprobar y exportar/ }).waitFor({ timeout: 30000 });
  await foto("plan-en-blanco");
  ok(await page.getByText("Plan en revisión").count() > 0, "plan en blanco creado");

  // Añadir amoxicilina → bloqueo por alergia
  await page.getByLabel("Fármaco", { exact: true }).fill("Amoxicilina");
  await page.getByLabel("Dosis").fill("500 mg");
  await page.getByLabel("Frecuencia").fill("cada 8 h");
  await page.getByLabel("Duración").fill("10 días");
  await page.getByRole("button", { name: /Añadir/ }).click();
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
  const lineaAmox = page.locator("li[data-linea-id]", { hasText: "Amoxicilina" });
  await lineaAmox.getByRole("button", { name: "Bloquear" }).click();
  await lineaAmox.getByText("Bloqueada por el médico").waitFor({ timeout: 15000 });
  await foto("linea-bloqueada");
  ok(await lineaAmox.getByRole("button", { name: "Editar" }).count() === 0, "línea bloqueada no se puede editar");
  await lineaAmox.getByRole("button", { name: "Desbloquear" }).click();
  await lineaAmox.getByRole("button", { name: "Editar" }).waitFor({ timeout: 15000 });
  ok(true, "desbloqueada: vuelve a ser editable");

  // Editar dosis en línea
  await lineaAmox.getByRole("button", { name: "Editar" }).click();
  await lineaAmox.getByLabel("Dosis").fill("875 mg");
  await lineaAmox.getByRole("button", { name: "Guardar" }).click();
  await lineaAmox.getByText("875 mg").first().waitFor({ timeout: 15000 });
  ok(await lineaAmox.getByText("Editada por el médico").count() > 0, "edición inline guardada y marcada como editada por el médico");

  // Añadir paracetamol → ok
  await page.getByLabel("Fármaco", { exact: true }).fill("Paracetamol");
  await page.getByLabel("Dosis").fill("500 mg");
  await page.getByLabel("Frecuencia").fill("cada 8 h");
  await page.getByLabel("Duración").fill("5 días");
  await page.getByRole("button", { name: /Añadir/ }).click();
  const lineaPara = page.locator("li[data-linea-id]", { hasText: "Paracetamol" });
  await lineaPara.getByText("Verificado").waitFor({ timeout: 30000 });
  ok(true, "paracetamol añadido con chip «Verificado»");

  // Añadir pendiente
  await page.getByLabel("Tipo").selectOption("pendiente");
  await page.getByLabel("Pendiente", { exact: true }).fill("Revalorar en 72 h");
  await page.getByRole("button", { name: /Añadir/ }).click();
  await page.locator("li[data-linea-id]", { hasText: "Revalorar en 72 h" }).waitFor({ timeout: 15000 });
  ok(true, "pendiente añadido");

  // Rechazar amoxicilina con motivo
  await lineaAmox.getByRole("button", { name: "Rechazar" }).click();
  await page.getByLabel("Motivo").fill("Paciente alérgica a penicilina; prefiero macrólido");
  await page.getByRole("button", { name: "Rechazar", exact: true }).last().click();
  await lineaAmox.getByText("Rechazada").waitFor({ timeout: 15000 });
  await lineaAmox.getByRole("button", { name: "Reactivar" }).waitFor({ timeout: 15000 });
  await foto("amoxicilina-rechazada");
  ok(await lineaAmox.getByText(/Motivo: Paciente alérgica/).count() === 1, "rechazada con motivo y botón de reactivar");

  // Pestaña cambios
  await page.getByRole("tab", { name: /Cambios/ }).click();
  await page.getByText("Bloqueó").first().waitFor({ timeout: 10000 });
  await foto("bitacora");
  const eventos = await page.locator("ol > li").count();
  ok(eventos >= 7, `bitácora con ${eventos} eventos (médico)`);
  await page.getByRole("tab", { name: "Plan" }).click();

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
  await page.getByText("Rosa Ficticia Muestra").waitFor({ timeout: 30000 });
  ok(await page.getByText("Alba Prueba Ficticia").count() === 0, "demo-c1 desaparece de pendientes");
  await foto("lista-final");

  // Navegación: estado para el agente
  await page.goto(`${BASE}/revision/demo-c2`, { waitUntil: "networkidle" });
  await page.getByText("Mateo Ejemplo Demo").waitFor({ timeout: 30000 });
  ok(await page.getByText("Sin registro: confirmar con el paciente").count() > 0, "caso 2 avisa que no hay registro de alergias");
} catch (e) {
  fallos++;
  console.log("✘ excepción:", e.message.split("\n")[0]);
  await foto("error").catch(() => {});
}

const esperados = /\/_agent-native\/actions\/(proponer-plan|actualizar-linea|aprobar-plan)|favicon|\.map$/;
const inesperados = redFallida.filter((r) => !esperados.test(r));
const consolaReal = consola.filter((c) => !/favicon|hydrat|sourcemap|Download the React DevTools/i.test(c));
console.log(`\nred con error (no esperados): ${inesperados.length}`); inesperados.forEach((r) => console.log("  " + r));
console.log(`consola con error: ${consolaReal.length}`); consolaReal.slice(0, 8).forEach((c) => console.log("  " + c.slice(0, 200)));
console.log(`\n${fallos ? `${fallos} fallos` : "recorrido completo correcto"} · capturas en ${OUT}`);
await browser.close();
process.exit(fallos || inesperados.length ? 1 : 0);
