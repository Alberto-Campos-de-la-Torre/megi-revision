// Demo de continuidad UI–agente sobre el MISMO registro (demo-c3, Rosa):
// el agente propone desde el tablero, el médico fija y acota desde la UI, el
// agente reajusta dentro del alcance, una cancelación a mitad de turno no deja
// cambios parciales y el médico concilia, aprueba y exporta. Modelo real.
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { chromium } from "playwright";
import { BASE, restaurar, finAgente, cancelarAgenteSiEnCurso, resultado } from "./comun.mjs";

const OUT = new URL("./capturas-continuidad/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".png")) rmSync(`${OUT}${f}`);
const resultados = []; let fallos = 0;
const ok = (c, m, d) => { console.log(`${c ? "✔" : "✘"} ${m}${d ? " · " + JSON.stringify(d) : ""}`); resultados.push({ prueba: m, pasa: Boolean(c), ...(d === undefined ? {} : { detalle: d }) }); if (!c) fallos++; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: "es-MX" });
const red = []; page.on("response", (r) => { if (r.status() >= 400 && !/agent-engine\/status|favicon|\.map$/.test(r.url())) red.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
let n = 0; const foto = async (nombre) => { n++; await page.screenshot({ path: `${OUT}${String(n).padStart(2, "0")}-${nombre}.png`, fullPage: true }); };
const version = async () => Number(((await page.getByText(/Plan en revisión · v\d+/).first().innerText().catch(() => "")).match(/v(\d+)/) ?? [])[1] ?? NaN);
const lineas = async () => page.locator("li[data-linea-id]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-linea-id"), texto: e.innerText.split("\n").slice(0, 2).join(" ").trim().slice(0, 90) })));
const responderAlergiasSiPregunta = async () => { const si = page.getByRole("button", { name: "Sí", exact: true }); if (await si.count()) { await si.click(); const cont = page.getByRole("button", { name: /Continuar|Continue/ }); if (await cont.count()) await cont.click(); } };

try {
  await restaurar(page);
  await page.goto(`${BASE}/revision/demo-c3`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Pedir propuesta al agente", exact: true }).waitFor({ timeout: 30000 });
  await foto("tablero-sin-plan");

  // 1 · El agente propone desde el tablero (mismo registro).
  await page.getByRole("button", { name: "Pedir propuesta al agente", exact: true }).click();
  const esperarPlan = async (ms) => { const inicio = Date.now(); while (Date.now() - inicio < ms) { if (await page.getByText(/Plan en revisión · v/).count()) return true; await responderAlergiasSiPregunta(); await page.waitForTimeout(1000); } return false; };
  let planVisible = await esperarPlan(240000);
  await finAgente(page);
  let reintentos = 0;
  if (!planVisible) {
    // El modelo puede responder en texto sin llamar a proponer-plan. El tablero
    // lo detecta al terminar el turno y ofrece volver a pedirlo; se usa ese camino.
    const aviso = page.getByText(/terminó sin guardar un plan/);
    ok(await aviso.count() > 0, "1 · el tablero avisa de que el agente terminó sin guardar un plan");
    await foto("agente-sin-plan-aviso");
    await page.getByRole("button", { name: "Volver a pedir la propuesta", exact: true }).click();
    reintentos++;
    planVisible = await esperarPlan(240000);
    await finAgente(page);
  }
  ok(planVisible, `1 · el plan propuesto por el agente aparece en el tablero sin recargar (reintentos: ${reintentos})`);
  const v1 = await version(); const l1 = await lineas();
  ok(l1.length >= 2, `1 · el plan tiene ${l1.length} líneas con estado propio`, { version: v1 });
  ok(/Propuesta por el agente/.test(await page.locator("main").innerText()), "1 · las líneas se marcan «Propuesta por el agente»");
  await foto("propuesta-del-agente");

  // 2 · El médico fija una línea y acota el alcance a otra desde la UI.
  // Localizadores anclados por id: tras bloquear, la línea pierde su botón «Bloquear».
  const idFijada = await page.locator("li[data-linea-id]").filter({ has: page.getByRole("button", { name: "Bloquear", exact: true }) }).first().getAttribute("data-linea-id");
  const fijada = page.locator(`li[data-linea-id="${idFijada}"]`);
  const nombreFijada = (await fijada.locator("span.font-medium").first().innerText()).trim();
  await fijada.getByRole("button", { name: "Bloquear", exact: true }).click();
  await fijada.getByText("Bloqueada por el médico", { exact: true }).waitFor({ timeout: 20000 });
  await cancelarAgenteSiEnCurso(page); // la alternativa automática solo aplica a bloqueos de seguridad; si arrancó, se cancela
  const v2 = await version();
  const idSel = await page.locator("li[data-linea-id]").filter({ hasNot: page.getByText("Bloqueada por el médico", { exact: true }) }).first().getAttribute("data-linea-id");
  const seleccionada = page.locator(`li[data-linea-id="${idSel}"]`);
  const nombreSel = (await seleccionada.locator("span.font-medium").first().innerText()).trim();
  await seleccionada.getByRole("checkbox").check();
  await page.getByText(/El agente solo podrá editar estas 1 líneas/).waitFor({ timeout: 10000 });
  ok(true, "2 · la UI explica el límite antes de pedir el reajuste", { fijada: nombreFijada, seleccionada: nombreSel });
  await foto("fijada-y-seleccion");
  const antesReajuste = await lineas();
  await page.getByRole("button", { name: "Reajustar solo selección", exact: true }).click();
  await page.getByText(/Edición del agente limitada a 1 línea/).waitFor({ timeout: 15000 });
  ok(true, "2 · el alcance queda guardado en el servidor (no solo en la selección visual)");
  const composer = page.locator('[role="textbox"][contenteditable="true"]').last();
  await composer.waitFor({ timeout: 30000 });
  await composer.click();
  await page.keyboard.press("End");
  await page.keyboard.type(` cambia la duración de ${nombreSel} a 3 días.`);
  await page.getByRole("button", { name: /Send message|Enviar mensaje/ }).click();
  await finAgente(page);
  await page.waitForTimeout(1500);
  let despues = await lineas(); let v3 = await version();
  let cambioSel = despues.find((l) => l.id === idSel)?.texto !== antesReajuste.find((l) => l.id === idSel)?.texto;
  let reintentosReajuste = 0;
  if (!cambioSel) {
    // El modelo puede terminar sin aplicar el cambio; el tablero avisa de que el
    // turno no cambió el plan y el médico repite la instrucción (una vez aquí).
    ok(await page.getByText(/no cambió el plan/).count() > 0, "3 · el tablero avisó de que el turno del agente no cambió el plan");
    await foto("turno-sin-cambios-aviso");
    const composerR = page.locator('[role="textbox"][contenteditable="true"]').last();
    await composerR.click();
    await composerR.fill(`Aplica el cambio con reajustar-plan: en el plan, la línea ${nombreSel} (id ${idSel}) pasa a duración "3 días". Usa la versión vigente del plan.`);
    await page.getByRole("button", { name: /Send message|Enviar mensaje/ }).click();
    await finAgente(page);
    await page.waitForTimeout(1500);
    despues = await lineas(); v3 = await version(); reintentosReajuste++;
    cambioSel = despues.find((l) => l.id === idSel)?.texto !== antesReajuste.find((l) => l.id === idSel)?.texto;
  }
  const otrasIntactas = antesReajuste.filter((l) => l.id !== idSel).every((l) => despues.find((d) => d.id === l.id)?.texto === l.texto);
  ok(cambioSel, `3 · la línea autorizada (${nombreSel}) cambió (reintentos: ${reintentosReajuste})`, { antes: antesReajuste.find((l) => l.id === idSel)?.texto, despues: despues.find((l) => l.id === idSel)?.texto });
  ok(otrasIntactas, "3 · las líneas fuera del alcance no cambiaron");
  ok(v3 > v2, "3 · el reajuste del agente creó una versión nueva del mismo plan", { antes: v2, despues: v3 });
  await foto("reajuste-dentro-del-alcance");

  // 3b · El médico pide quitar la línea fijada: el servidor rechaza el reajuste
  // entero y el tablero deja constancia de que el turno no cambió nada.
  const antesFijada = await lineas();
  await page.getByRole("button", { name: "Pedir reajuste al agente", exact: true }).click();
  const composerB = page.locator('[role="textbox"][contenteditable="true"]').last();
  await composerB.click(); await page.keyboard.press("End");
  await page.keyboard.type(` quita ${nombreFijada} del plan.`);
  await page.getByRole("button", { name: /Send message|Enviar mensaje/ }).click();
  await finAgente(page);
  await page.waitForTimeout(1500);
  const v3b = await version();
  ok(await fijada.getByText("Bloqueada por el médico", { exact: true }).count() === 1, `3b · la línea fijada (${nombreFijada}) sigue intacta aunque el médico pidió quitarla`);
  ok(v3b === v3 && JSON.stringify(await lineas()) === JSON.stringify(antesFijada), "3b · el servidor no aplicó nada: misma versión y mismas líneas", { version: v3b });
  const respuesta = await page.locator('article[data-role="assistant"] .agentkit-message-content').last().innerText().catch(() => "");
  ok(/bloquead|fijad|no (se )?puede|intocable|alcance|desbloque/i.test(respuesta), "3b · el agente explica el límite en su respuesta", { respuesta: respuesta.slice(0, 200) });
  ok(await page.getByText(/no cambió el plan/).count() > 0, "3b · el tablero avisa de que el turno no cambió el plan (lo del chat no está guardado)");
  await foto("fijada-intocable-aviso-sin-cambios");
  await page.getByRole("tab", { name: /Cambios/ }).click();
  await page.waitForTimeout(500);
  const bitacora = await page.locator("main").innerText();
  ok(/Agente/.test(bitacora) && /Médico|medico/i.test(bitacora), "3 · la bitácora registra a médico y agente sobre el mismo plan");
  await foto("bitacora-ambos-actores");
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "Liberar alcance", exact: true }).click();
  await page.getByText("El agente puede reajustar las líneas no fijadas.").waitFor({ timeout: 15000 });

  // 4 · Recuperación: cancelar a mitad de turno no deja cambios parciales.
  const v4 = await version(); const antesCancel = await lineas();
  await page.getByRole("button", { name: "Pedir reajuste al agente", exact: true }).click();
  const composer2 = page.locator('[role="textbox"][contenteditable="true"]').last();
  await composer2.click(); await page.keyboard.press("End");
  await page.keyboard.type(" añade Omeprazol 20 mg cada 24 h 7 días y un pendiente de control analítico en 1 semana.");
  await page.getByRole("button", { name: /Send message|Enviar mensaje/ }).click();
  const detener = page.getByRole("button", { name: /Stop generating|Stop response|Detener respuesta|Detener generación|Stop agent|Detener agente/i }).first();
  await detener.waitFor({ state: "visible", timeout: 30000 });
  await detener.click();
  await detener.waitFor({ state: "hidden", timeout: 30000 });
  await page.waitForTimeout(2000);
  const v5 = await version(); const trasCancel = await lineas();
  const sinParcial = v5 === v4 && JSON.stringify(trasCancel) === JSON.stringify(antesCancel);
  ok(sinParcial || v5 > v4, sinParcial ? "4 · cancelar a mitad de turno no deja cambios parciales (misma versión y mismas líneas)" : "4 · el turno terminó antes de cancelar; el cambio quedó versionado de forma atómica", { antes: v4, despues: v5 });
  await foto("cancelacion-sin-parcial");

  // 5 · El médico concilia, aprueba y exporta; el archivo refleja ambos actores.
  const conciliacion = page.locator("details").filter({ hasText: /Medicación del paciente/ });
  if (!(await conciliacion.evaluate((e) => e.open))) await conciliacion.locator("summary").click();
  for (const sel of await conciliacion.locator("select[aria-label^='Estado de']").all()) await sel.selectOption("activo");
  const guardar = conciliacion.getByRole("button", { name: /Guardar conciliación|Confirmar que no refiere medicación/ });
  if (await guardar.count()) { await guardar.click(); await page.getByText(/revisada por el médico/).waitFor({ timeout: 30000 }); }
  ok(true, "5 · la medicación histórica queda conciliada por el médico antes de aprobar");
  await page.getByRole("button", { name: /Aprobar y exportar/ }).click();
  await page.getByRole("alertdialog").waitFor({ timeout: 15000 });
  const casilla = page.getByRole("alertdialog").getByRole("checkbox");
  if (await casilla.count()) await casilla.first().check();
  await page.getByRole("button", { name: /^Aprobar y exportar$/ }).last().click();
  await page.getByText("Aprobado y exportado", { exact: true }).first().waitFor({ timeout: 60000 });
  await page.getByRole("tab", { name: "Exportación", exact: true }).click();
  await page.getByText(/sha256:/).first().waitFor({ timeout: 15000 });
  ok(await page.getByText(/MedicationRequest/).count() > 0, "5 · exportación FHIR con sello visible");
  ok(await page.getByRole("button", { name: "Bloquear", exact: true }).count() === 0, "5 · el plan exportado queda cerrado a nuevas ediciones");
  await foto("exportacion-sellada");
} catch (e) {
  fallos++; resultados.push({ prueba: "excepción", pasa: false, detalle: e.message.split("\n").slice(0, 2).join(" ") });
  console.log("✘ excepción:", e.message.split("\n")[0]);
  await foto("error").catch(() => {});
}
try { await cancelarAgenteSiEnCurso(page); } catch {}
await browser.close();
const fallosTotales = fallos + red.length;
console.log(fallosTotales ? `${fallos} fallos de comprobación y ${red.length} errores de red` : "continuidad UI–agente: correcto");
resultado("continuidad", resultados, { fallos: fallosTotales, red, alcance: "Demo con modelo real sobre demo-c3 (Rosa): propuesta desde el tablero, bloqueo y alcance desde la UI, reajuste del agente dentro del alcance, cancelación sin parcial y aprobación con conciliación. No mide calidad clínica." });
process.exit(fallosTotales ? 1 : 0);
