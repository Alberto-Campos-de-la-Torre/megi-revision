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
  lineasDe,
  lineasOut,
  lineaOutputSchema,
  origenAutorizado,
  origenSchema,
  planDe,
  registrarEvento,
  requireEmail,
  resumenVerificacion,
  verificarPlan,
  limpiaControles,
} from "../server/lib/plan.js";

export default defineAction({
  changeResource: (_input, result) => ({ resourceType: `plan:${result.linea.planId}`, resourceId: result.linea.planId }),
  // El framework exige sesión, mismo origen y capacidad UI para HTTP.
  needsApproval: (_args, ctx) => ctx?.caller === "http",
  description:
    "Añade una línea (fármaco o pendiente) a un plan existente y vuelve a verificar los fármacos. Para varios cambios a la vez usa reajustar-plan.",
  schema: lineaInputSchema.extend({
    versionEsperada: z.number().int().nonnegative().optional().describe("Versión vigente del plan, la que devuelve obtener-plan en `plan.version`. OBLIGATORIA en toda edición del agente: sin ella la llamada se rechaza con `version_desactualizada` y no se aplica nada. Tras un conflicto, relee el plan y manda la nueva."),
    planId: z.string().describe("Id del plan"),
    origen: origenSchema,
  }),
  outputSchema: z.object({
    id: z.string(),
    // La versión que deja esta escritura. Sin ella el agente no puede encadenar
    // dos cambios en un turno: medido con un modelo real, tras añadir la primera
    // línea reusaba la versión que ya había gastado, la segunda salía rechazada
    // y el framework retenía el reintento. `actualizar-linea` ya la devolvía.
    version: z.number(),
    linea: lineaOutputSchema,
    // El estado del plan tras el cambio, tomado de la base y no de la memoria
    // del modelo. Medido: sin esto, la frase final del agente inventaba el
    // recuento («5 líneas, 0 bloqueos») o costaba una lectura más. Con el
    // recuento en el recibo, decir la verdad es lo barato.
    resumen: z.object({
      bloqueos: z.number(),
      advertencias: z.number(),
      bloqueadas: z.number(),
      vigentes: z.number(),
    }),
    message: z.string(),
  }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    const inicio = performance.now();
    const email = requireEmail(ctx);
    limpiaControles(args); // sin caracteres de control antes de tocar la base
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
      const version = await guardarVersion(plan.id, origen, "agregar", args.justificacion || args.texto, inicio, tx, ctx);
      const [row] = await tx
        .select()
        .from(schema.lineasPlan)
        .where(eq(schema.lineasPlan.id, id))
        .limit(1);
      if (!row) throw new Error("Línea no encontrada tras insertar.");
      const out = lineasOut([row], plan)[0]!;
      const resumen = resumenVerificacion(lineasOut(await lineasDe(plan.id, tx), plan));
      ctx?.signal?.throwIfAborted();
      return {
        id,
        version,
        linea: out,
        resumen,
        message: `Añadida ${out.texto} (verificación ${out.verificacion}). El plan queda en la versión ${version} con ${resumen.vigentes} línea(s) vigente(s), ${resumen.bloqueos} bloqueo(s) y ${resumen.advertencias} advertencia(s). Usa la versión ${version} como versionEsperada si vas a hacer otro cambio, y estas cifras si tienes que resumir.`,
      };
    });
  }),
});
