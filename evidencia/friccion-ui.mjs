// Fricción de interfaz sin usuarios: teclado, zoom y estados de espera/error/vacío
// de los flujos principales (lista, tablero, aprobación, chat). Navegador sin
// cabeza contra la demo (MEGI mock). No llama al modelo: las sugerencias del
// chat solo se enfocan, no se envían. Capturas en capturas-friccion/.
import { chromium } from "playwright";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { BASE, restaurar, resultado } from "./comun.mjs";

const OUT = new URL("./capturas-friccion/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".png")) rmSync(`${OUT}${f}`); // capturas de esta ejecución únicamente
const resultados = [];
let fallos = 0;
const ok = (c, m, detalle) => { console.log(`${c ? "✔" : "✘"} ${m}${detalle ? " · " + JSON.stringify(detalle) : ""}`); resultados.push({ prueba: m, pasa: Boolean(c), ...(detalle === undefined ? {} : { detalle }) }); if (!c) fallos++; };
const errores = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "es-MX" });
page.on("pageerror", (e) => errores.push(e.message));
let n = 0;
const foto = async (nombre) => { n++; await page.screenshot({ path: `${OUT}${String(n).padStart(2, "0")}-${nombre}.png`, fullPage: true }); };
const activo = () => page.evaluate(() => { const e = document.activeElement; if (!e) return null; const cs = getComputedStyle(e); return { tag: e.tagName, texto: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 60), href: e.getAttribute("href"), focoVisible: e.matches(":focus-visible"), anillo: cs.outlineStyle !== "none" && cs.outlineWidth !== "0px" || /rgb/.test(cs.boxShadow) }; });
const tabHasta = async (pred, max = 60) => { for (let i = 0; i < max; i++) { await page.keyboard.press("Tab"); const a = await activo(); if (a && pred(a)) return a; } return null; };
const sinOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
const mainOverflow = () => page.evaluate(() => [...document.querySelectorAll("main")].every((m) => m.scrollWidth <= m.clientWidth + 1));
const anchoContenido = () => page.evaluate(() => { const m = document.querySelector("main"); return m ? Math.round(m.getBoundingClientRect().width) : 0; });

try {
  await restaurar(page);

  // ------------------------------------------------------------- teclado
  await page.goto(`${BASE}/revision`, { waitUntil: "networkidle" });
  await page.getByText("Alba Prueba Ficticia", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Tab");
  const tarjeta = await tabHasta((a) => a.tag === "A" && /\/revision\/demo-/.test(a.href ?? ""));
  ok(Boolean(tarjeta), "teclado · Tab llega a una tarjeta de consulta", tarjeta);
  ok(tarjeta?.focoVisible && tarjeta?.anillo, "teclado · la tarjeta enfocada muestra anillo de foco", tarjeta && { focoVisible: tarjeta.focoVisible, anillo: tarjeta.anillo });
  await foto("lista-foco-tarjeta");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/revision\/demo-/, { timeout: 15000 });
  ok(true, "teclado · Enter abre el tablero de la tarjeta enfocada", { url: page.url() });
  const rutaTablero = new URL(page.url()).pathname; // el tablero que se trabaja con teclado
  await page.getByRole("button", { name: "Plan en blanco", exact: true }).waitFor({ timeout: 30000 });

  // Plan en blanco con teclado
  const planBlanco = await tabHasta((a) => a.tag === "BUTTON" && a.texto === "Plan en blanco");
  ok(Boolean(planBlanco) && planBlanco.anillo, "teclado · «Plan en blanco» alcanzable con anillo de foco", planBlanco);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Aprobar y exportar/ }).waitFor({ timeout: 30000 });
  ok(true, "teclado · Enter crea el plan en blanco");

  // Formulario: Tab entre campos, Enter envía
  await page.getByLabel("Fármaco", { exact: true }).focus();
  await page.keyboard.type("Paracetamol");
  await page.keyboard.press("Tab"); await page.keyboard.type("500 mg");
  await page.keyboard.press("Tab"); await page.keyboard.type("cada 8 h");
  await page.keyboard.press("Tab"); await page.keyboard.type("5 días");
  await page.keyboard.press("Enter");
  await page.getByText("Sin alertas detectadas", { exact: true }).first().waitFor({ timeout: 30000 });
  ok(true, "teclado · Enter en el formulario añade la línea verificada");
  await foto("tablero-linea-por-teclado");

  // Acciones de línea alcanzables con Tab; Enter bloquea
  const linea = page.locator("li[data-linea-id]", { hasText: "Paracetamol" }).first();
  await linea.getByRole("checkbox").focus();
  const bloquear = await tabHasta((a) => a.tag === "BUTTON" && a.texto === "Bloquear", 10);
  ok(Boolean(bloquear) && bloquear.anillo, "teclado · «Bloquear» de la línea alcanzable con anillo de foco", bloquear);
  await page.keyboard.press("Enter");
  await linea.getByText("Bloqueada por el médico", { exact: true }).waitFor({ timeout: 15000 });
  ok(true, "teclado · Enter bloquea la línea");

  // Pestañas con flechas
  await page.getByRole("tab", { name: "Plan", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const pestana = await page.getByRole("tab", { selected: true }).innerText();
  ok(/Comparar versiones/.test(pestana), "teclado · flecha derecha cambia a «Comparar versiones»", { seleccionada: pestana });
  ok(await page.getByText(/Cargando versiones…|El próximo cambio guardará la primera versión|Versión de referencia|Comparar con|Versión \d/).count() > 0, "estados · la comparación muestra versiones o su estado vacío, sin error");
  await page.keyboard.press("ArrowLeft");

  // Diálogo de aprobación: foco dentro, Tab no escapa, Escape cierra
  await page.getByRole("button", { name: /Aprobar y exportar/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("alertdialog").waitFor({ timeout: 15000 });
  const dentro = () => page.evaluate(() => Boolean(document.activeElement?.closest("[role=alertdialog]")));
  ok(await dentro(), "teclado · al abrir el diálogo de aprobación el foco entra en él");
  let atrapado = true;
  for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); if (!(await dentro())) { atrapado = false; break; } }
  ok(atrapado, "teclado · Tab se mantiene dentro del diálogo (foco atrapado)");
  await foto("dialogo-aprobar-teclado");
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").waitFor({ state: "hidden", timeout: 10000 });
  ok(true, "teclado · Escape cierra el diálogo sin aprobar");
  ok(await page.getByText(/Plan en revisión · v/).count() > 0, "teclado · el plan sigue en revisión tras cerrar con Escape");

  // Chat: sugerencias enfocables (no se envían)
  await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Soy el agente de MEGI Revisión" }).waitFor({ timeout: 30000 });
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  const chip = await tabHasta((a) => a.tag === "BUTTON" && /consultas tengo pendientes/.test(a.texto), 80);
  ok(Boolean(chip) && chip.focoVisible && chip.anillo, "teclado · sugerencia de bienvenida enfocable con anillo visible", chip);
  const recorridoFoco = [];
  const enlace = await tabHasta((a) => { recorridoFoco.push(`${a.tag}:${a.texto.slice(0, 30)}`); return a.tag === "A" && /consultas pendientes/.test(a.texto); }, 25);
  ok(Boolean(enlace), "teclado · enlace «Ir a las consultas pendientes» alcanzable", enlace ?? { recorridoFoco });
  await foto("chat-foco-sugerencia");

  // ---------------------------------------------------------------- zoom
  for (const [etiqueta, preparar] of [
    ["texto 200 %", async () => { await page.setViewportSize({ width: 1280, height: 900 }); await page.addStyleTag({ content: "html{font-size:200%!important}" }); }],
    ["ventana 640 px (≈ zoom 200 %)", async () => { await page.setViewportSize({ width: 640, height: 900 }); }],
  ]) {
    await page.goto(`${BASE}/revision`, { waitUntil: "domcontentloaded" }); await preparar();
    await page.getByText("Alba Prueba Ficticia", { exact: true }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
    const anchoLista = await anchoContenido();
    ok((await sinOverflow()) && (await mainOverflow()), `zoom · lista sin desbordamiento horizontal (${etiqueta})`, { anchoContenidoPx: anchoLista });
    const nombre = await page.evaluate(() => { const e = [...document.querySelectorAll("main a .truncate")].find((x) => /Alba Prueba Ficticia/.test(x.textContent)); return e ? Math.round(e.getBoundingClientRect().width) : 0; });
    ok(nombre >= 80, `zoom · el nombre del paciente conserva ancho legible en la tarjeta (${etiqueta})`, { anchoNombrePx: nombre, anchoContenidoPx: anchoLista });
    await foto(`zoom-lista-${etiqueta.replace(/[^a-z0-9]+/gi, "-")}`);
    await page.goto(`${BASE}${rutaTablero}`, { waitUntil: "domcontentloaded" }); await preparar();
    await page.getByRole("button", { name: /Aprobar y exportar/ }).waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
    ok((await sinOverflow()) && (await mainOverflow()), `zoom · tablero sin desbordamiento horizontal (${etiqueta})`);
    const aprobar = page.getByRole("button", { name: /Aprobar y exportar/ });
    ok(await aprobar.isVisible() && await aprobar.isEnabled(), `zoom · «Aprobar y exportar» visible y operativo (${etiqueta})`);
    await foto(`zoom-tablero-${etiqueta.replace(/[^a-z0-9]+/gi, "-")}`);
    await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" }); await preparar();
    await page.getByRole("heading", { name: "Soy el agente de MEGI Revisión" }).waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
    ok(await sinOverflow(), `zoom · chat sin desbordamiento horizontal (${etiqueta})`);
    const chip1 = page.getByRole("button", { name: "¿Qué consultas tengo pendientes de revisión?", exact: true });
    await chip1.scrollIntoViewIfNeeded();
    let clicable = true; try { await chip1.click({ trial: true, timeout: 5000 }); } catch { clicable = false; }
    ok(clicable, `zoom · primera sugerencia del chat clicable (${etiqueta})`);
    await foto(`zoom-chat-${etiqueta.replace(/[^a-z0-9]+/gi, "-")}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // ------------------------------------------------------------- estados
  // Espera: lista con respuesta retrasada → esqueletos
  await page.route("**/_agent-native/actions/listar-consultas*", async (route) => { await new Promise((r) => setTimeout(r, 3000)); await route.continue().catch(() => {}); });
  await page.goto(`${BASE}/revision`, { waitUntil: "domcontentloaded" });
  await page.locator("main .skeleton-shimmer").first().waitFor({ timeout: 8000 }).catch(() => {});
  const esqueletos = await page.locator("main .skeleton-shimmer").count().catch(() => 0);
  ok(esqueletos >= 1, "estados · lista en espera muestra esqueletos", { esqueletos });
  await foto("estado-lista-espera");
  await page.unroute("**/_agent-native/actions/listar-consultas*");
  await page.getByText("Alba Prueba Ficticia", { exact: true }).first().waitFor({ timeout: 30000 });

  // Error: lista con MEGI caído
  await page.route("**/_agent-native/actions/listar-consultas*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "MEGI no disponible", errorCode: "megi_no_disponible" }) }));
  await page.goto(`${BASE}/revision`, { waitUntil: "domcontentloaded" });
  const errorLista = page.getByText(/No se pudo leer MEGI/);
  await errorLista.waitFor({ timeout: 20000 });
  ok(true, "estados · lista con MEGI caído muestra un mensaje de error accionable");
  await foto("estado-lista-error");
  await page.unroute("**/_agent-native/actions/listar-consultas*");

  // Vacío: exportadas sin casos tras restaurar
  await page.goto(`${BASE}/revision`, { waitUntil: "domcontentloaded" });
  await page.getByText("Alba Prueba Ficticia", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Exportadas", exact: true }).click();
  await page.waitForTimeout(800);
  const textoVacio = (await page.locator("main p").filter({ hasText: /no hay/i }).first().innerText().catch(() => "")).trim();
  ok(textoVacio.length > 0, "estados · archivo de exportadas vacío muestra un mensaje", { texto: textoVacio });
  ok(/exportad|archivo/i.test(textoVacio) && !/pendientes de revisión/.test(textoVacio), "estados · el mensaje de vacío habla de exportadas, no de pendientes", { texto: textoVacio });
  await foto("estado-exportadas-vacio");

  // Tablero inexistente
  await page.goto(`${BASE}/revision/no-existe`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Volver a la lista" }).waitFor({ timeout: 20000 });
  const errorTablero = (await page.locator("main p").first().innerText()).trim();
  ok(errorTablero.length > 0, "estados · consulta inexistente muestra error y «Volver a la lista»", { texto: errorTablero });
  await foto("estado-tablero-inexistente");

  // Tablero en espera
  await page.route("**/_agent-native/actions/ver-contexto-consulta*", async (route) => { await new Promise((r) => setTimeout(r, 3000)); await route.continue().catch(() => {}); });
  await page.goto(`${BASE}/revision/demo-c2`, { waitUntil: "domcontentloaded" });
  await page.locator("main .skeleton-shimmer").first().waitFor({ timeout: 8000 }).catch(() => {});
  const esqTablero = await page.locator("main .skeleton-shimmer").count().catch(() => 0);
  ok(esqTablero >= 1, "estados · tablero en espera muestra esqueletos", { esqueletos: esqTablero });
  await foto("estado-tablero-espera");
  await page.unroute("**/_agent-native/actions/ver-contexto-consulta*");
  await page.getByRole("heading", { name: "Mateo Ejemplo Demo", exact: true }).waitFor({ timeout: 30000 });

  // Acción fallida → aviso y estado intacto
  await page.goto(`${BASE}${rutaTablero}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Aprobar y exportar/ }).waitFor({ timeout: 30000 });
  await page.route("**/_agent-native/actions/actualizar-linea*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "MEGI no disponible (fallo inyectado)", errorCode: "megi_no_disponible" }) }));
  const paracetamol = page.locator("li[data-linea-id]", { hasText: "Paracetamol" }).first();
  await paracetamol.getByRole("button", { name: "Desbloquear", exact: true }).click();
  await page.locator("[data-sonner-toast], [role=status]").filter({ hasText: /No se pudo cambiar la línea|no disponible/ }).first().waitFor({ timeout: 15000 });
  ok(true, "estados · acción fallida muestra aviso de error");
  ok(await paracetamol.getByText("Bloqueada por el médico", { exact: true }).count() === 1, "estados · la línea conserva su estado tras el fallo");
  await foto("estado-accion-fallida");
  await page.unroute("**/_agent-native/actions/actualizar-linea*");

  // Landmarks: un único <main> por pantalla (el del layout); las rutas no anidan otro.
  for (const ruta of ["/revision", rutaTablero, "/chat"]) {
    await page.goto(`${BASE}${ruta}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const mains = await page.locator("main").count();
    ok(mains === 1, `landmarks · un solo <main> en ${ruta}`, { mains });
  }
  ok(errores.length === 0, "sin excepciones JavaScript en todo el recorrido", errores);
} catch (e) {
  fallos++; resultados.push({ prueba: "excepción", pasa: false, detalle: e.message.split("\n").slice(0, 3).join(" ") });
  console.log("✘ excepción:", e.message.split("\n")[0]);
  await foto("error").catch(() => {});
}
await browser.close();
console.log(fallos ? `${fallos} fallos` : "fricción de interfaz: sin fallos");
resultado("friccion-ui", resultados, { fallos, alcance: "Teclado, zoom (texto 200 % y ventana de 640 px) y estados de espera/error/vacío con respuestas interceptadas en el navegador. Sin usuarios reales y sin certificación de accesibilidad." });
process.exit(fallos ? 1 : 0);
