// guard:allow-resource-action-access — La autorización privada se aplica con requireEmail y planDe/lineaDe (owner_email) dentro de la transacción; no hay recursos compartidos.
import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction, fail } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { comprobarAlcance, comprobarVersion, guardarVersion } from "../server/lib/revision.js";
import { getDb, schema } from "../server/db/index.js";
import {
  ahora,
  exigirAbierto,
  exigirEspacio,
  lineaInputSchema,
  lineasAAgregarSchema,
  lineasAAgregar,
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

/** La versión vigente del plan; compartida por los dos esquemas de la acción. */
const VERSION_ESPERADA = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe(
    "Versión vigente del plan, la que devuelve obtener-plan en `plan.version`. OBLIGATORIA en toda edición del agente: sin ella la llamada se rechaza con `version_desactualizada` y no se aplica nada. Tras un conflicto, relee el plan y manda la nueva.",
  );
const PLAN_ID = z.string().describe("Id del plan");

export default defineAction({
  changeResource: (_input, result) => ({ resourceType: `plan:${result.linea.planId}`, resourceId: result.linea.planId }),
  // El framework exige sesión, mismo origen y capacidad UI para HTTP.
  needsApproval: (_args, ctx) => ctx?.caller === "http",
  description:
    'Añade una o VARIAS líneas (fármacos o pendientes) a un plan existente, en una sola transacción y una sola versión, y vuelve a verificar los fármacos del plan completo. TODAS las líneas van en `lineas`, incluso si es una: `lineas: [{"tipo":"pendiente","texto":"Control de presión en 72 h"}]`, y cada llamada lleva además `versionEsperada` con la versión que acabas de leer. Llamar una vez por línea gasta la versión en la primera y las siguientes se rechazan con version_desactualizada. Para quitar, editar o reemplazar líneas usa reajustar-plan.',
  // Dos esquemas a propósito, y esta es la razón medida. `schema` es el que
  // valida, y acepta las dos formas —`lineas`, o los campos sueltos de una
  // línea— porque así llaman la auditoría del proyecto (`evidencia/`) y las
  // baterías, y `run` valida también a quien lo llama directamente.
  // `agentInputSchema` es solo lo que VE el modelo, y ahí `lineas` es
  // obligatorio y los campos sueltos no existen. Medido con un modelo real en
  // dos tandas seguidas: lo que el esquema deja opcional, el modelo lo omite.
  // Con `lineas` opcional, 20 de 24 escrituras llegaron sin ninguna línea
  // —solo planId, versionEsperada y origen— y ninguna de las diez pasadas
  // completó el trabajo; la descripción y el mensaje de error no bastaron.
  schema: lineaInputSchema.partial().extend({
    lineas: lineasAAgregarSchema.optional(),
    versionEsperada: VERSION_ESPERADA,
    planId: PLAN_ID,
    origen: origenSchema,
  }),
  agentInputSchema: z.object({
    lineas: lineasAAgregarSchema,
    versionEsperada: VERSION_ESPERADA,
    planId: PLAN_ID,
    origen: origenSchema,
  }),
  outputSchema: z.object({
    /** La primera línea añadida; se conserva para quien ya leía `id`/`linea`. */
    id: z.string(),
    ids: z.array(z.string()),
    // La versión que deja esta escritura. Sin ella el agente no puede encadenar
    // dos cambios en un turno: medido con un modelo real, tras añadir la primera
    // línea reusaba la versión que ya había gastado, la segunda salía rechazada
    // y el framework retenía el reintento. `actualizar-linea` ya la devolvía.
    version: z.number(),
    linea: lineaOutputSchema,
    lineas: z.array(lineaOutputSchema),
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
    const entradas = lineasAAgregar(args);
    if (!entradas)
      fail(
        'Falta el contenido de las líneas: cada una necesita `tipo` ("farmaco" o "pendiente") y `texto`. Manda, por ejemplo, lineas: [{"tipo":"pendiente","texto":"Control de presión en 72 h"}].',
        { errorCode: "invalid_input" },
      );
    const orgId = ctx?.orgId ?? null;
    const origen = await origenAutorizado(args.origen, ctx);
    return getDb().transaction(async (tx) => {
      const plan = await planDe(args.planId, email, tx, true);
      exigirAbierto(plan);
      comprobarVersion(plan, args.versionEsperada, origen);
      comprobarAlcance(plan, origen, [], true);
      // El hueco se pide para TODAS de una vez: si no caben, no entra ninguna,
      // en vez de dejar el plan a medias y el recuento del recibo mintiendo.
      await exigirEspacio(plan.id, entradas.length, tx);
      const [ultima] = await tx
        .select({ orden: schema.lineasPlan.orden })
        .from(schema.lineasPlan)
        .where(eq(schema.lineasPlan.planId, plan.id))
        .orderBy(desc(schema.lineasPlan.orden))
        .limit(1);
      const t = ahora();
      let orden = (ultima?.orden ?? -1) + 1;
      const ids: string[] = [];
      for (const linea of entradas) {
        const id = crypto.randomUUID();
        ids.push(id);
        await tx.insert(schema.lineasPlan).values({
          id,
          planId: plan.id,
          tipo: linea.tipo,
          texto: linea.texto.trim(),
          dosis: linea.dosis.trim(),
          frecuencia: linea.frecuencia.trim(),
          duracion: linea.duracion.trim(),
          estado: origen === "medico" ? "editada" : "propuesta",
          verificacion: "pendiente",
          origen,
          justificacion: linea.justificacion || null,
          orden: orden++,
          ownerEmail: email,
          orgId,
          createdAt: t,
          updatedAt: t,
        });
        // Un asiento por línea: la bitácora que lee el médico no se resume.
        await registrarEvento(
          {
            planId: plan.id,
            lineaId: id,
            actor: origen,
            accion: "agregar",
            email,
            orgId,
            detalle: [
              `${linea.texto.trim()} ${linea.dosis.trim()} ${linea.frecuencia.trim()}`.trim(),
              linea.justificacion,
            ]
              .filter(Boolean)
              .join(" · "),
          },
          tx,
        );
      }
      // UNA verificación del plan ya completo. Verificar línea a línea no vería
      // la interacción entre dos fármacos añadidos en la misma llamada.
      if (entradas.some((l) => l.tipo === "farmaco"))
        await verificarPlan(plan.id, plan.pacienteId, tx);
      const cuantas = entradas.length;
      const version = await guardarVersion(
        plan.id,
        origen,
        "agregar",
        entradas[0]!.justificacion ||
          (cuantas === 1 ? entradas[0]!.texto : `${cuantas} líneas añadidas`),
        inicio,
        tx,
        ctx,
      );
      const todas = lineasOut(await lineasDe(plan.id, tx), plan);
      const nuevas = ids
        .map((id) => todas.find((l) => l.id === id))
        .filter((l): l is (typeof todas)[number] => l !== undefined);
      if (nuevas.length !== cuantas) throw new Error("Líneas no encontradas tras insertar.");
      const resumen = resumenVerificacion(todas);
      ctx?.signal?.throwIfAborted();
      const quedan = nuevas
        .map((l) => `${l.texto} (verificación ${l.verificacion})`)
        .join("; ");
      return {
        id: ids[0]!,
        ids,
        version,
        linea: nuevas[0]!,
        lineas: nuevas,
        resumen,
        message: `${cuantas === 1 ? "Añadida" : `Añadidas ${cuantas} líneas:`} ${quedan}. El plan queda en la versión ${version} con ${resumen.vigentes} línea(s) vigente(s), ${resumen.bloqueos} bloqueo(s) y ${resumen.advertencias} advertencia(s). Usa la versión ${version} como versionEsperada si vas a hacer otro cambio, y estas cifras si tienes que resumir.`,
      };
    });
  }),
});
