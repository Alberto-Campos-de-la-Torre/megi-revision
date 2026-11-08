import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction } from "@agent-native/core/action";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { requireEmail } from "../server/lib/plan.js";
export default defineAction({
  description: "Últimas 30 mediciones exploratorias del usuario para un caso: modalidad, tiempo hasta señal de plan visible y duración total. No son resultados de un estudio clínico.",
  readOnly: true, http: { method: "GET" },
  schema: z.object({ consultaId: z.string() }),
  outputSchema: z.object({ servidorMs: z.array(z.number()), modeloMs: z.null(), ultimoRunAgenteId: z.string().nullable(), mediciones: z.array(z.object({ id: z.string(), modalidad: z.string(), inicio: z.string(), fin: z.string().nullable(), planVisibleMs: z.number().nullable(), resultado: z.string().nullable(), totalMs: z.number().nullable() })) }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    const rows = await getDb().select().from(schema.medicionesRevision).where(and(eq(schema.medicionesRevision.ownerEmail, requireEmail(ctx)), eq(schema.medicionesRevision.consultaId, args.consultaId))).orderBy(desc(schema.medicionesRevision.inicio)).limit(30);
    const email = requireEmail(ctx);
    const versiones = await getDb().select({ ms: schema.versionesPlan.operacionMs, runId: schema.versionesPlan.agenteRunId }).from(schema.versionesPlan).innerJoin(schema.planes, eq(schema.planes.id, schema.versionesPlan.planId)).where(and(eq(schema.planes.ownerEmail, email), eq(schema.planes.consultaId, args.consultaId))).orderBy(desc(schema.versionesPlan.createdAt)).limit(100);
    return { servidorMs: versiones.map(v => v.ms), modeloMs: null, ultimoRunAgenteId: versiones.find(v => v.runId)?.runId ?? null, mediciones: rows.map(r => ({ id: r.id, modalidad: r.modalidad, inicio: r.inicio, fin: r.fin, planVisibleMs: r.planVisibleMs, resultado: r.resultado, totalMs: r.fin ? Math.max(0, Date.parse(r.fin) - Date.parse(r.inicio)) : null })) };
  }),
});
