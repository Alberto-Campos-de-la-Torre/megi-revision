import { enCacheDePeticion } from "./peticion.js";
/**
 * Adaptador REAL: habla con el backend MEGI (FastAPI) por HTTP.
 *
 * Variables de entorno (servidor; NUNCA con prefijo VITE_):
 *   MEGI_URL       p. ej. http://127.0.0.1:8020   (demo) · http://localhost:8000 (instalación)
 *   MEGI_USER      usuario de servicio (demo: demo_medico)
 *   MEGI_PASSWORD  su contraseña
 *
 * Hace login al primer uso y guarda el token (HMAC firmado por MEGI, 7 días).
 * Si una petición devuelve 401, reintenta UNA vez tras volver a entrar.
 *
 * Lecturas de revisión (I3): `GET /review/pending` (pendientes paginadas,
 * filtradas por médico en el servidor, con la ficha del paciente) y
 * `POST /review/medication-history` (recetas aprobadas de varios pacientes,
 * paginadas). Si el backend es anterior y responde 404 «Not Found», se cae
 * al recorrido paciente a paciente; cualquier otro error se propaga.
 */
import {
  MegiError,
  type Alerta,
  type Consulta,
  type ConsultaConPaciente,
  type Diagnostico,
  type Exportacion,
  type Medicamento,
  type MegiAdapter,
  type Paciente,
  type PaginaPendientes,
  type PlanAprobado,
  type Soap,
  type Verificacion,
} from "./types.js";

// ------------------------------------------------------------- ids lógicos
// El guion y las pruebas usan `demo-p1`/`demo-c1`; MEGI usa `P-DEMO1`/`C-DEMO1`.
// Cualquier otro id pasa tal cual (sirve también contra una instalación real).
const RE_LOGICO = /^demo-([pc])(\d+)(-prev)?$/i;
const RE_REAL = /^([PC])-DEMO(\d+)(-PREV)?$/;

export function aReal(id: string): string {
  const m = RE_LOGICO.exec(id);
  return m
    ? `${(m[1] ?? "").toUpperCase()}-DEMO${m[2] ?? ""}${m[3] ? "-PREV" : ""}`
    : id;
}

export function aLogico(id: string): string {
  const m = RE_REAL.exec(id);
  return m
    ? `demo-${(m[1] ?? "").toLowerCase()}${m[2] ?? ""}${m[3] ? "-prev" : ""}`
    : id;
}

/**
 * Un id solo puede ser UN segmento de ruta. Sin esto, un id como `../users`
 * se sale de `/api/consultations/` y convierte cualquier lectura en una
 * petición arbitraria a MEGI con la sesión del usuario de servicio: incluida
 * `GET /api/export/consultation/{id}`, que en MEGI escribe.
 */
const RE_SEGMENTO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function idSeguro(id: string, que = "id"): string {
  if (typeof id !== "string" || id.includes("..") || !RE_SEGMENTO.test(id)) {
    throw new MegiError(`${que} inválido: ${JSON.stringify(id)}`, 400);
  }
  return encodeURIComponent(id);
}

// ----------------------------------------------------------- utilidades
type Json = Record<string, any>;

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null || v === "") return fallback;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function jsonCanonico(v: unknown): string {
  const ordenar = (x: any): any =>
    Array.isArray(x)
      ? x.map(ordenar)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, ordenar(x[k])]),
          )
        : x;
  return JSON.stringify(ordenar(v));
}

function soapDeMegi(s: Json | null | undefined): Soap {
  const x = s ?? {};
  return { s: x.S ?? "", o: x.O ?? "", a: x.A ?? "", p: x.P ?? "" };
}

function soapAMegi(s: Soap): Json {
  return { S: s.s, O: s.o, A: s.a, P: s.p };
}

function dxDeMegi(list: unknown): Diagnostico[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((d: any) =>
      typeof d === "string"
        ? { texto: d }
        : { cie10: d?.code ?? undefined, texto: d?.label ?? d?.texto ?? "" },
    )
    .filter((d) => d.texto);
}

function rxDeMegi(list: unknown, desde?: string): Medicamento[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((r: any): Medicamento => {
      if (typeof r === "string")
        return { nombre: r, dosis: "", frecuencia: "", desde };
      const duracion = r?.duration ?? r?.duracion;
      const dosis = String(r?.dose ?? r?.dosis ?? "").trim();
      let nombre = String(r?.drug ?? r?.nombre ?? "").trim();
      // MEGI almacena `drug="Paracetamol 650 mg"` además de `dose="650 mg"`.
      // El contrato separa ambos; conservarlos duplicaría dosis e interacciones.
      if (dosis && nombre.toLowerCase().endsWith(` ${dosis.toLowerCase()}`)) {
        nombre = nombre.slice(0, -dosis.length).trim();
      }
      return {
        nombre,
        dosis,
        frecuencia: String(r?.freq ?? r?.frecuencia ?? ""),
        duracion:
          typeof duracion === "string" && duracion ? duracion : undefined,
        desde,
      };
    })
    .filter((m) => m.nombre);
}

/** MEGI recibe la receta como [{drug, dose, freq, duration}]. */
function rxAMegi(list: Medicamento[]): Json[] {
  return list.map((m) => ({
    drug: m.dosis ? `${m.nombre} ${m.dosis}`.trim() : m.nombre,
    dose: m.dosis,
    freq: m.frecuencia,
    duration: m.duracion ?? "",
  }));
}

/**
 * ¿La alerta habla de este fármaco? MEGI puede nombrarlo con la etiqueta que
 * le mandamos ("Ibuprofeno 400 mg") o con el nombre del catálogo
 * ("Ibuprofeno"). Comparar literalmente deja caer la alerta en silencio y el
 * fármaco se informa como `ok`: se compara normalizado y por nombre.
 */
function esElMismo(nombrado: string, nombre: string, etiqueta: string): boolean {
  const a = normaliza(nombrado).trim();
  if (!a) return false;
  const n = normaliza(nombre).trim();
  return a === normaliza(etiqueta).trim() || a === n || (!!n && a.startsWith(`${n} `));
}

function normaliza(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Contrato de `POST /safety/rx-check`: `{ alerts: [{severity: "blocker"|"warn",
 * type, drug, against, message}], blockers, warnings }`. Cualquier otra cosa
 * (un `{}`, `alerts` que no es lista, severidades desconocidas, alertas sin
 * mensaje o recuentos que no cuadran) NO es «sin alertas»: es un verificador
 * roto y la receta no puede darse por segura. Se rechaza con 502 y código
 * `verificador_invalido`; la capa de acción no guarda nada.
 */
export const CODIGO_VERIFICADOR_INVALIDO = "verificador_invalido";

function respuestaInvalida(motivo: string, respuesta: unknown): MegiError {
  return new MegiError(
    `Respuesta inválida del verificador de MEGI (/safety/rx-check): ${motivo}. La receta no se da por segura.`,
    502,
    { codigo: CODIGO_VERIFICADOR_INVALIDO, motivo, respuesta },
  );
}

export function alertasDeMegi(r: unknown): Alerta[] {
  if (!r || typeof r !== "object" || Array.isArray(r)) {
    throw respuestaInvalida("el cuerpo no es un objeto JSON", r);
  }
  const { alerts, blockers, warnings } = r as Json;
  if (!Array.isArray(alerts)) {
    throw respuestaInvalida("falta la lista `alerts`", r);
  }
  const alertas = alerts.map((a: unknown, i: number): Alerta => {
    if (!a || typeof a !== "object" || Array.isArray(a)) {
      throw respuestaInvalida(`la alerta ${i} no es un objeto`, r);
    }
    const x = a as Json;
    if (x.severity !== "blocker" && x.severity !== "warn") {
      throw respuestaInvalida(
        `la alerta ${i} tiene severidad desconocida ${JSON.stringify(x.severity)}`,
        r,
      );
    }
    if (typeof x.message !== "string" || !x.message.trim()) {
      throw respuestaInvalida(`la alerta ${i} no tiene mensaje`, r);
    }
    return {
      severidad: x.severity === "blocker" ? "bloqueo" : "advertencia",
      tipo: (["alergia", "cronico", "interaccion"] as const).includes(x.type)
        ? x.type
        : "otro",
      farmaco: typeof x.drug === "string" ? x.drug : "",
      contra: typeof x.against === "string" ? x.against : "",
      mensaje: x.message.trim(),
    };
  });
  // Los recuentos son redundantes, pero si vienen tienen que cuadrar: una
  // respuesta truncada o mezclada no debe pasar como completa.
  const nBloqueos = alertas.filter((a) => a.severidad === "bloqueo").length;
  if (blockers !== undefined && blockers !== nBloqueos) {
    throw respuestaInvalida(`\`blockers\`=${JSON.stringify(blockers)} no coincide con ${nBloqueos} alerta(s) de bloqueo`, r);
  }
  if (warnings !== undefined && warnings !== alertas.length - nBloqueos) {
    throw respuestaInvalida(`\`warnings\`=${JSON.stringify(warnings)} no coincide con ${alertas.length - nBloqueos} advertencia(s)`, r);
  }
  return alertas;
}

/**
 * Límite de peticiones en vuelo compartido por TODA una operación de lectura
 * (pacientes y sus consultas incluidos): el tope no se multiplica al anidar.
 * Solo envuelve peticiones HTTP sueltas (hojas); una tarea que a su vez
 * espera otras limitadas no debe ocupar un turno, o se bloquea la cola.
 */
export type Limitador = <R>(tarea: () => Promise<R>) => Promise<R>;

export function limitador(limite: number): Limitador {
  let activos = 0;
  const cola: Array<() => void> = [];
  const turno = () => new Promise<void>((r) => (activos < limite ? (activos++, r()) : cola.push(() => { activos++; r(); })));
  const soltar = () => {
    activos--;
    cola.shift()?.();
  };
  return async (tarea) => {
    await turno();
    try {
      return await tarea();
    } finally {
      soltar();
    }
  };
}

/** Ejecuta `fn` sobre `items` respetando `limitar`, conservando el orden. */
export function enLotes<T, R>(
  items: readonly T[],
  limitar: Limitador,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  return Promise.all(items.map((item, i) => limitar(() => fn(item, i))));
}

/** Peticiones simultáneas a MEGI por operación de lectura (H3: expedientes grandes). */
const CONCURRENCIA = 4;

/** Reemplazos deterministas cuando el servicio LLM de MEGI no está (503). */
const ALTERNATIVAS_LOCALES: Array<{ cuando: RegExp; sugerir: string[] }> = [
  {
    cuando: /amoxicilin|ampicilin|penicilin|dicloxacilin/,
    sugerir: [
      "Azitromicina 500 mg cada 24 h 3 días",
      "Clindamicina 300 mg cada 8 h 10 días",
    ],
  },
  {
    cuando: /ibuprofen|naproxen|diclofenac|ketorolac|meloxicam|piroxicam/,
    sugerir: [
      "Paracetamol 1 g cada 8 h",
      "Tratamiento tópico (diclofenaco gel) con vigilancia",
    ],
  },
  {
    cuando: /claritromicin|eritromicin/,
    sugerir: ["Azitromicina 500 mg cada 24 h 3 días"],
  },
  {
    cuando: /sulfameto|trimetoprim|cotrimoxazol/,
    sugerir: [
      "Nitrofurantoína 100 mg cada 12 h 5 días",
      "Fosfomicina 3 g dosis única",
    ],
  },
];

// ------------------------------------------------------------- adaptador
export type MegiHttpConfig = {
  url?: string;
  user?: string;
  password?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class MegiHttp implements MegiAdapter {
  private readonly cacheId = crypto.randomUUID();
  private readonly base: string;
  private readonly user: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private token: string | null = null;
  /** null = sin comprobar; false = el backend no tiene las lecturas paginadas de revisión. */
  private revisionPaginada: boolean | null = null;
  /** Lecturas en paralelo sin token comparten UN login en vuelo. */
  private loginEnVuelo: Promise<string> | null = null;
  private nombreMedico = "";

  constructor(cfg: MegiHttpConfig = {}) {
    const env = (globalThis as any).process?.env ?? {};
    this.base = (cfg.url ?? env.MEGI_URL ?? "http://127.0.0.1:8020").replace(
      /\/+$/,
      "",
    );
    this.user = cfg.user ?? env.MEGI_USER ?? "";
    this.password = cfg.password ?? env.MEGI_PASSWORD ?? "";
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    if (!this.user || !this.password) {
      throw new MegiError(
        "Faltan MEGI_USER / MEGI_PASSWORD para el adaptador http",
      );
    }
  }

  // ---- transporte -------------------------------------------------------
  private async raw(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) headers.Authorization = `Bearer ${await this.sesion()}`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const init: RequestInit = { method, headers, signal: ctl.signal };
      if (body !== undefined) init.body = JSON.stringify(body);
      return await this.fetchImpl(`${this.base}/api${path}`, init);
    } catch (e: any) {
      const motivo =
        e?.name === "AbortError"
          ? "tiempo de espera agotado"
          : (e?.cause?.code ?? e?.message ?? "sin respuesta");
      throw new MegiError(
        `MEGI no responde en ${this.base} (${motivo}). ¿Está arrancado el backend?`,
      );
    } finally {
      clearTimeout(t);
    }
  }

  private async call<T = Json>(
    method: string,
    path: string,
    body?: unknown,
    reintento = true,
    /**
     * Si es `false`, un cuerpo que no sea un objeto JSON NO se rechaza aquí y
     * sube tal cual. Solo lo usa `/safety/rx-check`, que tiene su propia
     * validación (`alertasDeMegi` → 502 `verificador_invalido`) y da un error
     * más preciso que el genérico de aquí: la receta no se da por segura, con
     * su código. Para cualquier otra ruta, un 200 sin JSON es un fallo.
     */
    exigeObjeto = true,
  ): Promise<T> {
    const r = await this.raw(method, path, body);
    if (r.status === 401 && reintento) {
      this.token = null; // sesión caducada o revocada: volver a entrar una vez
      return this.call<T>(method, path, body, false, exigeObjeto);
    }
    const texto = await r.text();
    const data = texto ? parseJson<any>(texto, texto) : null;
    if (!r.ok) {
      const detalle =
        typeof data === "object" && data?.detail ? data.detail : texto;
      throw new MegiError(
        `MEGI ${method} ${path} → ${r.status}: ${detalle}`,
        r.status,
        data,
      );
    }
    // Un 200 cuyo cuerpo no es JSON —la página de error de un proxy, una
    // respuesta cortada— no puede pasar por éxito: `parseJson` devuelve el
    // texto tal cual y la mesa acabaría mostrando una consulta vacía como si
    // fuera real. Hallazgo de la fase 2 (bloque F).
    if (exigeObjeto && (data === null || typeof data !== "object")) {
      throw new MegiError(
        `MEGI ${method} ${path} → ${r.status} con una respuesta que no es JSON; no se puede usar.`,
        502,
        { muestra: texto.slice(0, 120) },
      );
    }
    return data as T;
  }

  private sesion(): Promise<string> {
    if (this.token) return Promise.resolve(this.token);
    if (!this.loginEnVuelo) {
      this.loginEnVuelo = this.entrar().finally(() => {
        this.loginEnVuelo = null;
      });
    }
    return this.loginEnVuelo;
  }

  private async entrar(): Promise<string> {
    const r = await this.raw(
      "POST",
      "/auth/login",
      { username: this.user, password: this.password },
      false,
    );
    const data = parseJson<any>(await r.text(), {});
    if (!r.ok || !data?.token) {
      throw new MegiError(
        `Login en MEGI rechazado (${r.status}): ${data?.detail ?? "sin detalle"}`,
        r.status,
      );
    }
    if (data.must_change_password) {
      throw new MegiError(
        "El usuario de servicio debe cambiar su contraseña en MEGI antes de usarse",
      );
    }
    this.token = data.token as string;
    this.nombreMedico = data.name ?? this.user;
    return this.token;
  }

  // ---- lectura ----------------------------------------------------------
  async estado() {
    try {
      const r = await this.raw("GET", "/health", undefined, false);
      const d = parseJson<any>(await r.text(), {});
      return {
        disponible: r.ok,
        modo: d?.mode ?? "?",
        detalle: `build ${d?.build ?? "?"}`,
      };
    } catch (e: any) {
      return { disponible: false, modo: "sin conexión", detalle: e?.message };
    }
  }

  private pacienteDeMegi(p: Json, medicacionActiva: Medicamento[]): Paciente {
    // El esquema de salida exige `nombre: string` y `edad: number`. Un campo
    // mal tipado en MEGI rompía la acción entera en vez de mostrarse como
    // viniera, así que aquí se normaliza. Fase 2, bloque F.
    const texto = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
    const lista = (v: unknown) => (Array.isArray(v) ? v.map(texto).filter(Boolean) : []);
    return {
      id: aLogico(p.id),
      nombre: texto(p.name),
      edad: Number.isFinite(Number(p.age)) ? Number(p.age) : 0,
      sexo: p.sex === "F" || p.sex === "M" ? p.sex : "X",
      alergias: lista(p.allergies),
      cronicos: lista(p.chronic),
      medicacionActiva,
    };
  }

  private consultaDeMegi(c: Json): Consulta {
    const final = parseJson<Json | null>(c.final_soap, null);
    const borrador = parseJson<Json | null>(c.soap, null);
    const facts = parseJson<Json>(c.clinical_facts, {});
    const aprobada = c.status === "approved";
    const exportada = c.status === "exported";
    return {
      id: aLogico(c.id),
      pacienteId: aLogico(c.patient_id),
      fecha: c.finalized_at ?? c.started_at ?? "",
      motivo: c.motivo ?? "",
      soap: soapDeMegi(
        parseJson<Json | null>(c.approved_soap, null) ?? final ?? borrador,
      ),
      diagnosticos: dxDeMegi(
        parseJson<unknown>(c.dx_codes, null) ?? facts.diagnosticos ?? [],
      ),
      medicamentosPropuestos: Array.isArray(facts.medicamentos_propuestos)
        ? facts.medicamentos_propuestos
        : [],
      pendientes: Array.isArray(facts.pendientes) ? facts.pendientes : [],
      estado: exportada ? "exportada" : aprobada ? "aprobada" : "pendiente",
      transcripcion: c.transcript ?? "",
    };
  }

  /** Recetas aprobadas longitudinales: cada pauta conserva fuente, fecha y estado pendiente de conciliación. */
  private async medicacionActiva(
    pacienteReal: string,
    yaLeida?: Json[],
    limitar: Limitador = limitador(CONCURRENCIA),
  ): Promise<NonNullable<Paciente["historialMedicacion"]>> {
    if (!yaLeida) {
      // Lectura por lotes (una petición por página, no una por consulta).
      const porLotes = await this.historialPorLotes([pacienteReal], limitar);
      if (porLotes) return porLotes.get(pacienteReal) ?? [];
    }
    const lista =
      yaLeida ??
      (await this.call<Json[]>(
        "GET",
        `/patients/${idSeguro(pacienteReal, "id de paciente")}/consultations`,
      ));
    const aprobadas = lista.filter(
      (c) => c.status === "approved" || c.status === "exported",
    );
    if (!aprobadas.length) return [];
    aprobadas.sort((a, b) =>
      String(b.started_at).localeCompare(String(a.started_at)),
    );
    const historial: NonNullable<Paciente["historialMedicacion"]> = [];
    const vistos = new Set<string>();
    // Las lecturas van en lotes acotados (no una a una) y se deduplican dentro
    // de la acción; el orden cronológico se conserva al recorrer el resultado.
    const completas = await enLotes(aprobadas, limitar, (resumen) =>
      this.leerConsultaReal(String(resumen.id)),
    );
    for (const [k, resumen] of aprobadas.entries()) {
      const c = completas[k]!;
      const fecha = String(c.approved_at ?? c.started_at ?? "");
      for (const [i, m] of rxDeMegi(parseJson<unknown>(c.prescription, []), fecha).entries()) {
        const clave = `${normaliza(m.nombre)}|${normaliza(m.dosis)}|${normaliza(m.frecuencia)}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        const dias = /^(\d+)\s*d[ií]as?$/i.exec(m.duracion?.trim() ?? "");
        const fin = dias && Number.isFinite(Date.parse(fecha)) ? Date.parse(fecha) + Number(dias[1]) * 86400000 : null;
        historial.push({ ...m, id: `${String(c.id ?? resumen.id)}-${i}`, fuente: String(c.id ?? resumen.id), fecha, estado: fin !== null && fin < Date.now() ? "finalizado" : "sin_confirmar" });
      }
    }
    return historial;
  }

  async verPaciente(pacienteId: string): Promise<Paciente> {
    return enCacheDePeticion(`paciente:${this.cacheId}:${pacienteId}`, () => this.leerPaciente(pacienteId));
  }

  private async leerPaciente(pacienteId: string): Promise<Paciente> {
    const real = aReal(pacienteId);
    const ruta = idSeguro(real, "id de paciente");
    const [p, historial] = await Promise.all([
      this.call<Json>("GET", `/patients/${ruta}`),
      this.medicacionActiva(real),
    ]);
    return { ...this.pacienteDeMegi(p, historial.filter(m => m.estado !== "finalizado")), historialMedicacion: historial };
  }

  /** `GET /consultations/{id}` (id real) una sola vez por acción. */
  private leerConsultaReal(real: string): Promise<Json> {
    const ruta = idSeguro(real, "id de consulta");
    return enCacheDePeticion(`consulta:${this.cacheId}:${real}`, () =>
      this.call<Json>("GET", `/consultations/${ruta}`),
    );
  }

  async verConsulta(consultaId: string): Promise<Consulta> {
    return this.consultaDeMegi(await this.leerConsultaReal(aReal(consultaId)));
  }

  /** ¿El backend responde «no existe la ruta»? (FastAPI: 404 {"detail":"Not Found"}). */
  private static rutaInexistente(e: unknown): boolean {
    return e instanceof MegiError && e.status === 404 && /^not found$/i.test(String((e.detalle as Json | null)?.detail ?? ""));
  }

  /** Recorre todas las páginas de una lectura paginada; una página incompleta o fallida aborta todo (nunca un resultado truncado). */
  private async paginas<T>(
    leer: (desde: number) => Promise<Json>,
    que: string,
  ): Promise<T[]> {
    const items: T[] = [];
    let desde = 0;
    let total: number | null = null;
    for (let vueltas = 0; ; vueltas++) {
      const r = await leer(desde);
      if (!r || typeof r !== "object" || !Array.isArray(r.items) || typeof r.total !== "number") {
        throw new MegiError(`Respuesta inválida de ${que}: página sin \`items\` o \`total\``, 502, { codigo: "pagina_invalida", respuesta: r });
      }
      if (total !== null && r.total !== total) {
        throw new MegiError(`${que} cambió durante la lectura (total ${total} → ${r.total}); vuelve a intentarlo`, 409, { codigo: "pagina_inconsistente" });
      }
      total = r.total;
      items.push(...(r.items as T[]));
      if (r.next_offset === null || r.next_offset === undefined) break;
      if (typeof r.next_offset !== "number" || r.next_offset <= desde || vueltas > 10_000) {
        throw new MegiError(`Respuesta inválida de ${que}: \`next_offset\` no avanza`, 502, { codigo: "pagina_invalida" });
      }
      desde = r.next_offset;
    }
    if (items.length !== total) {
      throw new MegiError(`${que} devolvió ${items.length} elementos de ${total}; lectura incompleta`, 502, { codigo: "pagina_incompleta" });
    }
    return items;
  }

  /**
   * Recetas aprobadas de varios pacientes en lotes paginados. Devuelve null si
   * el backend no tiene el endpoint (se usará el recorrido por consulta).
   */
  private async historialPorLotes(
    pacientesReales: string[],
    limitar: Limitador,
  ): Promise<Map<string, NonNullable<Paciente["historialMedicacion"]>> | null> {
    if (this.revisionPaginada === false || !pacientesReales.length) return this.revisionPaginada === false ? null : new Map();
    const ids = [...new Set(pacientesReales)].map((id) => { idSeguro(id, "id de paciente"); return id; });
    const filas: Json[] = [];
    try {
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100);
        filas.push(...await this.paginas<Json>(
          (desde) => limitar(() => this.call<Json>("POST", "/review/medication-history", { patient_ids: lote, limit: 200, offset: desde })),
          "POST /review/medication-history",
        ));
      }
    } catch (e) {
      if (MegiHttp.rutaInexistente(e)) { this.revisionPaginada = false; return null; }
      throw e;
    }
    this.revisionPaginada = true;
    const out = new Map<string, NonNullable<Paciente["historialMedicacion"]>>();
    const vistos = new Map<string, Set<string>>();
    for (const c of filas) {
      const pid = String(c.patient_id ?? "");
      if (!out.has(pid)) { out.set(pid, []); vistos.set(pid, new Set()); }
      const historial = out.get(pid)!;
      const fecha = String(c.approved_at ?? c.started_at ?? "");
      for (const [i, m] of rxDeMegi(parseJson<unknown>(c.prescription, []), fecha).entries()) {
        const clave = `${normaliza(m.nombre)}|${normaliza(m.dosis)}|${normaliza(m.frecuencia)}`;
        if (vistos.get(pid)!.has(clave)) continue;
        vistos.get(pid)!.add(clave);
        const dias = /^(\d+)\s*d[ií]as?$/i.exec(m.duracion?.trim() ?? "");
        const fin = dias && Number.isFinite(Date.parse(fecha)) ? Date.parse(fecha) + Number(dias[1]) * 86400000 : null;
        historial.push({ ...m, id: `${String(c.id)}-${i}`, fuente: String(c.id), fecha, estado: fin !== null && fin < Date.now() ? "finalizado" : "sin_confirmar" });
      }
    }
    return out;
  }

  async listarPendientes(pagina: { limite: number; desde: number }): Promise<PaginaPendientes> {
    const limite = Math.max(1, Math.min(200, Math.floor(pagina.limite)));
    const desde = Math.max(0, Math.floor(pagina.desde));
    if (this.revisionPaginada !== false) {
      let r: Json | null = null;
      try {
        r = await this.call<Json>("GET", `/review/pending?limit=${limite}&offset=${desde}`);
      } catch (e) {
        if (!MegiHttp.rutaInexistente(e)) throw e;
        this.revisionPaginada = false;
      }
      if (r) {
        if (!Array.isArray(r.items) || typeof r.total !== "number") {
          throw new MegiError("Respuesta inválida de GET /review/pending: faltan `items` o `total`", 502, { codigo: "pagina_invalida", respuesta: r });
        }
        this.revisionPaginada = true;
        const limitar = limitador(CONCURRENCIA);
        const items = r.items as Json[];
        const idsPacientes = [...new Set(items.map((it) => String(it.patient?.id ?? it.consultation?.patient_id ?? "")))].filter(Boolean);
        const historiales = (await this.historialPorLotes(idsPacientes, limitar)) ?? new Map<string, NonNullable<Paciente["historialMedicacion"]>>();
        const consultas = items.map((it): ConsultaConPaciente => {
          const c = it.consultation as Json;
          const p = (it.patient as Json | null) ?? { id: c.patient_id };
          const historial = historiales.get(String(p.id)) ?? [];
          const paciente = { ...this.pacienteDeMegi(p, historial.filter((m) => m.estado !== "finalizado")), historialMedicacion: historial };
          return { ...this.consultaDeMegi(c), paciente };
        });
        const siguiente = typeof r.next_offset === "number" ? r.next_offset : null;
        return { consultas, total: r.total, siguiente };
      }
    }
    // Backend sin lecturas paginadas: recorrido completo y paginación local.
    const todas = await this.listarRecorriendoPacientes();
    const consultas = todas.slice(desde, desde + limite);
    const siguiente = desde + consultas.length;
    return { consultas, total: todas.length, siguiente: siguiente < todas.length ? siguiente : null };
  }

  async listarConsultasCerradas(): Promise<ConsultaConPaciente[]> {
    // Si el total cambia entre páginas (alguien aprobó mientras leíamos) el
    // recorrido podría saltar o repetir una consulta: se reinicia desde cero;
    // tras tres intentos se informa en vez de devolver una lista dudosa.
    for (let intento = 0; intento < 3; intento++) {
      const out: ConsultaConPaciente[] = [];
      let desde: number | null = 0;
      let total: number | null = null;
      let reiniciar = false;
      while (desde !== null) {
        const pagina: PaginaPendientes = await this.listarPendientes({ limite: 200, desde });
        if (total !== null && pagina.total !== total) { reiniciar = true; break; }
        total = pagina.total;
        out.push(...pagina.consultas);
        if (pagina.siguiente !== null && pagina.siguiente <= desde) {
          throw new MegiError("La paginación de pendientes no avanza", 502, { codigo: "pagina_invalida" });
        }
        desde = pagina.siguiente;
      }
      if (!reiniciar) return out;
    }
    throw new MegiError("Las consultas pendientes cambiaron mientras se leían; vuelve a intentarlo", 409, { codigo: "pagina_inconsistente" });
  }

  /**
   * Recorrido anterior (paciente a paciente, consulta a consulta). Sigue
   * disponible como respaldo para backends sin `/review/pending` y para medir
   * el coste frente a la lectura paginada.
   */
  async listarRecorriendoPacientes(): Promise<ConsultaConPaciente[]> {
    const pacientes = await this.call<Json[]>("GET", "/patients");
    // Pacientes en paralelo; las peticiones hoja comparten UN límite de concurrencia.
    const limitar = limitador(CONCURRENCIA);
    const porPaciente = await Promise.all(pacientes.map(async (p) => {
      const lista = await limitar(() => this.call<Json[]>(
        "GET",
        `/patients/${idSeguro(String(p.id), "id de paciente")}/consultations`,
      ));
      // Consolidada (finalized) y todavía sin aprobar: es lo que hay que revisar.
      const pendientes = lista.filter(
        (c) =>
          c.finalized && c.status !== "approved" && c.status !== "exported",
      );
      if (!pendientes.length) return [];
      // La lista de consultas ya está leída: no se vuelve a pedir.
      const historial = await this.medicacionActiva(String(p.id), lista, limitar);
      const paciente = { ...this.pacienteDeMegi(p, historial.filter(m => m.estado !== "finalizado")), historialMedicacion: historial };
      const completas = await enLotes(pendientes, limitar, (c) =>
        this.leerConsultaReal(String(c.id)),
      );
      return completas.map((full): ConsultaConPaciente => ({ ...this.consultaDeMegi(full), paciente }));
    }));
    const out = porPaciente.flat();
    out.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return out;
  }

  // ---- seguridad --------------------------------------------------------
  async verificarReceta(
    pacienteId: string,
    farmacos: Medicamento[],
    medicacionConciliada?: Medicamento[],
    pacienteLeido?: Paciente,
  ): Promise<Record<string, Verificacion>> {
    const paciente = pacienteLeido ?? await this.verPaciente(pacienteId);
    // La receta se cruza también contra lo que YA toma: así una interacción
    // propuesto×activo (ibuprofeno × warfarina) sale aunque la warfarina no
    // esté en la receta de hoy.
    const activos = (medicacionConciliada ?? paciente.historialMedicacion?.filter(m => m.estado !== "finalizado" && m.estado !== "suspendido") ?? paciente.medicacionActiva).filter(
      (a) => !farmacos.some((f) => normaliza(f.nombre) === normaliza(a.nombre)),
    );
    const rx = [...rxAMegi(farmacos), ...rxAMegi(activos)];
    const r = await this.call<Json>(
      "POST",
      "/safety/rx-check",
      { rx_list: rx, allergies: paciente.alergias, chronic: paciente.cronicos },
      true,
      false, // lo valida `alertasDeMegi`, que distingue por qué está roto
    );

    const alertas = alertasDeMegi(r);

    // Una alerta que no se puede atribuir a NINGÚN fármaco enviado (sin
    // `drug`/`against`, o con nombres que no reconocemos) no se descarta: se
    // aplica a todos los fármacos propuestos. Antes caía en silencio y un
    // bloqueo global terminaba en `ok`. Las que sí se atribuyen pero solo a
    // la medicación activa (activo × activo) siguen fuera de la receta de hoy.
    const enviados = [...farmacos, ...activos].map((m) => ({
      nombre: m.nombre,
      etiqueta: rxAMegi([m])[0]!.drug,
    }));
    const atribuible = (a: Alerta) =>
      enviados.some(
        (m) =>
          esElMismo(a.farmaco, m.nombre, m.etiqueta) ||
          esElMismo(a.contra, m.nombre, m.etiqueta),
      );
    const sinAtribuir = alertas.filter((a) => !atribuible(a));

    const out: Record<string, Verificacion> = {};
    for (const f of farmacos) {
      const etiqueta = rxAMegi([f])[0]!.drug;
      const mias = [
        ...alertas.filter(
          (a) =>
            esElMismo(a.farmaco, f.nombre, etiqueta) ||
            esElMismo(a.contra, f.nombre, etiqueta),
        ),
        ...sinAtribuir,
      ];
      const bloqueo = mias.some((a) => a.severidad === "bloqueo");
      const v: Verificacion = {
        resultado: bloqueo ? "bloqueado" : mias.length ? "advertencia" : "ok",
        alertas: mias,
      };
      if (mias.length) v.motivo = mias.map((a) => a.mensaje).join(" · ");
      if (bloqueo)
        v.alternativas = await this.alternativas(pacienteId, f.nombre, paciente);
      out[f.nombre] = v;
    }
    return out;
  }

  async alternativas(
    pacienteId: string,
    farmaco: string,
    yaLeido?: Paciente,
  ): Promise<string[]> {
    // Primero MEGI (LLM + catálogo). Si el servicio MLX no está arriba
    // responde 503: se cae a una tabla local, declarada como tal.
    try {
      const paciente = yaLeido ?? (await this.verPaciente(pacienteId));
      const r = await this.call<Json>("POST", "/drugs/alternatives", {
        rx_list: [farmaco, ...paciente.medicacionActiva.map((m) => m.nombre)],
        farmaco_a: farmaco,
        farmaco_b:
          paciente.medicacionActiva[0]?.nombre ?? paciente.alergias[0] ?? "",
        severidad: "grave",
      });
      const s = (r.sugerencias ?? [])
        .map((x: any) =>
          typeof x === "string" ? x : (x?.texto ?? x?.farmaco ?? ""),
        )
        .filter(Boolean);
      if (s.length) return s;
    } catch (e) {
      if (!(e instanceof MegiError) || (e.status !== 503 && e.status !== 502))
        throw e;
    }
    const n = normaliza(farmaco);
    return ALTERNATIVAS_LOCALES.find((a) => a.cuando.test(n))?.sugerir ?? [];
  }

  // ---- cierre -----------------------------------------------------------
  async exportar(consultaId: string, plan: PlanAprobado): Promise<Exportacion> {
    const real = aReal(consultaId);
    const ruta = idSeguro(real, "id de consulta");
    const c = await this.leerConsultaReal(real);
    const paciente = await this.verPaciente(aLogico(c.patient_id));
    const soap =
      plan.soap ??
      soapDeMegi(
        parseJson<Json | null>(c.final_soap, null) ??
          parseJson<Json | null>(c.soap, null),
      );
    // Los pendientes van al Plan de la nota: MEGI no tiene campo aparte.
    const pendientesTxt = plan.pendientes.length
      ? ` Pendientes: ${plan.pendientes.join("; ")}.`
      : "";
    const soapFinal: Soap = { ...soap, p: (soap.p + pendientesTxt).trim() };

    // /review/approve recalcula la seguridad en el servidor y responde 409 si
    // hay bloqueos sin `safety_ack`: ese es el gate real, no la UI.
    const payload = {
      consultation_id: real,
      soap: soapAMegi(soapFinal),
      rx_list: rxAMegi(plan.farmacos),
      selected_dx: plan.diagnosticos.map((d) => ({
        code: d.cie10 ?? "",
        label: d.texto,
      })),
      allergies: paciente.alergias,
      chronic: paciente.cronicos,
      safety_ack: plan.confirmaAlertas,
      notes: plan.notas ?? "Plan revisado con el agente (MEGI Revisión)",
    };
    let aprobadaPor = c.approved_by ?? this.nombreMedico;
    if (c.status === "approved" || c.status === "exported") {
      // Un fallo al descargar el FHIR no deshace una aprobación remota.
      // Se recupera solo si MEGI conserva exactamente el plan que enviamos.
      const coincide =
        jsonCanonico(parseJson(c.prescription, [])) ===
          jsonCanonico(payload.rx_list) &&
        jsonCanonico(parseJson(c.approved_soap, null)) ===
          jsonCanonico(payload.soap) &&
        jsonCanonico(parseJson(c.dx_codes, [])) ===
          jsonCanonico(payload.selected_dx);
      if (!coincide)
        throw new MegiError(
          "La consulta ya fue aprobada con otro contenido en MEGI; revisa el expediente antes de continuar.",
          409,
        );
    } else {
      const r = await this.call<Json>("POST", "/review/approve", payload);
      aprobadaPor = r.approved_by ?? this.nombreMedico;
    }

    const [sello, fhir] = await Promise.all([
      this.call<Json>("GET", `/export/consultation/${ruta}`),
      this.call<Json>("GET", `/consultations/${ruta}/fhir`),
    ]);
    return {
      formato: "fhir",
      contenido: JSON.stringify(fhir, null, 2),
      sello: sello.content_hash,
      aprobadaPor,
    };
  }
}

export function crearMegiHttp(cfg?: MegiHttpConfig): MegiAdapter {
  return new MegiHttp(cfg);
}
