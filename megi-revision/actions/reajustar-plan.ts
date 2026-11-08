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
  exigirEspacio,
  lineaOut, lineasOut,
  lineaOutputSchema,
  lineasDe,
  origenAutorizado,
  origenSchema,
  planDe,
  registrarEvento,
  requireEmail,
  resumenVerificacion,
  verificarPlan,
  limpiaControles,
} from "../server/lib/plan.js";

const cambioSchema = z.object({
  accion: z
    .enum(["reemplazar", "quitar", "editar", "agregar"])
    .describe(
      '"reemplazar": rechaza lineaId y añade la nueva línea en su lugar · "quitar": rechaza lineaId · "editar": cambia campos de lineaId · "agregar": nueva línea',
    ),
  lineaId: z
    .string()
    .optional()
    .describe("Línea afectada (todas menos agregar)"),
  tipo: z
    .enum(["farmaco", "pendiente"])
    .optional()
    .describe(
      "Para agregar/reemplazar; por defecto el tipo de la línea reemplazada o farmaco",
    ),
  texto: z.string().trim().min(1).optional().describe("Nuevo fármaco o texto"),
  dosis: z.string().optional(),
  frecuencia: z.string().optional(),
  duracion: z.string().optional(),
  motivo: z
    .string()
    .min(1)
    .describe("Una frase: por qué este cambio (se muestra al médico)"),
});

export default defineAction({
  changeResource: input => ({ resourceType: `plan:${input.planId}`, resourceId: input.planId }),
  // El framework exige sesión, mismo origen y capacidad UI para HTTP.
  needsApproval: (_args, ctx) => ctx?.caller === "http",
  description:
    "Aplica VARIOS cambios al plan en una sola transacción y vuelve a verificar: reemplazar, quitar, editar o agregar líneas, cada uno con su motivo. Respeta lo bloqueado: si algún cambio toca una línea bloqueada por el médico, NO se aplica nada y responde linea_bloqueada (409) con los ids; explícaselo al médico en vez de reintentar. Las líneas rechazadas tampoco se tocan (reactívalas con actualizar-linea).",
  schema: z.object({
    versionEsperada: z.number().int().nonnegative().optional().describe("Versión leída antes de editar; relectura obligatoria tras conflicto"),
    planId: z.string().describe("Id del plan"),
    cambios: z
      .array(cambioSchema)
      .min(1)
      .max(30)
      .describe("Todos los cambios de este reajuste"),
    explicacion: z
      .string()
      .min(1)
      .describe("Resumen de dos o tres frases de lo que cambiaste y por qué"),
    origen: origenSchema,
  }),
  outputSchema: z.object({
    id: z.string(),
    aplicados: z.number(),
    lineas: z.array(lineaOutputSchema),
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
      comprobarAlcance(plan, origen, args.cambios.flatMap(c => c.lineaId ? [c.lineaId] : []), args.cambios.some(c => c.accion === "agregar"));
      const actuales = await lineasDe(plan.id, tx);
      const porId = new Map(actuales.map((l) => [l.id, l]));

      // Validación completa ANTES de escribir: todo o nada.
      const bloqueadas: string[] = [];
      const afectadas = new Set<string>();
      for (const c of args.cambios) {
        if (c.accion !== "agregar") {
          if (!c.lineaId)
            fail(`El cambio "${c.accion}" necesita lineaId.`, {
              errorCode: "invalid_input",
            });
          if (afectadas.has(c.lineaId))
            fail("Una línea solo puede aparecer una vez por reajuste.", {
              errorCode: "invalid_input",
            });
          afectadas.add(c.lineaId);
          const l = porId.get(c.lineaId);
          if (!l)
            fail(`Línea ${c.lineaId} no existe en este plan.`, {
              errorCode: "not_found",
              statusCode: 404,
            });
          if (l.estado === "bloqueada") bloqueadas.push(l.id);
          if (l.estado === "rechazada")
            fail(
              `La línea "${l.texto}" ya está rechazada; reactívala con actualizar-linea si hace falta.`,
              { errorCode: "invalid_input", details: { lineaId: l.id } },
            );
        }
        if (
          (c.accion === "agregar" || c.accion === "reemplazar") &&
          !c.texto?.trim()
        ) {
          fail(`El cambio "${c.accion}" necesita texto.`, {
            errorCode: "invalid_input",
          });
        }
        if (
          c.accion === "editar" &&
          [c.texto, c.dosis, c.frecuencia, c.duracion].every(
            (v) => v === undefined,
          )
        ) {
          fail('El cambio "editar" no trae ningún campo.', {
            errorCode: "invalid_input",
          });
        }
      }
      await exigirEspacio(
        plan.id,
        args.cambios.filter(
          (c) => c.accion === "agregar" || c.accion === "reemplazar",
        ).length,
        tx,
      );
      if (bloqueadas.length) {
        const nombres = bloqueadas.map((id) => porId.get(id)!.texto).join(", ");
        fail(
          `No se aplicó nada: el reajuste toca líneas bloqueadas por el médico (${nombres}). Propón otra cosa o pídele que las desbloquee.`,
          {
            errorCode: "linea_bloqueada",
            statusCode: 409,
            details: { lineasBloqueadas: bloqueadas },
          },
        );
      }

      const t = ahora();
      let siguienteOrden =
        actuales.reduce((m, l) => Math.max(m, l.orden), -1) + 1;
      const eventos: Array<{
        lineaId: string | null;
        accion: string;
        detalle: string;
      }> = [];

      for (const c of args.cambios) {
        const l = c.lineaId ? porId.get(c.lineaId)! : null;
        if (c.accion === "quitar" || c.accion === "reemplazar") {
          await tx
            .update(schema.lineasPlan)
            .set({ estado: "rechazada", justificacion: c.motivo, updatedAt: t })
            .where(eq(schema.lineasPlan.id, l!.id));
          eventos.push({
            lineaId: l!.id,
            accion: "quitar",
            detalle: `${l!.texto} · ${c.motivo}`,
          });
        }
        if (c.accion === "agregar" || c.accion === "reemplazar") {
          const id = crypto.randomUUID();
          const tipo = c.tipo ?? l?.tipo ?? "farmaco";
          await tx.insert(schema.lineasPlan).values({
            id,
            planId: plan.id,
            tipo,
            texto: c.texto!.trim(),
            dosis: (c.dosis ?? "").trim(),
            frecuencia: (c.frecuencia ?? "").trim(),
            duracion: (c.duracion ?? "").trim(),
            estado: "propuesta",
            verificacion: "pendiente",
            origen,
            justificacion: c.motivo,
            orden: c.accion === "reemplazar" ? l!.orden : siguienteOrden++,
            ownerEmail: email,
            orgId,
            createdAt: t,
            updatedAt: t,
          });
          if (plan.alcanceAgente && c.accion === "reemplazar") {
            const ids: string[] = JSON.parse(plan.alcanceAgente);
            plan.alcanceAgente = JSON.stringify([...ids.filter(x => x !== l!.id), id]);
            await tx.update(schema.planes).set({ alcanceAgente: plan.alcanceAgente }).where(eq(schema.planes.id, plan.id));
          }
          eventos.push({
            lineaId: id,
            accion: c.accion === "reemplazar" ? "reemplazar" : "agregar",
            detalle:
              `${c.accion === "reemplazar" ? `${l!.texto} → ` : ""}${c.texto!.trim()} ${(c.dosis ?? "").trim()} ${(c.frecuencia ?? "").trim()}`.trim() +
              ` · ${c.motivo}`,
          });
        }
        if (c.accion === "editar") {
          const set: Partial<typeof schema.lineasPlan.$inferInsert> = {
            estado: "editada",
            origen,
            updatedAt: t,
          };
          if (c.texto !== undefined) set.texto = c.texto.trim();
          if (c.dosis !== undefined) set.dosis = c.dosis.trim();
          if (c.frecuencia !== undefined) set.frecuencia = c.frecuencia.trim();
          if (c.duracion !== undefined) set.duracion = c.duracion.trim();
          if (l!.tipo === "farmaco") {
            set.verificacion = "pendiente";
            set.motivoVerificacion = null;
            set.alternativas = "[]";
          }
          await tx
            .update(schema.lineasPlan)
            .set(set)
            .where(eq(schema.lineasPlan.id, l!.id));
          eventos.push({
            lineaId: l!.id,
            accion: "editar",
            detalle: `${l!.texto} · ${c.motivo}`,
          });
        }
      }
      await tx
        .update(schema.planes)
        .set({ explicacion: args.explicacion, updatedAt: t })
        .where(eq(schema.planes.id, plan.id));

      await registrarEvento(
        {
          planId: plan.id,
          actor: origen,
          accion: "reajustar",
          detalle: args.explicacion,
          email,
          orgId,
        },
        tx,
      );
      for (const e of eventos)
        await registrarEvento(
          {
            planId: plan.id,
            lineaId: e.lineaId,
            actor: origen,
            accion: e.accion,
            detalle: e.detalle,
            email,
            orgId,
          },
          tx,
        );
      await verificarPlan(plan.id, plan.pacienteId, tx);

      await guardarVersion(plan.id, origen, "reajustar", args.explicacion, inicio, tx, ctx);
      const lineas = lineasOut(await lineasDe(plan.id, tx), plan);
      const resumen = resumenVerificacion(lineas);
      ctx?.signal?.throwIfAborted();
      return {
        id: plan.id,
        aplicados: args.cambios.length,
        lineas,
        resumen,
        message: `Reajuste aplicado (${args.cambios.length} cambios). Ahora: ${resumen.bloqueos} bloqueo(s), ${resumen.advertencias} advertencia(s), ${resumen.bloqueadas} línea(s) bloqueada(s) intactas.`,
      };
    });
  }),
});
