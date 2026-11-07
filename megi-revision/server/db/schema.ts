/**
 * Modelo propio de MEGI Revisión. Lo clínico (expediente, SOAP, verificación)
 * vive en MEGI y se consume por el adaptador; aquí vive la MESA DE REVISIÓN:
 * el plan en curso, sus líneas con estado y bloqueo, y la bitácora de cambios.
 */
import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";

export const PLAN_ESTADOS = ["borrador", "exportado"] as const;
export const LINEA_TIPOS = ["farmaco", "pendiente"] as const;
export const LINEA_ESTADOS = ["propuesta", "editada", "bloqueada", "rechazada"] as const;
export const VERIFICACIONES = ["pendiente", "ok", "advertencia", "bloqueado"] as const;
export const ORIGENES = ["agente", "medico"] as const;

export const planes = pgTable("planes", {
  id: text("id").primaryKey(),
  consultaId: text("consulta_id").notNull(),
  pacienteId: text("paciente_id").notNull(),
  pacienteNombre: text("paciente_nombre").notNull().default(""),
  motivo: text("motivo").notNull().default(""),
  estado: text("estado", { enum: PLAN_ESTADOS }).notNull().default("borrador"),
  /** Última explicación del agente al proponer o reajustar. */
  explicacion: text("explicacion"),
  sello: text("sello"),
  exportacion: text("exportacion"),
  aprobadoPor: text("aprobado_por"),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at").notNull().default(sql`now()`),
  version: integer("version").notNull().default(0),
  contextoFuente: text("contexto_fuente"),
  alcanceAgente: text("alcance_agente"),
  conciliacion: text("conciliacion"),
  conciliacionConfirmada: boolean("conciliacion_confirmada").notNull().default(false),
  alcanceSugerencias: text("alcance_sugerencias").notNull().default("[]"),
  sugerencias: text("sugerencias").notNull().default("[]"),
});

export const lineasPlan = pgTable("lineas_plan", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  tipo: text("tipo", { enum: LINEA_TIPOS }).notNull(),
  texto: text("texto").notNull(),
  dosis: text("dosis").notNull().default(""),
  frecuencia: text("frecuencia").notNull().default(""),
  duracion: text("duracion").notNull().default(""),
  estado: text("estado", { enum: LINEA_ESTADOS }).notNull().default("propuesta"),
  verificacion: text("verificacion", { enum: VERIFICACIONES }).notNull().default("pendiente"),
  motivoVerificacion: text("motivo_verificacion"),
  /** JSON string[] de reemplazos sugeridos cuando hay bloqueo. */
  alternativas: text("alternativas").notNull().default("[]"),
  origen: text("origen", { enum: ORIGENES }).notNull().default("agente"),
  /** Por qué el agente la propuso, o por qué el médico la rechazó. */
  justificacion: text("justificacion"),
  orden: integer("orden").notNull().default(0),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at").notNull().default(sql`now()`),
});

export const eventosRevision = pgTable("eventos_revision", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  lineaId: text("linea_id"),
  actor: text("actor", { enum: ORIGENES }).notNull(),
  accion: text("accion").notNull(),
  detalle: text("detalle").notNull().default(""),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  createdAt: text("created_at").notNull().default(sql`now()`),
});

export type PlanRow = typeof planes.$inferSelect;
export type LineaRow = typeof lineasPlan.$inferSelect;
export type EventoRow = typeof eventosRevision.$inferSelect;

/** Instantáneas del dominio, capturadas en la misma transacción que el cambio. */
export const versionesPlan = pgTable("versiones_plan", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  version: integer("version").notNull(),
  actor: text("actor", { enum: ORIGENES }).notNull(),
  accion: text("accion").notNull(),
  motivo: text("motivo").notNull().default(""),
  snapshot: text("snapshot").notNull(),
  operacionMs: integer("operacion_ms").notNull().default(0),
  agenteRunId: text("agente_run_id"),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  createdAt: text("created_at").notNull(),
});

export const medicionesRevision = pgTable("mediciones_revision", {
  id: text("id").primaryKey(),
  planId: text("plan_id"),
  consultaId: text("consulta_id").notNull(),
  modalidad: text("modalidad", { enum: ["manual", "agente"] }).notNull(),
  inicio: text("inicio").notNull(),
  fin: text("fin"),
  planVisibleMs: integer("plan_visible_ms"),
  resultado: text("resultado", { enum: ["finalizada", "interrumpida"] }),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});
