// Ejercita al agente en vivo con Mateo (demo-c2), alergias, propuesta y bloqueo.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { BASE, VARIANTE, restaurar, finAgente, cancelarAgenteSiEnCurso, resultado } from "./comun.mjs";
const OUT = new URL(`./capturas/${VARIANTE ? `${VARIANTE}/` : ""}`, import.meta.url).pathname;
const resultados = [];
mkdirSync(OUT, { recursive: true });
let fallos = 0; const ok = (c, m) => { console.log(`${c ? "✔" : "✘"} ${m}`); resultados.push({ prueba: m, pasa: Boolean(c) }); if (!c) fallos++; };
const red = []; const consola = []; const etapas = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: "es-MX" });
await page.exposeFunction("etapaMegi", etapa => etapas.push(etapa));
await page.addInitScript(() => {
  for (const evento of ["agent-native:tool-input", "agent-native:tool-done", "agentNative.chatRunning"]) window.addEventListener(evento, e => {
    const d = e.detail ?? {};
    if (evento === "agent-native:tool-input" && d.phase !== "start") return;
    const claves = value => {
      if (typeof value === "string") { try { value = JSON.parse(value); } catch { return []; } }
      return value && typeof value === "object" ? Object.keys(value).slice(0, 25) : [];
    };
    window.etapaMegi({ argsKeys: claves(d.input ?? d.argsText), resultKeys: claves(d.result), evento, tool: d.tool, phase: d.phase, isRunning: d.isRunning, tabId: d.tabId, runId: d.runId, completedSideEffect: d.completedSideEffect, isError: d.isError, fecha: Date.now() });
  });
});
page.on("console", (m) => { if (m.type() === "error") consola.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) red.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
const foto = (n) => page.screenshot({ path: `${OUT}${n}.png`, fullPage: true });
let restaurarModelo;
try {
  await restaurar(page);
  if (process.env.MEGI_BENCH_MODEL) {
    const { prepararComparacion } = await import("./seleccionar-modelo.mjs");
    const comparacion = await prepararComparacion(page, process.env.MEGI_BENCH_MODEL, process.env.MEGI_BENCH_PROVIDER ?? "ollama");
    restaurarModelo = comparacion.restaurar;
    await comparacion.seleccionar();
  }
  await page.goto(`${BASE}/revision/demo-c2`, { waitUntil: process.env.MEGI_BENCH_MODEL ? "domcontentloaded" : "networkidle" });
  const dev = page.getByRole("button", { name: /local dev|desarrollador local/i });
  if (await dev.count()) { await dev.first().click(); await page.waitForURL(/revision/, { timeout: 30000 }); await page.waitForLoadState("networkidle"); }
  await page.getByRole("button", { name: "Pedir propuesta al agente" }).waitFor({ timeout: 30000 });
  if (process.env.MEGI_BENCH_MODEL) await page.waitForFunction(model => {
    const normalizar = value => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    return [...document.querySelectorAll("button.agent-composer-model-button")].some(b => normalizar(b.textContent).includes(normalizar(model)));
  }, process.env.MEGI_BENCH_MODEL, { timeout: 30000 });
  await page.getByRole("button", { name: "Pedir propuesta al agente" }).click();
  const detener = page.getByRole("button", { name: /Stop response|Detener.*respuesta|Stop generating|Detener.*generación/i });
  await detener.first().waitFor({ state: "visible", timeout: 30000 });
  ok(await page.getByRole("button", { name: /Send message|Enviar mensaje/ }).count() === 0 || await page.getByRole("button", { name: /Send message|Enviar mensaje/ }).first().isDisabled(), "la UI impide un envío solapado durante el turno");
  await detener.first().click();
  await finAgente(page);
  ok(await page.getByRole("button", { name: "Pedir propuesta al agente", exact: true }).count() === 1, "cancelar antes de proponer no deja un plan parcial");
  await foto("19-cancelacion");
  await page.getByRole("button", { name: "Pedir propuesta al agente" }).click();
  await page.getByText("¿Confirmas que no tiene alergias conocidas?", { exact: true }).first().waitFor({ timeout: 120000 });
  await finAgente(page);
  ok(true, "nuevo intento tras cancelar llega a la pregunta estructurada");
  await foto("20-pregunta-alergias");
  const comienzoPropuesta = Date.now();
  await page.getByRole("button", { name: "Sí", exact: true }).click();
  await page.getByRole("button", { name: /Continuar|Continue/, exact: false }).click();
  await foto("20-agente-peticion");
  const cuerpo = async () => page.locator("body").innerText();
  ok(/Conectar IA/.test(await cuerpo()) === false, "el agente está conectado (no aparece «Conectar IA»)");
  // Espera a que el plan aparezca en el tablero (la acción proponer-plan refresca la vista).
  const inicio = Date.now();
  let planVisible = false;
  let reintentos = 0;
  while (Date.now() - inicio < 180000) {
    if (await page.getByText(/Plan en revisión · v/).count()) { planVisible = true; break; }
    const paso = await page.locator('main [role="status"]').innerText().catch(() => "");
    if (paso && !etapas.some(e => e.paso === paso)) etapas.push({ paso, fecha: Date.now() });
    // El modelo puede terminar el turno describiendo el plan en texto sin llamar a
    // proponer-plan; el tablero lo detecta y ofrece volver a pedirlo (una vez aquí).
    const reintentar = page.getByRole("button", { name: "Volver a pedir la propuesta", exact: true });
    if (reintentos === 0 && await reintentar.count()) { etapas.push({ paso: "El agente terminó sin guardar un plan; se vuelve a pedir", fecha: Date.now() }); await reintentar.click(); reintentos++; }
    await page.waitForTimeout(1000);
  }
  const visibleMs = Date.now() - comienzoPropuesta;
  await finAgente(page);
  if (reintentos) ok(planVisible, `el tablero detectó un turno sin plan y la segunda petición lo guardó (reintentos: ${reintentos})`);
  ok(etapas.some(e => /Leyendo contexto|Verificando|guardando|preparando/i.test(e.paso ?? "")), "tablero muestra etapas del runtime durante la propuesta");
  const cierre = etapas.filter(e => e.evento === "agentNative.chatRunning" && e.isRunning === false && e.fecha >= comienzoPropuesta).at(-1);
  if (!cierre) throw new Error("No se recibió el fin real del turno; la latencia no puede medirse.");
  const propuestaMs = cierre.fecha - comienzoPropuesta;
  resultado("latencia", [{ prueba: "propuesta y explicación tras respuesta de alergias", ms: propuestaMs, objetivoMs: 35000, cumpleObjetivo: propuestaMs < 35000 && visibleMs < 35000 }], { exploratorio: true, n: 1, inicioPropuesta: comienzoPropuesta, finTurno: cierre.fecha, visibleMs, etapas });
  await foto("21-agente-respuesta");
  ok(await page.getByText("Plan listo para revisión médica", { exact: true }).count() > 0, "recibo de creación visible en el chat al entregar el control al médico");
  ok(planVisible, `plan visible en ${(visibleMs / 1000).toFixed(1)} s; turno completo en ${(propuestaMs / 1000).toFixed(1)} s`);
  ok(visibleMs <= propuestaMs + 5000, "plan visible tras guardar sin esperar el respaldo de sincronización de 60 s");
  if (planVisible) {
    const texto = await cuerpo();
    ok(/Propuesta por el agente/.test(texto), "líneas marcadas «Propuesta por el agente»");
    ok(await page.locator("details[open]").filter({ has: page.getByText("Motivo del último cambio", { exact: true }) }).count() > 0, "motivo del agente abierto en el tablero");
    const mediciones = page.locator("details").filter({ has: page.getByText("Manual vs agente · exploratorio, n pequeño", { exact: true }) });
    if (!(await mediciones.evaluate(e => e.open))) await mediciones.locator("summary").click();
    await page.getByText("Último turno del agente que modificó este plan · exploratorio, n=1", { exact: true }).waitFor({ timeout: 30000 });
    ok(await page.getByText(/API del modelo:.*llamada/).count() > 0, "duración de API del modelo medida desde su traza, separada de las herramientas");
    await page.locator("details[open]").filter({ has: page.getByText("Manual vs agente · exploratorio, n pequeño", { exact: true }) }).screenshot({ path: `${OUT}21-medicion-api-modelo.png` });
    if (process.env.MEGI_BENCH_MODEL) {
      const tabId = etapas.find(e => e.tool === "proponer-plan" && e.fecha >= comienzoPropuesta)?.tabId;
      const runId = etapas.find(e => e.runId && e.isRunning && e.fecha >= comienzoPropuesta && (!tabId || e.tabId === tabId))?.runId;
      if (!runId) throw new Error("La comparación no identificó el turno que creó el plan");
      const modeloEfectivo = await page.evaluate(async id => {
        const r = await fetch(`/_agent-native/observability/traces/${encodeURIComponent(id)}`);
        if (!r.ok) throw new Error(`Traza de comparación no disponible: ${r.status}`);
        return (await r.json()).summary.model;
      }, runId);
      if (modeloEfectivo !== process.env.MEGI_BENCH_MODEL) throw new Error(`Comparación inválida: se solicitó ${process.env.MEGI_BENCH_MODEL}, pero la traza registró ${modeloEfectivo}`);
      ok(true, "modelo efectivo de la traza coincide con el solicitado para la comparación");
    }
    const nLineas = await page.locator("li[data-linea-id]").count();
    ok(nLineas >= 2, `el plan tiene ${nLineas} líneas`);
    console.log(`   advertencia AINE/HTA visible: ${/Advertencia/.test(texto) ? "sí" : "no"} · verificado: ${/Sin alertas detectadas/.test(texto) ? "sí" : "no"}`);
    await page.getByRole("tab", { name: /Cambios/ }).click();
    await page.waitForTimeout(500);
    ok(/Agente/.test(await cuerpo()), "la bitácora registra al agente como actor");
    await foto("22-bitacora-agente");
    // Segunda vuelta: el médico bloquea una línea y pide reajuste que la toca.
    await page.getByRole("tab", { name: "Plan", exact: true }).click();
    const primera = page.locator("li[data-linea-id]").first();
    const nombre = (await primera.locator("span.font-medium").first().innerText()).trim();
    await primera.getByRole("button", { name: "Bloquear" }).click();
    await primera.getByText("Bloqueada por el médico").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Pedir reajuste al agente", exact: true }).click();
    const composer = page.locator('[role="textbox"][contenteditable="true"]').last();
    await composer.fill(`Quita ${nombre} del plan y déjalo todo lo demás igual.`);
    await page.getByRole("button", { name: /Send message|Enviar mensaje/ }).click();
    await finAgente(page);
    const respuesta = await page.locator('article[data-role="assistant"] .agentkit-message-content').last().innerText();
    const respondio = /bloquead|fijad/i.test(respuesta);
    await primera.getByText("Bloqueada por el médico").waitFor({ timeout: 30000 });
    await foto("23-agente-respeta-bloqueo");
    ok(await primera.getByText("Bloqueada por el médico").count() === 1, `la línea bloqueada (${nombre}) sigue intacta tras pedir al agente que la quite`);
    ok(respondio, "el agente explica que no puede tocar la línea bloqueada");
  }
} catch (e) { fallos++; resultados.push({ prueba: "excepción", pasa: false, detalle: e.message }); console.log("✘ excepción:", e.message.split("\n")[0]); await foto("29-error").catch(() => {}); }
try { await cancelarAgenteSiEnCurso(page); await restaurarModelo?.(); }
catch (e) { fallos++; resultados.push({ prueba: "limpieza de la comparación", pasa: false, detalle: e.message }); }
const sinSesion = red.filter(r => /401 GET .*\/_agent-native\/agent-engine\/status$/.test(r));
const inesperados = red.filter((r) => !/favicon|\.map$/.test(r) && !(sinSesion.length === 1 && r === sinSesion[0]));
console.log(`red con error: ${inesperados.length}`); inesperados.forEach((r) => console.log("  " + r));
console.log(`consola: ${consola.filter((c) => !/script tag while rendering/.test(c)).length}`);
const fallosTotales = fallos + inesperados.length;
console.log(fallosTotales ? `${fallos} fallos de comprobación y ${inesperados.length} errores de red` : "agente en vivo: correcto");
resultado("agente", resultados, { fallos: fallosTotales, fallosComprobacion: fallos, etapas, sondaSinSesion: sinSesion, red: inesperados, consola: consola.filter(c => !/script tag while rendering/.test(c)) });
await browser.close(); process.exit(fallosTotales ? 1 : 0);
