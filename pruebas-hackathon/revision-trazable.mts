import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const app = new URL("../megi-revision/", import.meta.url);
const req = createRequire(new URL("package.json", app));
process.env.DATABASE_URL = "pglite:memory://"; process.env.MEGI_MODE = "mock";
const load = (p: string) => import(new URL(p, app).href);
const { getPgliteClient, closePgliteClients } = await import(new URL("client.js", pathToFileURL(req.resolve("@agent-native/core/db"))).href);
const db = await getPgliteClient(process.env.DATABASE_URL);
for (const m of readFileSync(new URL("server/plugins/db.ts", app), "utf8").matchAll(/sql: `([\s\S]*?)`,/g)) await db.exec(m[1]);
const actions: Record<string, any> = {};
for (const n of ["proponer-plan", "obtener-plan", "actualizar-linea", "agregar-linea", "reajustar-plan", "aprobar-plan", "preparar-aprobacion", "definir-alcance", "historial-plan", "conciliar-medicacion", "restaurar-demo", "medir-revision", "metricas-revision", "listar-consultas", "sugerir-reemplazo", "resolver-sugerencia"]) actions[n] = (await load(`actions/${n}.ts`)).default;
const doctor = { userEmail: "revision@local.test", orgId: null, caller: "frontend" };
const agent = { ...doctor, caller: "tool" };
const other = { ...doctor, userEmail: "otra@local.test" };
const call = async (n: string, input: any, context = agent) => {
  let args = input;
  if (["actualizar-linea", "agregar-linea", "reajustar-plan"].includes(n) && context.caller !== "frontend" && args.versionEsperada === undefined) {
    const r = args.planId ? await db.query("SELECT version FROM planes WHERE id = $1 AND owner_email = $2", [args.planId, context.userEmail]) : await db.query("SELECT p.version FROM planes p JOIN lineas_plan l ON l.plan_id = p.id WHERE l.id = $1 AND p.owner_email = $2", [args.lineaId, context.userEmail]);
    if (r.rows[0]) args = {...args, versionEsperada: r.rows[0].version};
  }
  return actions[n].run(args, context);
};
const results: { id: string; passed: boolean }[] = [];
const test = async (id: string, fn: () => Promise<void> | void) => { try { await fn(); results.push({ id, passed: true }); console.log("PASS", id); } catch(e) { results.push({ id, passed: false }); console.error("FAIL", id, e); } };
const denied = async (n: string, args: any, code: string, ctx = agent) => { await assert.rejects(() => call(n, args, ctx), (e: any) => e.errorCode === code); };
const { megi } = await load("server/lib/megi/index.ts");
const adapter = await megi(doctor.userEmail);
const read = (id: string) => call("obtener-plan", { planId: id });
try {
 const p = await call("proponer-plan", { consultaId: "demo-c4", lineas: [{ tipo: "farmaco", texto: "Paracetamol", dosis: "500 mg", frecuencia: "cada 8 h" }, { tipo: "pendiente", texto: "Diario de cefalea" }], explicacion: "Propuesta con nota" });
 const [a, b] = p.lineas;
 await test("propuesta-entrega-recibo-verificado-sin-ocultar-alertas-ni-cerrar-mcp", async () => {
   const entry = actions["proponer-plan"];
   const { isActionExposedToExternalAgents } = await import(pathToFileURL(req.resolve("@agent-native/core/action")).href);
   const { normalizeActionChangeResult } = await import(pathToFileURL(req.resolve("@agent-native/core/action-ui")).href);
   assert.equal(entry.endsTurn, true);
   assert.equal(isActionExposedToExternalAgents(entry), true);
   const shown = entry.chatUI.projectResult({}, p);
   assert.deepEqual(Object.keys(shown), ["id", "plan", "change"]);
   const { anotarRecurso, invalidarRevision } = await load("app/lib/revision-sync.ts");
   anotarRecurso("proponer-plan", shown);
   const query = (resource: string) => ({ queryKey: ["action"], meta: { actionResources: [resource] } });
   assert.equal(invalidarRevision(query(`consulta:${p.plan.consultaId}`), [{ key: "proponer-plan" }]), true);
   assert.equal(invalidarRevision(query(`plan:${p.id}`), [{ key: "proponer-plan" }]), true);
   assert.equal(invalidarRevision(query("plan:ajeno"), [{ key: "proponer-plan" }]), false);
   const alertado = await call("proponer-plan", { consultaId: "demo-c1", lineas: [{ tipo: "farmaco", texto: "Amoxicilina", dosis: "500 mg" }] }, { ...agent, userEmail: "recibo@local.test" });
   assert.ok(alertado.resumen.bloqueos > 0);
   assert.match(entry.chatUI.projectResult({}, alertado).change.detail, new RegExp(`${alertado.resumen.bloqueos} bloqueo`));
   assert.ok(normalizeActionChangeResult(shown));
   assert.match(shown.change.title, /revisión médica/);
   assert.match(shown.change.detail, new RegExp(`${p.resumen.bloqueos} bloqueo`));
   assert.match(shown.change.detail, /concilia la medicación antes de aprobar/);
   assert.ok(!JSON.stringify(shown).includes('"fuentes"'));
   assert.equal((await read(p.id)).plan.version, p.plan.version);
   const error = await call("proponer-plan", { consultaId: "demo-c4", lineas: [] }).then(() => null, e => e);
   assert.equal(error.errorCode, "lineas_vacias");
 });
 await test("version-inicial-y-fuentes-reales", () => { assert.equal(p.plan.version, 1); assert.equal(a.fuentes[0].tipo, "nota"); assert.match(a.fuentes[0].fragmento, /Paracetamol/); });
 await test("alcance-exclusivo-del-medico", () => denied("definir-alcance", { planId: p.id, versionEsperada: 1, lineas: [a.id] }, "ui_only_action"));
 await call("definir-alcance", { planId: p.id, versionEsperada: 1, lineas: [a.id] }, doctor);
 await test("seleccion-guardada-en-servidor", async () => { const r = await read(p.id); assert.deepEqual(r.plan.alcanceAgente, [a.id]); assert.equal(r.plan.version, 2); });
 await test("no-edita-otra-linea", () => denied("actualizar-linea", { lineaId: b.id, texto: "Fuera de ámbito", versionEsperada: 2 }, "fuera_de_alcance"));
 await test("no-agrega-para-evadir-alcance", () => denied("agregar-linea", { planId: p.id, tipo: "pendiente", texto: "Otra línea", versionEsperada: 2 }, "fuera_de_alcance"));
 await test("no-omite-version-en-edicion-acotada", () => assert.rejects(() => actions["actualizar-linea"].run({ lineaId: a.id, dosis: "1 g" }, agent), (e: any) => e.errorCode === "version_desactualizada"));
 await test("no-edita-version-antigua", () => denied("actualizar-linea", { lineaId: a.id, dosis: "1 g", versionEsperada: 1 }, "version_desactualizada"));
 await call("actualizar-linea", { lineaId: a.id, dosis: "1 g", versionEsperada: 2, motivo: "Revisión de dosis" });
 await test("snapshot-muestra-antes-y-despues", async () => { const r = await call("historial-plan", { planId: p.id }); const actual = JSON.parse(r.versiones[0].snapshot); const anterior = JSON.parse(r.versiones[1].snapshot); assert.equal(actual.lineas.find((l: any) => l.id === a.id).dosis, "1 g"); assert.equal(anterior.lineas.find((l: any) => l.id === a.id).dosis, "500 mg"); assert.equal(r.versiones[0].actor, "agente"); });
 await test("historial-aislado-por-usuario", () => denied("historial-plan", { planId: p.id }, "not_found", other));
 const original = adapter.verificarReceta.bind(adapter);
 const antes = await call("historial-plan", { planId: p.id });
 adapter.verificarReceta = async () => { throw new Error("Fallo controlado"); };
 await test("fallo-no-guarda-linea-ni-version", async () => { await denied("actualizar-linea", { lineaId: a.id, dosis: "2 g", versionEsperada: 3 }, "megi_no_disponible"); assert.deepEqual(await call("historial-plan", { planId: p.id }), antes); assert.equal((await read(p.id)).lineas[0].dosis, "1 g"); });
 adapter.verificarReceta = original;
 await call("actualizar-linea", { lineaId: a.id, estado: "bloqueada", versionEsperada: 3 }, doctor);
 await test("bloqueo-intacto-dentro-del-alcance", () => denied("reajustar-plan", { planId: p.id, versionEsperada: 4, cambios: [{ accion: "quitar", lineaId: a.id, motivo: "No debe pasar" }], explicacion: "Prueba" }, "linea_bloqueada"));
 await test("aprobacion-rechaza-vista-desactualizada", () => denied("aprobar-plan", { planId: p.id, versionEsperada: 3 }, "version_desactualizada", doctor));
 const p2 = await call("proponer-plan", { consultaId: "demo-c2", lineas: [{ tipo: "farmaco", texto: "Naproxeno", dosis: "250 mg" }], explicacion: "Interacción histórica" });
 await test("antecedente-no-se-convierte-en-confirmado", async () => { const r = await read(p2.id); assert.equal(r.conciliacion[0].estado, "sin_confirmar"); assert.equal(r.lineas[0].verificacion, "advertencia"); });
 await test("medicacion-sin-conciliar-frena-aprobacion", () => denied("aprobar-plan", { planId: p2.id, versionEsperada: 1 }, "medicacion_sin_conciliar", doctor));
 await test("agente-no-concilia", () => denied("conciliar-medicacion", { planId: p2.id, versionEsperada: 1, decisiones: [] }, "ui_only_action"));
 const meds = (await read(p2.id)).conciliacion;
 await call("conciliar-medicacion", { planId: p2.id, versionEsperada: 1, decisiones: meds.map((m: any) => ({ id: m.id, estado: "activo" })) }, doctor);
 await test("conciliacion-reverifica-y-conserva-fuente", async () => { const r = await read(p2.id); assert.equal(r.conciliacion[0].fuente, meds[0].fuente); assert.equal(r.plan.version, 2); assert.equal(r.lineas[0].verificacion, "advertencia"); });
 await test("fuente-ausente-reconoce-incertidumbre", async () => { const added = await call("agregar-linea", { planId: p2.id, tipo: "pendiente", texto: "Indicación inexistente en la nota" }); assert.equal(added.linea.fuentes[0].tipo, "sin_respaldo"); });
 await test("mediciones-reales-y-aisladas", async () => { await call("medir-revision", { consultaId: "demo-c2", operacion: "iniciar", modalidad: "agente" }, doctor); await call("medir-revision", { consultaId: "demo-c2", operacion: "visible" }, doctor); await call("medir-revision", { consultaId: "demo-c2", operacion: "terminar" }, doctor); const r = await call("metricas-revision", { consultaId: "demo-c2" }); assert.ok(r.mediciones[0].planVisibleMs >= 0); assert.ok(r.mediciones[0].totalMs >= r.mediciones[0].planVisibleMs); assert.equal((await call("metricas-revision", { consultaId: "demo-c2" }, other)).mediciones.length, 0); });
 const q = await call("proponer-plan", { consultaId: "demo-c4", lineas: [{ tipo: "pendiente", texto: "Otro usuario" }] }, { ...other, caller: "tool" });
 await test("restaurar-demo-solo-casos-propios-y-conserva-mediciones", async () => { await call("restaurar-demo", { confirmar: true }, doctor); assert.equal((await call("obtener-plan", { planId: q.id }, other)).id, q.id); assert.equal((await call("metricas-revision", { consultaId: "demo-c2" })).mediciones.length, 1); assert.equal((await call("listar-consultas", {})).consultas.length, 4); });
 await test("reemplazo-hereda-alcance-sin-abrir-otras-lineas", async () => { const p = await call("proponer-plan", { consultaId: "demo-c4", lineas: [{ tipo: "pendiente", texto: "Diario de cefalea" }] }); await call("definir-alcance", { planId: p.id, versionEsperada: 1, lineas: [p.lineas[0].id] }, doctor); const r = await call("reajustar-plan", { planId: p.id, versionEsperada: 2, cambios: [{ accion: "reemplazar", lineaId: p.lineas[0].id, texto: "Diario diario", motivo: "Cambio acotado" }], explicacion: "Reemplazo" }); const nuevo = r.lineas.find((l: any) => l.estado !== "rechazada"); assert.deepEqual((await read(p.id)).plan.alcanceAgente, [nuevo.id]); });
 await test("conciliar-suspension-se-respeta-tambien-al-exportar", async () => {
   const p = await call("proponer-plan", { consultaId: "demo-c3", lineas: [{ tipo: "farmaco", texto: "Ibuprofeno", dosis: "400 mg" }] });
   assert.equal(p.lineas[0].verificacion, "bloqueado");
   const actual = await read(p.id);
   await call("conciliar-medicacion", { planId: p.id, versionEsperada: 1, decisiones: actual.conciliacion.map((m: any) => ({ id: m.id, estado: "suspendido" })) }, doctor);
   assert.notEqual((await read(p.id)).lineas[0].verificacion, "bloqueado");
   assert.equal((await call("aprobar-plan", { planId: p.id, versionEsperada: 2 }, doctor)).plan.estado, "exportado");
 });
 await test("dos-ediciones-de-la-misma-version-no-pierden-cambios", async () => {
   const lista = await call("listar-consultas", {});
   const p = await read(lista.consultas.find((c: any) => c.id === "demo-c4").planId);
   const l = p.lineas.find((l: any) => l.estado !== "rechazada");
   const cambios = await Promise.allSettled(["Cambio A", "Cambio B"].map(texto => call("actualizar-linea", { lineaId: l.id, texto, versionEsperada: p.plan.version })));
   assert.equal(cambios.filter(r => r.status === "fulfilled").length, 1);
   assert.ok(cambios.some(r => r.status === "rejected" && r.reason.errorCode === "version_desactualizada"));
   assert.equal((await read(p.id)).plan.version, p.plan.version + 1);
 });
 await test("cancelacion-no-deja-version-ni-cambio-parcial", async () => {
   const lista = await call("listar-consultas", {});
   const p = await read(lista.consultas.find((c: any) => c.id === "demo-c4").planId);
   const antes = await call("historial-plan", { planId: p.id });
   const signal = AbortSignal.abort();
   await assert.rejects(() => call("agregar-linea", { planId: p.id, tipo: "pendiente", texto: "No debe guardarse" }, { ...doctor, signal }));
   assert.deepEqual(await call("historial-plan", { planId: p.id }), antes);
 });
 await test("alertas-distintas-no-heredan-confirmacion-previa", async () => {
   const p = await call("proponer-plan", { consultaId: "demo-c1", lineas: [{ tipo: "farmaco", texto: "Amoxicilina", dosis: "500 mg" }] });
   const r = await call("preparar-aprobacion", { planId: p.id, versionEsperada: 1 }, doctor);
   const antes = await call("historial-plan", { planId: p.id });
   const vigente = await megi(doctor.userEmail);
   const verificar = vigente.verificarReceta.bind(vigente);
   vigente.verificarReceta = async (...args: any[]) => { const v = await verificar(...args); v.Amoxicilina.motivo = "Alerta nueva no revisada"; return v; };
   try { await denied("aprobar-plan", { planId: p.id, versionEsperada: r.version, confirmaAlertas: true }, "alertas_actualizadas", doctor); assert.deepEqual(await call("historial-plan", { planId: p.id }), antes); }
   finally { vigente.verificarReceta = verificar; }
 });
 await test("comparacion-distingue-pauta-fijada-de-alerta-recalculada", async () => {
   const { compararLineas } = await load("app/lib/revision-diff.ts");
   const l = { id: "fijada", texto: "Losartán", dosis: "50 mg", frecuencia: "cada 24 h", duracion: "continuo", estado: "bloqueada", verificacion: "advertencia", origen: "agente", justificacion: null };
   const [r] = compararLineas([l], [{ ...l, verificacion: "ok" }]);
   assert.equal(r.tipo, "conservada"); assert.equal(r.cambios[0].campo, "verificacion");
 });
 await test("restauracion-rechaza-http-antes-de-contactar-backend", async () => {
   // En http el rol clínico (MEGI_MEDICOS) se exige antes; con el médico declarado, la restauración sigue rechazándose por modo.
   process.env.MEGI_MODE = "http"; process.env.MEGI_MEDICOS = doctor.userEmail;
   try {
     await denied("restaurar-demo", { confirmar: true }, "solo_demo", doctor);
     delete process.env.MEGI_MEDICOS;
     await denied("restaurar-demo", { confirmar: true }, "sin_rol_clinico", doctor);
   }
   finally { process.env.MEGI_MODE = "mock"; delete process.env.MEGI_MEDICOS; }
 });
 await test("medicion-interrumpida-no-se-presenta-como-finalizada", async () => {
   await call("medir-revision", { consultaId: "demo-c4", operacion: "iniciar", modalidad: "manual" }, doctor);
   await denied("medir-revision", { consultaId: "demo-c4", operacion: "iniciar", modalidad: "agente" }, "medicion_en_curso", doctor);
   await call("medir-revision", { consultaId: "demo-c4", operacion: "interrumpir" }, doctor);
   const r = await call("metricas-revision", { consultaId: "demo-c4" });
   assert.equal(r.mediciones[0].resultado, "interrumpida"); assert.ok(r.mediciones[0].fin);
 });
 await test("plan-anterior-se-puede-leer-sin-backend", async () => {
   const lista = await call("listar-consultas", {});
   const p = await read(lista.consultas.find((c: any) => c.id === "demo-c4").planId);
   await db.query("UPDATE planes SET contexto_fuente = NULL WHERE id = $1", [p.id]);
   const vigente = await megi(doctor.userEmail); const ver = vigente.verConsulta.bind(vigente);
   vigente.verConsulta = async () => { throw new Error("Sin backend"); };
   try { const r = await read(p.id); assert.equal(r.id, p.id); assert.equal(r.lineas[0].fuentes[0].tipo, "sin_respaldo"); }
   finally { vigente.verConsulta = ver; }
 });
 await test("exportacion-anterior-se-recupera-sin-backend", async () => {
   const rows = await db.query("SELECT id FROM planes WHERE owner_email = $1 AND estado = 'exportado' LIMIT 1", [doctor.userEmail]);
   const id = rows.rows[0].id;
   await db.query("UPDATE planes SET contexto_fuente = NULL WHERE id = $1", [id]);
   const vigente = await megi(doctor.userEmail); const ver = vigente.verConsulta.bind(vigente);
   vigente.verConsulta = async () => { throw new Error("Sin backend"); };
   try { assert.equal((await call("aprobar-plan", { planId: id }, doctor)).plan.estado, "exportado"); }
   finally { vigente.verConsulta = ver; }
 });
 const { MegiHttp } = await load("server/lib/megi/megi-http.ts");
 await test("historial-incluye-cronico-antiguo-y-distingue-tratamiento-finalizado", async () => {
   const http = new MegiHttp({ url: "http://test", user: "demo", password: "demo", fetchImpl: async (url: any) => {
     const path = new URL(String(url)).pathname;
     let body: any;
     if (path.endsWith("/auth/login")) body = { token: "tok" };
     else if (path.endsWith("/patients/P-TEST")) body = { id: "P-TEST", name: "Paciente sintético", age: 50, sex: "M", allergies: [] };
     else if (path.endsWith("/patients/P-TEST/consultations")) body = [{ id: "vieja", status: "approved", started_at: "2025-01-01" }, { id: "reciente", status: "approved", started_at: "2026-01-01" }];
     else if (path.endsWith("/consultations/vieja")) body = { id: "vieja", approved_at: "2025-01-01", prescription: JSON.stringify([{ drug: "Warfarina 5 mg", dose: "5 mg", freq: "cada 24 h", duration: "continuo" }]) };
     else if (path.endsWith("/consultations/reciente")) body = { id: "reciente", approved_at: "2026-01-01", prescription: JSON.stringify([{ drug: "Amoxicilina", dose: "500 mg", freq: "cada 8 h", duration: "7 días" }]) };
     else if (/\/review\/(pending|medication-history)$/.test(path)) return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } }); // backend anterior: recorrido por consulta
     else throw new Error(path);
     return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
   }});
   const r = await http.verPaciente("P-TEST"); assert.ok(r.historialMedicacion.some((m: any) => /Warfarina/.test(m.nombre) && m.estado === "sin_confirmar")); assert.ok(r.historialMedicacion.some((m: any) => /Amoxicilina/.test(m.nombre) && m.estado === "finalizado"));
 });

 await test("version-obligatoria-sin-alcance", async () => {
   const ps = await db.query("SELECT id FROM planes WHERE owner_email = $1 AND estado = 'borrador' LIMIT 1", [doctor.userEmail]); const p = await read(ps.rows[0].id);
   await call("definir-alcance", { planId: p.id, versionEsperada: p.plan.version, lineas: null }, doctor);
   await assert.rejects(() => actions["actualizar-linea"].run({ lineaId: p.lineas[0].id, texto: "No autorizado sin versión" }, agent), (e: any) => e.errorCode === "version_desactualizada");
 });
 await test("contexto-conservado-minimo-sin-transcripcion", async () => {
   const p = await db.query("SELECT contexto_fuente FROM planes WHERE owner_email = $1 AND contexto_fuente IS NOT NULL LIMIT 1", [doctor.userEmail]);
   const c = JSON.parse(p.rows[0].contexto_fuente); assert.deepEqual(Object.keys(c.consulta).sort(), ["fecha", "id", "medicamentosPropuestos", "pendientes", "soap"]); assert.deepEqual(Object.keys(c.paciente), ["historialMedicacion"]);
 });
 await test("legacy-hidratacion-fallida-es-502-tipado", async () => {
   const ps = await db.query("SELECT id FROM planes WHERE owner_email = $1 AND estado = 'borrador' LIMIT 1", [doctor.userEmail]); const p = await read(ps.rows[0].id);
   await db.query("UPDATE planes SET contexto_fuente = NULL WHERE id = $1", [p.id]);
   const a = await megi(doctor.userEmail); const original = a.verConsulta; a.verConsulta = async () => { throw new Error("Caída controlada"); };
   try { await assert.rejects(() => call("actualizar-linea", { lineaId: p.lineas[0].id, texto: "No guardar" }), (e: any) => e.errorCode === "megi_no_disponible" && e.statusCode === 502); } finally { a.verConsulta = original; }
 });
 await test("exportadas-antiguas-neutras-y-listadas-sin-backend", async () => {
   const lista = await call("listar-consultas", { estado: "exportadas" }); assert.ok(lista.consultas.length); const p = await read(lista.consultas[0].planId); assert.deepEqual(p.lineas[0].fuentes, []);
 });
 await test("nueva-medicacion-viva-entra-y-frena-aprobacion", async () => {
   const who = { ...doctor, userEmail: "viva@local.test" }; const a = await megi(who.userEmail);
   const p = await call("proponer-plan", { consultaId: "demo-c4", lineas: [{ tipo: "farmaco", texto: "Paracetamol", dosis: "500 mg" }] }, who);
   const ver = a.verPaciente; const check = a.verificarReceta; let cruzada = false;
   a.verPaciente = async (...args: any[]) => { const vivo = await ver.apply(a, args); return { ...vivo, historialMedicacion: [...(vivo.historialMedicacion ?? []), { id: "receta-nueva", nombre: "Warfarina", dosis: "5 mg", frecuencia: "cada 24 h", fuente: "MEGI recién aprobada", fecha: new Date().toISOString(), estado: "sin_confirmar" }] }; };
   a.verificarReceta = async (...args: any[]) => { cruzada = args[2].some((m: any) => m.nombre === "Warfarina"); return check.apply(a, args); };
   try { await call("preparar-aprobacion", { planId: p.id, versionEsperada: 1 }, who); const r = await call("obtener-plan", { planId: p.id }, who); assert.ok(cruzada); assert.equal(r.conciliacion.find((m: any) => m.id === "receta-nueva").estado, "sin_confirmar"); await denied("aprobar-plan", { planId: p.id, versionEsperada: r.plan.version }, "medicacion_sin_conciliar", who); }
   finally { a.verPaciente = ver; a.verificarReceta = check; }
 });
 await test("cambio-de-pauta-no-hereda-suspension-y-conserva-manuales", async () => {
   const { fusionarConciliacion } = await load("server/lib/revision.ts");
   const m = { id: "rx", nombre: "Warfarina", dosis: "5 mg", frecuencia: "diaria", fuente: "MEGI", fecha: "2026-11-06", estado: "suspendido" };
   const p = { conciliacion: JSON.stringify([m, { ...m, id: "manual", fuente: "Referido", nombre: "Otro" }]) };
   const fusion = fusionarConciliacion(p, { historialMedicacion: [{ ...m, dosis: "10 mg" }] });
   assert.ok(fusion.some((x: any) => x.dosis === "10 mg" && x.estado === "sin_confirmar")); assert.ok(fusion.some((x: any) => x.id === "manual"));
 });
 await test("cache-solo-peticion-y-aislado-por-adaptador", async () => {
   const { enPeticionMegi } = await load("server/lib/megi/peticion.ts"); let n = 0;
   const crear = () => new MegiHttp({ url: "http://test", user: "u", password: "p", fetchImpl: async (url: any) => { n++; const path = new URL(String(url)).pathname; if (/\/review\//.test(path)) return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } }); return new Response(JSON.stringify(path.endsWith("/login") ? { token: "t" } : path.endsWith("/consultations") ? [] : { id: "P-CACHE", name: "Sintético", allergies: [] }), {status: 200, headers: {"content-type":"application/json"}}); } });
   const a = crear(); const b = crear();
   await enPeticionMegi(async () => { const p = await a.verPaciente("P-CACHE"); const antes = n; assert.strictEqual(await a.verPaciente("P-CACHE"), p); assert.equal(n, antes); await b.verPaciente("P-CACHE"); assert.ok(n > antes); });
   const antes = n; await enPeticionMegi(() => a.verPaciente("P-CACHE")); assert.ok(n > antes);
 });
 await test("sugerencia-acotada-no-toca-fijada-y-medico-resuelve", async () => {
   const who = { ...doctor, userEmail: "sugerencias@local.test" }; const ag = { ...who, caller: "tool" };
   const p = await call("proponer-plan", { consultaId: "demo-c1", lineas: [{ tipo: "farmaco", texto: "Amoxicilina", dosis: "500 mg" }] }, ag); const id = p.lineas[0].id;
   await call("actualizar-linea", { lineaId: id, estado: "bloqueada", versionEsperada: 1 }, who);
   const args = { planId: p.id, lineaId: id, versionEsperada: 2, tipo: "farmaco", texto: "Azitromicina", dosis: "500 mg", frecuencia: "cada 24 h", duracion: "3 días", justificacion: "Alternativa a revisar" };
   await denied("sugerir-reemplazo", args, "fuera_de_alcance", ag);
   await call("definir-alcance", { planId: p.id, versionEsperada: 2, lineas: [id], modo: "sugerencias" }, who);
   const propuesta = await call("sugerir-reemplazo", { ...args, versionEsperada: 3 }, ag);
   const r = await call("obtener-plan", { planId: p.id }, who); assert.equal(r.lineas.length, 1); assert.equal(r.lineas[0].estado, "bloqueada"); assert.equal(r.lineas[0].texto, "Amoxicilina"); assert.equal(r.plan.alcanceAgente, null);
   const resolver = { planId: p.id, sugerenciaId: propuesta.sugerencia.id, versionEsperada: 4, decision: "aceptar" };
   await denied("resolver-sugerencia", resolver, "ui_only_action", ag); await denied("resolver-sugerencia", resolver, "linea_bloqueada", who);
   await call("actualizar-linea", { lineaId: id, estado: "editada", versionEsperada: 4 }, who);
   await call("resolver-sugerencia", { ...resolver, versionEsperada: 5 }, who);
   const final = await call("obtener-plan", { planId: p.id }, who); assert.equal(final.sugerencias[0].estado, "aceptada"); assert.ok(final.lineas.some((l: any) => l.texto === "Azitromicina" && l.estado === "editada")); assert.equal(final.plan.version, 6);
   const historial = await call("historial-plan", { planId: p.id }, who); const snapshot = JSON.parse(historial.versiones[0].snapshot); assert.equal(snapshot.sugerencias[0].estado, "aceptada"); assert.deepEqual(snapshot.alcanceSugerencias, [id]);
 });
 await test("alternativa-se-cruza-con-otros-farmacos-del-plan", async () => {
   const who = { ...doctor, userEmail: "cruce-alternativa@local.test" }; const ag = { ...who, caller: "tool" };
   const p = await call("proponer-plan", { consultaId: "demo-c1", lineas: [{ tipo: "farmaco", texto: "Amoxicilina", dosis: "500 mg" }, { tipo: "farmaco", texto: "Warfarina", dosis: "5 mg" }] }, ag);
   await call("definir-alcance", { planId: p.id, versionEsperada: 1, lineas: [p.lineas[0].id], modo: "sugerencias" }, who);
   const a = await megi(who.userEmail); const original = a.verificarReceta; let cruzada = false;
   a.verificarReceta = async (...args: any[]) => { cruzada = args[1].some((m: any) => m.nombre === "Warfarina") && !args[1].some((m: any) => m.nombre === "Amoxicilina"); return original.apply(a, args); };
   try { await call("sugerir-reemplazo", { planId: p.id, lineaId: p.lineas[0].id, versionEsperada: 2, tipo: "farmaco", texto: "Azitromicina", dosis: "500 mg", frecuencia: "cada 24 h", duracion: "3 días", justificacion: "Alternativa con cruce completo" }, ag); assert.ok(cruzada); } finally { a.verificarReceta = original; }
 });
 await test("receta-aprobada-despues-del-plan-cruza-por-adaptador-http", async () => {
   const who = { ...doctor, userEmail: "viva-http@local.test" };
   const adapter = await megi(who.userEmail);
   let nuevaReceta = false; const cruces: string[][] = [];
   const http = new MegiHttp({ url: "http://megi-sintetico", user: "demo", password: "demo", fetchImpl: async (url: any, init: any) => {
     const path = new URL(String(url)).pathname;
     let body: any;
     if (path.endsWith("/auth/login")) body = { token: "token-sintetico" };
     else if (path.endsWith("/patients/P-DEMO4")) body = { id: "P-DEMO4", name: "Paciente HTTP sintético", age: 50, sex: "M", allergies: [], chronic: [] };
     else if (path.endsWith("/patients/P-DEMO4/consultations")) body = nuevaReceta ? [{ id: "RX-NUEVA", status: "approved", started_at: new Date().toISOString() }] : [];
     else if (path.endsWith("/consultations/RX-NUEVA")) body = { id: "RX-NUEVA", approved_at: new Date().toISOString(), prescription: JSON.stringify([{ drug: "Warfarina", dose: "5 mg", freq: "cada 24 h", duration: "continuo" }]) };
     else if (path.endsWith("/safety/rx-check")) { cruces.push(JSON.parse(init.body).rx_list.map((m: any) => m.drug)); body = { alerts: [] }; }
     else if (/\/review\/(pending|medication-history)$/.test(path)) return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
     else throw new Error(`Ruta sintética no prevista: ${path}`);
     return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
   }});
   const pacienteOriginal = adapter.verPaciente; const verificarOriginal = adapter.verificarReceta;
   adapter.verPaciente = http.verPaciente.bind(http); adapter.verificarReceta = http.verificarReceta.bind(http);
   try {
     const p = await call("proponer-plan", { consultaId: "demo-c4", lineas: [{ tipo: "farmaco", texto: "Paracetamol", dosis: "500 mg" }] }, who);
     assert.equal(cruces[0].some(x => /Warfarina/.test(x)), false);
     nuevaReceta = true;
     await call("preparar-aprobacion", { planId: p.id, versionEsperada: p.plan.version }, who);
     const actual = await call("obtener-plan", { planId: p.id }, who);
     assert.ok(cruces[cruces.length - 1].some(x => /Warfarina/.test(x)));
     assert.equal(actual.conciliacion.find((m: any) => m.nombre === "Warfarina").estado, "sin_confirmar");
     await denied("aprobar-plan", { planId: p.id, versionEsperada: actual.plan.version }, "medicacion_sin_conciliar", who);
   } finally { adapter.verPaciente = pacienteOriginal; adapter.verificarReceta = verificarOriginal; }
 });
 await test("contexto-se-parsea-una-vez-por-accion-y-no-se-reusa-entre-peticiones", async () => {
   const who = { ...doctor, userEmail: "parseo@local.test" };
   const p = await call("proponer-plan", { consultaId: "demo-c4", lineas: [{ tipo: "farmaco", texto: "Paracetamol", dosis: "500 mg" }, { tipo: "pendiente", texto: "Diario de cefalea" }] }, who);
   const raw = (await db.query("SELECT contexto_fuente FROM planes WHERE id = $1", [p.id])).rows[0].contexto_fuente;
   const original = JSON.parse; let parseos = 0;
   JSON.parse = function (valor: string, ...args: any[]) { if (valor === raw) parseos++; return original.call(JSON, valor, ...args); } as typeof JSON.parse;
   try {
     await call("actualizar-linea", { lineaId: p.lineas[0].id, dosis: "650 mg", versionEsperada: 1 }, who);
     assert.equal(parseos, 1, "verificación, snapshot y salida comparten el contexto ya parseado");
     await call("obtener-plan", { planId: p.id }, who);
     assert.equal(parseos, 2, "la petición siguiente vuelve a leer su propio contexto");
   } finally { JSON.parse = original; }
 });
 await test("traza-del-modelo-vinculada-desde-contexto-del-servidor-y-aislada", async () => {
   const who = { ...agent, userEmail: "traza@local.test", runId: "run-servidor-ficticio" };
   const p = await call("proponer-plan", { consultaId: "demo-c4", lineas: [{ tipo: "farmaco", texto: "Paracetamol", dosis: "500 mg" }], runId: "run-falsificado-en-input" }, who);
   let r = await call("metricas-revision", { consultaId: "demo-c4" }, who);
   assert.equal(r.ultimoRunAgenteId, who.runId);
   await call("actualizar-linea", { lineaId: p.lineas[0].id, dosis: "650 mg", versionEsperada: 1 }, { ...who, caller: "frontend", runId: "no-es-un-turno-del-modelo" });
   r = await call("metricas-revision", { consultaId: "demo-c4" }, who);
   assert.equal(r.ultimoRunAgenteId, who.runId);
   assert.equal((await call("metricas-revision", { consultaId: "demo-c4" }, other)).ultimoRunAgenteId, null);
   const versiones = await db.query("SELECT agente_run_id FROM versiones_plan WHERE plan_id = $1 ORDER BY version", [p.id]);
   assert.deepEqual(versiones.rows.map((v: any) => v.agente_run_id), [who.runId, null]);
 });
 await test("entrega-pausada-refresca-su-recurso-sin-marca-de-efecto", async () => {
   const { observarRecursosRevision, invalidarHerramientaRevision } = await load("app/lib/revision-sync.ts");
   const previo = (globalThis as any).window;
   (globalThis as any).window = new EventTarget();
   const notificados: string[] = [];
   const limpiar = observarRecursosRevision(tool => notificados.push(tool));
   const emit = (name: string, detail: any) => (globalThis as any).window.dispatchEvent(new CustomEvent(name, { detail }));
   const query = (tag: string) => ({ queryKey: ["action"], meta: { actionResources: [tag] } });
   try {
     emit("agent-native:tool-input", { tool: "proponer-plan", phase: "start", argsText: JSON.stringify({ consultaId: "A" }) });
     emit("agent-native:tool-done", { tool: "proponer-plan", result: { change: { title: "Recibo" } } });
     assert.deepEqual(notificados, ["proponer-plan"]);
     assert.equal(invalidarHerramientaRevision(query("consulta:A"), "proponer-plan"), true);
     assert.equal(invalidarHerramientaRevision(query("consulta:B"), "proponer-plan"), false);
     emit("agent-native:tool-input", { tool: "proponer-plan", phase: "start", argsText: JSON.stringify({ consultaId: "B" }) });
     emit("agent-native:tool-done", { tool: "proponer-plan", result: "Recibo no estructurado" });
     assert.equal(invalidarHerramientaRevision(query("consulta:A"), "proponer-plan"), false);
     assert.equal(invalidarHerramientaRevision(query("consulta:B"), "proponer-plan"), true);
     emit("agent-native:tool-done", { tool: "proponer-plan", isError: true });
     emit("agent-native:tool-done", { tool: "obtener-plan" });
     emit("agent-native:tool-done", { tool: "proponer-plan", completedSideEffect: true });
     assert.equal(notificados.length, 3);
     assert.equal(invalidarHerramientaRevision({ queryKey: ["action"] }, "proponer-plan"), false);
   } finally { limpiar(); (globalThis as any).window = previo; }
 });
 await test("invalidacion-de-un-plan-no-despierta-otro", async () => {
   const { anotarRecurso, invalidarRevision } = await load("app/lib/revision-sync.ts");
   anotarRecurso("reajustar-plan", { planId: "A" }); const query = (id: string) => ({ queryKey: ["action", "obtener-plan"], meta: { actionResources: [`plan:${id}`] } });
   assert.equal(invalidarRevision(query("A"), [{ key: "reajustar-plan" }]), true); assert.equal(invalidarRevision(query("B"), [{ key: "reajustar-plan" }]), false); assert.equal(invalidarRevision(query("B"), [{ key: "desconocida" }]), true);
   anotarRecurso("reajustar-plan", { planId: "B" });
   assert.equal(invalidarRevision(query("A"), [{ key: "reajustar-plan" }]), false);
   assert.equal(invalidarRevision(query("B"), [{ key: "reajustar-plan" }]), true);
 });
} finally {
 writeFileSync(new URL("revision-trazable-resultados.json", import.meta.url), JSON.stringify({ fecha: new Date().toISOString(), entorno: "PGlite en memoria, pacientes sintéticos, sin LLM", resultados: results }, null, 2) + "\n");
 await closePgliteClients();
}
if (results.some(r => !r.passed)) process.exitCode = 1;
