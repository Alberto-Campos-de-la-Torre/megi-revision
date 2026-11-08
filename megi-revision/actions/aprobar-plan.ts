// guard:allow-resource-action-access — La autorización privada se aplica con requireEmail y planDe/lineaDe (owner_email) dentro de la transacción; no hay recursos compartidos.
import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { medicacionParaVerificar, conciliacionDe, comprobarVersion, guardarVersion } from "../server/lib/revision.js";
import { getDb, schema } from "../server/db/index.js";
import { MegiError } from "../server/lib/megi/index.js";
import { conectarMegi,
  ahora,
  exigirAbierto,
  exigirMedico,
  lineaOut, lineasOut,
  lineasDe,
  origenAutorizado,
  origenSchema,
  planDe,
  planOut,
  planOutputSchema,
  registrarEvento,
  requireEmail,
  resumenVerificacion,
  verificarPlan,
  limpiaControles,
} from "../server/lib/plan.js";

export default defineAction({
  changeResource: input => ({ resourceType: `plan:${input.planId}`, resourceId: input.planId }),
  uiOnly: true,
  agentTool: false,
  description:
    "Aprobación final y exportación FHIR: solo el médico desde la interfaz autenticada. El agente debe pedirle que use Aprobar y exportar; las llamadas tool, MCP, CLI y HTTP directo reciben solo_medico (403). Vuelve a verificar y exige confirmar los bloqueos. Reintentar un plan ya exportado devuelve el mismo resultado sin volver a aprobar.",
  schema: z.object({
    versionEsperada: z.number().int().nonnegative().optional().describe("Versión leída antes de editar; relectura obligatoria tras conflicto"),
    planId: z.string().describe("Id del plan"),
    confirmaAlertas: z
      .boolean()
      .default(false)
      .describe(
        "Solo el médico: confirma explícitamente los bloqueos restantes",
      ),
    notas: z
      .string()
      .default("")
      .describe("Nota breve para la auditoría de MEGI"),
    origen: origenSchema,
  }),
  outputSchema: z.object({
    id: z.string(),
    plan: planOutputSchema,
    sello: z.string().nullable(),
    aprobadoPor: z.string().nullable(),
    message: z.string(),
  }),
  link: ({ result }) => ({
    url: buildDeepLink({
      view: "revision",
      to: `/revision/${encodeURIComponent(result.plan.consultaId)}`,
      params: { consultaId: result.plan.consultaId },
    }),
    label: "Ver plan exportado",
  }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    const inicio = performance.now();
    const email = requireEmail(ctx);
    limpiaControles(args); // sin caracteres de control antes de tocar la base
    await exigirMedico(ctx);
    const orgId = ctx?.orgId ?? null;
    const origen = await origenAutorizado(args.origen, ctx);
    return getDb().transaction(async (tx) => {
      const plan = await planDe(args.planId, email, tx, true);
      if (plan.estado === "exportado") {
        return {
          id: plan.id,
          plan: planOut(plan),
          sello: plan.sello,
          aprobadoPor: plan.aprobadoPor,
          message: "El plan ya está aprobado y exportado.",
        };
      }
      exigirAbierto(plan);
      comprobarVersion(plan, args.versionEsperada);
      const sinConfirmar = conciliacionDe(plan).filter(m => m.estado === "sin_confirmar");
      if (sinConfirmar.length) fail("Confirma la medicación histórica con el paciente antes de aprobar.", { errorCode: "medicacion_sin_conciliar", statusCode: 409 });
      const alertasVistas = (await lineasDe(plan.id, tx)).filter(l => l.estado !== "rechazada" && l.verificacion === "bloqueado").map(l => `${l.id}:${l.motivoVerificacion}`).sort();
      await verificarPlan(plan.id, plan.pacienteId, tx);
      const [vivo] = await tx.select().from(schema.planes).where(eq(schema.planes.id, plan.id));
      if (conciliacionDe(vivo!).some(m => m.estado === "sin_confirmar")) fail("Hay medicación nueva en MEGI. Vuelve a preparar la aprobación y concíliala.", { errorCode: "medicacion_sin_conciliar", statusCode: 409 });
      plan.conciliacion = vivo!.conciliacion;
      const lineas = lineasOut(await lineasDe(plan.id, tx), plan);
      const vigentes = lineas.filter((l) => l.estado !== "rechazada");
      if (!vigentes.length)
        fail("El plan no tiene líneas vigentes.", {
          errorCode: "invalid_input",
        });
      const bloqueos = vigentes.filter(
        (l) => l.tipo === "farmaco" && l.verificacion === "bloqueado",
      );
      // Las advertencias no frenan la aprobación, pero tienen que quedar
      // escritas: si no, no hay rastro de que existían al aprobar.
      const avisos = vigentes
        .filter((l) => l.tipo === "farmaco" && l.verificacion === "advertencia")
        .map((l) => `${l.texto}: ${l.motivoVerificacion ?? "sin motivo"}`);
      if (bloqueos.length && !args.confirmaAlertas) {
        fail(
          `Hay ${bloqueos.length} fármaco(s) con bloqueo de seguridad sin confirmar: ${bloqueos.map((b) => `${b.texto} (${b.motivoVerificacion ?? ""})`).join("; ")}. Cámbialos, recházalos o pide al médico que confirme.`,
          {
            errorCode: "alertas_sin_confirmar",
            statusCode: 409,
            details: { lineas: bloqueos.map((b) => b.id) },
          },
        );
      }

      if (args.confirmaAlertas && JSON.stringify(bloqueos.map(l => `${l.id}:${l.motivoVerificacion}`).sort()) !== JSON.stringify(alertasVistas)) fail("Las alertas cambiaron en MEGI. Vuelve a abrir la revisión de aprobación para leerlas y confirmarlas.", { errorCode: "alertas_actualizadas", statusCode: 409 });
      if (bloqueos.length && args.versionEsperada === undefined) fail("La confirmación debe indicar la versión revisada del plan.", { errorCode: "version_desactualizada", statusCode: 409 });
      const adapter = await conectarMegi(ctx?.userEmail ?? undefined);
      const consulta = await adapter.verConsulta(plan.consultaId);
      let exportacion;
      try {
        exportacion = await adapter.exportar(plan.consultaId, {
          medicacionConciliada: medicacionParaVerificar(plan),
          farmacos: vigentes
            .filter((l) => l.tipo === "farmaco")
            .map((l) => ({
              nombre: l.texto,
              dosis: l.dosis,
              frecuencia: l.frecuencia,
              duracion: l.duracion || undefined,
            })),
          pendientes: vigentes
            .filter((l) => l.tipo === "pendiente")
            .map((l) => l.texto),
          diagnosticos: consulta.diagnosticos,
          // La nota final refleja las líneas revisadas; no conserva tratamientos
          // rechazados o sustituidos dentro del texto original del SOAP.
          soap: {
            ...consulta.soap,
            p: [
              "Plan revisado por el médico.",
              ...vigentes
                .filter((l) => l.tipo === "farmaco")
                .map(
                  (l) =>
                    `${l.texto} ${l.dosis}, ${l.frecuencia}${l.duracion ? `, ${l.duracion}` : ""}.`,
                ),
            ].join(" "),
          },
          confirmaAlertas: args.confirmaAlertas,
          notas: [
            args.notas || "Plan revisado con el agente (MEGI Revisión)",
            // En modo http MEGI registra `approved_by` con la cuenta de
            // servicio; la identidad real de quien aprobó viaja en la nota y
            // queda en la auditoría de MEGI (H2).
            `Aprobado en MEGI Revisión por ${email}`,
            `Versión revisada: ${plan.version}. Medicación conciliada: ${conciliacionDe(plan).map(m => `${m.nombre} ${m.dosis}: ${m.estado}`).join("; ") || "sin registros históricos"}`,
            avisos.length ? `Advertencias vigentes: ${avisos.join(" | ")}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        });
      } catch (e) {
        if (e instanceof MegiError) {
          fail(`MEGI rechazó la aprobación: ${e.message}`, {
            errorCode: e.status === 409 ? "megi_rechazo" : "megi_no_disponible",
            statusCode: e.status === 409 ? 409 : 502,
          });
        }
        throw e;
      }
      const t = ahora();
      await tx
        .update(schema.planes)
        .set({
          estado: "exportado",
          sello: exportacion.sello ?? null,
          exportacion: exportacion.contenido,
          aprobadoPor: exportacion.aprobadaPor ?? null,
          updatedAt: t,
        })
        .where(eq(schema.planes.id, plan.id));
      await registrarEvento(
        {
          planId: plan.id,
          actor: origen,
          accion: "aprobar",
          email,
          orgId,
          detalle: `Exportado a MEGI (${exportacion.formato}) · sello ${exportacion.sello ?? "—"}${args.confirmaAlertas ? " · alertas confirmadas por el médico" : ""}${avisos.length ? ` · ${avisos.length} advertencia(s) vigentes: ${avisos.join(" | ")}` : ""}`,
        },
        tx,
      );
      await guardarVersion(plan.id, origen, "aprobar", args.notas || "Aprobación y exportación", inicio, tx, ctx);
      const [actualizado] = await tx
        .select()
        .from(schema.planes)
        .where(eq(schema.planes.id, plan.id))
        .limit(1);
      if (!actualizado) throw new Error("Plan no encontrado tras exportar.");
      const resumen = resumenVerificacion(lineas);
      return {
        id: plan.id,
        plan: planOut(actualizado),
        sello: exportacion.sello ?? null,
        aprobadoPor: exportacion.aprobadaPor ?? null,
        message: `Plan aprobado y exportado: ${resumen.vigentes} líneas, sello ${exportacion.sello ?? "—"}.`,
      };
    });
  }),
});
