// guard:allow-resource-action-access — La autorización privada se aplica con requireEmail y planDe/lineaDe (owner_email) dentro de la transacción; no hay recursos compartidos.
import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { exigirAbierto, exigirMedico, planDe, requireEmail, verificarPlan } from "../server/lib/plan.js";
import { comprobarVersion, guardarVersion } from "../server/lib/revision.js";
export default defineAction({
  changeResource: input => ({ resourceType: `plan:${input.planId}`, resourceId: input.planId }),
  uiOnly: true, agentTool: false,
  description: "Actualiza las alertas antes de mostrar la confirmación final y conserva la versión que el médico debe revisar. No aprueba ni exporta.",
  schema: z.object({ planId: z.string(), versionEsperada: z.number().int() }),
  outputSchema: z.object({ version: z.number() }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    const inicio = performance.now(); const email = requireEmail(ctx); ctx?.signal?.throwIfAborted(); await exigirMedico(ctx);
    return getDb().transaction(async tx => {
      const p = await planDe(args.planId, email, tx, true); exigirAbierto(p); comprobarVersion(p, args.versionEsperada);
      await verificarPlan(p.id, p.pacienteId, tx);
      ctx?.signal?.throwIfAborted();
      const version = await guardarVersion(p.id, "medico", "verificar", "Verificación actualizada antes de revisar la aprobación", inicio, tx, ctx);
      ctx?.signal?.throwIfAborted();
      return { version };
    });
  }),
});
