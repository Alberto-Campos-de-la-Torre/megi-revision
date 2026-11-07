import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { sugerenciaSchema, type Sugerencia } from "../server/lib/sugerencias.js";
import { leerJson, conciliacionDe, conciliadoSchema } from "../server/lib/revision.js";
import { getDb, schema } from "../server/db/index.js";
import { aLogico } from "../server/lib/megi/index.js";
import {
  eventoOutputSchema, lineaOut, lineasOut, lineaOutputSchema, lineasDe, planDe, planOut, planOutputSchema, requireEmail, resumenVerificacion,
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
    sugerencias: z.array(sugerenciaSchema),
    ultimoActor: z.string().nullable(),
    conciliacion: z.array(conciliadoSchema),
    conciliacionConfirmada: z.boolean(),
    exportacion: z.string().nullable(),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: ({ result }) => ({
    url: buildDeepLink({ view: "revision", to: `/revision/${encodeURIComponent(result.plan.consultaId)}`, params: { consultaId: result.plan.consultaId } }),
    label: "Abrir plan",
  }),
  run: async ({ planId, consultaId }, ctx) => enPeticionMegi(async () => {
    const email = requireEmail(ctx);
    let id = planId;
    if (!id) {
      if (!consultaId) fail("Indica planId o consultaId.", { errorCode: "invalid_input" });
      // El plan se guarda con el id lógico; aceptar también el id real de MEGI.
      const [p] = await getDb()
        .select({ id: schema.planes.id })
        .from(schema.planes)
        .where(and(eq(schema.planes.consultaId, aLogico(consultaId)), eq(schema.planes.ownerEmail, email)))
        .limit(1);
      if (!p) fail("Esta consulta todavía no tiene plan; créalo con proponer-plan.", { errorCode: "not_found", statusCode: 404 });
      id = p.id;
    }
    const plan = await planDe(id!, email);
    const lineas = lineasOut(await lineasDe(plan.id), plan);
    const eventos = await getDb()
      .select({
        id: schema.eventosRevision.id, lineaId: schema.eventosRevision.lineaId, actor: schema.eventosRevision.actor,
        accion: schema.eventosRevision.accion, detalle: schema.eventosRevision.detalle, createdAt: schema.eventosRevision.createdAt,
      })
      .from(schema.eventosRevision)
      .where(eq(schema.eventosRevision.planId, plan.id))
      .orderBy(desc(schema.eventosRevision.createdAt))
      .limit(500);
    eventos.reverse();
    return {
      id: plan.id, plan: planOut(plan), lineas, sugerencias: leerJson<Sugerencia[]>(plan.sugerencias, []), ultimoActor: eventos[eventos.length - 1]?.actor ?? null, conciliacion: conciliacionDe(plan), conciliacionConfirmada: plan.conciliacionConfirmada,
      eventos: eventos.map((e) => ({ ...e, createdAt: String(e.createdAt) })),
      resumen: resumenVerificacion(lineas), exportacion: plan.exportacion,
    };
  }),
});
