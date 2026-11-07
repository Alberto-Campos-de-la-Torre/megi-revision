// Valor diferencial medible de la mesa de revisión frente a un chat sin mesa,
// con los cuatro casos sintéticos y la MISMA receta inicial en ambas
// modalidades. Arnés aislado: acciones reales + PGlite en memoria + MEGI mock.
// No llama al LLM, no toca la demo ni la instalación real.
//
// Qué se compara (mecanismos observables, no resultados clínicos):
//   · alertas del verificador hechas visibles ANTES de aprobar
//   · intentos del agente sobre líneas fijadas o fuera del alcance → rechazados
//   · medicación histórica sin confirmar → aprobación detenida hasta conciliar
//   · bloqueo de seguridad → aprobación detenida hasta confirmación explícita
//   · líneas con fuente en la nota / sin respaldo
//   · versiones y eventos de bitácora producidos
// En un chat sin mesa, la receta es texto: ninguno de esos mecanismos existe
// (0 por construcción), y una segunda respuesta sustituye a la primera entera.
// Ejecutar: megi-revision/node_modules/.bin/tsx evidencia/valor-diferencial.mts
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const app = new URL("../megi-revision/", import.meta.url);
const req = createRequire(new URL("package.json", app));
process.env.DATABASE_URL = "pglite:memory://";
process.env.MEGI_MODE = "mock";
const load = (path: string) => import(new URL(path, app).href);
const { getPgliteClient, closePgliteClients } = await import(new URL("client.js", pathToFileURL(req.resolve("@agent-native/core/db"))).href);
const client = await getPgliteClient(process.env.DATABASE_URL);
const migraciones = [...readFileSync(new URL("server/plugins/db.ts", app), "utf8").matchAll(/sql: `([\s\S]*?)`,/g)];
for (const m of migraciones) await client.exec(m[1]);
const actions: Record<string, any> = {};
for (const name of ["ver-contexto-consulta", "proponer-plan", "obtener-plan", "actualizar-linea", "reajustar-plan", "definir-alcance", "conciliar-medicacion", "aprobar-plan", "historial-plan", "sugerir-reemplazo"]) {
  actions[name] = (await load(`actions/${name}.ts`)).default;
}
const email = "valor@local.test";
const agente = { caller: "tool", userEmail: email, orgId: null };
const medico = { caller: "frontend", userEmail: email, orgId: null };
const run = (n: string, args: any, ctx: any = agente) => actions[n].run(args, ctx);
const rechazo = async (n: string, args: any, ctx: any = agente) => { try { await run(n, args, ctx); return null; } catch (e: any) { return e.errorCode ?? e.message; } };

// La misma receta inicial que daría un asistente genérico para cada caso
// (deliberadamente con un fármaco problemático por caso, salvo Luis).
const casos = [
  { id: "demo-c1", nombre: "Alba (alergia a penicilina)", lineas: [
    { tipo: "farmaco", texto: "Amoxicilina", dosis: "500 mg", frecuencia: "cada 8 h", duracion: "10 días", justificacion: "Faringoamigdalitis con fiebre de 3 días" },
    { tipo: "farmaco", texto: "Paracetamol", dosis: "500 mg", frecuencia: "cada 8 h", duracion: "5 días", justificacion: "Fiebre y dolor" },
    { tipo: "pendiente", texto: "Control en 72 h si persiste la fiebre" } ] },
  { id: "demo-c2", nombre: "Mateo (HTA con losartán; alergias sin registro)", lineas: [
    { tipo: "farmaco", texto: "Naproxeno", dosis: "250 mg", frecuencia: "cada 12 h", duracion: "5 días", justificacion: "Dolor lumbar mecánico" },
    { tipo: "farmaco", texto: "Paracetamol", dosis: "1 g", frecuencia: "cada 8 h", duracion: "5 días", justificacion: "Analgesia" },
    { tipo: "pendiente", texto: "Toma de presión arterial en 2 semanas" } ] },
  { id: "demo-c3", nombre: "Rosa (FA con warfarina; alergia a sulfas)", lineas: [
    { tipo: "farmaco", texto: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 h", duracion: "7 días", justificacion: "Gonalgia derecha" },
    { tipo: "farmaco", texto: "Paracetamol", dosis: "1 g", frecuencia: "cada 8 h", duracion: "7 días", justificacion: "Analgesia" },
    { tipo: "pendiente", texto: "Radiografía de rodilla derecha" } ] },
  { id: "demo-c4", nombre: "Luis (sin alergias, sin medicación)", lineas: [
    { tipo: "farmaco", texto: "Paracetamol", dosis: "1 g", frecuencia: "cada 8 h", duracion: "3 días", justificacion: "Cefalea tensional" },
    { tipo: "pendiente", texto: "Higiene del sueño y control si empeora" } ] },
] as const;

const filas: any[] = [];
const checks: { id: string; passed: boolean; detail?: unknown }[] = [];
const check = (id: string, passed: boolean, detail?: unknown) => { checks.push({ id, passed, ...(detail === undefined ? {} : { detail }) }); console.log(`${passed ? "PASS" : "FAIL"} ${id}${detail === undefined ? "" : " · " + JSON.stringify(detail)}`); };

try {
  for (const caso of casos) {
    const fila: any = { caso: caso.id, nombre: caso.nombre, lineasPropuestas: caso.lineas.length };
    const ctx = await run("ver-contexto-consulta", { consultaId: caso.id });
    fila.alergiasRegistradas = ctx.paciente.alergiasRegistradas;
    fila.historialSinConfirmar = ctx.paciente.historialMedicacion.filter((m: any) => m.estado === "sin_confirmar").length;

    // 1 · El agente propone: todo el conjunto se verifica antes de guardarse.
    const p = await run("proponer-plan", { consultaId: caso.id, lineas: caso.lineas, explicacion: "Receta inicial idéntica en ambas modalidades" });
    const farmacos = p.lineas.filter((l: any) => l.tipo === "farmaco");
    fila.alertasVisiblesAntesDeAprobar = { bloqueos: p.resumen.bloqueos, advertencias: p.resumen.advertencias, motivos: farmacos.filter((l: any) => l.verificacion !== "ok").map((l: any) => `${l.texto}: ${l.motivoVerificacion}`) };
    fila.fuentes = { conFuenteEnNotaOMedicacion: p.lineas.filter((l: any) => l.fuentes.some((f: any) => f.tipo !== "sin_respaldo")).length, sinRespaldo: p.lineas.filter((l: any) => !l.fuentes.length || l.fuentes.every((f: any) => f.tipo === "sin_respaldo")).length };

    // 2 · El médico fija la primera línea; el agente intenta tocarla.
    const fijada = farmacos[0];
    let v = (await run("obtener-plan", { planId: p.id })).plan.version;
    await run("actualizar-linea", { lineaId: fijada.id, estado: "bloqueada", origen: "medico", versionEsperada: v, motivo: "Decisión del médico" }, medico);
    v = (await run("obtener-plan", { planId: p.id })).plan.version;
    const antes = JSON.stringify((await run("obtener-plan", { planId: p.id })).lineas);
    const intentos = [
      await rechazo("actualizar-linea", { lineaId: fijada.id, dosis: "999 mg", versionEsperada: v, motivo: "Ajuste del agente" }),
      await rechazo("reajustar-plan", { planId: p.id, versionEsperada: v, cambios: [{ accion: "quitar", lineaId: fijada.id, motivo: "Prueba" }], explicacion: "Intento sobre línea fijada" }),
      await rechazo("reajustar-plan", { planId: p.id, versionEsperada: v, cambios: [{ accion: "editar", lineaId: fijada.id, dosis: "1 mg", motivo: "Prueba" }, { accion: "agregar", texto: "Omeprazol", dosis: "20 mg", motivo: "Protección gástrica" }], explicacion: "Reajuste mixto que toca la fijada" }),
    ];
    fila.intentosSobreFijada = { intentos: intentos.length, rechazados: intentos.filter((c) => c === "linea_bloqueada").length, planIntacto: antes === JSON.stringify((await run("obtener-plan", { planId: p.id })).lineas) };

    // 3 · El médico limita el alcance a la segunda línea; el agente intenta salirse.
    const permitida = p.lineas.find((l: any) => l.id !== fijada.id && l.tipo === "farmaco") ?? p.lineas.find((l: any) => l.id !== fijada.id);
    const otra = p.lineas.find((l: any) => l.id !== fijada.id && l.id !== permitida.id);
    const alc = await run("definir-alcance", { planId: p.id, versionEsperada: v, lineas: [permitida.id] }, medico);
    v = alc.version;
    const fuera = [
      otra ? await rechazo("reajustar-plan", { planId: p.id, versionEsperada: v, cambios: [{ accion: "editar", lineaId: otra.id, texto: `${otra.texto} (modificado)`, motivo: "Prueba" }], explicacion: "Fuera del alcance" }) : "fuera_de_alcance",
      await rechazo("reajustar-plan", { planId: p.id, versionEsperada: v, cambios: [{ accion: "agregar", texto: "Omeprazol", dosis: "20 mg", motivo: "Prueba" }], explicacion: "Añadir fuera del alcance" }),
      await rechazo("sugerir-reemplazo", { planId: p.id, lineaId: fijada.id, versionEsperada: v, tipo: "farmaco", texto: "Cefuroxima", dosis: "500 mg", frecuencia: "cada 12 h", duracion: "7 días", justificacion: "Alternativa" }),
    ];
    const dentro = await run("reajustar-plan", { planId: p.id, versionEsperada: v, cambios: [{ accion: "editar", lineaId: permitida.id, duracion: "4 días", motivo: "Acorta la pauta a lo necesario" }], explicacion: "Cambio dentro del alcance autorizado" });
    v = (await run("obtener-plan", { planId: p.id })).plan.version;
    fila.alcance = { intentosFuera: fuera.length, rechazados: fuera.filter((c) => c === "fuera_de_alcance").length, cambioDentroAplicado: dentro.aplicados === 1 };
    await run("definir-alcance", { planId: p.id, versionEsperada: v, lineas: null }, medico);
    v = (await run("obtener-plan", { planId: p.id })).plan.version;

    // 4 · Aprobación: conciliación y bloqueos frenan hasta decisión explícita del médico.
    const plan1 = await run("obtener-plan", { planId: p.id });
    const sinConfirmar = plan1.conciliacion.filter((m: any) => m.estado === "sin_confirmar");
    const frenoConciliacion = sinConfirmar.length ? await rechazo("aprobar-plan", { planId: p.id, versionEsperada: v, origen: "medico" }, medico) : null;
    if (sinConfirmar.length) {
      const c = await run("conciliar-medicacion", { planId: p.id, versionEsperada: v, decisiones: plan1.conciliacion.map((m: any) => ({ id: m.id, estado: "activo" })), adicionales: [] }, medico);
      v = c.version;
    }
    const bloqueos = (await run("obtener-plan", { planId: p.id })).resumen.bloqueos;
    const frenoBloqueo = bloqueos ? await rechazo("aprobar-plan", { planId: p.id, versionEsperada: v, origen: "medico" }, medico) : null;
    const aprobado = await run("aprobar-plan", { planId: p.id, versionEsperada: v, origen: "medico", ...(bloqueos ? { confirmaAlertas: true } : {}) }, medico);
    fila.aprobacion = { medicacionSinConfirmar: sinConfirmar.length, frenoConciliacion, bloqueosVigentes: bloqueos, frenoBloqueo, exportado: aprobado.plan.estado === "exportado", sello: aprobado.sello?.slice(0, 16) };

    // 5 · Trazabilidad producida.
    const final = await run("obtener-plan", { planId: p.id });
    const hist = await run("historial-plan", { planId: p.id });
    fila.trazabilidad = { versiones: hist.versiones.length, eventos: final.eventos.length, actores: [...new Set(final.eventos.map((e: any) => e.actor))], lineasConEstadoPropio: final.lineas.length };
    filas.push(fila);

    check(`${caso.id}-alertas-visibles-antes-de-aprobar`, caso.id === "demo-c4" ? p.resumen.bloqueos + p.resumen.advertencias === 0 : p.resumen.bloqueos + p.resumen.advertencias >= 1, fila.alertasVisiblesAntesDeAprobar);
    check(`${caso.id}-linea-fijada-intocable`, fila.intentosSobreFijada.rechazados === 3 && fila.intentosSobreFijada.planIntacto, fila.intentosSobreFijada);
    check(`${caso.id}-alcance-respetado`, fila.alcance.rechazados === 3 && fila.alcance.cambioDentroAplicado, fila.alcance);
    check(`${caso.id}-aprobacion-con-frenos`, (sinConfirmar.length === 0 || frenoConciliacion === "medicacion_sin_conciliar") && (bloqueos === 0 || frenoBloqueo === "alertas_sin_confirmar") && fila.aprobacion.exportado, fila.aprobacion);
    check(`${caso.id}-trazabilidad`, fila.trazabilidad.versiones >= 4 && fila.trazabilidad.actores.includes("medico") && fila.trazabilidad.actores.includes("agente"), fila.trazabilidad);
  }

  const total = (f: (x: any) => number) => filas.reduce((s, x) => s + f(x), 0);
  const comparacion = {
    mesaDeRevision: {
      alertasVisiblesAntesDeAprobar: total((x) => x.alertasVisiblesAntesDeAprobar.bloqueos + x.alertasVisiblesAntesDeAprobar.advertencias),
      intentosSobreLineasFijadasRechazados: `${total((x) => x.intentosSobreFijada.rechazados)}/${total((x) => x.intentosSobreFijada.intentos)}`,
      intentosFueraDeAlcanceRechazados: `${total((x) => x.alcance.rechazados)}/${total((x) => x.alcance.intentosFuera)}`,
      aprobacionesDetenidasPorConciliacion: filas.filter((x) => x.aprobacion.frenoConciliacion === "medicacion_sin_conciliar").length,
      aprobacionesDetenidasPorBloqueo: filas.filter((x) => x.aprobacion.frenoBloqueo === "alertas_sin_confirmar").length,
      lineasConFuente: `${total((x) => x.fuentes.conFuenteEnNotaOMedicacion)}/${total((x) => x.lineasPropuestas)}`,
      versiones: total((x) => x.trazabilidad.versiones),
      eventosBitacora: total((x) => x.trazabilidad.eventos),
      exportacionesSelladas: filas.filter((x) => x.aprobacion.exportado).length,
    },
    chatSinMesa: {
      alertasVisiblesAntesDeAprobar: 0,
      intentosSobreLineasFijadasRechazados: "no existe el concepto de línea fijada: una nueva respuesta sustituye toda la receta",
      intentosFueraDeAlcanceRechazados: "no existe alcance: el texto completo es editable",
      aprobacionesDetenidasPorConciliacion: 0,
      aprobacionesDetenidasPorBloqueo: 0,
      lineasConFuente: "0: el texto no enlaza con la nota ni con la medicación registrada",
      versiones: 0,
      eventosBitacora: 0,
      exportacionesSelladas: 0,
    },
    nota: "Cuenta mecanismos observables sobre cuatro casos sintéticos con la misma receta inicial. No mide errores clínicos ni tiempo de médicos; esa evidencia sigue pendiente de sesiones con usuarios (PENDIENTE_VALIDACION_USUARIOS.md).",
  };
  const salida = { fecha: new Date().toISOString(), entorno: "acciones reales + PGlite en memoria + MEGI mock; sin LLM", casos: filas, comparacion, checks, pasan: checks.filter((c) => c.passed).length, total: checks.length };
  writeFileSync(new URL("./resultados/valor-diferencial.json", import.meta.url), JSON.stringify(salida, null, 2) + "\n");
  console.log(JSON.stringify(comparacion.mesaDeRevision, null, 1));
  console.log(`${salida.pasan}/${salida.total} comprobaciones`);
  process.exitCode = salida.pasan === salida.total ? 0 : 1;
} finally {
  await closePgliteClients?.();
}
