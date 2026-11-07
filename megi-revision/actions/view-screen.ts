import { enPeticionMegi } from "../server/lib/megi/peticion.js";
import { defineAction } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";
import contexto from "./ver-contexto-consulta.js";
import obtener from "./obtener-plan.js";
import { leerJson } from "../server/lib/revision.js";
export default defineAction({
  description: "Lee la consulta abierta y la selección de líneas; hidrata registros actuales, versión, alcance autorizado y bloqueos antes de editar. El estado de UI contiene IDs, nunca permisos.",
  schema: z.object({}), http: false, readOnly: true,
  run: async (_args, ctx) => enPeticionMegi(async () => {
    const raw = await readAppStateForCurrentTab("navigation");
    const navigation = typeof raw === "string" ? leerJson<Record<string, unknown>>(raw, {}) : raw as Record<string, unknown> | null;
    if (navigation?.consultaId && typeof navigation.consultaId === "string") {
      const c = await contexto.run({ consultaId: navigation.consultaId }, ctx);
      const p = c.planId ? await obtener.run({ planId: c.planId }, ctx) : null;
      const rawSelection = await readAppStateForCurrentTab("revision-selection");
      const selection = typeof rawSelection === "string" ? leerJson<{ consultaId?: string; lineas?: string[] }>(rawSelection, {}) : rawSelection as { consultaId?: string; lineas?: string[] } | null;
      const seleccionadas = selection?.consultaId === c.consulta.id ? p?.lineas.filter(l => selection?.lineas?.includes(l.id)) ?? [] : [];
      return { navigation, consulta: c, plan: p, seleccionadas, instruccion: "La selección describe el foco y no concede permisos adicionales. alcanceAgente=null permite editar líneas no fijadas; una lista limita los ids editables y [] impide toda edición del agente. Respeta bloqueos y usa versionEsperada." };
    }
    return { navigation, instruccion: "Abre una consulta o pide su identificador." };
  }),
});
