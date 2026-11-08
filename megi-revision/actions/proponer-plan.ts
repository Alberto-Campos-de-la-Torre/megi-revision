// guard:allow-resource-action-access — Crea un recurso nuevo con ownerEmail derivado de requireEmail; consulta de MEGI y unicidad por propietario antes de insertar.
import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction, fail } from "@agent-native/core/action";
import { ACTION_CHAT_UI_RECORD_CHANGE_RENDERER } from "@agent-native/core/action-ui";
import { buildDeepLink } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { contextoMinimo, guardarVersion } from "../server/lib/revision.js";
import { getDb, schema } from "../server/db/index.js";
import { fallaDeMegi } from "../server/lib/megi/index.js";
import { conectarMegi,
  ahora,
  lineaInputSchema,
  lineasOut,
  lineaOutputSchema,
  lineasDe,
  origenAutorizado,
  origenSchema,
  planOut,
  planOutputSchema,
  registrarEvento,
  requireEmail,
  resumenVerificacion,
  verificarPlan,
  limpiaControles,
} from "../server/lib/plan.js";

const reciboSchema = z.object({
  verb: z.literal("created"), kind: z.literal("plan"),
  title: z.string(), detail: z.string(), url: z.string(),
});

export default defineAction({
  // Creation finishes at the medical handoff: explanation and verified lines
  // are already persisted. Other edit actions continue to use the agent loop.
  endsTurn: true,
  // Direct MCP callers receive the complete result and deep link; no in-app
  // answer is needed to complete creation. Medical approval stays UI-only.
  mcpTool: true,
  chatUI: {
    renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
    // Keep the resource ids used by directed invalidation, without copying
    // clinical lines or sources into the chat widget's recovery payload.
    projectResult: (_args, result) => z.object({
      id: z.string(), plan: z.object({ id: z.string(), consultaId: z.string() }),
      change: reciboSchema,
    }).parse(result),
  },
  changeResource: (_input, result) => ({ resourceType: `consulta:${result.plan.consultaId}`, resourceId: result.id }),
  // El framework exige sesión, mismo origen y capacidad UI para HTTP.
  needsApproval: (_args, ctx) => ctx?.caller === "http",
  description:
    'Crea y verifica el plan; muestra el recibo y entrega el control al médico, terminando el turno. UNA sola llamada con TODAS las líneas en `lineas` (array de objetos): cada fármaco como {tipo:"farmaco", texto, dosis, frecuencia, duracion, justificacion} y cada pendiente como {tipo:"pendiente", texto}. Nunca envíes `lineas` vacío. Falla con plan_existente (409) si ya hay plan: usa reajustar-plan. La revisión y aprobación finales son médicas.',
  schema: z.object({
    consultaId: z.string().describe("Id de la consulta (de listar-consultas)"),
    lineas: z
      .array(lineaInputSchema)
      .max(40)
      .describe(
        'Todas las líneas del plan en orden, p. ej. [{"tipo":"farmaco","texto":"Paracetamol","dosis":"1 g","frecuencia":"cada 8 h","duracion":"5 días","justificacion":"Analgesia"},{"tipo":"pendiente","texto":"Control en 2 semanas"}]. Solo la interfaz (origen medico) puede mandarlo vacío',
      ),
    explicacion: z
      .string()
      .default("")
      .describe(
        "Dos frases breves: decisión clínica, fuente y datos que falta confirmar. El detalle de pauta y alertas queda en cada línea.",
      ),
    origen: origenSchema,
  }),
  outputSchema: z.object({
    id: z.string(),
    plan: planOutputSchema,
    lineas: z.array(lineaOutputSchema),
    resumen: z.object({
      bloqueos: z.number(),
      advertencias: z.number(),
      bloqueadas: z.number(),
      vigentes: z.number(),
    }),
    message: z.string(),
    change: reciboSchema,
  }),
  link: ({ args }) => ({
    url: buildDeepLink({
      view: "revision",
      to: `/revision/${encodeURIComponent(args.consultaId)}`,
      params: { consultaId: args.consultaId },
    }),
    label: "Abrir plan",
  }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    const inicio = performance.now();
    const email = requireEmail(ctx);
    limpiaControles(args); // sin caracteres de control antes de tocar la base
    const orgId = ctx?.orgId ?? null;
    const origen = await origenAutorizado(args.origen, ctx);
    const adapter = await conectarMegi(ctx?.userEmail ?? undefined);
    let consulta;
    try {
      consulta = await adapter.verConsulta(args.consultaId);
    } catch (e) {
      fallaDeMegi(e, "La consulta");
    }
    if (consulta.estado !== "pendiente") {
      fail(`La consulta ya está ${consulta.estado} en MEGI.`, {
        errorCode: "consulta_cerrada",
        statusCode: 409,
      });
    }
    const paciente = await adapter
      .verPaciente(consulta.pacienteId)
      .catch((e) => fallaDeMegi(e, "El paciente"));
    if (origen !== "medico" && args.lineas.length === 0) {
      // Sin escribir nada: el agente debe volver a llamar con las líneas completas.
      fail(
        "No se creó el plan: `lineas` llegó vacío. Vuelve a llamar a proponer-plan con cada fármaco (tipo, texto, dosis, frecuencia, duracion, justificacion) y cada pendiente (tipo, texto) de la nota; empieza por " +
          (consulta.medicamentosPropuestos.length
            ? consulta.medicamentosPropuestos.join("; ")
            : "los fármacos del Plan de la nota") +
          ".",
        { errorCode: "lineas_vacias", statusCode: 400 },
      );
    }

    const [existente] = await getDb()
      .select({ id: schema.planes.id })
      .from(schema.planes)
      .where(
        and(
          eq(schema.planes.consultaId, consulta.id),
          eq(schema.planes.ownerEmail, email),
        ),
      )
      .limit(1);
    if (existente) {
      fail(
        "Esta consulta ya tiene un plan; usa reajustar-plan o agregar-linea sobre él.",
        {
          errorCode: "plan_existente",
          statusCode: 409,
          details: { planId: existente.id },
        },
      );
    }

    const planId = crypto.randomUUID();
    const t = ahora();
    return getDb().transaction(async (tx) => {
      const [insertado] = await tx
        .insert(schema.planes)
        .values({
          id: planId,
          consultaId: consulta.id,
          pacienteId: paciente.id,
          pacienteNombre: paciente.nombre,
          motivo: consulta.motivo,
          estado: "borrador",
          explicacion: args.explicacion || null,
          contextoFuente: JSON.stringify(contextoMinimo(consulta, paciente)),
          ownerEmail: email,
          orgId,
          createdAt: t,
          updatedAt: t,
        })
        .onConflictDoNothing({
          target: [schema.planes.consultaId, schema.planes.ownerEmail],
        })
        .returning({ id: schema.planes.id });
      if (!insertado)
        fail(
          "Esta consulta ya tiene un plan; usa obtener-plan y reajustar-plan.",
          { errorCode: "plan_existente", statusCode: 409 },
        );
      if (args.lineas.length) {
        await tx.insert(schema.lineasPlan).values(
          args.lineas.map((l, i) => ({
            id: crypto.randomUUID(),
            planId,
            tipo: l.tipo,
            texto: l.texto.trim(),
            dosis: l.dosis.trim(),
            frecuencia: l.frecuencia.trim(),
            duracion: l.duracion.trim(),
            estado: "propuesta" as const,
            verificacion: "pendiente" as const,
            origen,
            justificacion: l.justificacion || null,
            orden: i,
            ownerEmail: email,
            orgId,
            createdAt: t,
            updatedAt: t,
          })),
        );
      }
      await verificarPlan(planId, paciente.id, tx);
      await registrarEvento(
        {
          planId,
          actor: origen,
          accion: "proponer",
          email,
          orgId,
          detalle:
            args.explicacion || `${args.lineas.length} líneas propuestas`,
        },
        tx,
      );

      await guardarVersion(planId, origen, "proponer", args.explicacion || "Plan inicial", inicio, tx, ctx);
      const [plan] = await tx
        .select()
        .from(schema.planes)
        .where(eq(schema.planes.id, planId))
        .limit(1);
      if (!plan) throw new Error("Plan no encontrado tras crear.");
      const lineas = lineasOut(await lineasDe(planId, tx), plan);
      const resumen = resumenVerificacion(lineas);
      const message = `Plan creado con ${lineas.length} líneas: ${resumen.bloqueos} bloqueo(s), ${resumen.advertencias} advertencia(s). Revisión médica pendiente: confirma las fuentes y concilia la medicación antes de aprobar.`;
      ctx?.signal?.throwIfAborted();
      return {
        id: planId,
        plan: planOut(plan),
        lineas,
        resumen,
        message,
        change: {
          verb: "created" as const, kind: "plan" as const,
          title: "Plan listo para revisión médica",
          detail: message,
          url: buildDeepLink({ view: "revision", to: `/revision/${encodeURIComponent(consulta.id)}`, params: { consultaId: consulta.id } }),
        },
      };
    });
  }),
});
