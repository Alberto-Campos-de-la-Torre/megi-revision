import { createHash } from "node:crypto";
import { fail, type ActionRunContext } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../db/index.js";
import type { PlanRow } from "../db/schema.js";
import type { Consulta, Medicamento, Paciente } from "./megi/types.js";
import { enCacheSincronaDePeticion } from "./megi/peticion.js";

export type RevisionDb = ReturnType<typeof getDb>;
export const fuenteSchema = z.object({
  tipo: z.enum(["nota", "medicacion", "sin_respaldo"]),
  referencia: z.string(), fecha: z.string(), fragmento: z.string(),
});
export type Fuente = z.infer<typeof fuenteSchema>;
export const conciliadoSchema = z.object({
  id: z.string(), nombre: z.string().trim().min(1).max(160), dosis: z.string().max(160),
  frecuencia: z.string().max(160), duracion: z.string().optional(),
  fuente: z.string(), fecha: z.string(),
  estado: z.enum(["activo", "suspendido", "finalizado", "sin_confirmar"]),
});
export type Conciliado = z.infer<typeof conciliadoSchema>;
export type ContextoFuente = {
  consulta: Pick<Consulta, "id" | "fecha" | "soap" | "medicamentosPropuestos" | "pendientes">;
  paciente: { historialMedicacion: Conciliado[] };
};
export function contextoMinimo(consulta: Consulta, paciente: Paciente): ContextoFuente {
  return { consulta: { id: consulta.id, fecha: consulta.fecha, soap: consulta.soap, medicamentosPropuestos: consulta.medicamentosPropuestos, pendientes: consulta.pendientes }, paciente: { historialMedicacion: candidatosDe(paciente) } };
}
export function leerJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
export function contextoFuenteDe(plan: Pick<PlanRow, "contextoFuente">): ContextoFuente | null {
  const fuente = plan.contextoFuente;
  return fuente ? enCacheSincronaDePeticion(`fuente:${fuente}`, () => leerJson<ContextoFuente | null>(fuente, null)) : null;
}
const normal = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function evidenciaDe(l: { tipo: string; texto: string }, contexto: ContextoFuente | null): Fuente[] {
  const c = contexto;
  if (!c) return [{ tipo: "sin_respaldo", referencia: "", fecha: "", fragmento: "Sin fuente conservada: requiere confirmación del médico." }];
  const term = normal(l.texto);
  const nota = [...Object.values(c.consulta.soap), ...c.consulta.medicamentosPropuestos, ...c.consulta.pendientes]
    .find(s => term.length >= 3 && (` ${normal(s)} `).includes(` ${term} `));
  const result: Fuente[] = [];
  if (nota) result.push({ tipo: "nota", referencia: c.consulta.id, fecha: c.consulta.fecha, fragmento: nota });
  for (const m of c.paciente.historialMedicacion ?? []) {
    if (normal(m.nombre) === term) result.push({ tipo: "medicacion", referencia: m.fuente, fecha: m.fecha, fragmento: `${m.nombre} ${m.dosis} ${m.frecuencia}. Estado histórico: ${m.estado}.` });
  }
  if (!result.length) result.push({ tipo: "sin_respaldo", referencia: c.consulta.id, fecha: c.consulta.fecha, fragmento: "No se encontró una mención literal en las fuentes conservadas. Propuesta o modificación que requiere confirmación." });
  return result;
}
export function candidatosDe(paciente: Paciente): Conciliado[] {
  if (paciente.historialMedicacion) return paciente.historialMedicacion;
  return paciente.medicacionActiva.map((m, i) => ({ ...m, id: `registro-${i}`, fuente: "Última receta del expediente", fecha: m.desde ?? "", estado: "sin_confirmar" as const }));
}
export function conciliacionDe(plan: PlanRow): Conciliado[] {
  const guardada = leerJson<Conciliado[] | null>(plan.conciliacion, null);
  if (guardada !== null) return guardada;
  return contextoFuenteDe(plan)?.paciente.historialMedicacion ?? [];
}
const pauta = (m: Medicamento) => [m.nombre, m.dosis, m.frecuencia, m.duracion ?? ""].map(normal).join("|");
/** Conserva decisiones solo para la misma pauta y procedencia; lo nuevo requiere confirmar. */
export function fusionarConciliacion(plan: PlanRow, vivo: Paciente): Conciliado[] {
  const guardadas = conciliacionDe(plan);
  const usadas = new Set<string>();
  const nuevas = candidatosDe(vivo).map(m => {
    const previa = guardadas.find(g => (g.id === m.id || g.fuente === m.fuente) && pauta(g) === pauta(m));
    if (previa) { usadas.add(previa.id); return { ...m, id: previa.id, estado: previa.estado }; }
    const id = guardadas.some(g => g.id === m.id) ? `${m.id}~${createHash("sha256").update(pauta(m)).digest("hex").slice(0, 10)}` : m.id;
    return { ...m, id, estado: m.estado === "finalizado" ? "finalizado" as const : "sin_confirmar" as const };
  });
  return [...nuevas, ...guardadas.filter(g => !usadas.has(g.id) && !nuevas.some(m => m.id === g.id))];
}
export function medicacionParaVerificar(plan: PlanRow, vivo?: Paciente): Medicamento[] | undefined {
  if (!vivo && !plan.contextoFuente && !plan.conciliacion) return undefined;
  return (vivo ? fusionarConciliacion(plan, vivo) : conciliacionDe(plan)).filter(m => m.estado === "activo" || m.estado === "sin_confirmar");
}
export function comprobarVersion(plan: PlanRow, esperada?: number, actor?: string) {
  // El mensaje lleva la versión vigente a propósito: medido con un modelo real,
  // el agente que recibía solo «relee el plan» volvía a llamar sin el campo y se
  // quedaba en bucle. Con el número en la propia respuesta, la corrección no
  // necesita otra lectura. No revela nada: el dueño del plan ya puede leerla.
  if (actor === "agente" && esperada === undefined) fail(`Falta versionEsperada: es obligatoria en toda edición del agente. La versión vigente de este plan es ${plan.version}; vuelve a llamar con versionEsperada=${plan.version}.`, { errorCode: "version_desactualizada", statusCode: 409 });
  if (esperada !== undefined && esperada !== plan.version) fail(`El plan cambió: mandaste versionEsperada=${esperada} y la vigente es ${plan.version}. Relee el plan antes de continuar.`, { errorCode: "version_desactualizada", statusCode: 409 });
}
export function comprobarAlcance(plan: PlanRow, actor: string, ids: string[], agrega = false) {
  if (actor === "medico" || !plan.alcanceAgente) return;
  const permitidas = leerJson<string[]>(plan.alcanceAgente, []);
  if (agrega || ids.some(id => !permitidas.includes(id))) fail("La decisión del médico limita la edición a las líneas seleccionadas. No se aplicó ningún cambio.", { errorCode: "fuera_de_alcance", statusCode: 403 });
}
export async function guardarVersion(planId: string, actor: "agente" | "medico", accion: string, motivo: string, inicio: number, db: RevisionDb, ctx?: ActionRunContext) {
  const [p] = await db.select().from(schema.planes).where(eq(schema.planes.id, planId));
  if (!p) throw new Error("Plan inexistente al versionar");
  const lineas = await db.select().from(schema.lineasPlan).where(eq(schema.lineasPlan.planId, planId)).orderBy(schema.lineasPlan.orden, schema.lineasPlan.id);
  const version = p.version + 1;
  const createdAt = new Date().toISOString();
  const contexto = contextoFuenteDe(p);
  const snapshot = { estado: p.estado, explicacion: p.explicacion, alcanceSugerencias: leerJson<string[]>(p.alcanceSugerencias, []), sugerencias: leerJson<unknown[]>(p.sugerencias, []), alcance: leerJson<string[] | null>(p.alcanceAgente, null), conciliacion: conciliacionDe(p), lineas: lineas.map(l => ({ ...l, fuentes: p.estado === "exportado" && !contexto ? [] : evidenciaDe(l, contexto) })) };
  const agenteRunId = actor === "agente" && ctx?.caller !== "frontend" ? ctx?.runId ?? null : null;
  await db.insert(schema.versionesPlan).values({ id: crypto.randomUUID(), planId, version, actor, accion, motivo, snapshot: JSON.stringify(snapshot), operacionMs: Math.max(0, Math.round(performance.now() - inicio)), agenteRunId, ownerEmail: p.ownerEmail, orgId: p.orgId, createdAt });
  await db.update(schema.planes).set({ version, updatedAt: createdAt }).where(eq(schema.planes.id, planId));
  return version;
}
export async function versionesDe(planId: string, antes: number | undefined, db: RevisionDb = getDb()) {
  const { and, lt } = await import("drizzle-orm");
  return db.select().from(schema.versionesPlan).where(and(eq(schema.versionesPlan.planId, planId), antes === undefined ? undefined : lt(schema.versionesPlan.version, antes))).orderBy(desc(schema.versionesPlan.version)).limit(21);
}
