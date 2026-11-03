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
const migration = readFileSync(new URL("server/plugins/db.ts", app), "utf8").match(/sql: `([\s\S]*?)`,/);
if (!migration) throw new Error("No se encontró la migración de la app");
await client.exec(migration[1]);
const actions: Record<string, any> = {};
for (const name of ["proponer-plan", "obtener-plan", "actualizar-linea", "reajustar-plan", "aprobar-plan", "agregar-linea"]) {
  actions[name] = (await load(`actions/${name}.ts`)).default;
}
const { megi } = await load("server/lib/megi/index.ts");
const adapter = await megi();
const ctx = { caller: "tool", userEmail: "auditoria@local.test", orgId: null };
const call = (name: string, args: unknown, context = ctx) => actions[name].run(args, context);
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
  const approved = await call("aprobar-plan", {planId:p.id, confirmaAlertas:true, origen:"medico"}, doctor);
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
  if (process.argv.includes("--http")) {
    // Lecturas y verificaciones del backend ficticio; nunca aprueba ni exporta.
    const { MegiHttp } = await load("server/lib/megi/megi-http.ts");
    const http = new MegiHttp({ url: "http://127.0.0.1:8020", user: "demo_medico", password: "demo-megi-2026" });
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
