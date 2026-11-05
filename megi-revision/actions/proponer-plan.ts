import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { megi, MegiError } from "../server/lib/megi/index.js";
import {
  ahora,
  lineaInputSchema,
  lineaOut,
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
} from "../server/lib/plan.js";

export default defineAction({
  // El framework exige sesión, mismo origen y capacidad UI para HTTP.
  needsApproval: (_args, ctx) => ctx?.caller === "http",
  description:
    'Crea el plan de revisión de una consulta con las líneas propuestas y verifica cada fármaco contra alergias, crónicos y medicación activa en MEGI. UNA sola llamada con TODAS las líneas en `lineas` (array de objetos): cada fármaco como {tipo:"farmaco", texto, dosis, frecuencia, duracion, justificacion} y cada pendiente como {tipo:"pendiente", texto}. El agente nunca manda `lineas` vacío. Falla con plan_existente (409) si la consulta ya tiene plan: entonces usa reajustar-plan.',
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
        "Dos o tres frases: en qué te basaste y qué decisiones tomaste",
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
  }),
  link: ({ args }) => ({
    url: buildDeepLink({
      view: "revision",
      to: `/revision/${encodeURIComponent(args.consultaId)}`,
      params: { consultaId: args.consultaId },
    }),
    label: "Abrir plan",
  }),
  run: async (args, ctx) => {
    const email = requireEmail(ctx);
    const orgId = ctx?.orgId ?? null;
    const origen = origenAutorizado(args.origen, ctx);
    const adapter = await megi();
    let consulta;
    try {
      consulta = await adapter.verConsulta(args.consultaId);
    } catch (e) {
      if (e instanceof MegiError && e.status === 404)
        fail("Consulta no encontrada en MEGI.", {
          errorCode: "not_found",
          statusCode: 404,
        });
      throw e;
    }
    if (consulta.estado !== "pendiente") {
      fail(`La consulta ya está ${consulta.estado} en MEGI.`, {
        errorCode: "consulta_cerrada",
        statusCode: 409,
      });
    }
    const paciente = await adapter.verPaciente(consulta.pacienteId);
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

      const [plan] = await tx
        .select()
        .from(schema.planes)
        .where(eq(schema.planes.id, planId))
        .limit(1);
      if (!plan) throw new Error("Plan no encontrado tras crear.");
      const lineas = (await lineasDe(planId, tx)).map(lineaOut);
      const resumen = resumenVerificacion(lineas);
      ctx?.signal?.throwIfAborted();
      return {
        id: planId,
        plan: planOut(plan),
        lineas,
        resumen,
        message: `Plan creado con ${lineas.length} líneas: ${resumen.bloqueos} bloqueo(s), ${resumen.advertencias} advertencia(s).`,
      };
    });
  },
});
