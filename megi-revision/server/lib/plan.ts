/**
 * Reglas compartidas de la mesa de revisión. Las acciones las usan; la UI y el
 * agente pasan por las acciones, así que la regla vive en un solo sitio.
 */
import { fail, type ActionRunContext } from "@agent-native/core/action";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import type { LineaRow, PlanRow } from "../db/schema.js";
import { aLogico, CODIGO_VERIFICADOR_INVALIDO, MegiError, megi, identidadClinica, type MegiAdapter } from "./megi/index.js";
import { contextoFuenteDe, contextoMinimo, evidenciaDe, fusionarConciliacion, leerJson, medicacionParaVerificar, type ContextoFuente } from "./revision.js";
import type { Medicamento, Verificacion } from "./megi/types.js";

/**
 * Adaptador MEGI de este correo con el contrato de error de las acciones: sin
 * identidad clínica → 403 `sin_rol_clinico`; almacén de credenciales caído →
 * 503 `credenciales_no_disponibles`. Un MegiError sin código (backend caído,
 * 404 clínico…) se propaga tal cual para que cada acción lo trate como ya hace.
 */
export async function conectarMegi(email?: string | null): Promise<MegiAdapter> {
  try {
    return await megi(email ?? undefined);
  } catch (e) {
    const codigo = e instanceof MegiError ? (e.detalle as any)?.codigo : undefined;
    if (codigo === "sin_rol_clinico" || codigo === "credenciales_no_disponibles") {
      fail((e as Error).message, { errorCode: codigo, statusCode: codigo === "sin_rol_clinico" ? 403 : 503 });
    }
    throw e;
  }
}

export const origenSchema = z
  .enum(["agente", "medico"])
  .default("agente")
  .describe(
    'Quién hace el cambio: "agente" (tú) o "medico" (solo la interfaz lo manda). Nunca te hagas pasar por el médico.',
  );

type PlanDb = ReturnType<typeof getDb>;

/** El caller lo establece el framework en el servidor, nunca el modelo. */
export async function origenAutorizado(
  origen: "agente" | "medico",
  ctx?: ActionRunContext,
): Promise<"agente" | "medico"> {
  ctx?.signal?.throwIfAborted();
  if (origen === "medico" && ctx?.caller !== "frontend") {
    fail(
      "Las decisiones del médico solo se realizan desde la interfaz autenticada.",
      { errorCode: "solo_medico", statusCode: 403 },
    );
  }
  if (origen === "medico") await exigirIdentidadClinica(ctx);
  return ctx?.caller === "frontend" ? "medico" : "agente";
}

/**
 * Identidad clínica de la sesión: conexión propia con MEGI, correo autorizado
 * para la cuenta de servicio (MEGI_MEDICOS) o sandbox mock. Sin ella no hay
 * decisión médica válida (403 `sin_rol_clinico`); si la conexión no se pudo
 * leer, 503 `credenciales_no_disponibles` (reintentable, no es un rechazo).
 */
export async function exigirIdentidadClinica(ctx?: ActionRunContext): Promise<void> {
  const id = await identidadClinica(ctx?.userEmail);
  if (!id.ok) {
    fail(`Solo una cuenta con rol clínico puede tomar esta decisión. ${id.motivo}`, {
      errorCode: id.codigo,
      statusCode: id.codigo === "credenciales_no_disponibles" ? 503 : 403,
    });
  }
}

/**
 * Decisión médica: interfaz autenticada (caller `frontend`) Y identidad clínica
 * de la cuenta (conexión propia con MEGI, o correo autorizado en `MEGI_MEDICOS`
 * para la cuenta de servicio). Ninguna de las dos cosas la decide el modelo.
 */
export async function exigirMedico(ctx?: ActionRunContext): Promise<void> {
  if (ctx?.caller !== "frontend") {
    fail(
      "La aprobación final debe confirmarla el médico desde la interfaz autenticada.",
      { errorCode: "solo_medico", statusCode: 403 },
    );
  }
  await exigirIdentidadClinica(ctx);
}

const CONTROLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Quita caracteres de control del texto que llega en los argumentos.
 * Postgres no admite `\u0000` en una columna `text`: un byte nulo en el nombre
 * de un fármaco hacía fallar el INSERT con el error crudo del driver (sin
 * errorCode, HTTP 500 y la consulta SQL en el registro). Y ninguno de esos
 * caracteres significa nada en una receta. Se limpian en la entrada, una sola
 * vez, antes de tocar la base. Hallazgo de la fase 2 (bloque H).
 */
export function limpiaControles<T>(valor: T): T {
  if (typeof valor === "string") return valor.replace(CONTROLES, "") as T;
  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length; i++) valor[i] = limpiaControles(valor[i]);
    return valor;
  }
  if (valor && typeof valor === "object") {
    for (const k of Object.keys(valor as Record<string, unknown>)) {
      const v = (valor as Record<string, unknown>)[k];
      if (typeof v === "string" || Array.isArray(v) || (v && typeof v === "object"))
        (valor as Record<string, unknown>)[k] = limpiaControles(v);
    }
  }
  return valor;
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

/**
 * Las líneas que pide una llamada a `agregar-linea`, con los huecos rellenos.
 *
 * Por qué `lineas` es un array obligatorio incluso para una sola línea. Medido
 * con un modelo real: cuando el médico pedía dos pendientes, el agente llamaba
 * una vez por línea, gastaba la versión en la primera y la segunda salía
 * rechazada con `version_desactualizada`; el turno acababa con la mitad del
 * trabajo hecho. Con `lineas`, la forma natural de la herramienta hace lo
 * correcto: una llamada, una transacción, una versión y UNA verificación del
 * conjunto, que además es la clínicamente honesta —dos fármacos que
 * interaccionan entre sí solo se ven mirando el resultado completo—.
 *
 * Y por qué obligatorio y no opcional: al dejar `tipo` y `texto` opcionales
 * para hacerle sitio, el mismo modelo llamó dos veces sin ninguna línea y se
 * comió el turno. Lo que el esquema marca como obligatorio es información que
 * el modelo usa, no decoración.
 *
 * Acepta las dos formas —`lineas`, o los campos de una sola línea— porque así
 * la llaman la auditoría del proyecto y la interfaz. Devuelve `null` si alguna
 * línea no es utilizable: o entran todas o ninguna, porque un plan a medias con
 * un recibo que dice otra cosa es peor que un fallo.
 */
type LineaSuelta = { [K in keyof LineaInput]?: LineaInput[K] | undefined };
export function lineasAAgregar(
  args: LineaSuelta & { lineas?: readonly LineaInput[] | undefined },
): LineaInput[] | null {
  const completa = (l: LineaSuelta): LineaInput | null =>
    l.tipo && typeof l.texto === "string" && l.texto.trim()
      ? {
          tipo: l.tipo,
          texto: l.texto,
          dosis: l.dosis ?? "",
          frecuencia: l.frecuencia ?? "",
          duracion: l.duracion ?? "",
          justificacion: l.justificacion ?? "",
        }
      : null;
  if (args.lineas?.length) {
    const lista = args.lineas.map(completa).filter((l): l is LineaInput => l !== null);
    return lista.length === args.lineas.length ? lista : null;
  }
  const sola = completa(args);
  return sola ? [sola] : null;
}

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
  fuentes: z.array(z.object({ tipo: z.enum(["nota", "medicacion", "sin_respaldo"]), referencia: z.string(), fecha: z.string(), fragmento: z.string() })),
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
  version: z.number(),
  alcanceAgente: z.array(z.string()).nullable(),
  alcanceSugerencias: z.array(z.string()),
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

export function lineaOut(r: LineaRow, contextoFuente: ContextoFuente | null = null): LineaOut {
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
    fuentes: evidenciaDe(r, contextoFuente),
    orden: r.orden,
    updatedAt: String(r.updatedAt),
  };
}

export function lineasOut(rows: LineaRow[], plan: PlanRow): LineaOut[] {
  const contexto = contextoFuenteDe(plan);
  return rows.map(r => ({ ...lineaOut(r, contexto), ...(plan.estado === "exportado" && !contexto ? { fuentes: [] } : {}) }));
}

export function planOut(p: PlanRow) {
  return {
    id: p.id,
    consultaId: p.consultaId,
    pacienteId: p.pacienteId,
    pacienteNombre: p.pacienteNombre,
    motivo: p.motivo,
    estado: p.estado,
    version: p.version,
    alcanceAgente: leerJson<string[] | null>(p.alcanceAgente, null),
    alcanceSugerencias: leerJson<string[]>(p.alcanceSugerencias, []),
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
  const busca = (id: string) => {
    const q = db
      .select()
      .from(schema.planes)
      .where(and(eq(schema.planes.id, id), eq(schema.planes.ownerEmail, email)))
      .limit(1);
    return bloquear ? q.for("update") : q;
  };
  let [p] = await busca(planId);
  // El id de la consulta en el campo del plan no es un callejón sin salida.
  // Medido con un modelo real: el agente manda `{"planId": "demo-c2"}` y perdía
  // dos llamadas en remontar el 404 —y alguna escritura se quedaba ahí—. La
  // búsqueda sigue acotada al dueño, así que esto no abre nada: solo acepta el
  // otro id del mismo plan. Un id con forma de plan que no existe sigue dando 404.
  if (!p && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId)) {
    const [porConsulta] = await db
      .select({ id: schema.planes.id })
      .from(schema.planes)
      .where(and(eq(schema.planes.consultaId, aLogico(planId)), eq(schema.planes.ownerEmail, email)))
      .limit(1);
    if (porConsulta) [p] = await busca(porConsulta.id);
  }
  if (!p)
    fail("Plan no encontrado.", { errorCode: "not_found", statusCode: 404 });
  // Compatibilidad con planes anteriores a la migración de trazabilidad.
  // Una mutación abierta conserva la fuente en su transacción. Leer el historial
  // o recuperar una exportación ya guardada no depende de que MEGI esté disponible.
  if (bloquear && p.estado === "borrador" && !p.contextoFuente) {
    const adapter = await conectarMegi(p.ownerEmail);
    try {
      const [consulta, paciente] = await Promise.all([adapter.verConsulta(p.consultaId), adapter.verPaciente(p.pacienteId)]);
      p.contextoFuente = JSON.stringify(contextoMinimo(consulta, paciente));
    } catch { fail("No se pudo hidratar el plan anterior con MEGI. No se guardaron cambios.", { errorCode: "megi_no_disponible", statusCode: 502 }); }
    if (bloquear) await db.update(schema.planes).set({ contextoFuente: p.contextoFuente }).where(eq(schema.planes.id, p.id));
  }
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
  const [planActual] = await db.select().from(schema.planes).where(eq(schema.planes.id, planId));
  const adapter = await conectarMegi(planActual!.ownerEmail);
  let resultado: Record<string, Verificacion>;
  try {
    const vivo = await adapter.verPaciente(pacienteId);
    const conciliacion = fusionarConciliacion(planActual!, vivo);
    await db.update(schema.planes).set({ conciliacion: JSON.stringify(conciliacion), ...(conciliacion.some(m => m.estado === "sin_confirmar") ? { conciliacionConfirmada: false } : {}) }).where(eq(schema.planes.id, planId));
    planActual!.conciliacion = JSON.stringify(conciliacion);
    if (!vigentes.length) return {};
    resultado = await adapter.verificarReceta(
      pacienteId,
      vigentes.map(comoMedicamento),
      medicacionParaVerificar(planActual!),
      vivo,
    );
  } catch (e) {
    // El verificador respondió, pero con algo que no es su contrato: no es una
    // caída (no se reintenta igual) y nunca se interpreta como «sin alertas».
    if (e instanceof MegiError && (e.detalle as any)?.codigo === CODIGO_VERIFICADOR_INVALIDO) {
      fail(`${e.message} No se guardó ningún cambio.`, {
        errorCode: CODIGO_VERIFICADOR_INVALIDO,
        statusCode: 502,
      });
    }
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
