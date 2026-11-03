/**
 * Contrato del adaptador MEGI (Frente A ↔ Frente B).
 *
 * Es la ÚNICA interfaz que la app Agent-Native conoce. Tiene dos
 * implementaciones intercambiables con `MEGI_MODE`:
 *   - `megi-mock.ts`  (Frente A): datos ficticios en memoria.
 *   - `megi-http.ts`  (Frente B): API real de MEGI (FastAPI).
 *
 * Los ids que viajan por aquí son LÓGICOS (`demo-p1`, `demo-c1`): el adaptador
 * http los traduce a los reales de MEGI y de vuelta. Así el guion, las pruebas
 * y la interfaz son idénticos en ambos modos.
 */

export type Sexo = "F" | "M" | "X";

export type Medicamento = {
  /** Nombre tal como se receta ("Ibuprofeno", "Warfarina"). */
  nombre: string;
  dosis: string;
  frecuencia: string;
  /** "7 días", "continuo"… */
  duracion?: string | undefined;
  /** Fecha ISO desde la que lo toma (solo medicación activa). */
  desde?: string | undefined;
};

export type Paciente = {
  id: string;
  nombre: string;
  edad: number;
  sexo: Sexo;
  /** Lista VACÍA = sin registro de alergias (no «sin alergias»). */
  alergias: string[];
  cronicos: string[];
  /** Última receta aprobada del expediente. */
  medicacionActiva: Medicamento[];
};

export type Diagnostico = { cie10?: string | undefined; texto: string };

export type Soap = { s: string; o: string; a: string; p: string };

export type Consulta = {
  id: string;
  pacienteId: string;
  /** ISO 8601. */
  fecha: string;
  motivo: string;
  /** Nota consolidada (final) de la consulta. */
  soap: Soap;
  diagnosticos: Diagnostico[];
  /** Fármacos que la nota propone (texto libre, tal como salió del SOAP). */
  medicamentosPropuestos: string[];
  /** Pendientes/indicaciones detectados en el plan (texto libre). */
  pendientes: string[];
  /** `pendiente` = consolidada y sin receta aprobada; `aprobada`; `exportada`. */
  estado: "pendiente" | "aprobada" | "exportada";
  /** Transcripción breve (puede ir vacía). */
  transcripcion?: string | undefined;
};

export type ConsultaConPaciente = Consulta & { paciente: Paciente };

export type Verificacion = {
  resultado: "ok" | "advertencia" | "bloqueado";
  /** "Alergia registrada a penicilinas", "Interacción grave con warfarina…" */
  motivo?: string | undefined;
  /** Detalle de cada alerta que afecta a este fármaco. */
  alertas?: Alerta[] | undefined;
  /** Sugerencias de reemplazo cuando hay bloqueo (pueden venir vacías). */
  alternativas?: string[] | undefined;
};

export type Alerta = {
  severidad: "bloqueo" | "advertencia";
  tipo: "alergia" | "cronico" | "interaccion" | "otro";
  farmaco: string;
  contra: string;
  mensaje: string;
};

/** Lo que la app manda al exportar: el plan ya revisado por el médico. */
export type PlanAprobado = {
  farmacos: Medicamento[];
  pendientes: string[];
  diagnosticos: Diagnostico[];
  /** Nota final (si el médico la editó); si falta, se usa la consolidada. */
  soap?: Soap | undefined;
  /** El médico confirmó explícitamente las alertas de bloqueo restantes. */
  confirmaAlertas: boolean;
  notas?: string | undefined;
};

export type Exportacion = {
  formato: "texto" | "fhir";
  contenido: string;
  /** Sello del contenido que devuelve MEGI (sha256:…), si aplica. */
  sello?: string | undefined;
  aprobadaPor?: string | undefined;
};

export interface MegiAdapter {
  /** Consultas consolidadas pendientes de revisión, con su paciente. */
  listarConsultasCerradas(): Promise<ConsultaConPaciente[]>;
  verConsulta(consultaId: string): Promise<Consulta>;
  verPaciente(pacienteId: string): Promise<Paciente>;
  /**
   * Verifica una receta propuesta contra alergias, crónicos y medicación
   * activa del paciente. Clave del resultado = `nombre` del fármaco enviado.
   */
  verificarReceta(pacienteId: string, farmacos: Medicamento[]): Promise<Record<string, Verificacion>>;
  /** Reemplazos sugeridos para un fármaco problemático en este paciente. */
  alternativas(pacienteId: string, farmaco: string): Promise<string[]>;
  /** Aprueba en MEGI y devuelve el documento exportado. */
  exportar(consultaId: string, plan: PlanAprobado): Promise<Exportacion>;
  /** Disponibilidad del backend (para mostrar estado en la UI). */
  estado(): Promise<{ disponible: boolean; modo: string; detalle?: string }>;
}

/** Error con mensaje claro cuando MEGI no responde o rechaza (caso roto 5). */
export class MegiError extends Error {
  readonly status: number | undefined;
  readonly detalle: unknown;
  constructor(message: string, status?: number, detalle?: unknown) {
    super(message);
    this.name = "MegiError";
    this.status = status;
    this.detalle = detalle;
  }
}
