// Reproducción de hallazgos H1/H2 del dictamen. No carga .env ni realiza peticiones reales.
// El resultado original (antes de corregir) se conserva en resultados/auditoria-independiente-2026-11-06.json;
// esta versión escribe resultados/auditoria-independiente-tras-correccion.json.
// Desde la raíz: megi-revision/node_modules/.bin/tsx evidencia/auditoria-independiente.mts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
process.env.MEGI_MODE = "http";
process.env.MEGI_USER = "servicio-ficticio";
process.env.MEGI_PASSWORD = "solo-prueba";
process.env.MEGI_URL = "http://fixture.invalid";
const { MegiHttp } = await import(new URL("megi-revision/server/lib/megi/megi-http.ts", root).href);
const { megi } = await import(new URL("megi-revision/server/lib/megi/index.ts", root).href);
const { exigirMedico } = await import(new URL("megi-revision/server/lib/plan.ts", root).href);
const checks: unknown[] = [];
for (const body of [
  {},
  { alerts: [] },
  { alerts: [{ severity: "blocker", drug: "", against: "", message: "Bloqueo global sin atribución" }] },
]) {
  const transport = async (url: string | URL | Request) => {
    const p = new URL(String(url)).pathname;
    // Lecturas paginadas de revisión (I3): este transporte simula un backend anterior (404) y el adaptador recorre consultas.
    if (/\/review\/(pending|medication-history)$/.test(p)) return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    const data = p.endsWith("/auth/login") ? { token: "ficticio" }
      : p.endsWith("/consultations") ? []
      : p.includes("/patients/") ? { id: "P-DEMO1", name: "Paciente Ficticio", allergies: ["Penicilina"] }
      : body;
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const adapter = new MegiHttp({ url: "http://fixture.invalid", user: "ficticio", password: "ficticio", fetchImpl: transport as typeof fetch });
  // Tras la corrección de H1, los cuerpos inválidos y el bloqueo sin atribución ya no terminan en `ok`:
  // se registra el resultado o el error (502, verificador_invalido) para compararlo con el dictamen.
  const result = await adapter.verificarReceta("demo-p1", [{ nombre: "Amoxicilina", dosis: "500 mg", frecuencia: "cada 8 h" }])
    .then((v) => ({ resultado: v.Amoxicilina.resultado, motivo: v.Amoxicilina.motivo }), (e: any) => ({ resultado: "rechazado", status: e.status, codigo: e.detalle?.codigo, error: e.message }));
  checks.push({ id: "respuesta-verificador", respuestaSimulada: body, ...result });
}
// H2: en modo http la instancia es única; sin MEGI_MEDICOS el acceso falla cerrado y con lista solo entran los correos declarados.
const acceso = (email: string) => megi(email).then(() => "concedido", (e: any) => ({ denegado: e.status, codigo: e.detalle?.codigo }));
checks.push({ id: "sesion-http-compartida", sinListaDeMedicos: { "medico-a": await acceso("medico-a@ficticio.test"), "medico-b": await acceso("medico-b@ficticio.test") } });
process.env.MEGI_MEDICOS = "medico-a@ficticio.test";
checks.push({ id: "sesion-http-con-lista", correoAjeno: await acceso("medico-b@ficticio.test"), alcance: "No se instancia el adaptador para el correo autorizado: no hay red." });
let permite = true; let codigo: string | undefined;
try { await exigirMedico({ caller: "frontend", userEmail: "sin-rol@ficticio.test" }); } catch (e: any) { permite = false; codigo = e.errorCode; }
checks.push({ id: "rol-medico", permiteFrontendSinRolClinico: permite, codigo, alcance: "Prueba unitaria del gate; el framework autentica la sesión por separado. No prueba una intrusión remota." });
const result = { fecha: new Date().toISOString(), entorno: "Sin red real, sin .env, transporte HTTP sintético, sin escrituras clínicas", referencia: "Reproducción de evidencia/resultados/auditoria-independiente-2026-11-06.json tras corregir H1 y H2", checks };
writeFileSync(fileURLToPath(new URL("resultados/auditoria-independiente-tras-correccion.json", import.meta.url)), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
