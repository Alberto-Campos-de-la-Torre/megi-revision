// guard:allow-resource-action-access — La autorización privada se aplica con requireEmail y planDe/lineaDe (owner_email) dentro de la transacción; no hay recursos compartidos.
import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import type { Verificacion } from "../server/lib/megi/types.js";
import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { conectarMegi, exigirAbierto, limpiaControles, lineaInputSchema, reintentoSeguroPorVersion, lineasDe, origenAutorizado, planDe, registrarEvento, requireEmail } from "../server/lib/plan.js";
import { comprobarVersion, guardarVersion, leerJson, fusionarConciliacion, medicacionParaVerificar } from "../server/lib/revision.js";
import { pautaOriginal, sugerenciaSchema, type Sugerencia } from "../server/lib/sugerencias.js";
export default defineAction({
  description: "Propone una alternativa para una línea autorizada en alcanceSugerencias. Guarda una sugerencia revisable sin tocar la receta, aunque la línea esté fijada o rechazada. Solo el médico puede aceptarla; una fijada debe desbloquearse primero.",
  needsApproval: (_args, ctx) => ctx?.caller === "http",
  // Un reintento con la versión vigente no puede duplicar nada: si la primera
  // llamada entró, la versión ya cambió y este reintento se rechaza. Sin
  // versión, el freno del framework se queda.
  retrySafe: reintentoSeguroPorVersion,
  schema: lineaInputSchema.extend({ planId: z.string(), lineaId: z.string(), versionEsperada: z.number().int() }),
  outputSchema: z.object({ planId: z.string(), version: z.number(), sugerencia: sugerenciaSchema }),
  changeResource: input => ({ resourceType: `plan:${input.planId}`, resourceId: input.planId }),
  run: async (args, ctx) => enPeticionMegi(async () => {
    const inicio = performance.now(); const email = requireEmail(ctx); limpiaControles(args); const actor = await origenAutorizado("agente", ctx);
    return getDb().transaction(async tx => {
      const p = await planDe(args.planId, email, tx, true); exigirAbierto(p); comprobarVersion(p, args.versionEsperada, actor);
      if (!leerJson<string[]>(p.alcanceSugerencias, []).includes(args.lineaId)) fail("Esta línea no está autorizada para sugerencias.", { errorCode: "fuera_de_alcance", statusCode: 403 });
      const actuales = await lineasDe(p.id, tx);
      const l = actuales.find(l => l.id === args.lineaId);
      if (!l || l.tipo !== "farmaco") fail("Fármaco de origen no encontrado.", { errorCode: "not_found", statusCode: 404 });
      const anteriores = leerJson<Sugerencia[]>(p.sugerencias, []);
      if (anteriores.length >= 100) fail("Revisa las sugerencias existentes antes de añadir otras.", { errorCode: "demasiadas_sugerencias", statusCode: 409 });
      const adapter = await conectarMegi(email);
      let v: Verificacion | undefined;
      try {
        const vivo = await adapter.verPaciente(p.pacienteId);
        const fusionada = fusionarConciliacion(p, vivo);
        await tx.update(schema.planes).set({ conciliacion: JSON.stringify(fusionada), conciliacionConfirmada: !fusionada.some(m => m.estado === "sin_confirmar") && p.conciliacionConfirmada }).where(eq(schema.planes.id, p.id));
        const receta = actuales.filter(x => x.id !== l.id && x.tipo === "farmaco" && x.estado !== "rechazada").map(x => ({ nombre: x.texto, dosis: x.dosis, frecuencia: x.frecuencia, duracion: x.duracion }));
        receta.push({ nombre: args.texto, dosis: args.dosis, frecuencia: args.frecuencia, duracion: args.duracion });
        v = (await adapter.verificarReceta(p.pacienteId, receta, medicacionParaVerificar(p, vivo), vivo))[args.texto];
        if (v && v.resultado !== "bloqueado" && receta.slice(0, -1).some(x => x.nombre.trim().toLowerCase() === args.texto.trim().toLowerCase())) {
          v = { ...v, resultado: "advertencia", motivo: [v.motivo, "La alternativa duplicaría un fármaco vigente del plan; revisa la pauta completa."].filter(Boolean).join(" · ") };
        }
      } catch { fail("MEGI no está disponible para verificar la alternativa.", { errorCode: "megi_no_disponible", statusCode: 502 }); }
      if (!v) fail("MEGI no verificó la alternativa.", { errorCode: "verificacion_incompleta", statusCode: 502 });
      const sugerencia: Sugerencia = { id: crypto.randomUUID(), lineaId: l.id, versionBase: p.version, pautaOriginal: pautaOriginal(l), texto: args.texto, dosis: args.dosis, frecuencia: args.frecuencia, duracion: args.duracion, motivo: args.justificacion, estado: "pendiente", creada: new Date().toISOString(), verificacion: v.resultado, motivoVerificacion: v.motivo ?? null };
      await tx.update(schema.planes).set({ sugerencias: JSON.stringify([...anteriores, sugerencia]), explicacion: `Alternativa pendiente de revisión: ${args.texto}. ${args.justificacion}` }).where(eq(schema.planes.id, p.id));
      await registrarEvento({ planId: p.id, lineaId: l.id, actor, accion: "sugerir", detalle: `${args.texto}: ${args.justificacion}. La receta permanece intacta.`, email, orgId: p.orgId }, tx);
      const version = await guardarVersion(p.id, actor, "sugerir", args.justificacion, inicio, tx, ctx); ctx?.signal?.throwIfAborted();
      return { planId: p.id, version, sugerencia };
    });
  }),
});
