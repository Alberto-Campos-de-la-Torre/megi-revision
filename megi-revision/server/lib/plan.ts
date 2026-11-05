/**
 * Reglas compartidas de la mesa de revisión. Las acciones las usan; la UI y el
 * agente pasan por las acciones, así que la regla vive en un solo sitio.
 */
import { fail, type ActionRunContext } from "@agent-native/core/action";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import type { LineaRow, PlanRow } from "../db/schema.js";
import { megi } from "./megi/index.js";
import type { Medicamento, Verificacion } from "./megi/types.js";

export const origenSchema = z
  .enum(["agente", "medico"])
  .default("agente")
  .describe(
    'Quién hace el cambio: "agente" (tú) o "medico" (solo la interfaz lo manda). Nunca te hagas pasar por el médico.',
  );

type PlanDb = ReturnType<typeof getDb>;

/** El caller lo establece el framework en el servidor, nunca el modelo. */
export function origenAutorizado(
  origen: "agente" | "medico",
  ctx?: ActionRunContext,
): "agente" | "medico" {
  ctx?.signal?.throwIfAborted();
  if (origen === "medico" && ctx?.caller !== "frontend") {
    fail(
      "Las decisiones del médico solo se realizan desde la interfaz autenticada.",
      { errorCode: "solo_medico", statusCode: 403 },
    );
  }
  return ctx?.caller === "frontend" ? "medico" : "agente";
}

export function exigirMedico(ctx?: ActionRunContext): void {
  if (ctx?.caller !== "frontend") {
    fail(
      "La aprobación final debe confirmarla el médico desde la interfaz autenticada.",
      { errorCode: "solo_medico", statusCode: 403 },
    );
  }
}

export const lineaInputSchema = z.object({
  tipo: z
    .enum(["farmaco", "pendiente"])
    .describe(
      '"farmaco" (receta) o "pendiente" (estudio, control, indicación)',
    ),
  texto: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Fármaco ("Amoxicilina") o texto del pendiente ("Radiografía de rodilla AP y lateral")',
    ),
  dosis: z.string().default("").describe('Solo fármacos: "500 mg"'),
  frecuencia: z.string().default("").describe('Solo fármacos: "cada 8 h"'),
  duracion: z
    .string()
    .default("")
    .describe('Solo fármacos: "7 días", "continuo"'),
  justificacion: z
    .string()
    .default("")
    .describe("Una frase: por qué va en el plan"),
});
export type LineaInput = z.infer<typeof lineaInputSchema>;

export const lineaOutputSchema = z.object({
  id: z.string(),
  planId: z.string(),
  tipo: z.enum(["farmaco", "pendiente"]),
  texto: z.string(),
  dosis: z.string(),
  frecuencia: z.string(),
  duracion: z.string(),
  estado: z.enum(["propuesta", "editada", "bloqueada", "rechazada"]),
  verificacion: z.enum(["pendiente", "ok", "advertencia", "bloqueado"]),
  motivoVerificacion: z.string().nullable(),
  alternativas: z.array(z.string()),
  origen: z.enum(["agente", "medico"]),
  justificacion: z.string().nullable(),
  orden: z.number(),
  updatedAt: z.string(),
});
export type LineaOut = z.infer<typeof lineaOutputSchema>;

export const planOutputSchema = z.object({
  id: z.string(),
  consultaId: z.string(),
  pacienteId: z.string(),
  pacienteNombre: z.string(),
  motivo: z.string(),
  estado: z.enum(["borrador", "exportado"]),
  explicacion: z.string().nullable(),
  sello: z.string().nullable(),
  aprobadoPor: z.string().nullable(),
  updatedAt: z.string(),
});

export const eventoOutputSchema = z.object({
  id: z.string(),
  lineaId: z.string().nullable(),
  actor: z.enum(["agente", "medico"]),
  accion: z.string(),
  detalle: z.string(),
  createdAt: z.string(),
});

export function lineaOut(r: LineaRow): LineaOut {
  let alternativas: string[] = [];
  try {
    const v = JSON.parse(r.alternativas || "[]");
    if (Array.isArray(v)) alternativas = v.filter((x) => typeof x === "string");
  } catch {
    alternativas = [];
  }
  return {
    id: r.id,
    planId: r.planId,
    tipo: r.tipo,
    texto: r.texto,
    dosis: r.dosis,
    frecuencia: r.frecuencia,
    duracion: r.duracion,
    estado: r.estado,
    verificacion: r.verificacion,
    motivoVerificacion: r.motivoVerificacion,
    alternativas,
    origen: r.origen,
    justificacion: r.justificacion,
    orden: r.orden,
    updatedAt: String(r.updatedAt),
  };
}

export function planOut(p: PlanRow) {
  return {
    id: p.id,
    consultaId: p.consultaId,
    pacienteId: p.pacienteId,
    pacienteNombre: p.pacienteNombre,
    motivo: p.motivo,
    estado: p.estado,
    explicacion: p.explicacion,
    sello: p.sello,
    aprobadoPor: p.aprobadoPor,
    updatedAt: String(p.updatedAt),
  };
}

export function requireEmail(
  ctx: { userEmail?: string | null } | undefined,
): string {
  return (
    ctx?.userEmail ??
    fail("Inicia sesión para revisar planes.", { statusCode: 401 })
  );
}

export function ahora(): string {
  return new Date().toISOString();
}

/** Plan del usuario por id; 404 si no existe o no es suyo. */
export async function planDe(
  planId: string,
  email: string,
  db: PlanDb = getDb(),
  bloquear = false,
): Promise<PlanRow> {
  const query = db
    .select()
    .from(schema.planes)
    .where(
      and(eq(schema.planes.id, planId), eq(schema.planes.ownerEmail, email)),
    )
    .limit(1);
  const [p] = await (bloquear ? query.for("update") : query);
  if (!p)
    fail("Plan no encontrado.", { errorCode: "not_found", statusCode: 404 });
  return p;
}

export function exigirAbierto(p: PlanRow): void {
  if (p.estado !== "borrador") {
    fail("El plan ya fue aprobado y exportado; no admite cambios.", {
      errorCode: "plan_cerrado",
      statusCode: 409,
    });
  }
}

/**
 * Tope de líneas por plan. Las LECTURAS no truncan en silencio (antes
 * devolvían 200 y una línea añadida por encima de ese número desaparecía del
 * tablero y de la receta exportada); son las ESCRITURAS las que se paran antes
 * de pasarse, con `exigirEspacio`.
 */
export const MAX_LINEAS = 400;

export async function lineasDe(
  planId: string,
  db: PlanDb = getDb(),
): Promise<LineaRow[]> {
  return db
    .select()
    .from(schema.lineasPlan)
    .where(eq(schema.lineasPlan.planId, planId))
    .orderBy(asc(schema.lineasPlan.orden), asc(schema.lineasPlan.createdAt))
    .limit(MAX_LINEAS);
}

/** Se niega a añadir líneas si el plan se pasaría del tope. */
export async function exigirEspacio(
  planId: string,
  nuevas: number,
  db: PlanDb = getDb(),
): Promise<void> {
  if (nuevas <= 0) return;
  const [fila] = await db
    .select({ n: count() })
    .from(schema.lineasPlan)
    .where(eq(schema.lineasPlan.planId, planId));
  const hay = Number(fila?.n ?? 0);
  if (hay + nuevas > MAX_LINEAS) {
    fail(
      `El plan ya tiene ${hay} líneas y el tope es ${MAX_LINEAS}. Rechaza o consolida líneas antes de añadir más.`,
      { errorCode: "plan_demasiado_largo", statusCode: 409 },
    );
  }
}

export async function registrarEvento(
  input: {
    planId: string;
    lineaId?: string | null;
    actor: "agente" | "medico";
    accion: string;
    detalle?: string;
    email: string;
    orgId: string | null;
  },
  db: PlanDb = getDb(),
): Promise<void> {
  await db.insert(schema.eventosRevision).values({
    id: crypto.randomUUID(),
    planId: input.planId,
    lineaId: input.lineaId ?? null,
    actor: input.actor,
    accion: input.accion,
    detalle: input.detalle ?? "",
    ownerEmail: input.email,
    orgId: input.orgId,
    createdAt: ahora(),
  });
}

/** Para comparar nombres de fármaco: sin acentos, sin mayúsculas, sin bordes. */
export function normalizaNombre(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function comoMedicamento(
  l: Pick<LineaRow, "texto" | "dosis" | "frecuencia" | "duracion">,
): Medicamento {
  return {
    nombre: l.texto,
    dosis: l.dosis,
    frecuencia: l.frecuencia,
    duracion: l.duracion || undefined,
  };
}

/**
 * Verifica contra MEGI TODOS los fármacos vigentes del plan (no rechazados) y
 * persiste el resultado en cada línea. Se verifica el conjunto, no una línea
 * suelta: una interacción es entre dos líneas.
 */
export async function verificarPlan(
  planId: string,
  pacienteId: string,
  db: PlanDb = getDb(),
): Promise<Record<string, Verificacion>> {
  const lineas = await lineasDe(planId, db);
  const vigentes = lineas.filter(
    (l) => l.tipo === "farmaco" && l.estado !== "rechazada",
  );
  if (!vigentes.length) return {};
  const adapter = await megi();
  let resultado: Record<string, Verificacion>;
  try {
    resultado = await adapter.verificarReceta(
      pacienteId,
      vigentes.map(comoMedicamento),
    );
  } catch {
    fail(
      "No se pudo verificar la receta con MEGI. No se guardó ningún cambio; vuelve a intentarlo cuando esté disponible.",
      {
        errorCode: "megi_no_disponible",
        statusCode: 502,
      },
    );
  }
  if (
    vigentes.some(
      (l) =>
        !["ok", "advertencia", "bloqueado"].includes(
          resultado?.[l.texto]?.resultado ?? "",
        ),
    )
  ) {
    fail("MEGI no verificó todos los fármacos. No se guardó ningún cambio.", {
      errorCode: "verificacion_incompleta",
      statusCode: 502,
    });
  }
  // El mismo fármaco dos veces en el plan no lo detecta MEGI: la verificación
  // va por nombre, así que dos líneas del mismo fármaco reciben el mismo
  // resultado y la dosis duplicada pasa sin aviso. Se marca aquí.
  const repetidos = new Map<string, number>();
  for (const l of vigentes) {
    const k = normalizaNombre(l.texto);
    repetidos.set(k, (repetidos.get(k) ?? 0) + 1);
  }
  for (const l of vigentes) {
    const v = resultado[l.texto];
    const duplicado = (repetidos.get(normalizaNombre(l.texto)) ?? 0) > 1;
    const base = v?.resultado ?? "pendiente";
    const motivo = [
      duplicado
        ? `${l.texto} aparece más de una vez en el plan: comprueba que la dosis no quede duplicada.`
        : "",
      v?.motivo ?? "",
    ]
      .filter(Boolean)
      .join(" · ");
    await db
      .update(schema.lineasPlan)
      .set({
        verificacion: duplicado && base === "ok" ? "advertencia" : base,
        motivoVerificacion: motivo || null,
        alternativas: JSON.stringify(v?.alternativas ?? []),
        updatedAt: ahora(),
      })
      .where(eq(schema.lineasPlan.id, l.id));
  }
  return resultado;
}

export function resumenVerificacion(lineas: LineaOut[]) {
  const vigentes = lineas.filter((l) => l.estado !== "rechazada");
  return {
    bloqueos: vigentes.filter((l) => l.verificacion === "bloqueado").length,
    advertencias: vigentes.filter((l) => l.verificacion === "advertencia")
      .length,
    bloqueadas: vigentes.filter((l) => l.estado === "bloqueada").length,
    vigentes: vigentes.length,
  };
}
