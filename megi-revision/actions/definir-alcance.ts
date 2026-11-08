// guard:allow-resource-action-access — La autorización privada se aplica con requireEmail y planDe/lineaDe (owner_email) dentro de la transacción; no hay recursos compartidos.
import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { exigirAbierto, exigirMedico, limpiaControles, lineasDe, planDe, registrarEvento, requireEmail } from "../server/lib/plan.js";
import { comprobarVersion, guardarVersion } from "../server/lib/revision.js";

export default defineAction({
  changeResource: input => ({ resourceType: `plan:${input.planId}`, resourceId: input.planId }),
  uiOnly: true, agentTool: false,
  description: "El médico delimita las líneas que el agente puede modificar. null libera el alcance; una lista vacía congela toda edición del agente.",
  schema: z.object({ planId: z.string(), modo: z.enum(["edicion", "sugerencias"]).default("edicion"), versionEsperada: z.number().int(), lineas: z.array(z.string()).max(400).nullable() }),
  outputSchema: z.object({ version: z.number(), alcance: z.array(z.string()).nullable() }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    const inicio = performance.now();
    ctx?.signal?.throwIfAborted();
    const email = requireEmail(ctx); limpiaControles(args); await exigirMedico(ctx);
    return getDb().transaction(async tx => {
      const p = await planDe(args.planId, email, tx, true); exigirAbierto(p); comprobarVersion(p, args.versionEsperada);
      const lineas = await lineasDe(p.id, tx);
      if (args.lineas?.some(id => !lineas.some(l => l.id === id && (args.modo === "sugerencias" || l.estado !== "rechazada")))) fail("Selecciona líneas vigentes de este plan.", { errorCode: "invalid_input" });
      const alcance = args.lineas === null ? null : [...new Set(args.lineas)];
      await tx.update(schema.planes).set(args.modo === "sugerencias" ? { alcanceSugerencias: JSON.stringify(alcance ?? []) } : { alcanceAgente: alcance === null ? null : JSON.stringify(alcance) }).where(eq(schema.planes.id, p.id));
      const motivo = args.modo === "sugerencias" ? `El médico autorizó sugerencias sin edición para ${alcance?.length ?? 0} línea(s)` : alcance === null ? "El médico liberó el ámbito de edición" : `El médico autorizó editar únicamente ${alcance.length} línea(s)`;
      await registrarEvento({ planId: p.id, actor: "medico", accion: "alcance", detalle: motivo, email, orgId: p.orgId }, tx);
      const version = await guardarVersion(p.id, "medico", "alcance", motivo, inicio, tx, ctx);
      ctx?.signal?.throwIfAborted();
      return { version, alcance };
    });
  }),
});
