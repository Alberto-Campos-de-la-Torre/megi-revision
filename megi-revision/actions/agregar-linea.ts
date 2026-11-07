// guard:allow-resource-action-access — La autorización privada se aplica con requireEmail y planDe/lineaDe (owner_email) dentro de la transacción; no hay recursos compartidos.
import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { comprobarAlcance, comprobarVersion, guardarVersion } from "../server/lib/revision.js";
import { getDb, schema } from "../server/db/index.js";
import {
  ahora,
  exigirAbierto,
  exigirEspacio,
  lineaInputSchema,
  lineasOut,
  lineaOutputSchema,
  origenAutorizado,
  origenSchema,
  planDe,
  registrarEvento,
  requireEmail,
  verificarPlan,
} from "../server/lib/plan.js";

export default defineAction({
  changeResource: (_input, result) => ({ resourceType: `plan:${result.linea.planId}`, resourceId: result.linea.planId }),
  // El framework exige sesión, mismo origen y capacidad UI para HTTP.
  needsApproval: (_args, ctx) => ctx?.caller === "http",
  description:
    "Añade una línea (fármaco o pendiente) a un plan existente y vuelve a verificar los fármacos. Para varios cambios a la vez usa reajustar-plan.",
  schema: lineaInputSchema.extend({
    versionEsperada: z.number().int().nonnegative().optional().describe("Versión leída antes de editar; relectura obligatoria tras conflicto"),
    planId: z.string().describe("Id del plan"),
    origen: origenSchema,
  }),
  outputSchema: z.object({
    id: z.string(),
    linea: lineaOutputSchema,
    message: z.string(),
  }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    const inicio = performance.now();
    const email = requireEmail(ctx);
    const orgId = ctx?.orgId ?? null;
    const origen = await origenAutorizado(args.origen, ctx);
    return getDb().transaction(async (tx) => {
      const plan = await planDe(args.planId, email, tx, true);
      exigirAbierto(plan);
      comprobarVersion(plan, args.versionEsperada, origen);
      comprobarAlcance(plan, origen, [], true);
      await exigirEspacio(plan.id, 1, tx);
      const [ultima] = await tx
        .select({ orden: schema.lineasPlan.orden })
        .from(schema.lineasPlan)
        .where(eq(schema.lineasPlan.planId, plan.id))
        .orderBy(desc(schema.lineasPlan.orden))
        .limit(1);
      const id = crypto.randomUUID();
      const t = ahora();
      await tx.insert(schema.lineasPlan).values({
        id,
        planId: plan.id,
        tipo: args.tipo,
        texto: args.texto.trim(),
        dosis: args.dosis.trim(),
        frecuencia: args.frecuencia.trim(),
        duracion: args.duracion.trim(),
        estado: origen === "medico" ? "editada" : "propuesta",
        verificacion: "pendiente",
        origen,
        justificacion: args.justificacion || null,
        orden: (ultima?.orden ?? -1) + 1,
        ownerEmail: email,
        orgId,
        createdAt: t,
        updatedAt: t,
      });
      await registrarEvento(
        {
          planId: plan.id,
          lineaId: id,
          actor: origen,
          accion: "agregar",
          email,
          orgId,
          detalle: [
            `${args.texto.trim()} ${args.dosis.trim()} ${args.frecuencia.trim()}`.trim(),
            args.justificacion,
          ]
            .filter(Boolean)
            .join(" · "),
        },
        tx,
      );
      if (args.tipo === "farmaco")
        await verificarPlan(plan.id, plan.pacienteId, tx);
      await guardarVersion(plan.id, origen, "agregar", args.justificacion || args.texto, inicio, tx, ctx);
      const [row] = await tx
        .select()
        .from(schema.lineasPlan)
        .where(eq(schema.lineasPlan.id, id))
        .limit(1);
      if (!row) throw new Error("Línea no encontrada tras insertar.");
      const out = lineasOut([row], plan)[0]!;
      ctx?.signal?.throwIfAborted();
      return {
        id,
        linea: out,
        message: `Añadida ${out.texto} (verificación ${out.verificacion})`,
      };
    });
  }),
});
