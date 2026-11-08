// guard:allow-resource-action-access — La autorización privada se aplica con requireEmail y planDe/lineaDe (owner_email) dentro de la transacción; no hay recursos compartidos.
import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { exigirAbierto, exigirMedico, limpiaControles, planDe, registrarEvento, requireEmail, verificarPlan } from "../server/lib/plan.js";
import { comprobarVersion, conciliacionDe, conciliadoSchema, guardarVersion } from "../server/lib/revision.js";
export default defineAction({
  changeResource: input => ({ resourceType: `plan:${input.planId}`, resourceId: input.planId }),
  uiOnly: true, agentTool: false,
  description: "El médico confirma, suspende o marca como finalizada la medicación histórica, y puede añadir medicación comunicada por el paciente. Nunca se omiten candidatos sin decisión; se vuelve a verificar el plan.",
  schema: z.object({ planId: z.string(), versionEsperada: z.number().int(), decisiones: z.array(z.object({ id: z.string(), estado: conciliadoSchema.shape.estado })).max(400), adicionales: z.array(z.object({ nombre: z.string().trim().min(1).max(160), dosis: z.string().max(160), frecuencia: z.string().max(160) })).max(40).default([]) }),
  outputSchema: z.object({ version: z.number(), medicacion: z.array(conciliadoSchema) }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    const inicio = performance.now(); const email = requireEmail(ctx); limpiaControles(args); ctx?.signal?.throwIfAborted(); await exigirMedico(ctx);
    return getDb().transaction(async tx => {
      const p = await planDe(args.planId, email, tx, true); exigirAbierto(p); comprobarVersion(p, args.versionEsperada);
      const candidatos = conciliacionDe(p);
      const ids = args.decisiones.map(d => d.id);
      if (new Set(ids).size !== ids.length || ids.some(id => !candidatos.some(m => m.id === id))) fail("Decisiones duplicadas o medicación ajena al plan.", { errorCode: "invalid_input" });
      const medicacion = candidatos.map(m => ({ ...m, estado: args.decisiones.find(d => d.id === m.id)?.estado ?? m.estado }));
      for (const m of args.adicionales) medicacion.push({ ...m, id: crypto.randomUUID(), fecha: new Date().toISOString(), fuente: "Declaración del paciente confirmada por el médico", estado: "activo" });
      await tx.update(schema.planes).set({ conciliacion: JSON.stringify(medicacion) }).where(eq(schema.planes.id, p.id));
      await verificarPlan(p.id, p.pacienteId, tx);
      const [reverificado] = await tx.select().from(schema.planes).where(eq(schema.planes.id, p.id));
      const fusionada = conciliacionDe(reverificado!);
      await tx.update(schema.planes).set({ conciliacionConfirmada: !fusionada.some(m => m.estado === "sin_confirmar") }).where(eq(schema.planes.id, p.id));
      const detalle = fusionada.map(m => `${m.nombre} ${m.dosis}: ${m.estado} (${m.fuente})`).join("; ") || "El médico confirmó ausencia de medicación referida";
      await registrarEvento({ planId: p.id, actor: "medico", accion: "conciliar", detalle, email, orgId: p.orgId }, tx);
      const version = await guardarVersion(p.id, "medico", "conciliar", detalle, inicio, tx, ctx);
      ctx?.signal?.throwIfAborted();
      return { version, medicacion: fusionada };
    });
  }),
});
