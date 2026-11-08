import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { fallaDeMegi } from "../server/lib/megi/index.js";
import { conectarMegi, requireEmail } from "../server/lib/plan.js";

export default defineAction({
  description:
    "Lista las consultas consolidadas en MEGI que están pendientes de revisión (sin receta aprobada), con paciente, alergias y el plan de revisión si ya existe.",
  schema: z.object({
    estado: z.enum(["pendientes", "exportadas"]).default("pendientes"),
    limite: z.number().int().min(1).max(200).default(50).describe("Consultas por página (MEGI pagina en servidor)"),
    desde: z.number().int().min(0).default(0).describe("Desplazamiento de la página; usa `siguiente` de la respuesta anterior"),
  }),
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
    total: z.number().int().describe("Total de consultas en este estado"),
    siguiente: z.number().int().nullable().describe("Desplazamiento de la página siguiente, o null si no hay más"),
    megi: z.object({ disponible: z.boolean(), modo: z.string() }),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: () => ({ url: buildDeepLink({ view: "revision", to: "/revision" }), label: "Abrir Revisión" }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    const email = requireEmail(ctx);
    if (args.estado === "exportadas") {
      const planes = await getDb().select().from(schema.planes).where(eq(schema.planes.ownerEmail, email));
      const exportados = planes.filter(p => p.estado === "exportado").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const pagina = exportados.slice(args.desde, args.desde + args.limite);
      const sig = args.desde + pagina.length;
      return { consultas: pagina.map(p => ({ id: p.consultaId, fecha: p.updatedAt, motivo: p.motivo, paciente: { id: p.pacienteId, nombre: p.pacienteNombre, edad: 0, sexo: "", alergias: [], cronicos: [], medicacionActiva: [] }, planId: p.id, planEstado: "exportado" as const })), total: exportados.length, siguiente: sig < exportados.length ? sig : null, megi: { disponible: true, modo: "archivo local" } };
    }
    const adapter = await conectarMegi(ctx?.userEmail ?? undefined);
    const [estado, pagina, planes] = await Promise.all([
      adapter.estado(),
      // Si MEGI no está, la agenda responde con `megi_no_disponible` (502) en
      // lugar de un 500 opaco: la mesa puede decir qué pasa. Fase 2, bloque E.
      adapter.listarPendientes({ limite: args.limite, desde: args.desde }).catch((e) => fallaDeMegi(e, "La agenda")),
      getDb()
        .select({ id: schema.planes.id, consultaId: schema.planes.consultaId, estado: schema.planes.estado })
        .from(schema.planes)
        .where(eq(schema.planes.ownerEmail, email))
        .limit(500),
    ]);
    const porConsulta = new Map(planes.map((p) => [p.consultaId, p]));
    // Una consulta exportada localmente pero aún «pendiente» en MEGI (descarga
    // interrumpida) no se lista como pendiente; el total lo descuenta.
    const visibles = pagina.consultas.filter(c => porConsulta.get(c.id)?.estado !== "exportado");
    return {
      total: Math.max(0, pagina.total - (pagina.consultas.length - visibles.length)),
      siguiente: pagina.siguiente,
      consultas: visibles.map((c) => ({
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
  }),
});
