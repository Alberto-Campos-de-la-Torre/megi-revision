import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { fallaDeMegi } from "../server/lib/megi/index.js";
import { candidatosDe, conciliadoSchema } from "../server/lib/revision.js";
import { conectarMegi, requireEmail } from "../server/lib/plan.js";

export default defineAction({
  description:
    "Todo lo que hay que leer ANTES de proponer un plan: nota SOAP consolidada, diagnósticos, fármacos y pendientes que menciona la nota, y la ficha del paciente (alergias, crónicos, medicación activa). Devuelve también el planId si ya hay plan.",
  schema: z.object({
    consultaId: z.string().describe("Id de la consulta, de listar-consultas (p. ej. demo-c3)"),
  }),
  outputSchema: z.object({
    consulta: z.object({
      id: z.string(), fecha: z.string(), motivo: z.string(), estado: z.string(),
      soap: z.object({ s: z.string(), o: z.string(), a: z.string(), p: z.string() }),
      diagnosticos: z.array(z.object({ cie10: z.string().optional(), texto: z.string() })),
      medicamentosPropuestos: z.array(z.string()),
      pendientes: z.array(z.string()),
      transcripcion: z.string(),
    }),
    paciente: z.object({
      id: z.string(), nombre: z.string(), edad: z.number(), sexo: z.string(),
      alergias: z.array(z.string()),
      alergiasRegistradas: z.boolean(),
      cronicos: z.array(z.string()),
      historialMedicacion: z.array(conciliadoSchema),
      medicacionActiva: z.array(z.object({ nombre: z.string(), dosis: z.string(), frecuencia: z.string(), duracion: z.string().optional() })),
    }),
    planId: z.string().nullable(),
    aviso: z.string(),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: ({ args }) => ({
    url: buildDeepLink({ view: "revision", to: `/revision/${encodeURIComponent(args.consultaId)}`, params: { consultaId: args.consultaId } }),
    label: "Abrir consulta",
  }),
  run: async ({ consultaId }, ctx) => enPeticionMegi(async () => {
    const email = requireEmail(ctx);
    const adapter = await conectarMegi(ctx?.userEmail ?? undefined);
    let consulta;
    try {
      consulta = await adapter.verConsulta(consultaId);
    } catch (e) {
      fallaDeMegi(e, "La consulta");
    }
    const paciente = await adapter
      .verPaciente(consulta.pacienteId)
      .catch((e) => fallaDeMegi(e, "El paciente"));
    // `consulta.id` es el id lógico con el que se guarda el plan; el argumento
    // puede venir con el id real de MEGI.
    const [plan] = await getDb()
      .select({ id: schema.planes.id })
      .from(schema.planes)
      .where(and(eq(schema.planes.consultaId, consulta.id), eq(schema.planes.ownerEmail, email)))
      .limit(1);
    return {
      consulta: {
        id: consulta.id, fecha: consulta.fecha, motivo: consulta.motivo, estado: consulta.estado, soap: consulta.soap,
        diagnosticos: consulta.diagnosticos, medicamentosPropuestos: consulta.medicamentosPropuestos,
        pendientes: consulta.pendientes, transcripcion: consulta.transcripcion ?? "",
      },
      paciente: {
        id: paciente.id, nombre: paciente.nombre, edad: paciente.edad, sexo: paciente.sexo,
        alergias: paciente.alergias,
        alergiasRegistradas: paciente.alergias.length > 0,
        cronicos: paciente.cronicos,
        historialMedicacion: candidatosDe(paciente),
        medicacionActiva: paciente.medicacionActiva.map((m) => ({ nombre: m.nombre, dosis: m.dosis, frecuencia: m.frecuencia, duracion: m.duracion })),
      },
      planId: plan?.id ?? null,
      aviso: paciente.alergias.length
        ? "Alergias tomadas del expediente."
        : "SIN REGISTRO de alergias: no asumas que no tiene; dilo y pide confirmación al médico.",
    };
  }),
});
