import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { planDe, requireEmail } from "../server/lib/plan.js";
import { versionesDe } from "../server/lib/revision.js";
export default defineAction({
  description: "Versiones del plan, autores, motivos y tiempos de operación del servidor. Página de 20; usa antes para continuar. Las instantáneas contienen las fuentes de cada línea.",
  readOnly: true, http: { method: "GET" },
  schema: z.object({ planId: z.string(), antes: z.number().int().positive().optional() }),
  outputSchema: z.object({ versiones: z.array(z.object({ version: z.number(), actor: z.string(), accion: z.string(), motivo: z.string(), operacionMs: z.number(), createdAt: z.string(), snapshot: z.string() })), siguiente: z.number().nullable() }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    await planDe(args.planId, requireEmail(ctx));
    const rows = await versionesDe(args.planId, args.antes);
    return { versiones: rows.slice(0, 20).map(({ version, actor, accion, motivo, operacionMs, createdAt, snapshot }) => ({ version, actor, accion, motivo, operacionMs, createdAt, snapshot })), siguiente: rows.length > 20 ? rows[19]!.version : null };
  }),
});
