// I1 · Recorrido de la UI en MODO HTTP contra el backend de evidencia (:8123), automatizado.
// Fase A: cuenta de servicio compartida autorizada por MEGI_MEDICOS (lectura, propuesta,
//   bloqueo, rechazo, aprobación) y comprobación en la auditoría de MEGI de la identidad real.
// Fase B: conexión PROPIA del médico (secretos de usuario del framework): solo ve sus
//   pacientes y MEGI firma con SU identidad; retirar la conexión vuelve a la cuenta compartida.
// Fase C: sin MEGI_MEDICOS ni conexión propia: la UI recibe 403 sin_rol_clinico y no hay
//   llamadas clínicas al backend.
// Requiere: node evidencia/backend.mjs en marcha. Escribe solo en bases de ensayo.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { arrancarUi, CORREO_DEV } from "./ui-http.mjs";

const BACKEND = process.env.MEGI_URL ?? "http://127.0.0.1:8123";
const OUT = fileURLToPath(new URL("./capturas-http/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const resultados = []; let fallos = 0;
const ok = (c, m, detalle) => { console.log(`${c ? "✔" : "✘"} ${m}${detalle !== undefined ? ` · ${JSON.stringify(detalle)}` : ""}`); resultados.push({ prueba: m, pasa: Boolean(c), ...(detalle !== undefined ? { detalle } : {}) }); if (!c) fallos++; };
let n = 0;
const foto = (page, nombre) => { n++; return page.screenshot({ path: `${OUT}${String(n).padStart(2, "0")}-${nombre}.png`, fullPage: true }); };
const login = async (u, p) => (await (await fetch(`${BACKEND}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p }) })).json()).token;
const leer = async (token, ruta) => { const r = await fetch(`${BACKEND}/api${ruta}`, { headers: { Authorization: `Bearer ${token}` } }); return { status: r.status, body: r.status < 400 ? await r.json() : await r.text() }; };
const logBackend = process.env.MEGI_BACKEND_LOG;
const lineasLog = () => (logBackend ? readFileSync(logBackend, "utf8").split("\n").filter((l) => /"(GET|POST) \/api\//.test(l) && !/\/api\/health/.test(l)) : null);
const apiPendientes = [];
const observar = (page) => {
  page.on("response", async (r) => { if (/\/actions\/listar-consultas/.test(r.url())) { let body = null; try { body = await r.json(); } catch { /* sin json */ } apiPendientes.push({ status: r.status(), body }); } });
};
const entrar = async (page, base, ruta = "/revision") => {
  await page.goto(`${base}${ruta}`, { waitUntil: "networkidle" });
  const dev = page.getByRole("button", { name: /local dev|desarrollador local/i });
  if (await dev.count()) { await dev.first().click(); await page.waitForURL(/revision|home/, { timeout: 30000 }); await page.goto(`${base}${ruta}`, { waitUntil: "networkidle" }); }
};
const secreto = (page, clave, valor) => page.evaluate(async ([k, v]) => { const r = await fetch(`/_agent-native/secrets/${k}`, { method: v === null ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: v === null ? undefined : JSON.stringify({ value: v }) }); return r.status; }, [clave, valor]);
const planEnBlancoYLinea = async (page, farmaco, dosis, frecuencia, duracion, chip) => {
  await page.getByText("Pedir propuesta al agente").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Plan en blanco" }).click();
  await page.getByRole("button", { name: /Aprobar y exportar/ }).waitFor({ timeout: 30000 });
  await page.getByLabel("Fármaco", { exact: true }).fill(farmaco);
  await page.getByLabel("Dosis", { exact: true }).fill(dosis);
  await page.getByLabel("Frecuencia", { exact: true }).fill(frecuencia);
  await page.getByLabel("Duración", { exact: true }).fill(duracion);
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  const linea = page.locator("li[data-linea-id]", { hasText: farmaco }).first();
  await linea.getByText(chip).waitFor({ timeout: 30000 });
  return linea;
};
const aprobar = async (page) => {
  await page.getByRole("button", { name: /Aprobar y exportar/ }).click();
  await page.getByText("Aprobar y exportar a MEGI").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /^Aprobar y exportar$/ }).last().click();
  await page.getByText("Aprobado y exportado", { exact: true }).first().waitFor({ timeout: 60000 });
};

const browser = await chromium.launch();
let ui = null;
const revision = { backend: (await (await fetch(`${BACKEND}/api/health`)).json()), appCommit: execFileSync("git", ["-C", fileURLToPath(new URL("../megi-revision/", import.meta.url)), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), appConCambiosSinCommit: execFileSync("git", ["-C", fileURLToPath(new URL("../megi-revision/", import.meta.url)), "status", "--porcelain"], { encoding: "utf8" }).trim().length > 0 };
try {
  const tokenA = await login("demo_medico", "demo-megi-2026");
  const tokenB = await login("demo_medica_b", "demo-megi-b-2026");
  const estadoInicial = await leer(tokenA, "/consultations/C-DEMO1");
  if (estadoInicial.body?.status === "approved" || estadoInicial.body?.status === "exported") throw new Error("C-DEMO1 ya está aprobada: reinicia node evidencia/backend.mjs para resembrar antes del recorrido");

  // ---------------- Fase A · cuenta de servicio compartida, correo autorizado
  ui = await arrancarUi({ puerto: 8084, medicos: CORREO_DEV, variante: "fase-a-b" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "es-MX" });
  observar(page);
  await entrar(page, ui.url);
  await page.getByText("Consultas pendientes de revisión").waitFor({ timeout: 60000 });
  await page.locator("main").getByText("Alba Prueba Ficticia", { exact: true }).waitFor({ timeout: 60000 });
  await foto(page, "http-lista-compartida");
  ok((await page.locator("main ul > li").count()) === 4, "A · lista http: 4 pendientes del médico de servicio");
  ok((await page.getByText(/MEGI conectado \(local_mock\)/).count()) > 0, "A · indicador «MEGI conectado (local_mock)» con el modo real del backend");
  ok((await page.getByText(/Mostrando 4 de 4 pendientes/).count()) > 0, "A · la lista indica página y total del servidor");
  ok((await page.getByText("Sin alergias conocidas (registrado)").count()) === 1 && (await page.getByText("Sin registro de alergias").count()) >= 1, "A · «Ninguna conocida» se muestra como registro (verde), distinto de «sin registro»");
  await page.setViewportSize({ width: 390, height: 844 });
  await foto(page, "http-lista-movil");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "A · lista sin desbordamiento horizontal a 390 px");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: /Alba Prueba Ficticia/ }).click();
  await page.waitForURL(/\/revision\/demo-c1/);
  const amox = await planEnBlancoYLinea(page, "Amoxicilina", "500 mg", "cada 8 h", "7 días", "Bloqueo de seguridad");
  ok((await page.getByText(/alergia a Penicilina/).count()) > 0, "A · bloqueo por alergia verificado por el backend real");
  await foto(page, "http-amoxicilina-bloqueada");
  await page.getByLabel("Fármaco", { exact: true }).fill("Paracetamol");
  await page.getByLabel("Dosis", { exact: true }).fill("500 mg");
  await page.getByLabel("Frecuencia", { exact: true }).fill("cada 8 h");
  await page.getByLabel("Duración", { exact: true }).fill("5 días");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await page.locator("li[data-linea-id]", { hasText: "Paracetamol" }).getByText("Sin alertas detectadas").waitFor({ timeout: 30000 });
  await amox.getByRole("button", { name: "Bloquear" }).click();
  await amox.getByText("Bloqueada por el médico").waitFor({ timeout: 15000 });
  ok((await amox.getByRole("button", { name: "Editar" }).count()) === 0, "A · línea fijada por el médico no editable");
  await amox.getByRole("button", { name: "Desbloquear" }).click();
  await amox.getByRole("button", { name: "Rechazar" }).first().waitFor({ timeout: 15000 });
  await amox.getByRole("button", { name: "Rechazar" }).first().click();
  await page.getByLabel("Motivo", { exact: true }).fill("Alergia a penicilina confirmada con el backend");
  await page.getByRole("button", { name: "Rechazar", exact: true }).last().click();
  await amox.getByText("Rechazada").waitFor({ timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 844 });
  const fondo = page.locator(".agent-sidebar-backdrop");
  if (await fondo.isVisible()) { await fondo.click({ position: { x: 10, y: 400 } }); await fondo.waitFor({ state: "hidden" }); }
  await foto(page, "http-tablero-movil");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "A · tablero sin desbordamiento horizontal a 390 px");
  const aprobarVisible = page.getByRole("button", { name: /Aprobar y exportar/ }).first();
  ok(await aprobarVisible.isVisible(), "A · la acción principal (Aprobar y exportar) es visible en móvil");
  await page.setViewportSize({ width: 1280, height: 900 });
  await aprobar(page);
  await foto(page, "http-exportado-compartida");
  const c1 = await leer(tokenA, "/consultations/C-DEMO1");
  const auditoria1 = await leer(tokenA, "/consultations/C-DEMO1/audit");
  const aprobacion1 = (auditoria1.body?.timeline ?? []).find((e) => e.kind === "approve");
  ok(["approved", "exported"].includes(c1.body?.status) && c1.body?.approved_by === "Dra. Demo Ficticia", "A · MEGI aprobó con la cuenta de servicio (approved_by = cuenta compartida)", c1.body?.approved_by);
  ok(aprobacion1?.note?.includes(`Aprobado en MEGI Revisión por ${CORREO_DEV}`) === true, "A · la auditoría de MEGI conserva el correo real del aprobador en la nota", aprobacion1?.note?.slice(0, 80));
  ok(!(await page.locator("body").innerText()).includes("demo-megi-2026"), "A · ninguna credencial aparece en pantalla");

  // ---------------- Fase B · conexión propia del médico (secretos de usuario)
  ok((await secreto(page, "MEGI_USUARIO", "demo_medica_b")) < 300 && (await secreto(page, "MEGI_CONTRASENA", "demo-megi-b-2026")) < 300, "B · el médico guarda su conexión propia en la superficie de secretos (ámbito usuario)");
  await page.goto(`${ui.url}/revision`, { waitUntil: "networkidle" });
  await page.getByText("Consultas pendientes de revisión").waitFor({ timeout: 60000 });
  await page.locator("main").getByText("Bruno Paciente Ficticio", { exact: true }).waitFor({ timeout: 60000 });
  await foto(page, "http-lista-conexion-propia");
  ok((await page.locator("main ul > li").count()) === 1 && (await page.locator("main").getByText("Alba Prueba Ficticia", { exact: true }).count()) === 0 && (await page.locator("main").getByText("Rosa Ficticia Muestra", { exact: true }).count()) === 0, "B · con conexión propia solo ve SUS pendientes (1), no los del otro médico");
  await page.getByRole("link", { name: /Bruno Paciente Ficticio/ }).click();
  await page.waitForURL(/\/revision\/C-DEMOB1/);
  await planEnBlancoYLinea(page, "Azitromicina", "500 mg", "cada 24 h", "3 días", "Sin alertas detectadas");
  ok((await page.getByText(/Losartán/).count()) > 0, "B · la medicación del expediente del paciente de B (Losartán) llega por el historial por lotes");
  const conciliacion = page.getByLabel(/Estado de Losartán/);
  if (await conciliacion.count()) { await conciliacion.selectOption("activo"); await page.getByRole("button", { name: /Guardar conciliación/ }).click(); await page.getByText(/Conciliación guardada|conciliad/i).first().waitFor({ timeout: 15000 }).catch(() => {}); }
  await aprobar(page);
  await foto(page, "http-exportado-identidad-propia");
  const cB = await leer(tokenB, "/consultations/C-DEMOB1");
  const auditoriaB = await leer(tokenB, "/consultations/C-DEMOB1/audit");
  const aprobacionB = (auditoriaB.body?.timeline ?? []).find((e) => e.kind === "approve");
  ok(cB.body?.approved_by === "Dra. Segunda Ficticia", "B · MEGI firma la aprobación con la identidad PROPIA del médico (approved_by = su cuenta)", cB.body?.approved_by);
  ok(aprobacionB?.note?.includes(`Aprobado en MEGI Revisión por ${CORREO_DEV}`) === true, "B · la nota de auditoría conserva además la sesión de la app");
  ok((await leer(tokenA, "/consultations/C-DEMOB1")).status === 404 && (await leer(tokenA, "/consultations/C-DEMOB1/audit")).status === 404, "B · el otro médico no lee ni audita esa consulta en MEGI (404)");
  await page.getByRole("tab", { name: "Exportación" }).click();
  await page.getByText(/sha256:/).first().waitFor({ timeout: 10000 });
  ok((await page.getByText(/Aprobado por:/).count()) > 0 && (await page.getByText(/Dra\. Segunda Ficticia/).count()) > 0, "B · la pestaña Exportación muestra al firmante real (la identidad propia, no la cuenta de servicio)");
  ok((await secreto(page, "MEGI_USUARIO", null)) < 300 && (await secreto(page, "MEGI_CONTRASENA", null)) < 300, "B · el médico retira su conexión");
  await page.goto(`${ui.url}/revision`, { waitUntil: "networkidle" });
  await page.getByText("Consultas pendientes de revisión").waitFor({ timeout: 60000 });
  await page.locator("main").getByText("Rosa Ficticia Muestra", { exact: true }).waitFor({ timeout: 60000 });
  ok((await page.locator("main ul > li").count()) === 3 && (await page.locator("main").getByText("Bruno Paciente Ficticio", { exact: true }).count()) === 0, "B · sin conexión propia vuelve a la cuenta compartida (solo porque MEGI_MEDICOS lo autoriza): 3 pendientes restantes de A");
  await page.getByRole("button", { name: "Exportadas", exact: true }).click();
  await page.getByRole("link", { name: /Bruno Paciente Ficticio/ }).waitFor({ timeout: 30000 });
  ok(true, "B · el plan exportado con identidad propia sigue en el archivo local del médico tras retirar la conexión");
  await page.close();
  await ui.detener(); ui = null;

  // ---------------- Fase C · sin lista ni conexión: denegado, sin llamadas clínicas
  const antesLog = lineasLog();
  ui = await arrancarUi({ puerto: 8085, medicos: null, variante: "fase-c" });
  const pageC = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "es-MX" });
  apiPendientes.length = 0; observar(pageC);
  await entrar(pageC, ui.url);
  await pageC.getByText(/Tu cuenta no tiene acceso a MEGI|No se pudo leer MEGI/).waitFor({ timeout: 60000 });
  await foto(pageC, "http-denegado-sin-rol");
  const respuesta = apiPendientes.find((r) => r.status >= 400);
  ok(respuesta?.status === 403 && JSON.stringify(respuesta.body).includes("sin_rol_clinico"), "C · la UI recibe 403 sin_rol_clinico de listar-consultas sin lista ni conexión", respuesta && { status: respuesta.status, errorCode: respuesta.body?.errorCode ?? respuesta.body?.error?.code });
  const textoC = await pageC.locator("body").innerText();
  ok(textoC.includes("Tu cuenta no tiene acceso a MEGI") && !textoC.includes("demo-megi-2026"), "C · la pantalla explica el acceso denegado y cómo resolverlo, sin exponer credenciales");
  const despuesLog = lineasLog();
  if (antesLog && despuesLog) ok(despuesLog.length === antesLog.length, "C · el backend no recibió ninguna llamada clínica durante la denegación", { antes: antesLog.length, despues: despuesLog.length });
  else ok(true, "C · (sin MEGI_BACKEND_LOG: no se contó el tráfico del backend)");
  await pageC.close();
} catch (e) {
  fallos++; resultados.push({ prueba: "excepción", pasa: false, detalle: e.message });
  console.log("✘ excepción:", e.message.split("\n")[0]);
  if (ui) console.log(ui.salida().slice(-1500));
} finally {
  if (ui) await ui.detener();
  await browser.close();
  mkdirSync(fileURLToPath(new URL("./resultados/", import.meta.url)), { recursive: true });
  writeFileSync(fileURLToPath(new URL("./resultados/recorrido-http.json", import.meta.url)), JSON.stringify({ fecha: new Date().toISOString(), modo: "http", backend: BACKEND, ...revision, fallos, resultados }, null, 2) + "\n");
  console.log(`\n${fallos ? `${fallos} fallos` : "recorrido http completo correcto"} · capturas en ${OUT}`);
  process.exit(fallos ? 1 : 0);
}
