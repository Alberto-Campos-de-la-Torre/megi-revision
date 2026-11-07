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
    {
      version: 2,
      name: "revision-trazable-y-conciliacion",
      sql: `ALTER TABLE planes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planes ADD COLUMN IF NOT EXISTS contexto_fuente TEXT;
ALTER TABLE planes ADD COLUMN IF NOT EXISTS alcance_agente TEXT;
ALTER TABLE planes ADD COLUMN IF NOT EXISTS conciliacion TEXT;
CREATE TABLE IF NOT EXISTS versiones_plan (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES planes(id), version INTEGER NOT NULL,
 actor TEXT NOT NULL, accion TEXT NOT NULL, motivo TEXT NOT NULL DEFAULT '', snapshot TEXT NOT NULL,
 operacion_ms INTEGER NOT NULL DEFAULT 0, owner_email TEXT NOT NULL, org_id TEXT, created_at TEXT NOT NULL,
 UNIQUE(plan_id, version)
);
CREATE INDEX IF NOT EXISTS versiones_plan_owner_idx ON versiones_plan(owner_email, plan_id, version DESC);
CREATE TABLE IF NOT EXISTS mediciones_revision (
 id TEXT PRIMARY KEY, plan_id TEXT REFERENCES planes(id), consulta_id TEXT NOT NULL, modalidad TEXT NOT NULL,
 inicio TEXT NOT NULL, fin TEXT, plan_visible_ms INTEGER, owner_email TEXT NOT NULL, org_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS medicion_abierta_idx ON mediciones_revision(owner_email, consulta_id) WHERE fin IS NULL;`,
    },
    {
      version: 3,
      name: "resultado-de-mediciones-exploratorias",
      sql: `ALTER TABLE mediciones_revision ADD COLUMN IF NOT EXISTS resultado TEXT;`,
    },
    {
      version: 4,
      name: "medicacion-viva-y-sugerencias-supervisadas",
      sql: `ALTER TABLE planes ADD COLUMN IF NOT EXISTS conciliacion_confirmada BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE planes ADD COLUMN IF NOT EXISTS alcance_sugerencias TEXT NOT NULL DEFAULT '[]';
ALTER TABLE planes ADD COLUMN IF NOT EXISTS sugerencias TEXT NOT NULL DEFAULT '[]';`,
    },
    {
      version: 5,
      name: "vincular-version-con-turno-medido-del-agente",
      sql: `ALTER TABLE versiones_plan ADD COLUMN IF NOT EXISTS agente_run_id TEXT;`,
    },
  ],
  { table: "megi_revision_migrations" },
);
