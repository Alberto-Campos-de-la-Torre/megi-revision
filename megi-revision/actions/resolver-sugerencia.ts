// guard:allow-resource-action-access — La autorización privada se aplica con requireEmail y planDe/lineaDe (owner_email) dentro de la transacción; no hay recursos compartidos.
import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { exigirAbierto, exigirEspacio, exigirMedico, lineasDe, planDe, registrarEvento, requireEmail, verificarPlan } from "../server/lib/plan.js";
import { comprobarVersion, guardarVersion, leerJson } from "../server/lib/revision.js";
import { cicloSugerencia, pautaOriginal, type Sugerencia } from "../server/lib/sugerencias.js";
export default defineAction({
  uiOnly: true, agentTool: false,
  description: "El médico acepta o descarta una alternativa. Aceptar sustituye una pauta no fijada y reverifica el conjunto. Una línea fijada nunca se desbloquea implícitamente.",
  schema: z.object({ planId: z.string(), sugerenciaId: z.string(), versionEsperada: z.number().int(), decision: z.enum(["aceptar", "descartar"]) }),
  outputSchema: z.object({ version: z.number() }),
  changeResource: input => ({ resourceType: `plan:${input.planId}`, resourceId: input.planId }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    const inicio = performance.now(); const email = requireEmail(ctx); await exigirMedico(ctx); ctx?.signal?.throwIfAborted();
    return getDb().transaction(async tx => {
      const p = await planDe(args.planId, email, tx, true); exigirAbierto(p); comprobarVersion(p, args.versionEsperada);
      const sugerencias = leerJson<Sugerencia[]>(p.sugerencias, []);
      const s = sugerencias.find(s => s.id === args.sugerenciaId);
      if (!s || s.estado !== "pendiente") fail("La sugerencia no está pendiente.", { errorCode: "sugerencia_no_pendiente", statusCode: 409 });
      if (args.decision === "aceptar") {
        const lineas = await lineasDe(p.id, tx); const original = lineas.find(l => l.id === s.lineaId);
        if (!original || pautaOriginal(original) !== s.pautaOriginal) fail("La pauta de origen cambió. Solicita una sugerencia nueva.", { errorCode: "sugerencia_obsoleta", statusCode: 409 });
        if (original.estado === "bloqueada") fail("Desbloquea explícitamente la pauta antes de aceptar su reemplazo.", { errorCode: "linea_bloqueada", statusCode: 409 });
        await exigirEspacio(p.id, 1, tx);
        await tx.update(schema.lineasPlan).set({ estado: "rechazada", justificacion: s.motivo }).where(eq(schema.lineasPlan.id, original.id));
        await tx.insert(schema.lineasPlan).values({ id: crypto.randomUUID(), planId: p.id, tipo: "farmaco", texto: s.texto, dosis: s.dosis, frecuencia: s.frecuencia, duracion: s.duracion, estado: "editada", origen: "medico", justificacion: `Alternativa del agente aceptada por el médico: ${s.motivo}`, orden: original.orden, ownerEmail: email, orgId: p.orgId });
        await verificarPlan(p.id, p.pacienteId, tx);
      }
      s.estado = cicloSugerencia.transition(s.estado, args.decision);
      await tx.update(schema.planes).set({ sugerencias: JSON.stringify(sugerencias) }).where(eq(schema.planes.id, p.id));
      const detalle = `${args.decision}: ${s.texto} · ${s.motivo}`;
      await registrarEvento({ planId: p.id, lineaId: s.lineaId, actor: "medico", accion: "resolver-sugerencia", detalle, email, orgId: p.orgId }, tx);
      const version = await guardarVersion(p.id, "medico", "resolver-sugerencia", detalle, inicio, tx, ctx); ctx?.signal?.throwIfAborted();
      return { version };
    });
  }),
});
