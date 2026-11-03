import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  eventoOutputSchema, lineaOut, lineaOutputSchema, lineasDe, planDe, planOut, planOutputSchema, requireEmail, resumenVerificacion,
} from "../server/lib/plan.js";

export default defineAction({
  description:
    "Plan de revisión completo: líneas con estado (propuesta/editada/bloqueada/rechazada), verificación (ok/advertencia/bloqueado con motivo y alternativas) y bitácora de cambios. Acepta planId o consultaId.",
  schema: z.object({
    planId: z.string().optional().describe("Id del plan"),
    consultaId: z.string().optional().describe("O bien el id de la consulta (p. ej. demo-c3)"),
  }),
  outputSchema: z.object({
    id: z.string(),
    plan: planOutputSchema,
    lineas: z.array(lineaOutputSchema),
    eventos: z.array(eventoOutputSchema),
    resumen: z.object({ bloqueos: z.number(), advertencias: z.number(), bloqueadas: z.number(), vigentes: z.number() }),
    exportacion: z.string().nullable(),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: ({ result }) => ({
    url: buildDeepLink({ view: "revision", to: `/revision/${encodeURIComponent(result.plan.consultaId)}`, params: { consultaId: result.plan.consultaId } }),
    label: "Abrir plan",
  }),
  run: async ({ planId, consultaId }, ctx) => {
    const email = requireEmail(ctx);
    let id = planId;
    if (!id) {
      if (!consultaId) fail("Indica planId o consultaId.", { errorCode: "invalid_input" });
      const [p] = await getDb()
        .select({ id: schema.planes.id })
        .from(schema.planes)
        .where(and(eq(schema.planes.consultaId, consultaId), eq(schema.planes.ownerEmail, email)))
        .limit(1);
      if (!p) fail("Esta consulta todavía no tiene plan; créalo con proponer-plan.", { errorCode: "not_found", statusCode: 404 });
      id = p.id;
    }
    const plan = await planDe(id!, email);
    const lineas = (await lineasDe(plan.id)).map(lineaOut);
    const eventos = await getDb()
      .select({
        id: schema.eventosRevision.id, lineaId: schema.eventosRevision.lineaId, actor: schema.eventosRevision.actor,
        accion: schema.eventosRevision.accion, detalle: schema.eventosRevision.detalle, createdAt: schema.eventosRevision.createdAt,
      })
      .from(schema.eventosRevision)
      .where(eq(schema.eventosRevision.planId, plan.id))
      .orderBy(asc(schema.eventosRevision.createdAt))
      .limit(500);
    return {
      id: plan.id, plan: planOut(plan), lineas,
      eventos: eventos.map((e) => ({ ...e, createdAt: String(e.createdAt) })),
      resumen: resumenVerificacion(lineas), exportacion: plan.exportacion,
    };
  },
});
