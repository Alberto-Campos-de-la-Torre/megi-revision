import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { megi } from "../server/lib/megi/index.js";
import { requireEmail } from "../server/lib/plan.js";

export default defineAction({
  description:
    "Lista las consultas consolidadas en MEGI que están pendientes de revisión (sin receta aprobada), con paciente, alergias y el plan de revisión si ya existe.",
  schema: z.object({}),
  outputSchema: z.object({
    consultas: z.array(
      z.object({
        id: z.string(),
        fecha: z.string(),
        motivo: z.string(),
        paciente: z.object({
          id: z.string(), nombre: z.string(), edad: z.number(), sexo: z.string(),
          alergias: z.array(z.string()), cronicos: z.array(z.string()),
          medicacionActiva: z.array(z.string()),
        }),
        planId: z.string().nullable(),
        planEstado: z.enum(["borrador", "exportado"]).nullable(),
      }),
    ),
    megi: z.object({ disponible: z.boolean(), modo: z.string() }),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: () => ({ url: buildDeepLink({ view: "revision", to: "/revision" }), label: "Abrir Revisión" }),
  run: async (_args, ctx) => {
    const email = requireEmail(ctx);
    const adapter = await megi();
    const [estado, consultas, planes] = await Promise.all([
      adapter.estado(),
      adapter.listarConsultasCerradas(),
      getDb()
        .select({ id: schema.planes.id, consultaId: schema.planes.consultaId, estado: schema.planes.estado })
        .from(schema.planes)
        .where(eq(schema.planes.ownerEmail, email))
        .limit(500),
    ]);
    const porConsulta = new Map(planes.map((p) => [p.consultaId, p]));
    return {
      consultas: consultas.map((c) => ({
        id: c.id,
        fecha: c.fecha,
        motivo: c.motivo,
        paciente: {
          id: c.paciente.id, nombre: c.paciente.nombre, edad: c.paciente.edad, sexo: c.paciente.sexo,
          alergias: c.paciente.alergias, cronicos: c.paciente.cronicos,
          medicacionActiva: c.paciente.medicacionActiva.map((m) => `${m.nombre} ${m.dosis} ${m.frecuencia}`.trim()),
        },
        planId: porConsulta.get(c.id)?.id ?? null,
        planEstado: porConsulta.get(c.id)?.estado ?? null,
      })),
      megi: { disponible: estado.disponible, modo: estado.modo },
    };
  },
});
