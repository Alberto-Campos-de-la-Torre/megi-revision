// I3 · Coste de listar pendientes y leer historial: recorrido paciente a paciente (anterior)
// frente a lecturas paginadas (/review/pending + /review/medication-history), con un backend
// SINTÉTICO en memoria (sin red, sin .env) de 10, 100 y 500 pacientes, más un expediente largo
// con un crónico antiguo relevante. Mide peticiones, bytes de respuesta, tiempo y concurrencia.
// Desde la raíz: megi-revision/node_modules/.bin/tsx evidencia/coste-historial.mts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const { MegiHttp } = await import(new URL("megi-revision/server/lib/megi/megi-http.ts", root).href);
const { enPeticionMegi } = await import(new URL("megi-revision/server/lib/megi/peticion.ts", root).href);

type Fila = Record<string, any>;
function backendSintetico(nPacientes: number, opciones: { pendientesCadaN?: number; aprobadasPorPaciente?: number; paciente0Largo?: number; paginaMax?: number; latenciaMs?: number } = {}) {
  const { pendientesCadaN = 2, aprobadasPorPaciente = 3, paciente0Largo = 0, paginaMax = 200, latenciaMs = 1 } = opciones;
  const pacientes: Fila[] = Array.from({ length: nPacientes }, (_, i) => ({ id: `P-S${i + 1}`, name: `Paciente sintético ${i + 1}`, age: 40, sex: "F", allergies: [], chronic: i === 0 ? ["Fibrilación auricular"] : [] }));
  const consultas: Fila[] = [];
  for (const [i, p] of pacientes.entries()) {
    const aprobadas = i === 0 && paciente0Largo ? paciente0Largo : aprobadasPorPaciente;
    for (let k = 1; k <= aprobadas; k++) {
      const fecha = new Date(Date.UTC(2026, 9, 1) - k * 7 * 86400000).toISOString();
      // El crónico antiguo del paciente 1 va en su consulta MÁS ANTIGUA: no debe perderse.
      const rx = i === 0 && k === aprobadas ? [{ drug: "Warfarina 5 mg", dose: "5 mg", freq: "cada 24 h", duration: "continuo" }] : [{ drug: `Fármaco${k} 10 mg`, dose: "10 mg", freq: "cada 24 h", duration: "7 días" }];
      consultas.push({ id: `C-${p.id}-${k}`, patient_id: p.id, status: "approved", started_at: fecha, finalized_at: fecha, approved_at: fecha, final_soap: JSON.stringify({ S: "s", O: "o", A: "a", P: "p" }), prescription: JSON.stringify(rx), transcript: "x".repeat(2000) });
    }
    if (i % pendientesCadaN === 0) consultas.push({ id: `C-${p.id}-hoy`, patient_id: p.id, status: "in_review", started_at: "2026-11-07T09:00:00Z", finalized_at: "2026-11-07T10:00:00Z", final_soap: JSON.stringify({ S: "s", O: "o", A: "a", P: "p" }), clinical_facts: JSON.stringify({ medicamentos_propuestos: ["Paracetamol 500 mg"], pendientes: [] }), transcript: "x".repeat(2000) });
  }
  const medidas = { peticiones: 0, bytes: 0, enVuelo: 0, maxEnVuelo: 0, porRuta: new Map<string, number>() };
  const fetchImpl = async (url: any, init: any) => {
    const u = new URL(String(url)); const path = u.pathname; const metodo = init?.method ?? "GET";
    medidas.peticiones++; medidas.enVuelo++; medidas.maxEnVuelo = Math.max(medidas.maxEnVuelo, medidas.enVuelo);
    const clave = `${metodo} ${path.replace(/P-S\d+/g, "P-S*").replace(/C-P-S\*-\w+|C-P-S\d+-\w+/g, "C-*")}`; medidas.porRuta.set(clave, (medidas.porRuta.get(clave) ?? 0) + 1);
    await new Promise((r) => setTimeout(r, latenciaMs)); medidas.enVuelo--;
    const json = (body: any, status = 200) => { const t = JSON.stringify(body); medidas.bytes += t.length; return new Response(t, { status, headers: { "content-type": "application/json" } }); };
    if (path.endsWith("/auth/login")) return json({ token: "t", name: "Médico sintético" });
    if (path.endsWith("/api/patients")) return json(pacientes);
    let m: RegExpExecArray | null;
    if ((m = /\/patients\/(P-S\d+)\/consultations$/.exec(path))) return json(consultas.filter((c) => c.patient_id === m![1]).map((c) => ({ id: c.id, status: c.status, started_at: c.started_at, finalized_at: c.finalized_at, finalized: true })));
    if ((m = /\/patients\/(P-S\d+)$/.exec(path))) return json(pacientes.find((p) => p.id === m![1]) ?? { detail: "no" }, pacientes.some((p) => p.id === m![1]) ? 200 : 404);
    if ((m = /\/consultations\/(C-[\w-]+)$/.exec(path))) { const c = consultas.find((x) => x.id === m![1]); return json(c ?? { detail: "no" }, c ? 200 : 404); }
    if (path.endsWith("/review/pending")) {
      const limit = Math.min(paginaMax, Number(u.searchParams.get("limit") ?? 50)), offset = Number(u.searchParams.get("offset") ?? 0);
      const pend = consultas.filter((c) => c.status === "in_review").sort((a, b) => b.finalized_at.localeCompare(a.finalized_at) || b.id.localeCompare(a.id));
      const items = pend.slice(offset, offset + limit).map((c) => { const { transcript, ...sin } = c; return { consultation: sin, patient: pacientes.find((p) => p.id === c.patient_id) }; });
      const next = offset + items.length; return json({ items, total: pend.length, limit, offset, next_offset: next < pend.length ? next : null });
    }
    if (path.endsWith("/review/medication-history")) {
      const body = JSON.parse(init.body); const limit = Math.min(paginaMax, body.limit ?? 100), offset = body.offset ?? 0;
      const filas = consultas.filter((c) => body.patient_ids.includes(c.patient_id) && c.status === "approved").sort((a, b) => a.patient_id.localeCompare(b.patient_id) || b.approved_at.localeCompare(a.approved_at)).map((c) => ({ id: c.id, patient_id: c.patient_id, status: c.status, started_at: c.started_at, approved_at: c.approved_at, prescription: c.prescription }));
      const items = filas.slice(offset, offset + limit); const next = offset + items.length; return json({ items, total: filas.length, limit, offset, next_offset: next < filas.length ? next : null });
    }
    return json({ detail: "Not Found" }, 404);
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, medidas, pacientes, consultas };
}

async function medir(nombre: string, fn: () => Promise<unknown>, medidas: ReturnType<typeof backendSintetico>["medidas"]) {
  medidas.peticiones = 0; medidas.bytes = 0; medidas.maxEnVuelo = 0; medidas.porRuta.clear();
  const t0 = performance.now(); const resultado = await fn(); const ms = Math.round(performance.now() - t0);
  return { nombre, peticiones: medidas.peticiones, kb: Math.round(medidas.bytes / 1024), ms, maxEnVuelo: medidas.maxEnVuelo, porRuta: Object.fromEntries(medidas.porRuta), resultado };
}

const salida: any = { fecha: new Date().toISOString(), entorno: "Backend sintético en memoria (1 ms por petición), sin red ni .env; mide el adaptador http real", escenarios: [] };
for (const n of [10, 100, 500]) {
  const b = backendSintetico(n);
  const adaptador = () => new MegiHttp({ url: "http://sintetico.invalid", user: "u", password: "p", fetchImpl: b.fetchImpl });
  const anterior = await medir("recorrido paciente a paciente (anterior)", () => enPeticionMegi(() => adaptador().listarRecorriendoPacientes()), b.medidas);
  const pagina = await medir("primera página de 20 (nuevo)", () => enPeticionMegi(() => adaptador().listarPendientes({ limite: 20, desde: 0 })), b.medidas);
  const todas = await medir("todas las páginas (nuevo)", () => enPeticionMegi(() => adaptador().listarConsultasCerradas()), b.medidas);
  const pendientes = (anterior.resultado as any[]).length;
  const coinciden = JSON.stringify((anterior.resultado as any[]).map((c) => c.id).sort()) === JSON.stringify((todas.resultado as any[]).map((c) => c.id).sort());
  salida.escenarios.push({ pacientes: n, consultasPendientes: pendientes, consultasAprobadas: b.consultas.length - pendientes, coincidenAnteriorYNuevo: coinciden,
    mediciones: [anterior, pagina, todas].map(({ resultado, ...m }) => m),
    limitesEsperados: { anterior: "1 + pacientes + pendientes + aprobadas (≥ 1 petición por consulta)", primeraPagina: "1 GET /review/pending + ⌈pacientes de la página / 100⌉ × ⌈filas / 200⌉ POST /review/medication-history", todas: "⌈pendientes / 200⌉ páginas + sus lotes de historial" } });
  console.log(`${n} pacientes · ${pendientes} pendientes · anterior ${anterior.peticiones} peticiones/${anterior.kb} KB/${anterior.ms} ms · primera página ${pagina.peticiones}/${pagina.kb} KB/${pagina.ms} ms · todas ${todas.peticiones}/${todas.kb} KB/${todas.ms} ms · coinciden=${coinciden}`);
}
// Expediente largo: 60 recetas aprobadas y el crónico antiguo en la más vieja.
{
  const b = backendSintetico(5, { paciente0Largo: 60, paginaMax: 25 });
  const adaptador = () => new MegiHttp({ url: "http://sintetico.invalid", user: "u", password: "p", fetchImpl: b.fetchImpl });
  const largo = await medir("paciente con 60 recetas aprobadas, página de 25 (nuevo)", () => enPeticionMegi(() => adaptador().verPaciente("P-S1")), b.medidas);
  const historial = (largo.resultado as any).historialMedicacion as any[];
  const warfarina = historial.find((m) => /warfarina/i.test(m.nombre));
  const legado = new MegiHttp({ url: "http://sintetico.invalid", user: "u", password: "p", fetchImpl: (async (url: any, init: any) => { const p = new URL(String(url)).pathname; if (/\/review\//.test(p)) return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } }); return (b.fetchImpl as any)(url, init); }) as unknown as typeof fetch });
  const anterior = await medir("mismo paciente, recorrido consulta a consulta (anterior)", () => enPeticionMegi(() => legado.verPaciente("P-S1")), b.medidas);
  const warfarinaAnterior = ((anterior.resultado as any).historialMedicacion as any[]).find((m) => /warfarina/i.test(m.nombre));
  salida.expedienteLargo = { recetasAprobadas: 60, paginaDelServidor: 25, cronicoAntiguoConservado: Boolean(warfarina) && warfarina.estado === "sin_confirmar" && warfarina.fuente === "C-P-S1-60", cronicoAntiguoEnAnterior: Boolean(warfarinaAnterior), entradasHistorial: historial.length, mediciones: [largo, anterior].map(({ resultado, ...m }) => m) };
  console.log(`expediente largo · nuevo ${largo.peticiones} peticiones (${largo.porRuta["POST /api/review/medication-history"]} páginas de historial) · anterior ${anterior.peticiones} · warfarina antigua conservada=${salida.expedienteLargo.cronicoAntiguoConservado}`);
}
writeFileSync(fileURLToPath(new URL("resultados/coste-historial.json", import.meta.url)), JSON.stringify(salida, null, 2) + "\n");
const falla = salida.escenarios.some((e: any) => !e.coincidenAnteriorYNuevo) || !salida.expedienteLargo.cronicoAntiguoConservado;
process.exitCode = falla ? 1 : 0;
