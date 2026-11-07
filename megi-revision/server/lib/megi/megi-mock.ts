/**
 * Adaptador MOCK: los mismos cuatro casos que la siembra de MEGI
 * (`megi-demo/backend/seed_demo.py`), en memoria. Imita las formas que el
 * adaptador http devuelve, para que la app, el agente y el guion sean
 * idénticos en `MEGI_MODE=mock` y en `MEGI_MODE=http`.
 *
 * Datos FICTICIOS. La verificación usa una tabla de reglas equivalente al
 * rx-check determinista de MEGI (alergia, crónico, interacción).
 */
import {
  MegiError,
  type Alerta,
  type Consulta,
  type ConsultaConPaciente,
  type Exportacion,
  type Medicamento,
  type MegiAdapter,
  type Paciente,
  type PlanAprobado,
  type Verificacion,
  type PaginaPendientes,
} from "./types.js";

function hoy(hora = 9): string {
  const d = new Date();
  d.setUTCHours(hora, 0, 0, 0);
  return d.toISOString();
}
function haceDias(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(10, 0, 0, 0);
  return d.toISOString();
}

const PACIENTES: Paciente[] = [
  {
    id: "demo-p1",
    nombre: "Alba Prueba Ficticia",
    edad: 34,
    sexo: "F",
    alergias: ["Penicilina"],
    cronicos: [],
    medicacionActiva: [],
  },
  {
    id: "demo-p2",
    nombre: "Mateo Ejemplo Demo",
    edad: 61,
    sexo: "M",
    alergias: [],
    cronicos: ["Hipertensión arterial"],
    medicacionActiva: [
      {
        nombre: "Losartán",
        dosis: "50 mg",
        frecuencia: "cada 24 h",
        duracion: "continuo",
        desde: haceDias(90),
      },
    ],
  },
  {
    id: "demo-p3",
    nombre: "Rosa Ficticia Muestra",
    edad: 72,
    sexo: "F",
    alergias: ["Sulfas"],
    cronicos: ["Fibrilación auricular", "Hipertensión arterial"],
    medicacionActiva: [
      {
        nombre: "Warfarina",
        dosis: "5 mg",
        frecuencia: "cada 24 h",
        duracion: "continuo",
        desde: haceDias(60),
      },
      {
        nombre: "Metoprolol",
        dosis: "50 mg",
        frecuencia: "cada 12 h",
        duracion: "continuo",
        desde: haceDias(60),
      },
    ],
  },
  {
    id: "demo-p4",
    nombre: "Luis Modelo Simulado",
    edad: 28,
    sexo: "M",
    alergias: ["Ninguna conocida"],
    cronicos: [],
    medicacionActiva: [],
  },
];

const CONSULTAS: Consulta[] = [
  {
    id: "demo-c1",
    pacienteId: "demo-p1",
    fecha: hoy(9),
    motivo: "Dolor de garganta y fiebre de 3 días",
    soap: {
      s: "Odinofagia intensa de 3 días de evolución, fiebre no cuantificada, sin tos ni rinorrea. Refiere alergia a penicilina (exantema en la infancia).",
      o: "Temp 38.5 °C, FC 92, TA 110/70. Amígdalas hiperémicas con exudado blanquecino bilateral. Adenopatías cervicales anteriores dolorosas. Sin tos. Centor 4.",
      a: "Faringoamigdalitis aguda, probable etiología bacteriana (estreptocócica).",
      p: "Iniciar antibiótico: amoxicilina 500 mg cada 8 h por 10 días. Paracetamol 500 mg cada 8 h si fiebre o dolor. Hidratación. Volver si dificultad respiratoria o persiste fiebre a las 72 h.",
    },
    diagnosticos: [
      { cie10: "J03.9", texto: "Amigdalitis aguda, no especificada" },
    ],
    medicamentosPropuestos: [
      "Amoxicilina 500 mg cada 8 h 10 días",
      "Paracetamol 500 mg cada 8 h",
    ],
    pendientes: [
      "Revalorar en 72 h si persiste fiebre",
      "Datos de alarma: dificultad respiratoria",
    ],
    estado: "pendiente",
    transcripcion:
      "Doctora, tengo tres días con dolor de garganta muy fuerte y fiebre. No tengo tos. Soy alérgica a la penicilina, de niña me dio ronchas.",
  },
  {
    id: "demo-c2",
    pacienteId: "demo-p2",
    fecha: hoy(10),
    motivo: "Control de presión y dolor lumbar",
    soap: {
      s: "Lumbalgia mecánica de 1 semana tras esfuerzo, sin irradiación ni déficit. Acude además a control de HTA.",
      o: "TA 142/90, FC 78. Contractura paravertebral lumbar, Lasègue negativo, fuerza y reflejos normales.",
      a: "Lumbalgia mecánica aguda. Hipertensión arterial con control subóptimo.",
      p: "Naproxeno 250 mg cada 12 h por 5 días para el dolor. Calor local y ejercicios. Continuar losartán; valorar ajuste si TA persiste alta. Solicitar química sanguínea y EGO. Control en 2 semanas.",
    },
    diagnosticos: [
      { cie10: "M54.5", texto: "Lumbago no especificado" },
      { cie10: "I10", texto: "Hipertensión esencial (primaria)" },
    ],
    medicamentosPropuestos: [
      "Naproxeno 250 mg cada 12 h 5 días",
      "Losartán 50 mg cada 24 h (continuar)",
    ],
    pendientes: [
      "Química sanguínea y EGO",
      "Control de TA en 2 semanas",
      "Ejercicios de columna",
    ],
    estado: "pendiente",
    transcripcion:
      "Vengo a control de la presión y además traigo dolor en la espalda baja desde hace una semana por cargar cajas.",
  },
  {
    id: "demo-c3",
    pacienteId: "demo-p3",
    fecha: hoy(11),
    motivo: "Dolor de rodilla derecha",
    soap: {
      s: "Gonalgia derecha de 2 semanas, mecánica, sin trauma. Anticoagulada con warfarina por FA; toma metoprolol.",
      o: "Rodilla derecha con leve derrame, sin eritema ni calor, crepitación, arcos de movilidad conservados. TA 130/82, FC 70 irregular.",
      a: "Gonartrosis derecha con sinovitis leve.",
      p: "Ibuprofeno 400 mg cada 8 h por 7 días. Paracetamol 1 g cada 8 h. Radiografía de rodilla AP y lateral. Fisioterapia. INR de control en 2 semanas.",
    },
    diagnosticos: [
      { cie10: "M17.1", texto: "Gonartrosis primaria, unilateral" },
    ],
    medicamentosPropuestos: [
      "Ibuprofeno 400 mg cada 8 h 7 días",
      "Paracetamol 1 g cada 8 h",
    ],
    pendientes: [
      "Radiografía de rodilla derecha AP y lateral",
      "INR en 2 semanas",
      "Fisioterapia",
    ],
    estado: "pendiente",
    transcripcion:
      "Me duele la rodilla derecha desde hace dos semanas. Sigo tomando mi anticoagulante y la pastilla del corazón.",
  },
  {
    id: "demo-c4",
    pacienteId: "demo-p4",
    fecha: hoy(12),
    motivo: "Cefalea tensional",
    soap: {
      s: "Cefalea opresiva bilateral casi diaria de 1 mes, vespertina, sin náusea, fotofobia ni aura. Privación de sueño (5 h) y estrés laboral.",
      o: "TA 118/76, FC 70. Exploración neurológica normal. Fondo de ojo normal. Contractura cervical.",
      a: "Cefalea tensional episódica frecuente.",
      p: "Paracetamol 1 g cada 8 h por razón necesaria, máximo 3 días a la semana. Higiene del sueño, pausas activas. Diario de cefalea. Control en 4 semanas.",
    },
    diagnosticos: [{ cie10: "G44.2", texto: "Cefalea de tipo tensión" }],
    medicamentosPropuestos: ["Paracetamol 1 g cada 8 h PRN"],
    pendientes: [
      "Diario de cefalea",
      "Higiene del sueño",
      "Control en 4 semanas",
    ],
    estado: "pendiente",
    transcripcion:
      "Tengo dolor de cabeza casi diario desde hace un mes, como una banda apretada. Duermo cinco horas por el trabajo.",
  },
];

// ------------------------------------------------------------ reglas
function n(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[-\s]/g, "");
}

const ALERGIAS: Record<string, string[]> = {
  penicilina: ["penicilin", "amoxicilin", "ampicilin", "dicloxacilin"],
  betalactam: [
    "penicilin",
    "amoxicilin",
    "ampicilin",
    "cefalexin",
    "cefuroxim",
    "ceftriaxon",
  ],
  sulfa: ["sulfameto", "sulfadiaz", "trimetoprim", "cotrimoxazol"],
  aine: [
    "ibuprofen",
    "naproxen",
    "ketorolac",
    "diclofenac",
    "acetilsalicil",
    "aspirin",
    "meloxicam",
  ],
  paracetamol: ["paracetamol", "acetaminofen"],
};
const CRONICOS: Array<{ farmaco: RegExp; cond: RegExp; msg: string }> = [
  {
    farmaco: /ibuprofen|naproxen|ketorolac|diclofenac|meloxicam|acetilsalicil/,
    cond: /hta|hipertension/,
    msg: "AINE puede elevar la presión arterial y reducir el efecto de antihipertensivos.",
  },
  {
    farmaco: /ibuprofen|naproxen|ketorolac|diclofenac|meloxicam/,
    cond: /renal|erc|nefro/,
    msg: "AINE en enfermedad renal: riesgo de daño renal agudo.",
  },
  {
    farmaco: /propranolol|atenolol|metoprolol|carvedilol/,
    cond: /asma|epoc/,
    msg: "Beta-bloqueador en asma/EPOC: riesgo de broncoespasmo.",
  },
  {
    farmaco: /ibuprofen|naproxen|diclofenac|ketorolac/,
    cond: /ulcera|gastritis|erge/,
    msg: "AINE con antecedente gastrointestinal: riesgo de sangrado/úlcera.",
  },
];
const INTERACCIONES: Array<{
  a: RegExp;
  b: RegExp;
  sev: "grave" | "moderada" | "leve";
  mec: string;
  rec: string;
}> = [
  {
    a: /ibuprofen|naproxen|ketorolac|diclofenac/,
    b: /warfarin/,
    sev: "grave",
    mec: "Los AINE inhiben la función plaquetaria y lesionan la mucosa gástrica; potencian el sangrado con anticoagulantes.",
    rec: "Evitar la combinación; usar paracetamol para el dolor.",
  },
  {
    a: /claritromicin/,
    b: /warfarin/,
    sev: "grave",
    mec: "Inhibición de CYP3A4/CYP2C9: aumenta el efecto anticoagulante.",
    rec: "Evitar o monitorizar INR estrechamente; considerar azitromicina.",
  },
  {
    a: /ibuprofen|naproxen/,
    b: /losartan/,
    sev: "moderada",
    mec: "Los AINE reducen el efecto antihipertensivo y aumentan el riesgo de daño renal con ARA II.",
    rec: "Usar el AINE el menor tiempo posible y vigilar TA y función renal.",
  },
  {
    a: /ibuprofen/,
    b: /metoprolol/,
    sev: "leve",
    mec: "Los AINE pueden atenuar el efecto del betabloqueador.",
    rec: "Vigilar TA si el uso es prolongado.",
  },
];
const ALTERNATIVAS: Array<{ cuando: RegExp; sugerir: string[] }> = [
  {
    cuando: /amoxicilin|ampicilin|penicilin|dicloxacilin/,
    sugerir: [
      "Azitromicina 500 mg cada 24 h 3 días",
      "Clindamicina 300 mg cada 8 h 10 días",
    ],
  },
  {
    cuando: /ibuprofen|naproxen|diclofenac|ketorolac|meloxicam/,
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

function etiqueta(m: Medicamento): string {
  return m.dosis ? `${m.nombre} ${m.dosis}`.trim() : m.nombre;
}

function alertasDe(paciente: Paciente, farmacos: Medicamento[]): Alerta[] {
  const alertas: Alerta[] = [];
  const activos = paciente.medicacionActiva.filter(
    (a) => !farmacos.some((f) => n(f.nombre) === n(a.nombre)),
  );
  const todos = [...farmacos, ...activos];
  for (const f of farmacos) {
    const fn = n(f.nombre);
    for (const al of paciente.alergias) {
      const aln = n(al);
      const pats = Object.entries(ALERGIAS)
        .filter(([k]) => aln.includes(k) || k.includes(aln))
        .flatMap(([, v]) => v);
      const stem = aln.endsWith("s") && aln.length > 4 ? aln.slice(0, -1) : aln;
      if (pats.some((p) => fn.includes(p)) || (stem && fn.includes(stem))) {
        alertas.push({
          severidad: "bloqueo",
          tipo: "alergia",
          farmaco: etiqueta(f),
          contra: al,
          mensaje: `${etiqueta(f)} puede relacionarse con la alergia a ${al}.`,
        });
      }
    }
    for (const r of CRONICOS) {
      if (!r.farmaco.test(fn)) continue;
      const c = paciente.cronicos.find((c) => r.cond.test(n(c)));
      if (c)
        alertas.push({
          severidad: "advertencia",
          tipo: "cronico",
          farmaco: etiqueta(f),
          contra: n(c),
          mensaje: `${etiqueta(f)}: ${r.msg}`,
        });
    }
  }
  for (let i = 0; i < todos.length; i++) {
    for (let j = i + 1; j < todos.length; j++) {
      const a = todos[i]!,
        b = todos[j]!;
      const x = n(a.nombre),
        y = n(b.nombre);
      const ix = INTERACCIONES.find(
        (r) => (r.a.test(x) && r.b.test(y)) || (r.a.test(y) && r.b.test(x)),
      );
      if (!ix) continue;
      alertas.push({
        severidad: ix.sev === "grave" ? "bloqueo" : "advertencia",
        tipo: "interaccion",
        farmaco: etiqueta(a),
        contra: etiqueta(b),
        mensaje: `${etiqueta(a)} + ${etiqueta(b)} (${ix.sev}): ${ix.mec} → ${ix.rec}`,
      });
    }
  }
  return alertas;
}

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return (
    "sha256:" +
    Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export class MegiMock implements MegiAdapter {
  private pacientes = new Map(PACIENTES.map((p) => [p.id, structuredClone(p)]));
  private consultas = new Map(CONSULTAS.map((c) => [c.id, structuredClone(c)]));
  private exportaciones = new Map<
    string,
    { plan: string; resultado: Exportacion }
  >();

  async estado() {
    return {
      disponible: true,
      modo: "mock",
      detalle: "datos ficticios en memoria",
    };
  }

  async verPaciente(pacienteId: string): Promise<Paciente> {
    const p = this.pacientes.get(pacienteId);
    if (!p)
      throw new MegiError(
        `MEGI GET /patients/${pacienteId} → 404: paciente no encontrado`,
        404,
      );
    const copia = structuredClone(p);
    copia.historialMedicacion = copia.medicacionActiva.map((m, i) => ({ ...m, id: `demo-previa-${pacienteId}-${i}`, fuente: `Receta histórica ${pacienteId}`, fecha: m.desde ?? "", estado: "sin_confirmar" }));
    return copia;
  }

  async verConsulta(consultaId: string): Promise<Consulta> {
    const c = this.consultas.get(consultaId);
    if (!c)
      throw new MegiError(
        `MEGI GET /consultations/${consultaId} → 404: consulta no encontrada`,
        404,
      );
    return structuredClone(c);
  }

  async listarConsultasCerradas(): Promise<ConsultaConPaciente[]> {
    const out: ConsultaConPaciente[] = [];
    for (const c of this.consultas.values()) {
      if (c.estado !== "pendiente") continue;
      out.push({
        ...structuredClone(c),
        paciente: await this.verPaciente(c.pacienteId),
      });
    }
    return out.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  async listarPendientes(pagina: { limite: number; desde: number }): Promise<PaginaPendientes> {
    const todas = await this.listarConsultasCerradas();
    const desde = Math.max(0, pagina.desde);
    const consultas = todas.slice(desde, desde + Math.max(1, pagina.limite));
    const siguiente = desde + consultas.length;
    return { consultas, total: todas.length, siguiente: siguiente < todas.length ? siguiente : null };
  }

  async verificarReceta(
    pacienteId: string,
    farmacos: Medicamento[],
    medicacionConciliada?: Medicamento[],
  ): Promise<Record<string, Verificacion>> {
    const paciente = await this.verPaciente(pacienteId);
    if (medicacionConciliada) paciente.medicacionActiva = medicacionConciliada;
    const alertas = alertasDe(paciente, farmacos);
    const out: Record<string, Verificacion> = {};
    for (const f of farmacos) {
      const e = etiqueta(f);
      const mias = alertas.filter((a) => a.farmaco === e || a.contra === e);
      const bloqueo = mias.some((a) => a.severidad === "bloqueo");
      const v: Verificacion = {
        resultado: bloqueo ? "bloqueado" : mias.length ? "advertencia" : "ok",
        alertas: mias,
      };
      if (mias.length) v.motivo = mias.map((a) => a.mensaje).join(" · ");
      if (bloqueo)
        v.alternativas = await this.alternativas(pacienteId, f.nombre);
      out[f.nombre] = v;
    }
    return out;
  }

  async alternativas(_pacienteId: string, farmaco: string): Promise<string[]> {
    const fn = n(farmaco);
    return ALTERNATIVAS.find((a) => a.cuando.test(fn))?.sugerir ?? [];
  }

  async exportar(consultaId: string, plan: PlanAprobado): Promise<Exportacion> {
    const c = this.consultas.get(consultaId);
    if (!c)
      throw new MegiError(
        `MEGI GET /consultations/${consultaId} → 404: consulta no encontrada`,
        404,
      );
    if (c.estado !== "pendiente") {
      const anterior = this.exportaciones.get(consultaId);
      if (anterior?.plan === JSON.stringify(plan))
        return structuredClone(anterior.resultado);
      throw new MegiError(
        `MEGI POST /review/approve → 409: la consulta ya está ${c.estado} con otro contenido`,
        409,
      );
    }
    const paciente = await this.verPaciente(c.pacienteId);
    if (plan.medicacionConciliada) paciente.medicacionActiva = plan.medicacionConciliada;
    // Mismo gate que MEGI: bloqueo sin confirmación → 409.
    const bloqueos = alertasDe(paciente, plan.farmacos).filter(
      (a) => a.severidad === "bloqueo",
    );
    if (bloqueos.length && !plan.confirmaAlertas) {
      throw new MegiError(
        `MEGI POST /review/approve → 409: Receta con alerta de seguridad sin confirmar: ${bloqueos.map((b) => b.mensaje).join("; ")}`,
        409,
      );
    }
    const soap = plan.soap ?? c.soap;
    const p = plan.pendientes.length
      ? `${soap.p} Pendientes: ${plan.pendientes.join("; ")}.`
      : soap.p;
    const ref = `Patient/${paciente.id}`;
    const bundle = {
      resourceType: "Bundle",
      type: "document",
      timestamp: new Date().toISOString(),
      entry: [
        {
          resource: {
            resourceType: "Composition",
            id: `nota-${c.id}`,
            status: "final",
            type: { text: "Nota médica (SOAP) NOM-004" },
            subject: { reference: ref },
            author: [{ display: "Dra. Demo Ficticia" }],
            title: "Nota médica",
            section: [
              ["S", soap.s],
              ["O", soap.o],
              ["A", soap.a],
              ["P", p],
            ].map(([t, v]) => ({
              title: t,
              text: {
                status: "generated",
                div: `<div xmlns="http://www.w3.org/1999/xhtml">${v}</div>`,
              },
            })),
          },
        },
        {
          resource: {
            resourceType: "Patient",
            id: paciente.id,
            name: [{ text: paciente.nombre }],
            gender: paciente.sexo === "F" ? "female" : "male",
          },
        },
        {
          resource: {
            resourceType: "Encounter",
            id: c.id,
            status: "finished",
            subject: { reference: ref },
          },
        },
        ...plan.diagnosticos.map((d, i) => ({
          resource: {
            resourceType: "Condition",
            id: `dx-${i}`,
            subject: { reference: ref },
            code: {
              coding: [
                {
                  system: "http://hl7.org/fhir/sid/icd-10",
                  code: d.cie10,
                  display: d.texto,
                },
              ],
              text: d.texto,
            },
          },
        })),
        ...plan.farmacos.map((m, i) => ({
          resource: {
            resourceType: "MedicationRequest",
            id: `rx-${i}`,
            status: "active",
            intent: "order",
            subject: { reference: ref },
            medicationCodeableConcept: { text: etiqueta(m) },
            dosageInstruction: [
              { text: `${m.dosis} ${m.frecuencia} ${m.duracion ?? ""}`.trim() },
            ],
          },
        })),
      ],
    };
    const contenido = JSON.stringify(bundle, null, 2);
    c.estado = "exportada";
    const resultado: Exportacion = {
      formato: "fhir",
      contenido,
      sello: await sha256(contenido),
      aprobadaPor: "Dra. Demo Ficticia",
    };
    this.exportaciones.set(consultaId, {
      plan: JSON.stringify(plan),
      resultado,
    });
    return structuredClone(resultado);
  }
}

export function crearMegiMock(): MegiAdapter {
  return new MegiMock();
}
