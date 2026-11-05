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
 * Qué endpoint usa cada método está en docs/api_megi_para_adaptador.md.
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
  private readonly base: string;
  private readonly user: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private token: string | null = null;
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
  ): Promise<T> {
    const r = await this.raw(method, path, body);
    if (r.status === 401 && reintento) {
      this.token = null; // sesión caducada o revocada: volver a entrar una vez
      return this.call<T>(method, path, body, false);
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
    return data as T;
  }

  private async sesion(): Promise<string> {
    if (this.token) return this.token;
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
    return {
      id: aLogico(p.id),
      nombre: p.name ?? "",
      edad: Number(p.age ?? 0),
      sexo: p.sex === "F" || p.sex === "M" ? p.sex : "X",
      alergias: Array.isArray(p.allergies) ? p.allergies : [],
      cronicos: Array.isArray(p.chronic) ? p.chronic : [],
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

  /** Última receta aprobada del paciente = medicación activa. */
  private async medicacionActiva(
    pacienteReal: string,
    yaLeida?: Json[],
  ): Promise<Medicamento[]> {
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
    const ultima = aprobadas[0]!;
    const c = await this.call<Json>(
      "GET",
      `/consultations/${idSeguro(String(ultima.id), "id de consulta")}`,
    );
    return rxDeMegi(
      parseJson<unknown>(c.prescription, []),
      c.approved_at ?? c.started_at,
    );
  }

  async verPaciente(pacienteId: string): Promise<Paciente> {
    const real = aReal(pacienteId);
    const ruta = idSeguro(real, "id de paciente");
    const [p, meds] = await Promise.all([
      this.call<Json>("GET", `/patients/${ruta}`),
      this.medicacionActiva(real),
    ]);
    return this.pacienteDeMegi(p, meds);
  }

  async verConsulta(consultaId: string): Promise<Consulta> {
    const c = await this.call<Json>(
      "GET",
      `/consultations/${idSeguro(aReal(consultaId), "id de consulta")}`,
    );
    return this.consultaDeMegi(c);
  }

  async listarConsultasCerradas(): Promise<ConsultaConPaciente[]> {
    const pacientes = await this.call<Json[]>("GET", "/patients");
    const out: ConsultaConPaciente[] = [];
    for (const p of pacientes) {
      const lista = await this.call<Json[]>(
        "GET",
        `/patients/${idSeguro(String(p.id), "id de paciente")}/consultations`,
      );
      // Consolidada (finalized) y todavía sin aprobar: es lo que hay que revisar.
      const pendientes = lista.filter(
        (c) =>
          c.finalized && c.status !== "approved" && c.status !== "exported",
      );
      if (!pendientes.length) continue;
      // La lista de consultas ya está leída: no se vuelve a pedir.
      const paciente = this.pacienteDeMegi(
        p,
        await this.medicacionActiva(String(p.id), lista),
      );
      for (const c of pendientes) {
        const full = await this.call<Json>(
          "GET",
          `/consultations/${idSeguro(String(c.id), "id de consulta")}`,
        );
        out.push({ ...this.consultaDeMegi(full), paciente });
      }
    }
    out.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return out;
  }

  // ---- seguridad --------------------------------------------------------
  async verificarReceta(
    pacienteId: string,
    farmacos: Medicamento[],
  ): Promise<Record<string, Verificacion>> {
    const paciente = await this.verPaciente(pacienteId);
    // La receta se cruza también contra lo que YA toma: así una interacción
    // propuesto×activo (ibuprofeno × warfarina) sale aunque la warfarina no
    // esté en la receta de hoy.
    const activos = paciente.medicacionActiva.filter(
      (a) => !farmacos.some((f) => normaliza(f.nombre) === normaliza(a.nombre)),
    );
    const rx = [...rxAMegi(farmacos), ...rxAMegi(activos)];
    const r = await this.call<Json>("POST", "/safety/rx-check", {
      rx_list: rx,
      allergies: paciente.alergias,
      chronic: paciente.cronicos,
    });

    const alertas: Alerta[] = (r.alerts ?? []).map((a: Json) => ({
      severidad: a.severity === "blocker" ? "bloqueo" : "advertencia",
      tipo: (["alergia", "cronico", "interaccion"] as const).includes(a.type)
        ? a.type
        : "otro",
      farmaco: a.drug ?? "",
      contra: a.against ?? "",
      mensaje: a.message ?? "",
    }));

    const out: Record<string, Verificacion> = {};
    for (const f of farmacos) {
      const etiqueta = rxAMegi([f])[0]!.drug;
      const mias = alertas.filter(
        (a) =>
          esElMismo(a.farmaco, f.nombre, etiqueta) ||
          esElMismo(a.contra, f.nombre, etiqueta),
      );
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
    const c = await this.call<Json>("GET", `/consultations/${ruta}`);
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
