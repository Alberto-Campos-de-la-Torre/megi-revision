import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "mesa-de-revision",
      sql: `CREATE TABLE IF NOT EXISTS planes (
  id TEXT PRIMARY KEY,
  consulta_id TEXT NOT NULL,
  paciente_id TEXT NOT NULL,
  paciente_nombre TEXT NOT NULL DEFAULT '',
  motivo TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'exportado')),
  explicacion TEXT,
  sello TEXT,
  exportacion TEXT,
  aprobado_por TEXT,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now()),
  updated_at TEXT NOT NULL DEFAULT (now()),
  UNIQUE (consulta_id, owner_email)
);
CREATE TABLE IF NOT EXISTS lineas_plan (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES planes(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('farmaco', 'pendiente')),
  texto TEXT NOT NULL,
  dosis TEXT NOT NULL DEFAULT '',
  frecuencia TEXT NOT NULL DEFAULT '',
  duracion TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta', 'editada', 'bloqueada', 'rechazada')),
  verificacion TEXT NOT NULL DEFAULT 'pendiente' CHECK (verificacion IN ('pendiente', 'ok', 'advertencia', 'bloqueado')),
  motivo_verificacion TEXT,
  alternativas TEXT NOT NULL DEFAULT '[]',
  origen TEXT NOT NULL DEFAULT 'agente' CHECK (origen IN ('agente', 'medico')),
  justificacion TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now()),
  updated_at TEXT NOT NULL DEFAULT (now())
);
CREATE TABLE IF NOT EXISTS eventos_revision (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES planes(id),
  linea_id TEXT,
  actor TEXT NOT NULL CHECK (actor IN ('agente', 'medico')),
  accion TEXT NOT NULL,
  detalle TEXT NOT NULL DEFAULT '',
  owner_email TEXT NOT NULL,
  org_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now())
);
CREATE INDEX IF NOT EXISTS planes_owner_consulta_idx ON planes (owner_email, consulta_id);
CREATE INDEX IF NOT EXISTS lineas_plan_plan_orden_idx ON lineas_plan (plan_id, orden);
CREATE INDEX IF NOT EXISTS eventos_revision_plan_created_idx ON eventos_revision (plan_id, created_at)`,
    },
  ],
  { table: "megi_revision_migrations" },
);
