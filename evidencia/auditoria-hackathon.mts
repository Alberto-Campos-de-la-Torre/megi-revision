// Auditoría aislada: acciones reales + PGlite en memoria + adaptador mock.
// No carga .env, no llama al LLM y no modifica la demo existente.
// Ejecutar: megi-revision/node_modules/.bin/tsx evidencia/auditoria-hackathon.mts
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const app = new URL("../megi-revision/", import.meta.url);
const req = createRequire(new URL("package.json", app));
process.env.DATABASE_URL = "pglite:memory://";
process.env.MEGI_MODE = "mock";
const load = (path: string) => import(new URL(path, app).href);
const { getPgliteClient, closePgliteClients } = await import(new URL("client.js", pathToFileURL(req.resolve("@agent-native/core/db"))).href);
const client = await getPgliteClient(process.env.DATABASE_URL);
const migraciones = [...readFileSync(new URL("server/plugins/db.ts", app), "utf8").matchAll(/sql: `([\s\S]*?)`,/g)];
if (!migraciones.length) throw new Error("No se encontraron migraciones");
for (const m of migraciones) await client.exec(m[1]);
const actions: Record<string, any> = {};
for (const name of ["proponer-plan", "obtener-plan", "actualizar-linea", "reajustar-plan", "aprobar-plan", "agregar-linea", "conciliar-medicacion", "listar-consultas"]) {
  actions[name] = (await load(`actions/${name}.ts`)).default;
}
const { megi } = await load("server/lib/megi/index.ts");
const adapter = await megi("auditoria@local.test");
const ctx = { caller: "tool", userEmail: "auditoria@local.test", orgId: null };
const call = async (n: string, input: any, context = ctx) => {
  let args = input;
  if (["actualizar-linea", "agregar-linea", "reajustar-plan"].includes(n) && context.caller !== "frontend" && args.versionEsperada === undefined) {
    const r = args.planId ? await client.query("SELECT version FROM planes WHERE id = $1 AND owner_email = $2", [args.planId, context.userEmail]) : await client.query("SELECT p.version FROM planes p JOIN lineas_plan l ON l.plan_id = p.id WHERE l.id = $1 AND p.owner_email = $2", [args.lineaId, context.userEmail]);
    if (r.rows[0]) args = {...args, versionEsperada: r.rows[0].version};
  }
  return actions[n].run(args, context);
};
const results: any[] = [];
function record(id: string, passed: boolean, detail: unknown) {
  results.push({ id, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${id}: ${JSON.stringify(detail)}`);
}
async function rejection(name: string, args: unknown) {
  try { await call(name, args); return null; }
  catch (e: any) { return { code: e.errorCode, message: e.message }; }
}

try {
  for (const [patient, drug, expected] of [
    ["demo-p1", "Amoxicilina", "bloqueado"],
    ["demo-p2", "Naproxeno", "advertencia"],
    ["demo-p3", "Ibuprofeno", "bloqueado"],
    ["demo-p4", "Paracetamol", "ok"],
  ]) {
    const v = await adapter.verificarReceta(patient, [{ nombre: drug, dosis: "500 mg", frecuencia: "cada 8 h" }]);
    record(`mock-${patient}`, v[drug].resultado === expected, v[drug].resultado);
  }
  const p = await call("proponer-plan", {
    consultaId: "demo-c1", lineas: [{ tipo: "farmaco", texto: "Amoxicilina", dosis: "500 mg" }], explicacion: "Auditoría",
  });
  const id = p.lineas[0].id;
  record("propuesta-verificada", p.lineas[0].verificacion === "bloqueado", p.resumen);
  const deniedLock = await rejection("actualizar-linea", { lineaId: id, estado: "bloqueada" });
  record("agente-no-bloquea-con-origen-normal", deniedLock?.code === "solo_medico", deniedLock);
  await call("actualizar-linea", { lineaId: id, estado: "bloqueada", origen: "medico" }, { ...ctx, caller: "frontend" });
  const deniedEdit = await rejection("actualizar-linea", { lineaId: id, dosis: "999 mg" });
  record("bloqueo-normal", deniedEdit?.code === "linea_bloqueada", deniedEdit);
  const doctor = { ...ctx, caller: "frontend" };
  const uiDenied = await rejection("aprobar-plan", { planId: p.id });
  record("agente-no-aprueba", ["solo_medico", "ui_only_action"].includes(uiDenied?.code), uiDenied);
  const uiApprovalError = await call("aprobar-plan", { planId: p.id, origen: "medico" }, doctor).then(() => null, (e: any) => e.errorCode);
  record("medico-confirma-bloqueos", uiApprovalError === "alertas_sin_confirmar", uiApprovalError);
  for (const caller of ["tool", "http", "mcp", "cli", "automation", "a2a", "mcp-widget-write"]) {
    const c = { ...ctx, caller };
    const e = await call("actualizar-linea", { lineaId: id, estado: "editada", origen: "medico" }, c).then(() => null, (e: any) => e.errorCode);
    record(`suplantacion-denegada-${caller}`, e === "solo_medico", e);
    const a = await call("aprobar-plan", { planId: p.id, confirmaAlertas: true, origen: "medico" }, c).then(() => null, (e: any) => e.errorCode);
    record(`aprobacion-denegada-${caller}`, ["solo_medico", "ui_only_action"].includes(a), a);
  }
  const snapshot = async () => JSON.stringify(await Promise.all(["planes", "lineas_plan", "eventos_revision"].map(async (t) => (await client.query(`SELECT * FROM ${t} ORDER BY id`)).rows)));
  for (const [name, args] of [
    ["proponer-plan", {consultaId: "demo-c4", lineas: []}],
    ["agregar-linea", {planId: p.id, tipo: "pendiente", texto: "Prueba"}],
    ["reajustar-plan", {planId: p.id, cambios:[{accion: "agregar", texto:"Prueba", motivo:"Prueba"}], explicacion:"Prueba"}],
  ] as const) {
    const before = await snapshot();
    const e = await rejection(name, {...args, origen: "medico"});
    record(`suplantacion-denegada-${name}`, e?.code === "solo_medico" && before === await snapshot(), e);
  }
  for (const name of ["proponer-plan", "actualizar-linea", "agregar-linea", "reajustar-plan"]) {
    record(`http-exige-prueba-ui-${name}`, await actions[name].needsApproval({}, { ...ctx, caller: "http" }));
  }
  record("aprobacion-solo-ui-fuera-catalogo", actions["aprobar-plan"].uiOnly && actions["aprobar-plan"].agentTool === false);
  const reviewedVersion = (await call("obtener-plan", {planId:p.id})).plan.version;
  const approved = await call("aprobar-plan", {planId:p.id, versionEsperada:reviewedVersion, confirmaAlertas:true, origen:"medico"}, doctor);
  record("medico-aprueba-exporta", approved.plan.estado === "exportado" && approved.sello?.startsWith("sha256:"));
  const beforeRetry = await snapshot();
  const retry = await call("aprobar-plan", {planId:p.id, confirmaAlertas:true, origen:"medico"}, doctor);
  record("aprobacion-idempotente", retry.sello === approved.sello && beforeRetry === await snapshot());
  const closed = await rejection("actualizar-linea", {lineaId:id, dosis:"999 mg"});
  record("plan-exportado-cerrado", closed?.code === "plan_cerrado");

  const originalVerify = adapter.verificarReceta.bind(adapter);
  const offline = async () => {throw new Error("MEGI caído (fallo inyectado)");};
  const line = {tipo:"farmaco", texto:"Paracetamol", dosis:"500 mg", frecuencia:"cada 8 h", duracion:"5 días"};
  const beforeProposal = await snapshot();
  adapter.verificarReceta = offline;
  const failed = await rejection("proponer-plan", {consultaId:"demo-c2", lineas:[line]});
  record("propuesta-fallida-rollback-completo", failed?.code === "megi_no_disponible" && beforeProposal === await snapshot(), failed);
  adapter.verificarReceta = originalVerify;
  const p2 = await call("proponer-plan", {consultaId:"demo-c2", lineas:[line]});
  record("propuesta-reintentable-tras-caida", p2.lineas[0].verificacion === "ok");
  for (const [name,args] of [
    ["agregar-linea", {planId:p2.id,...line,texto:"Ibuprofeno"}],
    ["actualizar-linea", {lineaId:p2.lineas[0].id,dosis:"600 mg"}],
    ["reajustar-plan", {planId:p2.id,cambios:[{accion:"editar",lineaId:p2.lineas[0].id,dosis:"700 mg",motivo:"Fallo controlado"}],explicacion:"No debe persistir"}],
  ] as const) {
    const before = await snapshot(); adapter.verificarReceta = offline;
    const e = await rejection(name,args);
    record(`rollback-completo-${name}`,e?.code === "megi_no_disponible" && before === await snapshot(),e);
    adapter.verificarReceta = originalVerify;
  }
  const beforeIncomplete = await snapshot(); adapter.verificarReceta = async () => ({});
  const incomplete = await rejection("actualizar-linea",{lineaId:p2.lineas[0].id,dosis:"800 mg"});
  record("verificacion-incompleta-no-guarda",incomplete?.code === "verificacion_incompleta" && beforeIncomplete === await snapshot(),incomplete);
  adapter.verificarReceta = originalVerify;
  const beforeDuplicate = await snapshot();
  const duplicate = await rejection("reajustar-plan",{planId:p2.id,cambios:[
    {accion:"quitar",lineaId:p2.lineas[0].id,motivo:"Prueba"},
    {accion:"editar",lineaId:p2.lineas[0].id,dosis:"900 mg",motivo:"Prueba"},
  ],explicacion:"Prueba"});
  record("cambios-duplicados-rechazados",duplicate?.code === "invalid_input" && beforeDuplicate === await snapshot());
  const foreign = await call("actualizar-linea",{lineaId:p2.lineas[0].id,dosis:"999 mg"},{...ctx,userEmail:"otra-persona@local.test"}).then(()=>null,(e:any)=>e.errorCode);
  record("aislamiento-otro-usuario",foreign === "not_found" && beforeDuplicate === await snapshot());
  const cancel = new AbortController(); cancel.abort();
  const cancelled = await call("agregar-linea",{planId:p2.id,...line},{...ctx,signal:cancel.signal}).then(()=>false,()=>true);
  record("cancelacion-sin-escrituras",cancelled && beforeDuplicate === await snapshot());
  const next = await call("agregar-linea",{planId:p2.id,tipo:"pendiente",texto:"Control ficticio"});
  record("cancelacion-no-bloquea-siguiente-operacion",Boolean(next.id));

  const beforeCancelDuring = await snapshot();
  let releaseCancel!:()=>void; let reachedCancel!:()=>void;
  const cancelEntered = new Promise<void>(r=>{reachedCancel=r;});
  const cancelGate = new Promise<void>(r=>{releaseCancel=r;});
  const during = new AbortController();
  adapter.verificarReceta=async (...args:any[])=>{reachedCancel();await cancelGate;return originalVerify(...args);};
  const cancelPending=call("actualizar-linea",{lineaId:p2.lineas[0].id,dosis:"550 mg"},{...ctx,signal:during.signal}).then(()=>null,(e:any)=>e.name);
  await cancelEntered; during.abort(); releaseCancel();
  record("cancelacion-durante-verificacion-revierte",await cancelPending === "AbortError" && beforeCancelDuring === await snapshot());
  adapter.verificarReceta=originalVerify;
  let release!:()=>void; let reached!:()=>void;
  const entered = new Promise<void>(r=>{reached=r;});
  const gate = new Promise<void>(r=>{release=r;}); let first=true;
  adapter.verificarReceta=async (...args:any[])=>{if(first){first=false;reached();await gate;}return originalVerify(...args);};
  const locking=call("actualizar-linea",{lineaId:p2.lineas[0].id,estado:"bloqueada",origen:"medico"},doctor);
  await entered;
  const racing=rejection("actualizar-linea",{lineaId:p2.lineas[0].id,dosis:"999 mg"});
  release();await locking; const raceError=await racing;
  const finalRace=await call("obtener-plan",{consultaId:"demo-c2"});
  record("concurrencia-respeta-bloqueo",raceError?.code === "linea_bloqueada" && finalRace.lineas[0].dosis === "500 mg" && finalRace.lineas[0].estado === "bloqueada",raceError);
  adapter.verificarReceta=originalVerify;
  const originalExport=adapter.exportar.bind(adapter);let firstExport=true;
  adapter.exportar=async(...args:any[])=>{const r=await originalExport(...args);if(firstExport){firstExport=false;throw new Error("Descarga interrumpida después de aprobar");}return r;};
  const reconciliation = await call("obtener-plan",{planId:p2.id});
  await call("conciliar-medicacion",{planId:p2.id,versionEsperada:reconciliation.plan.version,decisiones:reconciliation.conciliacion.map((m:any)=>({id:m.id,estado:"activo"}))},doctor);
  const beforeExport=await snapshot();
  const interrupted=await call("aprobar-plan",{planId:p2.id,origen:"medico"},doctor).then(()=>false,()=>true);
  record("descarga-interrumpida-no-cierra-plan-local",interrupted && beforeExport === await snapshot());
  const recovered=await call("aprobar-plan",{planId:p2.id,origen:"medico"},doctor);
  record("reintento-recupera-aprobacion-remota",recovered.plan.estado === "exportado");
  const exported=await call("obtener-plan",{consultaId:"demo-c2"});
  const bundle=JSON.parse(exported.exportacion);
  const composition=bundle.entry.find((e:any)=>e.resource.resourceType === "Composition").resource;
  const text=composition.section.find((s:any)=>s.title === "P").text.div;
  record("soap-coincide-con-plan-revisado",/Paracetamol/.test(text) && !/Naproxeno/i.test(text),text);
  // Adaptador HTTP real con transporte simulado: aprueba una vez, falla la
  // descarga, recupera sin sobrescribir, y no repite la dosis al leer la receta.
  const { MegiHttp: HttpFixture } = await load("server/lib/megi/megi-http.ts");
  let remote:any={id:"C-DEMO4",patient_id:"P-DEMO4",status:"finalized",finalized:true,final_soap:JSON.stringify({S:"Ficticio",O:"Ficticio",A:"Ficticio",P:"Naproxeno previo"})};
  let approvals=0;let downloads=0;
  const fixture=new HttpFixture({url:"http://fixture.invalid",user:"fixture",password:"fixture",fetchImpl:async(url:any,init:any)=>{
    const path=new URL(url).pathname;
    let result:any={};let status=200;
    if(path.endsWith("/auth/login"))result={token:"fixture-token",name:"Médico ficticio"};
    else if(path.endsWith("/patients/P-DEMO4/consultations"))result=remote.status === "finalized"?[]:[{id:remote.id,status:remote.status,started_at:"2026-11-02"}];
    else if(path.endsWith("/patients/P-DEMO4"))result={id:"P-DEMO4",name:"Paciente ficticio",allergies:[],chronic:[]};
    else if(path.endsWith("/consultations/C-DEMO4"))result=remote;
    else if(path.endsWith("/review/approve")){
      approvals++;const body=JSON.parse(init.body);
      remote={...remote,status:"approved",approved_by:"Médico ficticio",prescription:JSON.stringify(body.rx_list.map((r:any)=>({duration:r.duration,freq:r.freq,dose:r.dose,drug:r.drug}))),approved_soap:JSON.stringify({P:body.soap.P,A:body.soap.A,O:body.soap.O,S:body.soap.S}),dx_codes:JSON.stringify(body.selected_dx)};
      result={approved_by:"Médico ficticio"};
    }else if(path.endsWith("/export/consultation/C-DEMO4")){
      downloads++;if(downloads===1){status=503;result={detail:"Fallo de descarga inyectado"};}
      else{remote.status="exported";result={content_hash:"sha256:fixture"};}
    }else if(path.endsWith("/consultations/C-DEMO4/fhir"))result={resourceType:"Bundle",entry:[]};
    else if(/\/review\/(pending|medication-history)$/.test(path)){status=404;result={detail:"Not Found"};}
    else throw new Error(`Ruta fixture inesperada: ${path}`);
    return new Response(JSON.stringify(result),{status,headers:{"content-type":"application/json"}});
  }});
  const approvedFixture={farmacos:[{nombre:"Paracetamol",dosis:"650 mg",frecuencia:"cada 8 h"}],pendientes:["Control ficticio"],diagnosticos:[],soap:{s:"Ficticio",o:"Ficticio",a:"Ficticio",p:"Paracetamol revisado"},confirmaAlertas:false};
  const downloadFailed=await fixture.exportar("demo-c4",approvedFixture).then(()=>false,()=>true);
  const fixtureRecovered=await fixture.exportar("demo-c4",approvedFixture);
  record("http-recupera-descarga-sin-reaprobar",downloadFailed && fixtureRecovered.sello === "sha256:fixture" && approvals === 1);
  const changed=await fixture.exportar("demo-c4",{...approvedFixture,farmacos:[{nombre:"Ibuprofeno",dosis:"400 mg",frecuencia:"cada 8 h"}]}).then(()=>null,(e:any)=>e.status);
  record("http-no-sobrescribe-aprobacion-distinta",changed === 409 && approvals === 1);
  const patientFixture=await fixture.verPaciente("demo-p4");
  record("http-no-duplica-dosis-al-leer",patientFixture.medicacionActiva[0].nombre === "Paracetamol" && patientFixture.medicacionActiva[0].dosis === "650 mg",patientFixture.medicacionActiva[0]);
  // ---- H1: contrato del verificador (/safety/rx-check) --------------------
  // Un HTTP 200 con cuerpo inválido NO es «sin alertas»: se rechaza (502,
  // verificador_invalido). Una alerta sin atribución no se descarta: aplica a
  // toda la receta propuesta.
  const { MegiError } = await load("server/lib/megi/types.ts");
  const verificador = (cuerpo: any, opciones: { estado?: number } = {}) => new HttpFixture({ url: "http://fixture.invalid", user: "fixture", password: "fixture", fetchImpl: async (url: any) => {
    const path = new URL(url).pathname;
    let result: any = {}; let status = 200;
    if (path.endsWith("/auth/login")) result = { token: "fixture-token", name: "Médico ficticio" };
    else if (path.endsWith("/consultations")) result = [];
    else if (path.includes("/patients/")) result = { id: "P-DEMO1", name: "Paciente ficticio", allergies: ["Penicilina"], chronic: [] };
    else if (path.endsWith("/safety/rx-check")) { result = cuerpo; status = opciones.estado ?? 200; }
    else if (path.endsWith("/drugs/alternatives")) result = { sugerencias: ["Alternativa ficticia"] };
    else if (/\/review\/(pending|medication-history)$/.test(path)) { status = 404; result = { detail: "Not Found" }; }
    else throw new Error(`Ruta fixture inesperada: ${path}`);
    return new Response(typeof result === "string" ? result : JSON.stringify(result), { status, headers: { "content-type": "application/json" } });
  } });
  const receta = [{ nombre: "Amoxicilina", dosis: "500 mg", frecuencia: "cada 8 h" }, { nombre: "Paracetamol", dosis: "500 mg", frecuencia: "cada 8 h" }];
  const verificar = (cuerpo: any) => verificador(cuerpo).verificarReceta("demo-p1", receta).then((v) => ({ ok: true as const, v }), (e: any) => ({ ok: false as const, status: e.status, codigo: e.detalle?.codigo, message: e.message }));
  for (const [id, cuerpo] of [
    ["http-verificador-cuerpo-vacio-rechazado", {}],
    ["http-verificador-alerts-no-lista-rechazado", { alerts: "ninguna" }],
    ["http-verificador-cuerpo-lista-rechazado", []],
    ["http-verificador-cuerpo-texto-rechazado", "ok"],
    ["http-verificador-severidad-desconocida-rechazada", { alerts: [{ severity: "critical", drug: "Amoxicilina 500 mg", against: "Penicilina", message: "x" }] }],
    ["http-verificador-alerta-sin-mensaje-rechazada", { alerts: [{ severity: "blocker", drug: "Amoxicilina 500 mg", against: "Penicilina" }] }],
    ["http-verificador-recuento-incoherente-rechazado", { alerts: [], blockers: 1, warnings: 0 }],
  ] as const) {
    const r = await verificar(cuerpo);
    record(id, !r.ok && r.status === 502 && r.codigo === "verificador_invalido", r.ok ? r.v : { codigo: r.codigo, message: r.message });
  }
  const limpio = await verificar({ alerts: [], blockers: 0, warnings: 0 });
  record("http-verificador-sin-alertas-sigue-ok", limpio.ok && limpio.v.Amoxicilina.resultado === "ok" && limpio.v.Paracetamol.resultado === "ok");
  const atribuida = await verificar({ alerts: [{ severity: "blocker", type: "alergia", drug: "Amoxicilina 500 mg", against: "Penicilina", message: "Alergia registrada a penicilinas" }], blockers: 1, warnings: 0 });
  record("http-alerta-atribuida-solo-a-su-farmaco", atribuida.ok && atribuida.v.Amoxicilina.resultado === "bloqueado" && atribuida.v.Paracetamol.resultado === "ok", atribuida.ok ? { a: atribuida.v.Amoxicilina.resultado, p: atribuida.v.Paracetamol.resultado } : atribuida);
  const global = await verificar({ alerts: [{ severity: "blocker", drug: "", against: "", message: "Bloqueo global sin atribución" }] });
  record("http-bloqueo-sin-atribucion-aplica-a-toda-la-receta", global.ok && global.v.Amoxicilina.resultado === "bloqueado" && global.v.Paracetamol.resultado === "bloqueado" && global.v.Paracetamol.motivo === "Bloqueo global sin atribución", global.ok ? { a: global.v.Amoxicilina.resultado, p: global.v.Paracetamol.resultado } : global);
  const desconocido = await verificar({ alerts: [{ severity: "warn", drug: "Fármaco-X", against: "Fármaco-Y", message: "Nombres que la app no reconoce" }] });
  record("http-alerta-con-nombres-desconocidos-no-se-pierde", desconocido.ok && desconocido.v.Amoxicilina.resultado === "advertencia" && desconocido.v.Paracetamol.resultado === "advertencia", desconocido);
  const activos = [{ nombre: "Warfarina", dosis: "5 mg", frecuencia: "cada 24 h" }, { nombre: "Aspirina", dosis: "100 mg", frecuencia: "cada 24 h" }];
  const pacienteFicticio = { id: "demo-p1", nombre: "Paciente ficticio", edad: 40, sexo: "X" as const, alergias: [], cronicos: [], medicacionActiva: activos };
  const entreActivos = await verificador({ alerts: [{ severity: "blocker", type: "interaccion", drug: "Warfarina 5 mg", against: "Aspirina 100 mg", message: "Interacción entre tratamientos previos" }] })
    .verificarReceta("demo-p1", [receta[1]], activos, pacienteFicticio);
  record("http-interaccion-entre-activos-no-marca-la-receta-nueva", entreActivos.Paracetamol.resultado === "ok", entreActivos.Paracetamol);
  const propuestoActivo = await verificador({ alerts: [{ severity: "blocker", type: "interaccion", drug: "Ibuprofeno 400 mg", against: "Warfarina 5 mg", message: "Interacción grave" }] })
    .verificarReceta("demo-p1", [{ nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 h" }], activos, pacienteFicticio);
  record("http-interaccion-propuesto-activo-bloquea", propuestoActivo.Ibuprofeno.resultado === "bloqueado", propuestoActivo.Ibuprofeno.resultado);
  // Capa de acción: la respuesta inválida se propaga con su propio código y no deja escrituras.
  const p3 = await call("proponer-plan", { consultaId: "demo-c3", lineas: [{ tipo: "farmaco", texto: "Paracetamol", dosis: "500 mg", frecuencia: "cada 8 h" }] });
  const beforeInvalid = await snapshot();
  adapter.verificarReceta = async () => { throw new MegiError("Respuesta inválida del verificador de MEGI (/safety/rx-check): falta la lista `alerts`. La receta no se da por segura.", 502, { codigo: "verificador_invalido" }); };
  const invalid = await rejection("actualizar-linea", { lineaId: p3.lineas[0].id, dosis: "650 mg" });
  record("accion-verificador-invalido-no-guarda", invalid?.code === "verificador_invalido" && beforeInvalid === await snapshot(), invalid);
  adapter.verificarReceta = originalVerify;
  const afterInvalid = await call("obtener-plan", { planId: p3.id });
  record("accion-verificador-invalido-no-cierra-el-plan", afterInvalid.lineas[0].dosis === "500 mg" && afterInvalid.plan.estado === "borrador");

  // ---- H2: identidad clínica ligada a la cuenta ------------------------------
  const { exigirMedico, rolClinico, identidadClinica, configurarCredencialesMegi, olvidarSesionHttp } = await load("server/lib/plan.ts").then(async (m: any) => ({ ...m, ...(await load("server/lib/megi/index.ts")) }));
  const gateMedico = (c: any) => exigirMedico(c).then(() => null, (e: any) => e.errorCode);
  const sinRol = { ...ctx, caller: "frontend", userEmail: "sin-rol@local.test" };
  record("mock-sin-lista-de-medicos-rol-no-exigido", rolClinico("sin-rol@local.test").ok === true && (await gateMedico(sinRol)) === null);
  process.env.MEGI_MEDICOS = "Auditoria@local.test, otra-medica@local.test";
  const rolDenegado = await gateMedico(sinRol);
  record("rol-clinico-exigido-con-lista-frontend-sin-rol", rolDenegado === "sin_rol_clinico", rolDenegado);
  record("rol-clinico-lista-insensible-a-mayusculas", (await gateMedico(doctor)) === null);
  const aprobarSinRol = await call("aprobar-plan", { planId: p3.id, confirmaAlertas: true, origen: "medico" }, sinRol).then(() => null, (e: any) => e.errorCode);
  record("aprobacion-denegada-frontend-sin-rol-clinico", aprobarSinRol === "sin_rol_clinico", aprobarSinRol);
  const beforeRolLinea = await snapshot();
  const bloquearSinRol = await call("actualizar-linea", { lineaId: p3.lineas[0].id, estado: "bloqueada", origen: "medico" }, sinRol).then(() => null, (e: any) => e.errorCode);
  record("decision-medica-en-linea-denegada-sin-rol-clinico", bloquearSinRol === "sin_rol_clinico" && beforeRolLinea === await snapshot(), bloquearSinRol);
  const agenteSigue = await call("obtener-plan", { planId: p3.id }, { ...ctx, caller: "tool" });
  record("agente-sigue-leyendo-con-lista-de-medicos", agenteSigue.plan.id === p3.id);
  delete process.env.MEGI_MEDICOS;
  process.env.MEGI_MODE = "http";
  const entornoHttp = { MEGI_USER: process.env.MEGI_USER, MEGI_PASSWORD: process.env.MEGI_PASSWORD, MEGI_URL: process.env.MEGI_URL };
  process.env.MEGI_USER = "servicio-ficticio"; process.env.MEGI_PASSWORD = "solo-prueba"; process.env.MEGI_URL = "http://fixture.invalid";
  const httpSinLista = await megi("medico-a@ficticio.test").then(() => null, (e: any) => ({ status: e.status, codigo: e.detalle?.codigo }));
  record("http-sin-lista-de-medicos-falla-cerrado", httpSinLista?.status === 403 && httpSinLista?.codigo === "sin_rol_clinico", httpSinLista);
  process.env.MEGI_MEDICOS = "medico-a@ficticio.test";
  const httpAjeno = await megi("medico-b@ficticio.test").then(() => null, (e: any) => ({ status: e.status, codigo: e.detalle?.codigo }));
  record("http-cuenta-compartida-rechaza-correo-sin-rol", httpAjeno?.status === 403 && httpAjeno?.codigo === "sin_rol_clinico", httpAjeno);
  const httpSinCorreo = await megi(undefined).then(() => null, (e: any) => e.status);
  record("http-sin-correo-no-obtiene-la-cuenta-compartida", httpSinCorreo === 403, httpSinCorreo);
  delete process.env.MEGI_MEDICOS;
  // Conexión PROPIA (I2): credenciales por correo desde la superficie de secretos (aquí inyectadas).
  const credenciales: Record<string, any> = { "medico-a@ficticio.test": { user: "dra_a", password: "clave-a" } };
  let fallo = false;
  configurarCredencialesMegi(async (email: string) => fallo ? { credenciales: null, fallo: true } : { credenciales: credenciales[email] ?? null });
  const propiaA = await megi("Medico-A@ficticio.test");
  const propiaA2 = await megi("medico-a@ficticio.test");
  record("http-conexion-propia-crea-instancia-por-medico", propiaA === propiaA2 && (propiaA as any).user === "dra_a");
  const propiaB = await megi("medico-b@ficticio.test").then(() => null, (e: any) => ({ status: e.status, codigo: e.detalle?.codigo }));
  record("http-sin-conexion-propia-ni-lista-denegado", propiaB?.status === 403 && propiaB?.codigo === "sin_rol_clinico", propiaB);
  credenciales["medico-b@ficticio.test"] = { user: "dr_b", password: "clave-b" };
  const propiaB2 = await megi("medico-b@ficticio.test");
  record("http-dos-medicos-dos-conexiones-distintas", propiaB2 !== propiaA && (propiaB2 as any).user === "dr_b");
  record("http-identidad-propia-habilita-decision-medica", (await gateMedico({ ...ctx, caller: "frontend", userEmail: "medico-a@ficticio.test" })) === null && (await identidadClinica("medico-a@ficticio.test")).modo === "propia");
  record("http-identidad-propia-no-basta-fuera-de-la-interfaz", (await gateMedico({ ...ctx, caller: "tool", userEmail: "medico-a@ficticio.test" })) === "solo_medico");
  credenciales["medico-a@ficticio.test"] = { user: "dra_a", password: "clave-rotada" };
  const rotada = await megi("medico-a@ficticio.test");
  record("http-rotacion-de-credenciales-renueva-la-conexion", rotada !== propiaA && (rotada as any).password === "clave-rotada");
  delete credenciales["medico-a@ficticio.test"];
  const revocada = await megi("medico-a@ficticio.test").then(() => null, (e: any) => ({ status: e.status, codigo: e.detalle?.codigo }));
  record("http-conexion-retirada-deniega-y-olvida-la-sesion", revocada?.status === 403 && revocada?.codigo === "sin_rol_clinico" && (await gateMedico({ ...ctx, caller: "frontend", userEmail: "medico-a@ficticio.test" })) === "sin_rol_clinico", revocada);
  fallo = true;
  const noDisponible = await megi("medico-b@ficticio.test").then(() => null, (e: any) => ({ status: e.status, codigo: e.detalle?.codigo }));
  record("http-almacen-de-credenciales-caido-es-503-no-rechazo", noDisponible?.status === 503 && noDisponible?.codigo === "credenciales_no_disponibles" && (await gateMedico({ ...ctx, caller: "frontend", userEmail: "medico-b@ficticio.test" })) === "credenciales_no_disponibles", noDisponible);
  fallo = false;
  // Contrato que recibe la UI: las acciones traducen el acceso denegado del adaptador (no un 500).
  const listarDenegado = await actions["listar-consultas"].run({ estado: "pendientes", limite: 20, desde: 0 }, { ...ctx, caller: "frontend", userEmail: "sin-conexion@ficticio.test" }).then(() => null, (e: any) => ({ code: e.errorCode, status: e.statusCode }));
  record("accion-listar-sin-identidad-clinica-es-403-sin-rol-clinico", listarDenegado?.code === "sin_rol_clinico" && listarDenegado?.status === 403, listarDenegado);
  fallo = true;
  const listarCaido = await actions["listar-consultas"].run({ estado: "pendientes", limite: 20, desde: 0 }, { ...ctx, caller: "frontend", userEmail: "medico-b@ficticio.test" }).then(() => null, (e: any) => ({ code: e.errorCode, status: e.statusCode }));
  record("accion-listar-con-almacen-caido-es-503-reintentable", listarCaido?.code === "credenciales_no_disponibles" && listarCaido?.status === 503, listarCaido);
  fallo = false;
  process.env.MEGI_MEDICOS = "medico-c@ficticio.test";
  const compartidaC = await megi("medico-c@ficticio.test");
  record("http-sin-conexion-propia-usa-cuenta-de-servicio-si-esta-autorizado", (compartidaC as any).user === "servicio-ficticio" && (await identidadClinica("medico-c@ficticio.test")).modo === "compartida");
  record("http-conexion-propia-prevalece-sobre-la-compartida", (await megi("medico-b@ficticio.test")) === propiaB2);
  configurarCredencialesMegi(null); olvidarSesionHttp("medico-b@ficticio.test");
  delete process.env.MEGI_MEDICOS;
  for (const [k, v] of Object.entries(entornoHttp)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  process.env.MEGI_MODE = "mock";
  record("mock-sandbox-por-correo-intacto-tras-pruebas-http", (await megi("auditoria@local.test")) === adapter);

  // ---- H3: lecturas en lotes acotados y sin repetir dentro de la acción -----
  const { enPeticionMegi } = await load("server/lib/megi/peticion.ts");
  let enVuelo = 0, maxEnVuelo = 0, peticiones = 0;
  const pacientesGrandes = Array.from({ length: 12 }, (_, i) => `P-GRANDE${i + 1}`);
  const expediente = new HttpFixture({ url: "http://fixture.invalid", user: "fixture", password: "fixture", fetchImpl: async (url: any) => {
    const path = new URL(url).pathname;
    peticiones++; enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
    await new Promise((r) => setTimeout(r, 3));
    enVuelo--;
    let result: any = {};
    const m = /\/patients\/(P-GRANDE\d+)(\/consultations)?$/.exec(path);
    const c = /\/consultations\/(C-(P-GRANDE\d+)-(\d+))$/.exec(path);
    if (path.endsWith("/auth/login")) result = { token: "fixture-token", name: "Médico ficticio" };
    else if (path.endsWith("/patients")) result = pacientesGrandes.map((id) => ({ id, name: id, allergies: [], chronic: [] }));
    else if (m && m[2]) result = [1, 2, 3].map((n) => ({ id: `C-${m[1]}-${n}`, status: n === 3 ? "finalized" : "approved", finalized: true, started_at: `2026-10-0${n}` }));
    else if (m) result = { id: m[1], name: m[1], allergies: [], chronic: [] };
    else if (c) result = { id: c[1], patient_id: c[2], status: c[3] === "3" ? "finalized" : "approved", finalized: true, started_at: `2026-10-0${c[3]}`, approved_at: `2026-10-0${c[3]}`, prescription: JSON.stringify([{ drug: `Fármaco${c[3]} 10 mg`, dose: "10 mg", freq: "cada 24 h", duration: "" }]) };
    else if (/\/review\/(pending|medication-history)$/.test(path)) return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
    else throw new Error(`Ruta fixture inesperada: ${path}`);
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const pendientesGrandes = await enPeticionMegi(async () => {
    const lista = await expediente.listarConsultasCerradas();
    const antes = peticiones;
    await expediente.verConsulta(lista[0].id);
    return { lista, repetidas: peticiones - antes };
  });
  record("http-expediente-grande-lecturas-en-paralelo-acotadas", maxEnVuelo > 1 && maxEnVuelo <= 4, { maxEnVuelo, peticiones });
  record("http-expediente-grande-resultado-completo", pendientesGrandes.lista.length === 12 && pendientesGrandes.lista.every((c: any) => c.estado === "pendiente" && c.paciente.historialMedicacion.length === 2), pendientesGrandes.lista.length);
  record("http-consulta-ya-leida-no-se-repite-en-la-accion", pendientesGrandes.repetidas === 0, pendientesGrandes.repetidas);
  record("http-login-unico-con-lecturas-paralelas", peticiones === 1 + 1 + 1 + 12 + 12 * 3, { peticiones, esperadas: "login + sonda /review/pending + /patients + 12 listas + 36 consultas" });

  // ---- I3: pendientes paginadas e historial por lotes (backend con /review/*) ----
  {
    const pacientesPag = Array.from({ length: 12 }, (_, i) => `P-PAG${i + 1}`);
    const consultaDe = (pid: string, n: number) => ({ id: `C-${pid}-${n}`, patient_id: pid, status: n === 3 ? "in_review" : "approved", started_at: `2026-10-0${n}T09:00:00Z`, finalized_at: `2026-10-0${n}T10:00:00Z`, approved_at: n === 3 ? null : `2026-10-0${n}T11:00:00Z`, final_soap: JSON.stringify({ S: "s", O: "o", A: "a", P: "p" }), prescription: n === 3 ? null : JSON.stringify([{ drug: `Fármaco${n} 10 mg`, dose: "10 mg", freq: "cada 24 h", duration: "" }]) });
    let totalPendientes = 12; let fallarPagina = -1; let cambiarTotalEn = -1;
    const vistas: string[] = []; let enVueloPag = 0, maxEnVueloPag = 0;
    const paginado = new HttpFixture({ url: "http://fixture.invalid", user: "fixture", password: "fixture", fetchImpl: async (url: any, init: any) => {
      const u = new URL(url); const path = u.pathname; vistas.push(`${init?.method ?? "GET"} ${path}${u.search}`);
      enVueloPag++; maxEnVueloPag = Math.max(maxEnVueloPag, enVueloPag); await new Promise((r) => setTimeout(r, 2)); enVueloPag--;
      const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (path.endsWith("/auth/login")) return json({ token: "t", name: "Médico ficticio" });
      if (path.endsWith("/review/pending")) {
        // El servidor acota la página (como _PAGE_MAX en MEGI): aquí a 5 para forzar varias páginas.
        const limit = Math.min(5, Number(u.searchParams.get("limit"))), offset = Number(u.searchParams.get("offset"));
        const pagina = Math.floor(offset / limit);
        if (pagina === fallarPagina) return json({ detail: "Fallo inyectado" }, 503);
        const total = pagina >= cambiarTotalEn && cambiarTotalEn >= 0 ? totalPendientes + 1 : totalPendientes;
        const items = pacientesPag.slice(offset, offset + limit).map((pid) => ({ consultation: consultaDe(pid, 3), patient: { id: pid, name: pid, age: 40, sex: "F", allergies: [], chronic: [] } }));
        const next = offset + items.length;
        return json({ items, total, limit, offset, next_offset: next < total ? next : null });
      }
      if (path.endsWith("/review/medication-history")) {
        const body = JSON.parse(init.body);
        if (body.patient_ids.some((id: string) => !pacientesPag.includes(id))) return json({ detail: "paciente no encontrado" }, 404);
        const filas = body.patient_ids.flatMap((pid: string) => [consultaDe(pid, 2), consultaDe(pid, 1)]).map((c: any) => ({ id: c.id, patient_id: c.patient_id, status: c.status, started_at: c.started_at, approved_at: c.approved_at, prescription: c.prescription }));
        const items = filas.slice(body.offset, body.offset + body.limit); const next = body.offset + items.length;
        return json({ items, total: filas.length, limit: body.limit, offset: body.offset, next_offset: next < filas.length ? next : null });
      }
      if (/\/patients\/P-PAG\d+$/.test(path)) return json({ id: path.split("/").pop(), name: "X", age: 40, sex: "F", allergies: [], chronic: [] });
      if (/\/patients\/P-AJENO$/.test(path)) return json({ detail: "paciente no encontrado" }, 404);
      throw new Error(`Ruta fixture inesperada: ${path}`);
    } });
    const pagina1 = await paginado.listarPendientes({ limite: 5, desde: 0 });
    const pagina2 = await paginado.listarPendientes({ limite: 5, desde: pagina1.siguiente! });
    const pagina3 = await paginado.listarPendientes({ limite: 5, desde: pagina2.siguiente! });
    const ids = [...pagina1.consultas, ...pagina2.consultas, ...pagina3.consultas].map((c) => c.id);
    record("http-pendientes-paginadas-sin-duplicados-ni-huecos", pagina1.total === 12 && pagina3.siguiente === null && new Set(ids).size === 12 && ids.length === 12, { total: pagina1.total, ids: ids.length });
    record("http-pagina-trae-historial-de-sus-pacientes", pagina1.consultas.every((c) => c.paciente.historialMedicacion?.length === 2 && c.paciente.medicacionActiva.length === 2), pagina1.consultas[0]?.paciente.historialMedicacion?.length);
    record("http-listar-una-pagina-no-descarga-todos-los-pacientes", !vistas.some((v) => /GET \/api\/patients$/.test(v)) && !vistas.some((v) => /\/consultations\/C-/.test(v)), vistas.length);
    const porPagina = vistas.filter((v) => !v.includes("/auth/login")).length / 3;
    record("http-coste-por-pagina-acotado-a-dos-peticiones", porPagina === 2, { peticiones: vistas.length, porPagina, detalle: "1 GET /review/pending + 1 POST /review/medication-history por página de ≤100 pacientes" });
    vistas.length = 0;
    const todas = await paginado.listarConsultasCerradas();
    record("http-listar-todo-recorre-las-paginas-del-servidor", todas.length === 12 && new Set(todas.map((c) => c.id)).size === 12 && vistas.filter((v) => v.includes("/review/pending")).length === 3, { peticiones: vistas.length, paginas: vistas.filter((v) => v.includes("/review/pending")).length });
    const ajeno = new HttpFixture({ url: "http://fixture.invalid", user: "fixture", password: "fixture", fetchImpl: (paginado as any).fetchImpl });
    const historialAjeno = await (ajeno as any).verPaciente("P-AJENO").then(() => null, (e: any) => e.status);
    record("http-paciente-ajeno-en-historial-es-404-no-respaldo", historialAjeno === 404 && !vistas.some((v) => /GET \/api\/patients\/P-AJENO\/consultations/.test(v)), historialAjeno);
    fallarPagina = 1;
    const truncada = await paginado.listarConsultasCerradas().then(() => null, (e: any) => e.status);
    record("http-pagina-fallida-aborta-sin-resultado-parcial", truncada === 503, truncada);
    fallarPagina = -1; cambiarTotalEn = 1;
    const inconsistente = await paginado.listarConsultasCerradas().then(() => null, (e: any) => e.detalle?.codigo);
    record("http-total-cambiado-entre-paginas-se-rechaza", inconsistente === "pagina_inconsistente", inconsistente);
    cambiarTotalEn = -1;
    record("http-lecturas-paginadas-respetan-concurrencia", maxEnVueloPag <= 4, maxEnVueloPag);
  }

  if (process.argv.includes("--http")) {
    // Lecturas y verificaciones del backend ficticio; nunca aprueba ni exporta.
    const { MegiHttp } = await load("server/lib/megi/megi-http.ts");
    const http = new MegiHttp({ url: process.env.MEGI_URL ?? "http://127.0.0.1:8020", user: "demo_medico", password: "demo-megi-2026" });
    const health = await http.estado();
    record("http-backend-disponible", health.disponible, health);
    for (const [patient, drug, expected] of [
      ["demo-p1", "Amoxicilina", "bloqueado"],
      ["demo-p2", "Naproxeno", "advertencia"],
      ["demo-p3", "Ibuprofeno", "bloqueado"],
      ["demo-p4", "Paracetamol", "ok"],
    ]) {
      const v = await http.verificarReceta(patient, [{ nombre: drug, dosis: "500 mg", frecuencia: "cada 8 h" }]);
      record(`http-${patient}`, v[drug].resultado === expected, v[drug].resultado);
    }
    // I3 con backend vivo: pendientes paginadas y total coherente con el recorrido anterior.
    const pag = await http.listarPendientes({ limite: 2, desde: 0 });
    const resto = pag.siguiente === null ? { consultas: [], siguiente: null, total: pag.total } : await http.listarPendientes({ limite: 200, desde: pag.siguiente });
    const recorrido = await http.listarRecorriendoPacientes();
    const idsPag = [...pag.consultas, ...resto.consultas].map((c) => c.id).sort();
    record("http-vivo-pendientes-paginadas-coinciden-con-el-recorrido", pag.consultas.length === 2 && JSON.stringify(idsPag) === JSON.stringify(recorrido.map((c) => c.id).sort()) && pag.total === recorrido.length, { pagina: pag.consultas.length, total: pag.total, recorrido: recorrido.length });
    const historialVivo = (await http.verPaciente("demo-p2")).historialMedicacion ?? [];
    record("http-vivo-historial-por-lotes-conserva-fuente-y-fecha", historialVivo.length > 0 && historialVivo.every((m) => m.fuente.startsWith("C-DEMO") && m.fecha), historialVivo.map((m) => `${m.nombre}@${m.fuente}`));
    // I2 con backend vivo: dos cuentas de MEGI, expedientes separados, firma propia.
    const base = process.env.MEGI_URL ?? "http://127.0.0.1:8020";
    const httpB = new MegiHttp({ url: base, user: "demo_medica_b", password: "demo-megi-b-2026" });
    const pendientesB = await httpB.listarConsultasCerradas();
    record("http-vivo-medica-b-solo-ve-sus-pendientes", pendientesB.length === 1 && pendientesB[0].id === "C-DEMOB1" && pendientesB[0].paciente.nombre === "Bruno Paciente Ficticio", pendientesB.map((c) => c.id));
    record("http-vivo-medico-a-no-ve-pacientes-de-b", !recorrido.some((c) => c.id === "C-DEMOB1") && (await http.verPaciente("P-DEMOB1").then(() => null, (e: any) => e.status)) === 404 && (await http.verConsulta("C-DEMOB1").then(() => null, (e: any) => e.status)) === 404);
    record("http-vivo-medica-b-no-ve-pacientes-de-a", (await httpB.verPaciente("demo-p1").then(() => null, (e: any) => e.status)) === 404 && (await httpB.verificarReceta("demo-p1", [{ nombre: "Paracetamol", dosis: "500 mg", frecuencia: "cada 8 h" }]).then(() => null, (e: any) => e.status)) === 404);
    const vB = await httpB.verificarReceta("C-DEMOB1" && "P-DEMOB1", [{ nombre: "Amoxicilina", dosis: "500 mg", frecuencia: "cada 8 h" }]);
    record("http-vivo-medica-b-verifica-su-paciente", vB.Amoxicilina.resultado === "bloqueado", vB.Amoxicilina.resultado);
    // Aprueba la consulta de B con la identidad de B (solo en el backend de evidencia, que se vuelve a sembrar al arrancar).
    const exportadaB = await httpB.exportar("C-DEMOB1", { farmacos: [{ nombre: "Azitromicina", dosis: "500 mg", frecuencia: "cada 24 h", duracion: "3 días" }], pendientes: ["Control en 72 h"], diagnosticos: [{ cie10: "J18.9", texto: "Neumonía" }], confirmaAlertas: false, notas: "Auditoría I2 · Aprobado en MEGI Revisión por medica-b@ficticio.test" });
    record("http-vivo-aprobacion-firmada-por-la-identidad-propia", exportadaB.aprobadaPor === "Dra. Segunda Ficticia" && exportadaB.sello?.startsWith("sha256:") === true, exportadaB.aprobadaPor);
    const tokenB = (await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "demo_medica_b", password: "demo-megi-b-2026" }) })).json() as any).token;
    const consultaB = await (await fetch(`${base}/api/consultations/C-DEMOB1`, { headers: { Authorization: `Bearer ${tokenB}` } })).json() as any;
    const eventosB = await (await fetch(`${base}/api/consultations/C-DEMOB1/audit`, { headers: { Authorization: `Bearer ${tokenB}` } })).json() as any;
    const aprobacion = JSON.stringify(eventosB);
    record("http-vivo-megi-registra-approved-by-de-b-y-la-nota-con-el-correo", consultaB.approved_by === "Dra. Segunda Ficticia" && /medica-b@ficticio\.test/.test(aprobacion) && /Dra\. Segunda Ficticia/.test(aprobacion), consultaB.approved_by);
    const tokenA = (await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "demo_medico", password: "demo-megi-2026" }) })).json() as any).token;
    const auditoriaAjena = await fetch(`${base}/api/consultations/C-DEMOB1/audit`, { headers: { Authorization: `Bearer ${tokenA}` } });
    record("http-vivo-medico-a-no-lee-la-auditoria-de-b", auditoriaAjena.status === 404, auditoriaAjena.status);
    record("http-vivo-pendientes-de-b-tras-aprobar", (await httpB.listarConsultasCerradas()).length === 0);
  }
} catch(e:any) {
  record("excepcion-inesperada",false,{name:e.name,message:e.message,stack:e.stack?.split("\n").slice(0,5)});
} finally {
  writeFileSync(new URL("auditoria-hackathon-resultados.json", import.meta.url), JSON.stringify({
    executedAt: new Date().toISOString(), appCommit: execFileSync("git", ["-C", fileURLToPath(app), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), uncommittedChanges: execFileSync("git",["-C",fileURLToPath(app),"status","--porcelain"],{encoding:"utf8"}).trim().length > 0, isolatedWrites: true,
    environment: "Acciones reales, caller=tool, PGlite en memoria, MEGI mock; sin LLM. Con --http agrega lecturas y verificaciones contra el backend de demo local",
    results,
  }, null, 2) + "\n");
  await closePgliteClients();
  process.exitCode = results.some((r) => !r.passed) ? 1 : 0;
}
