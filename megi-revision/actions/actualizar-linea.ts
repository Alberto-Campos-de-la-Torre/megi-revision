// guard:allow-resource-action-access — La autorización privada se aplica con requireEmail y planDe/lineaDe (owner_email) dentro de la transacción; no hay recursos compartidos.
import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { comprobarAlcance, comprobarVersion, guardarVersion } from "../server/lib/revision.js";
import { getDb, schema } from "../server/db/index.js";
import {
  ahora,
  exigirAbierto,
  limpiaControles,
  lineaOutputSchema,
  lineasDe,
  lineasOut,
  origenAutorizado,
  origenSchema,
  planDe,
  registrarEvento,
  reintentoSeguroPorVersion,
  requireEmail,
  resumenVerificacion,
  verificarPlan,
  versionEsperadaDelAgente,
  versionEsperadaSchema,
} from "../server/lib/plan.js";

const ESQUEMA = z.object({
    versionEsperada: versionEsperadaSchema,
    lineaId: z.string().describe("Id de la línea (de obtener-plan)"),
    texto: z.string().trim().min(1).optional().describe("Nuevo fármaco o texto"),
    dosis: z.string().optional(),
    frecuencia: z.string().optional(),
    duracion: z.string().optional(),
    estado: z
      .enum(["propuesta", "editada", "bloqueada", "rechazada"])
      .optional()
      .describe(
        '"bloqueada" congela la línea (solo médico); "rechazada" la saca del plan; "editada"/"propuesta" la reactivan o desbloquean',
      ),
    motivo: z
      .string()
      .default("")
      .describe("Por qué se cambia (obligatorio al rechazar)"),
    origen: origenSchema,
  });

export default defineAction({
  changeResource: (_input, result) => ({ resourceType: `plan:${result.linea.planId}`, resourceId: result.linea.planId }),
  // El framework exige sesión, mismo origen y capacidad UI para HTTP.
  needsApproval: (_args, ctx) => ctx?.caller === "http",
  description:
    "Cambia UNA línea del plan: edita texto/dosis/frecuencia/duración, o cambia su estado (bloquear, desbloquear, rechazar, reactivar). Una línea bloqueada es intocable: el agente recibe linea_bloqueada (409) y NO debe insistir; solo el médico la desbloquea desde la interfaz. Tras editar un fármaco se vuelve a verificar todo el plan.",
  schema: ESQUEMA,
  // Lo único que ve el modelo: la versión no es opcional ahí. Medido con Grok:
  // 1 de 15 escrituras llegó sin ella y se fue en un 409 evitable.
  agentInputSchema: ESQUEMA.extend({ versionEsperada: versionEsperadaDelAgente }),
  // Un reintento con la versión vigente no puede duplicar nada: si la primera
  // llamada entró, la versión ya cambió y este reintento se rechaza. Sin
  // versión, el freno del framework se queda.
  retrySafe: reintentoSeguroPorVersion,
  outputSchema: z.object({
    id: z.string(),
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
      const [referencia] = await tx
        .select()
        .from(schema.lineasPlan)
        .where(eq(schema.lineasPlan.id, args.lineaId))
        .limit(1);
      if (!referencia || referencia.ownerEmail !== email)
        fail("Línea no encontrada.", {
          errorCode: "not_found",
          statusCode: 404,
        });
      const plan = await planDe(referencia.planId, email, tx, true);
      exigirAbierto(plan);
      comprobarVersion(plan, args.versionEsperada, origen);
      // Otro cambio pudo terminar mientras esperábamos el bloqueo del plan.
      const [linea] = await tx
        .select()
        .from(schema.lineasPlan)
        .where(eq(schema.lineasPlan.id, args.lineaId))
        .limit(1);
      if (!linea)
        fail("Línea no encontrada.", {
          errorCode: "not_found",
          statusCode: 404,
        });

      comprobarAlcance(plan, origen, [linea.id]);
      const editaCampos = [
        args.texto,
        args.dosis,
        args.frecuencia,
        args.duracion,
      ].some((v) => v !== undefined);
      const cambiaEstado =
        args.estado !== undefined && args.estado !== linea.estado;
      if (!editaCampos && !cambiaEstado)
        fail("Nada que cambiar.", { errorCode: "invalid_input" });

      // Regla central: bloqueada = intocable. Solo el médico puede desbloquear, y
      // solo cambiando el estado (sin editar campos en la misma llamada).
      if (linea.estado === "bloqueada") {
        if (origen !== "medico") {
          fail(
            `La línea "${linea.texto}" está bloqueada por el médico; no la toques y díselo.`,
            {
              errorCode: "linea_bloqueada",
              statusCode: 409,
              details: { lineaId: linea.id },
            },
          );
        }
        if (editaCampos || !cambiaEstado) {
          fail("Desbloquea la línea antes de editarla.", {
            errorCode: "linea_bloqueada",
            statusCode: 409,
            details: { lineaId: linea.id },
          });
        }
      }
      if (origen !== "medico" && args.estado === "bloqueada") {
        fail("Solo el médico bloquea líneas.", {
          errorCode: "solo_medico",
          statusCode: 403,
        });
      }
      if (args.estado === "rechazada" && !args.motivo.trim()) {
        fail("Indica el motivo del rechazo.", { errorCode: "invalid_input" });
      }

      const set: Partial<typeof schema.lineasPlan.$inferInsert> = {
        updatedAt: ahora(),
      };
      if (args.texto !== undefined) set.texto = args.texto.trim();
      if (args.dosis !== undefined) set.dosis = args.dosis.trim();
      if (args.frecuencia !== undefined)
        set.frecuencia = args.frecuencia.trim();
      if (args.duracion !== undefined) set.duracion = args.duracion.trim();
      if (cambiaEstado) {
        set.estado = args.estado;
      } else if (editaCampos) {
        set.estado = "editada";
      }
      if (editaCampos) set.origen = origen;
      if (args.estado === "rechazada") set.justificacion = args.motivo.trim();
      if (editaCampos && linea.tipo === "farmaco") {
        set.verificacion = "pendiente";
        set.motivoVerificacion = null;
        set.alternativas = "[]";
      }
      await tx
        .update(schema.lineasPlan)
        .set(set)
        .where(eq(schema.lineasPlan.id, linea.id));

      const accion = cambiaEstado
        ? (
            {
              bloqueada: "bloquear",
              rechazada: "rechazar",
              propuesta: "reactivar",
              editada: linea.estado === "bloqueada" ? "desbloquear" : "editar",
            } as const
          )[args.estado!]
        : "editar";
      const cambios = editaCampos
        ? [
            args.texto !== undefined && `texto: ${linea.texto} → ${set.texto}`,
            args.dosis !== undefined &&
              `dosis: ${linea.dosis || "—"} → ${set.dosis}`,
            args.frecuencia !== undefined &&
              `frecuencia: ${linea.frecuencia || "—"} → ${set.frecuencia}`,
            args.duracion !== undefined &&
              `duración: ${linea.duracion || "—"} → ${set.duracion}`,
          ]
            .filter(Boolean)
            .join("; ")
        : "";
      await registrarEvento(
        {
          planId: plan.id,
          lineaId: linea.id,
          actor: origen,
          accion,
          email,
          orgId,
          detalle: [linea.texto, cambios, args.motivo.trim()]
            .filter(Boolean)
            .join(" · "),
        },
        tx,
      );
      // Rechazar o reactivar un fármaco también cambia las interacciones del resto.
      if (linea.tipo === "farmaco")
        await verificarPlan(plan.id, plan.pacienteId, tx);

      const version = await guardarVersion(plan.id, origen, accion, args.motivo || cambios || accion, inicio, tx, ctx);
      const [actualizada] = await tx
        .select()
        .from(schema.lineasPlan)
        .where(eq(schema.lineasPlan.id, linea.id))
        .limit(1);
      if (!actualizada)
        fail("Línea no encontrada tras actualizar.", {
          errorCode: "not_found",
          statusCode: 404,
        });
      const out = lineasOut([actualizada], plan)[0]!;
      const resumen = resumenVerificacion(lineasOut(await lineasDe(plan.id, tx), plan));
      ctx?.signal?.throwIfAborted();
      return {
        version,
        id: out.id,
        linea: out,
        resumen,
        message: `${accion}: ${out.texto} (${out.estado}, verificación ${out.verificacion}). El plan queda en la versión ${version} con ${resumen.vigentes} línea(s) vigente(s), ${resumen.bloqueos} bloqueo(s) y ${resumen.advertencias} advertencia(s).`,
      };
    });
  }),
});
