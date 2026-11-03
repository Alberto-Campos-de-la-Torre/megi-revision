"""Conexión SQLite (stdlib) + esquema. JSON-as-TEXT donde aplique."""
import sqlite3
from contextlib import contextmanager

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  name TEXT, short TEXT, curp TEXT, nss TEXT,
  age INTEGER, sex TEXT, time TEXT, status TEXT,
  reason TEXT, last TEXT,
  allergies TEXT, chronic TEXT
);

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  name TEXT,
  role TEXT,                            -- admin | medico
  password_hash TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consultation_id TEXT REFERENCES consultations(id),
  patient_id TEXT,
  kind TEXT,                            -- referencia | orden_estudios | incapacidad
  content TEXT,                         -- JSON del documento
  content_hash TEXT,                    -- sello sha256 del contenido
  created_by TEXT,                      -- usuario que lo generó/firmó
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generico TEXT UNIQUE,                 -- nombre genérico normalizado (minúsculas)
  sinonimos TEXT,                       -- JSON: variantes crudas / marcas
  clase TEXT,                           -- clase terapéutica (AINE, opioide, ...)
  via TEXT,
  dosis_habitual TEXT,                  -- de la práctica real (minado de notas)
  frecuencia_habitual TEXT,
  dosis_max_dia TEXT,                   -- la captura/aprueba el médico (GPC sugiere)
  precauciones TEXT,
  n_recetas INTEGER DEFAULT 0,          -- frecuencia de uso real minada
  fuente TEXT,                          -- minado_notas_imss | manual
  estado TEXT DEFAULT 'borrador',       -- borrador | aprobado (solo aprobado alimenta
                                        -- safety/pick-list; editar re-abre a borrador)
  aprobado_por TEXT, aprobado_en TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS drug_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farmaco_a TEXT, farmaco_b TEXT,       -- genéricos del catálogo (a < b alfabético)
  severidad TEXT,                       -- leve | moderada | grave (grave -> blocker)
  mecanismo TEXT, recomendacion TEXT,
  fuente TEXT,                          -- gemma_propuesta | manual
  estado TEXT DEFAULT 'borrador',       -- solo 'aprobado' alimenta el rx-check
  aprobado_por TEXT, aprobado_en TEXT, created_at TEXT,
  UNIQUE(farmaco_a, farmaco_b)
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT,
  consultation_id TEXT,                 -- consulta de origen (seguimiento)
  scheduled_date TEXT,                  -- YYYY-MM-DD
  time TEXT,                            -- HH:MM
  reason TEXT,
  status TEXT,                          -- pendiente | atendida | cancelada
  created_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS consultations (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patients(id),
  status TEXT DEFAULT 'draft',          -- draft | in_review | approved | exported
  started_at TEXT, updated_at TEXT,
  doctor_id TEXT
);

CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consultation_id TEXT REFERENCES consultations(id),
  route TEXT,                           -- general | identifier
  seq INTEGER, t_seconds INTEGER,
  speaker TEXT, text TEXT, confidence REAL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS identifier_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consultation_id TEXT REFERENCES consultations(id),
  field TEXT,                           -- curp | nss
  raw_value TEXT,
  state TEXT,                           -- VALUE | MULTI_CANDIDATE | ABSTAIN | INVALID
  resolved_value TEXT,
  candidates TEXT,
  requires_confirmation INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS review_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consultation_id TEXT REFERENCES consultations(id),
  kind TEXT, payload TEXT, actor TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consultation_id TEXT REFERENCES consultations(id),
  kind TEXT,                            -- nota | receta | resumen
  content_hash TEXT, signature TEXT, signed_at TEXT, payload TEXT
);

CREATE TABLE IF NOT EXISTS informes_radiologia (
  id TEXT PRIMARY KEY,                    -- IR-xxxxxxxx
  patient_id TEXT REFERENCES patients(id),-- la pertenencia se valida contra el PACIENTE
  modalidad TEXT,                         -- radiografia | ultrasonido | tomografia | resonancia | mastografia | otro
  region TEXT,                            -- tórax, abdomen, cráneo…
  indicacion TEXT,                        -- por qué se pidió el estudio
  fecha_estudio TEXT,
  tecnica TEXT, comparacion TEXT, hallazgos TEXT, impresion TEXT, recomendaciones TEXT,
  transcript TEXT,                        -- dictado crudo: NUNCA se descarta
  status TEXT DEFAULT 'borrador',         -- borrador | firmado (firmado = inmutable)
  content_hash TEXT,                      -- sello sha256 al firmar
  created_by TEXT, created_at TEXT, updated_at TEXT, signed_at TEXT
);

-- Imágenes del estudio (hasta 4 por informe). El original se conserva tal cual
-- (JPG/PNG/WebP o DICOM) y `vista.png` es lo que ve el radiólogo y lee el LLM.
-- Su sha256 entra en el sello al firmar: el informe queda atado a lo que se leyó.
CREATE TABLE IF NOT EXISTS informes_radiologia_imagenes (
  id TEXT PRIMARY KEY,                    -- IMG-xxxxxxxx
  informe_id TEXT REFERENCES informes_radiologia(id),
  nombre_original TEXT,
  formato TEXT,                           -- jpg | png | webp | dicom
  sha256 TEXT,                            -- del archivo ORIGINAL
  ancho INTEGER, alto INTEGER,            -- de vista.png
  dicom_meta TEXT,                        -- JSON con lo no identificante (modalidad, ventana, frames…)
  orden INTEGER DEFAULT 0,
  created_by TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,                   -- id de sesión que viaja dentro del token
  username TEXT,
  created_at TEXT,
  expires_at REAL,                        -- epoch seconds (mismo exp que el token)
  revoked_at TEXT,                        -- NULL = sesión viva
  last_seen_at TEXT
);

-- Estudios que el paciente TRAE a la consulta (fotos, PDF, DICOM), subidos
-- desde el escritorio o desde el teléfono por un enlace con código (QR). El
-- original se guarda intacto en STATE_DIR/estudios/<consulta>/<id>/.
CREATE TABLE IF NOT EXISTS estudios_aportados (
  id TEXT PRIMARY KEY,                    -- EA-xxxxxxxx
  consultation_id TEXT REFERENCES consultations(id),
  patient_id TEXT REFERENCES patients(id),
  nombre_original TEXT,
  formato TEXT,                           -- jpg | png | webp | heic | pdf | dicom
  bytes INTEGER, sha256 TEXT,
  ancho INTEGER, alto INTEGER,
  tiene_vista INTEGER DEFAULT 0,          -- 1 si existe vista.png (miniatura)
  origen TEXT,                            -- escritorio | telefono
  subido_por TEXT,                        -- médico dueño del enlace o de la sesión
  nota TEXT,
  created_at TEXT
);

-- Enlaces de subida para el teléfono: código aleatorio, 15 minutos, una consulta.
CREATE TABLE IF NOT EXISTS enlaces_subida (
  token TEXT PRIMARY KEY,
  consultation_id TEXT REFERENCES consultations(id),
  patient_id TEXT,
  created_by TEXT, created_at TEXT,
  expires_at REAL,                        -- epoch seconds
  revoked_at TEXT,
  usos INTEGER DEFAULT 0
);

-- Análisis automático de cada estudio aportado (services/analisis_estudios.py):
-- una fila por analizador que corrió (o por «ninguno» si no aplica modelo).
CREATE TABLE IF NOT EXISTS estudios_analisis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estudio_id TEXT REFERENCES estudios_aportados(id),
  consultation_id TEXT,
  analizador TEXT,                        -- clave del registro ANALIZADORES
  modelo TEXT, version TEXT,              -- nombre operativo del modelo y su corrida
  status TEXT,                            -- done | error | sin_modelo
  resumen TEXT,                           -- texto legible (lo que lee el LLM y el médico)
  resultado TEXT,                         -- JSON completo sin imágenes
  error TEXT, latency_ms INTEGER, created_at TEXT
);

-- Pre-diagnóstico de la consulta a partir de todos los análisis. Versionado:
-- cada regeneración es una fila nueva (auditable: qué modelos y qué dijo).
CREATE TABLE IF NOT EXISTS prediagnosticos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consultation_id TEXT REFERENCES consultations(id),
  version INTEGER,
  texto TEXT,
  fuente TEXT,                            -- llm | mock | sin_modelo
  modelos TEXT,                           -- JSON [{etiqueta, estudio_id, analizador, modelo}]
  hechos TEXT,                            -- JSON de los hechos que lo sustentan
  error TEXT, created_at TEXT
);

-- Pases de un solo uso para abrir la mesa del anestesiólogo (proyecto electros)
-- desde MEGI: MEGI los emite tras volver a teclear la contraseña y la mesa los
-- valida contra /api/anestesio/pase/validar antes de abrir. Sin pase, la mesa
-- no abre. Caducan en 90 s y se consumen al validarse.
CREATE TABLE IF NOT EXISTS pases_anestesio (
  token TEXT PRIMARY KEY,
  username TEXT,
  created_at TEXT,
  expires_at REAL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  username TEXT PRIMARY KEY,              -- usuario INTENTADO (exista o no)
  failures INTEGER DEFAULT 0,
  last_failure_at REAL,                   -- epoch seconds
  locked_until REAL                       -- epoch seconds (NULL = sin bloqueo)
);

CREATE TABLE IF NOT EXISTS soap_patches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consultation_id TEXT REFERENCES consultations(id),
  chunk_idx INTEGER,
  patch TEXT,                           -- JSON soap_patch
  warnings TEXT,                        -- JSON
  status TEXT,                          -- done | invalid_json | not_configured | error
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS rehab_sugerencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consultation_id TEXT REFERENCES consultations(id),
  doctor_id TEXT,                       -- de quién se aprende (cada médico adapta distinto)
  protocolo_id TEXT,                    -- id del catálogo de protocolos
  pasos_propuestos TEXT,                -- JSON: lo que ofreció el catálogo, literal
  pasos_aceptados TEXT,                 -- JSON: lo que el médico se quedó, ya editado
  pasos_quitados TEXT,                  -- JSON: diff calculado en el servidor
  pasos_anadidos TEXT,                  -- JSON
  evento TEXT DEFAULT 'aplicada',       -- mostrada | aplicada. Una 'mostrada' SIN su
                                        -- 'aplicada' es un RECHAZO, que es la señal
                                        -- más fuerte que hay y la única que no se
                                        -- puede reconstruir después.
  alternativas TEXT,                    -- JSON: qué se ofreció y en qué orden
  elegido_orden INTEGER,                -- 0 = se quedó con el primero; >0 = el ranking falló
  lateralidad TEXT,                     -- derecho | izquierdo (nunca lo elige el sistema)
  reglas_mostradas TEXT,                -- JSON: reglas de adaptación que se le enseñaron
  contexto TEXT,                        -- JSON {O, A}: la exploración que justificó la decisión
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS audio (
  id TEXT PRIMARY KEY,
  consultation_id TEXT REFERENCES consultations(id),
  audio_kind TEXT,                      -- ver app/audio_meta.py: general_consultation | chunk | identifier_slot | voice_command
  entity_type TEXT,                     -- CURP | NSS | INE | INE_OCR | RFC (si identifier)
  slot_id TEXT,
  original_path TEXT,
  asr_wav_path TEXT,
  duration_ms INTEGER,
  sha256 TEXT,
  transcription_status TEXT,            -- pending | done | mock | no_configurado | error
  transcript TEXT,
  resolved TEXT,                        -- JSON del resolver (si identifier)
  model TEXT,                           -- modelo ASR usado (auditoría)
  asr_mode TEXT,                        -- real | mock
  timing TEXT,                          -- JSON {convert_ms, asr_ms, total_ms}
  created_at TEXT
);
"""

# columnas añadidas después de la v1 del esquema (migración idempotente)
_AUDIO_EXTRA_COLUMNS = [
    ("model", "TEXT"), ("asr_mode", "TEXT"), ("timing", "TEXT"),
    # Auditoría de retención (retain_all): quién subió el audio, para qué se usó
    # y bajo qué política se retiene. Ver app/audio_meta.py (taxonomía central).
    ("uploaded_by", "TEXT"),    # username autenticado que subió/dictó el audio
    ("purpose", "TEXT"),        # para qué se usó (texto auditable, por audio_kind)
    ("retention", "TEXT"),      # política aplicada al guardar (retain_all)
    # Fase 10B: segmentos del chunk etiquetados por hablante (JSON:
    # [{start,end,text,speaker: medico|otro|desconocido, score}]).
    ("speaker_segments", "TEXT"),
]
_CONSULT_EXTRA_COLUMNS = [
    # Motivo de ESTA consulta. `patients.reason` es el del alta del paciente y
    # se quedó congelado ahí: quien viene por lumbalgia en marzo puede volver en
    # julio por otra cosa. Sin este campo, el LLM se prepara para la consulta
    # equivocada y el «Antes de empezar» sugiere sobre un motivo viejo.
    ("motivo", "TEXT"),
    ("transcript", "TEXT"),
    ("soap", "TEXT"),
    ("clinical_facts", "TEXT"),
    ("validation_flags", "TEXT"),
    ("final_soap", "TEXT"),
    ("finalized_at", "TEXT"),
    # v0.0.1 auditoría: nota final del médico, receta/dx, y quién aprobó/firmó
    ("approved_soap", "TEXT"),      # nota S/O/A/P aprobada por el médico (con sus ediciones)
    ("prescription", "TEXT"),       # receta (JSON)
    ("dx_codes", "TEXT"),           # diagnósticos CIE-10 (JSON)
    ("approved_by", "TEXT"),        # usuario que aprobó/firmó
    ("approved_at", "TEXT"),
    ("vitals", "TEXT"),             # signos vitales estructurados (JSON) confirmados
    # Fase 11: qué documentos amerita la consulta (JSON cacheado; ver
    # services/doc_suggest.py). La impresión solo ofrece los que aplican.
    ("doc_suggestions", "TEXT"),
    # Descubierto al migrar el expediente real: en las consultas importadas de
    # notas del IMSS, `doctor_id` traía el código de consultorio/agregado médico
    # (p. ej. "1F19660R"), no un usuario de MEGI. Se preserva aquí para no
    # perderlo y `doctor_id` queda para el dueño real (multi-tenencia).
    ("imss_consultorio", "TEXT"),
    # Pantalla de estudios previa al SOAP: 'con_estudios' | 'sin_estudios' | NULL
    # (no pasó por ella). «Continuar sin estudios» deja constancia.
    ("estudios_estado", "TEXT"),
]
_SOAP_PATCH_EXTRA_COLUMNS = [("rag_context", "TEXT")]  # JSON {sources, retrieval}
# P2: forzar cambio de contraseña al primer login (usuarios creados por admin).
_USERS_EXTRA_COLUMNS = [
    ("must_change_password", "INTEGER DEFAULT 0"),
    # Sección Anestesio (modelos restringidos): solo los médicos autorizados por
    # un administrador la ven; los administradores siempre.
    ("acceso_anestesio", "INTEGER DEFAULT 0"),
    # Identidad profesional POR MÉDICO. Antes salía de `seed.json` y era única
    # para toda la instalación: con varios médicos, cada receta que imprimiera
    # uno llevaría el nombre y la CÉDULA PROFESIONAL de otro. La receta es un
    # documento legal y la cédula identifica al responsable, así que esto es
    # parte de la multi-tenencia, no un adorno.
    ("specialty", "TEXT"),
    ("cedula", "TEXT"),
    ("cedula_esp", "TEXT"),
    ("institution", "TEXT"),
    ("address", "TEXT"),
    ("phone", "TEXT"),
    # Equipo del que dispone SU consultorio (JSON: ["CHC","US","TENS",…]). En
    # consulta privada cada médico tiene lo suyo: sugerir la dosis de un aparato
    # que no tiene no solo es inútil, enseña que el sistema no le entiende.
    ("equipo", "TEXT"),
    # Usuario visible SOLO para un administrador concreto (27-sep-2026). NULL =
    # lo ven todos los admins. Con varios administradores, el dueño del sistema
    # puede dar de alta a un médico sin que aparezca en la Administración de los
    # demás; agenda, expediente y sesiones ya eran por médico, así que la lista
    # de usuarios era el único sitio donde se veía.
    ("visible_para", "TEXT"),
]
# v0.0.1: agenda de pacientes (cita con fecha/hora o alta espontánea/walk-in).
_REHAB_EXTRA_COLUMNS = [
    ("evento", "TEXT DEFAULT 'aplicada'"),
    ("alternativas", "TEXT"),
    ("elegido_orden", "INTEGER"),
]
_PATIENT_EXTRA_COLUMNS = [
    ("scheduled_date", "TEXT"),   # YYYY-MM-DD de la cita (null si espontáneo)
    ("kind", "TEXT"),             # 'cita' | 'espontaneo'
    ("created_at", "TEXT"),
    ("email", "TEXT"),            # contacto (para enviar nota/receta)
    ("phone", "TEXT"),
    ("source", "TEXT"),          # null=capturado en MEGI | 'imss_ocr'=importado de notas reales
    # Motor de edad (SOAP dinámico): fecha de nacimiento para edad exacta
    # (días/meses/años) y datos pediátricos. `age` queda como respaldo.
    ("birthdate", "TEXT"),        # YYYY-MM-DD
    ("gestacional_semanas", "INTEGER"),   # edad gestacional al nacer (prematuro si <37)
    # Multi-tenencia: dueño del expediente (username del médico). El paciente es
    # la RAÍZ de la pertenencia; consultas, audio, documentos y citas heredan de
    # él. NULL = paciente sin asignar (los previos a esta migración): solo lo ve
    # quien tenga rol admin mediante el CLI de asignación, no la app.
    ("doctor_id", "TEXT"),
]

# Índices: sin esto cada listado de agenda haría scan completo en cuanto la base
# crezca con varios médicos.
# Lectura asistida de imagen (M5, 21-sep): JSON {lectura, model, n_imagenes,
# imagenes:[sha256], at}. Es asistencia: NO forma parte del informe firmado
# salvo lo que el radiólogo copie a mano a hallazgos/impresión.
_RADIOLOGIA_EXTRA_COLUMNS = [("analisis_ia", "TEXT")]
# Identificación automática del estudio aportado (tipo, confianza, detalle JSON)
# y estado del análisis: pendiente | analizando | listo | error.
_ESTUDIOS_EXTRA_COLUMNS = [("tipo", "TEXT"), ("tipo_p", "REAL"), ("tipo_detalle", "TEXT"), ("analisis_estado", "TEXT"),
                           # Triaje previo (services/triaje.py): huella perceptual para detectar fotos
                           # repetidas y motivo del descarte (JSON) cuando no se analiza.
                           ("phash", "TEXT"), ("triaje", "TEXT")]

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_patients_doctor ON patients(doctor_id)",
    "CREATE INDEX IF NOT EXISTS idx_rx_imagenes_informe ON informes_radiologia_imagenes(informe_id)",
    "CREATE INDEX IF NOT EXISTS idx_consultations_doctor ON consultations(doctor_id)",
    "CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations(patient_id)",
]


def _add_missing(conn, table, columns) -> None:
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
    for name, decl in columns:
        if name not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")


def _migrate(conn) -> None:
    _add_missing(conn, "audio", _AUDIO_EXTRA_COLUMNS)
    _add_missing(conn, "consultations", _CONSULT_EXTRA_COLUMNS)
    _add_missing(conn, "soap_patches", _SOAP_PATCH_EXTRA_COLUMNS)
    _add_missing(conn, "patients", _PATIENT_EXTRA_COLUMNS)
    _add_missing(conn, "users", _USERS_EXTRA_COLUMNS)
    _add_missing(conn, "rehab_sugerencias", _REHAB_EXTRA_COLUMNS)
    _add_missing(conn, "informes_radiologia", _RADIOLOGIA_EXTRA_COLUMNS)
    _add_missing(conn, "estudios_aportados", _ESTUDIOS_EXTRA_COLUMNS)
    # Índice PARCIAL, solo sobre 'mostrada': es el evento que se repite, porque
    # el componente se repinta y cada repintado contaría como otra impresión,
    # inflando el rechazo. Las 'aplicada' no se restringen — una duplicada sería
    # rara, pero hacerla fallar convertiría un registro de apoyo en un error 500
    # en mitad de la consulta.
    conn.execute("DROP INDEX IF EXISTS ix_rehab_mostrada")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_rehab_mostrada "
                 "ON rehab_sugerencias(consultation_id, protocolo_id) "
                 "WHERE evento = 'mostrada'")
    for sql in _INDEXES:
        conn.execute(sql)
    _backfill_audio_retention(conn)
    _quitar_fechas_de_nacimiento_contradictorias(conn)


def _quitar_fechas_de_nacimiento_contradictorias(conn) -> None:
    """Pacientes guardados con `birthdate` que contradice `age` (visto en
    producción: la fecha del alta como nacimiento de un adulto de 25 años).
    La edad escrita a mano vale más; la fecha se vacía y se deja rastro en el
    log. Idempotente: en la siguiente arrancada no hay nada que tocar."""
    from .services.age_engine import fecha_contradice_edad

    rows = conn.execute(
        "SELECT id, age, birthdate FROM patients WHERE birthdate IS NOT NULL AND birthdate <> ''"
    ).fetchall()
    malas = [r["id"] for r in rows if fecha_contradice_edad(r["birthdate"], r["age"])]
    for pid in malas:
        conn.execute("UPDATE patients SET birthdate = NULL WHERE id = ?", (pid,))
    if malas:
        print(f"[db] {len(malas)} paciente(s) con fecha de nacimiento que contradecía la edad: "
              f"fecha vaciada, se conserva la edad ({', '.join(malas)})", flush=True)


def _backfill_audio_retention(conn) -> None:
    """Audios guardados antes de la política de retención: se les asigna la
    clasificación por su audio_kind. `uploaded_by` queda NULL a propósito
    (no se sabe quién los subió; inventarlo falsearía la auditoría)."""
    from .audio_meta import AUDIO_KINDS, RETENTION_POLICY

    for kind, info in AUDIO_KINDS.items():
        conn.execute(
            "UPDATE audio SET purpose = ?, retention = ? WHERE audio_kind = ? AND retention IS NULL",
            (info["purpose"], RETENTION_POLICY, kind),
        )
    conn.execute(
        "UPDATE audio SET purpose = '(sin clasificar)', retention = ? WHERE retention IS NULL",
        (RETENTION_POLICY,),
    )


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
