import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { modoMegi, restaurarMock } from "../server/lib/megi/index.js";
import { exigirMedico, requireEmail } from "../server/lib/plan.js";
export default defineAction({
  uiOnly: true, agentTool: false,
  description: "Restaura únicamente los cuatro casos sintéticos y los planes del usuario actual. Disponible exclusivamente con el backend simulado.",
  schema: z.object({ confirmar: z.literal(true) }),
  outputSchema: z.object({ restaurados: z.number() }),
  run: async (_args, ctx) => enPeticionMegi(async () => {
    ctx?.signal?.throwIfAborted();
    const email = requireEmail(ctx); await exigirMedico(ctx);
    if (modoMegi() !== "mock") fail("La restauración solo está disponible en la demo autónoma.", { errorCode: "solo_demo", statusCode: 403 });
    const restaurados = await getDb().transaction(async tx => {
      const planes = await tx.select({ id: schema.planes.id }).from(schema.planes).where(and(eq(schema.planes.ownerEmail, email), inArray(schema.planes.consultaId, ["demo-c1", "demo-c2", "demo-c3", "demo-c4"]))).for("update");
      const ids = planes.map(p => p.id);
      await tx.update(schema.medicionesRevision).set({ fin: new Date().toISOString(), resultado: "interrumpida" }).where(and(eq(schema.medicionesRevision.ownerEmail, email), inArray(schema.medicionesRevision.consultaId, ["demo-c1", "demo-c2", "demo-c3", "demo-c4"]), isNull(schema.medicionesRevision.fin)));
      if (ids.length) {
        await tx.update(schema.medicionesRevision).set({ planId: null }).where(inArray(schema.medicionesRevision.planId, ids));
        await tx.delete(schema.versionesPlan).where(inArray(schema.versionesPlan.planId, ids));
        await tx.delete(schema.eventosRevision).where(inArray(schema.eventosRevision.planId, ids));
        await tx.delete(schema.lineasPlan).where(inArray(schema.lineasPlan.planId, ids));
        await tx.delete(schema.planes).where(and(eq(schema.planes.ownerEmail, email), inArray(schema.planes.id, ids)));
      }
      return ids.length;
    });
    restaurarMock(email);
    return { restaurados };
  }),
});
