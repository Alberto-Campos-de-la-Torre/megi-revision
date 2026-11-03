/**
 * Prueba de humo del adaptador http contra el backend de DEMO.
 *
 *   cd adaptador-megi
 *   MEGI_URL=http://127.0.0.1:8020 MEGI_USER=demo_medico MEGI_PASSWORD=demo-megi-2026 \
 *     node probar-adaptador.ts
 *
 * Recorre el guion completo con los 4 casos y termina APROBANDO y exportando
 * la consulta demo-c4 (caso limpio). Después hay que volver a sembrar:
 *   cd ../megi-demo/backend && MEGI_MODE=local_mock .venv/bin/python seed_demo.py
 */
import { MegiHttp, aLogico, aReal } from "./lib/megi/megi-http.ts";
import { MegiError } from "./lib/megi/types.ts";

let fallos = 0;
function ok(cond: unknown, msg: string) {
  console.log(`${cond ? "✔" : "✘"} ${msg}`);
  if (!cond) fallos++;
}

async function main() {
  const m = new MegiHttp();

  console.log("\n— ids lógicos");
  ok(aReal("demo-p1") === "P-DEMO1" && aLogico("P-DEMO1") === "demo-p1", "demo-p1 ↔ P-DEMO1");
  ok(aReal("demo-c3-prev") === "C-DEMO3-PREV" && aLogico("C-DEMO3-PREV") === "demo-c3-prev", "demo-c3-prev ↔ C-DEMO3-PREV");
  ok(aReal("P-ABC123") === "P-ABC123", "ids no demo pasan intactos");

  console.log("\n— estado");
  const st = await m.estado();
  ok(st.disponible, `backend disponible (modo ${st.modo})`);

  console.log("\n— listar consultas cerradas");
  const lista = await m.listarConsultasCerradas();
  ok(lista.length === 4, `4 consultas pendientes de revisión (hay ${lista.length})`);
  for (const c of lista) console.log(`   ${c.id} · ${c.paciente.nombre} · ${c.motivo} · activos: ${c.paciente.medicacionActiva.map((x) => x.nombre).join(", ") || "—"}`);

  console.log("\n— paciente demo-p3 (Rosa)");
  const rosa = await m.verPaciente("demo-p3");
  ok(rosa.alergias.includes("Sulfas"), "alergia a sulfas");
  ok(rosa.medicacionActiva.some((x) => /warfarina/i.test(x.nombre)), "warfarina en medicación activa (consulta previa aprobada)");

  console.log("\n— paciente demo-p2 (Mateo): alergias vacías = sin registro");
  const mateo = await m.verPaciente("demo-p2");
  ok(mateo.alergias.length === 0, "lista de alergias vacía");

  console.log("\n— consulta demo-c1 (Alba)");
  const c1 = await m.verConsulta("demo-c1");
  ok(c1.estado === "pendiente" && c1.soap.p.length > 0, "consolidada y pendiente, con plan");
  ok(c1.diagnosticos[0]?.cie10 === "J03.9", `dx ${c1.diagnosticos[0]?.cie10} ${c1.diagnosticos[0]?.texto}`);
  ok(c1.pendientes.length >= 2, `${c1.pendientes.length} pendientes detectados`);

  console.log("\n— caso 1: amoxicilina con alergia a penicilina → bloqueado");
  const v1 = await m.verificarReceta("demo-p1", [
    { nombre: "Amoxicilina", dosis: "500 mg", frecuencia: "cada 8 h", duracion: "10 días" },
    { nombre: "Paracetamol", dosis: "500 mg", frecuencia: "cada 8 h" },
  ]);
  ok(v1["Amoxicilina"].resultado === "bloqueado", `amoxicilina: ${v1["Amoxicilina"].resultado} — ${v1["Amoxicilina"].motivo}`);
  ok((v1["Amoxicilina"].alternativas ?? []).length > 0, `alternativas: ${v1["Amoxicilina"].alternativas?.join(" | ")}`);
  ok(v1["Paracetamol"].resultado === "ok", "paracetamol: ok");

  console.log("\n— caso 3: ibuprofeno con warfarina activa → bloqueado (interacción grave)");
  const v3 = await m.verificarReceta("demo-p3", [
    { nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 h", duracion: "7 días" },
    { nombre: "Paracetamol", dosis: "1 g", frecuencia: "cada 8 h" },
  ]);
  ok(v3["Ibuprofeno"].resultado === "bloqueado", `ibuprofeno: ${v3["Ibuprofeno"].resultado}`);
  ok(v3["Ibuprofeno"].alertas?.some((a) => a.tipo === "interaccion"), "la alerta es de interacción con la warfarina activa");
  ok(v3["Paracetamol"].resultado === "ok", "paracetamol: ok");

  console.log("\n— caso 2: naproxeno con HTA y losartán → advertencia (no bloquea)");
  const v2 = await m.verificarReceta("demo-p2", [{ nombre: "Naproxeno", dosis: "250 mg", frecuencia: "cada 12 h", duracion: "5 días" }]);
  ok(v2["Naproxeno"].resultado === "advertencia", `naproxeno: ${v2["Naproxeno"].resultado} (${v2["Naproxeno"].alertas?.length} alertas)`);

  console.log("\n— caso 4: paracetamol sin conflictos → ok");
  const v4 = await m.verificarReceta("demo-p4", [{ nombre: "Paracetamol", dosis: "1 g", frecuencia: "cada 8 h PRN" }]);
  ok(v4["Paracetamol"].resultado === "ok", "paracetamol: ok");

  console.log("\n— caso roto: exportar con bloqueo sin confirmar → MEGI responde 409");
  try {
    await m.exportar("demo-c1", {
      farmacos: [{ nombre: "Amoxicilina", dosis: "500 mg", frecuencia: "cada 8 h" }],
      pendientes: [], diagnosticos: c1.diagnosticos, confirmaAlertas: false,
    });
    ok(false, "debió rechazar");
  } catch (e) {
    ok(e instanceof MegiError && e.status === 409, `rechazado: ${(e as Error).message.slice(0, 110)}…`);
  }

  console.log("\n— caso roto: consulta inexistente → error claro");
  try {
    await m.verConsulta("demo-c99");
    ok(false, "debió fallar");
  } catch (e) {
    ok(e instanceof MegiError && e.status === 404, `404: ${(e as Error).message}`);
  }

  console.log("\n— cierre: aprobar y exportar demo-c4");
  const c4 = await m.verConsulta("demo-c4");
  const ex = await m.exportar("demo-c4", {
    farmacos: [{ nombre: "Paracetamol", dosis: "1 g", frecuencia: "cada 8 h PRN", duracion: "máx 3 días/semana" }],
    pendientes: c4.pendientes,
    diagnosticos: c4.diagnosticos,
    confirmaAlertas: false,
    notas: "Prueba del adaptador",
  });
  ok(ex.formato === "fhir" && ex.contenido.includes("MedicationRequest"), `exportado FHIR, sello ${ex.sello?.slice(0, 20)}… por ${ex.aprobadaPor}`);
  const c4b = await m.verConsulta("demo-c4");
  ok(c4b.estado === "exportada", `estado tras exportar: ${c4b.estado}`);
  const lista2 = await m.listarConsultasCerradas();
  ok(lista2.length === 3, `quedan ${lista2.length} pendientes`);

  console.log("\n— caso roto 5: backend apagado");
  const caido = new MegiHttp({ url: "http://127.0.0.1:1", timeoutMs: 1500 });
  try {
    await caido.verPaciente("demo-p1");
    ok(false, "debió fallar");
  } catch (e) {
    ok(e instanceof MegiError && /no responde/.test((e as Error).message), (e as Error).message);
  }

  console.log(`\n${fallos ? `${fallos} fallos` : "todo correcto"}\n`);
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error("Error inesperado:", e);
  process.exit(2);
});
