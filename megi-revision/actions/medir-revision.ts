import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { conectarMegi, exigirMedico, requireEmail } from "../server/lib/plan.js";
export default defineAction({
  uiOnly: true, agentTool: false,
  description: "Cronómetro exploratorio: inicio antes del trabajo, señal de plan visible desde la UI y finalización explícita. Tiempos de servidor, sin afirmar ahorro clínico.",
  schema: z.object({ consultaId: z.string(), operacion: z.enum(["iniciar", "visible", "terminar", "interrumpir"]), modalidad: z.enum(["manual", "agente"]).default("agente") }),
  outputSchema: z.object({ id: z.string(), inicio: z.string(), fin: z.string().nullable(), planVisibleMs: z.number().nullable() }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    ctx?.signal?.throwIfAborted();
    const email = requireEmail(ctx); await exigirMedico(ctx);
    await (await conectarMegi(email)).verConsulta(args.consultaId);
    return getDb().transaction(async tx => {
      const filtro = and(eq(schema.medicionesRevision.ownerEmail, email), eq(schema.medicionesRevision.consultaId, args.consultaId), isNull(schema.medicionesRevision.fin));
      const [abierta] = await tx.select().from(schema.medicionesRevision).where(filtro).for("update");
      if (args.operacion === "iniciar") {
        if (abierta) fail("Ya hay una medición en curso para este caso.", { errorCode: "medicion_en_curso", statusCode: 409 });
        const [r] = await tx.insert(schema.medicionesRevision).values({ id: crypto.randomUUID(), consultaId: args.consultaId, modalidad: args.modalidad, inicio: new Date().toISOString(), ownerEmail: email, orgId: ctx?.orgId ?? null }).onConflictDoNothing().returning();
        if (!r) fail("Ya hay una medición en curso.", { errorCode: "medicion_en_curso", statusCode: 409 });
        return { id: r.id, inicio: r.inicio, fin: r.fin, planVisibleMs: r.planVisibleMs };
      }
      if (!abierta) fail("No hay medición en curso.", { errorCode: "not_found", statusCode: 404 });
      const [p] = await tx.select({ id: schema.planes.id }).from(schema.planes).where(and(eq(schema.planes.ownerEmail, email), eq(schema.planes.consultaId, args.consultaId)));
      if (args.operacion === "visible" && !p) fail("El plan todavía no está guardado.", { errorCode: "plan_no_visible", statusCode: 409 });
      const [r] = await tx.update(schema.medicionesRevision).set({ planId: p?.id ?? null, ...((args.operacion === "terminar" || args.operacion === "interrumpir") ? { fin: new Date().toISOString(), resultado: args.operacion === "interrumpir" ? "interrumpida" as const : "finalizada" as const } : { planVisibleMs: abierta.planVisibleMs ?? Math.max(0, Date.now() - Date.parse(abierta.inicio)) }) }).where(eq(schema.medicionesRevision.id, abierta.id)).returning();
      return { id: r!.id, inicio: r!.inicio, fin: r!.fin, planVisibleMs: r!.planVisibleMs };
    });
  }),
});
