import { defineMachine } from "@agent-native/core/state-machine";
import { z } from "zod";
import type { LineaRow } from "../db/schema.js";
export const sugerenciaSchema = z.object({
  id: z.string(), lineaId: z.string(), versionBase: z.number(), pautaOriginal: z.string(),
  texto: z.string(), dosis: z.string(), frecuencia: z.string(), duracion: z.string(), motivo: z.string(),
  estado: z.enum(["pendiente", "aceptada", "descartada"]), creada: z.string(),
  verificacion: z.enum(["ok", "advertencia", "bloqueado"]), motivoVerificacion: z.string().nullable(),
});
export type Sugerencia = z.infer<typeof sugerenciaSchema>;
export const pautaOriginal = (l: Pick<LineaRow, "texto" | "dosis" | "frecuencia" | "duracion">) => JSON.stringify([l.texto, l.dosis, l.frecuencia, l.duracion]);

export const cicloSugerencia = defineMachine({ id: "sugerencia-clinica", states: ["pendiente", "aceptada", "descartada"], initial: "pendiente", terminal: ["aceptada", "descartada"], transitions: { aceptar: { from: ["pendiente"], to: "aceptada" }, descartar: { from: ["pendiente"], to: "descartada" } } });
