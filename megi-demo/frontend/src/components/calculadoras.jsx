import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";

// ============ CALCULADORAS CLÍNICAS (gasometría / ácido-base) ============
// La aritmética vive en el backend (`services/gasometria.py`) con pruebas: aquí
// solo se capturan valores y se muestra el resultado. Deliberadamente NO se
// guarda nada en el expediente — el médico decide qué pasa a la nota.
//
// La serie cubre las "gasometrías seriadas" del paciente crítico: una aislada
// dice poco, lo que orienta es hacia dónde va.

const CAMPOS = [
  { k: "ph", label: "pH", req: true, ph: "7.35 – 7.45" },
  { k: "pco2", label: "PCO₂", req: true, ph: "mmHg · 35 – 45" },
  { k: "hco3", label: "HCO₃⁻", req: true, ph: "mEq/L · 22 – 26" },
  { k: "na", label: "Na⁺", ph: "mEq/L" },
  { k: "cl", label: "Cl⁻", ph: "mEq/L" },
  { k: "k", label: "K⁺", ph: "mEq/L" },
  { k: "albumina", label: "Albúmina", ph: "g/dL" },
  { k: "glucosa", label: "Glucosa", ph: "mg/dL" },
  { k: "calcio", label: "Calcio", ph: "mg/dL" },
  { k: "pao2", label: "PaO₂", ph: "mmHg" },
  { k: "fio2", label: "FiO₂", ph: "0.21 – 1.0" },
  { k: "lactato", label: "Lactato", ph: "mmol/L" },
];

const VACIO = Object.fromEntries(CAMPOS.map((c) => [c.k, ""]));

const num = (v) => (v === "" || v === null ? null : Number(v));

// Fila de resultado: mismo ritmo que los fragmentos del lector de Guías
// (etiqueta mono arriba, texto a 12.5 con interlineado 1.6).
const Fila = ({ etiqueta, valor, detalle }) => (
  <div style={{ paddingBottom: 12, borderBottom: "1px dashed var(--hair)" }}>
    <div className="field-label">{etiqueta}</div>
    <div style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 4 }}>{valor}</div>
    {detalle && (
      <div className="mono" style={{ fontSize: 9.5, color: "var(--gold)", marginTop: 4, lineHeight: 1.5 }}>
        {detalle}
      </div>
    )}
  </div>
);

const Calculadoras = () => {
  const [v, setV] = React.useState(VACIO);
  const [res, setRes] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [serie, setSerie] = React.useState([]);
  const [tend, setTend] = React.useState(null);

  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }));

  const calcular = async () => {
    setBusy(true); setErr(null);
    const cuerpo = {};
    CAMPOS.forEach((c) => { const n = num(v[c.k]); if (n !== null && !Number.isNaN(n)) cuerpo[c.k] = n; });
    try {
      setRes(await api.calcularGasometria(cuerpo));
    } catch (e) {
      setRes(null);
      setErr(e.message || "no se pudo calcular");
    } finally {
      setBusy(false);
    }
  };

  // Añade la medición actual a la serie del paciente crítico y recalcula la
  // tendencia. La serie vive solo en esta pantalla, no se guarda.
  const agregarASerie = async () => {
    const punto = { hora: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) };
    ["ph", "pco2", "hco3", "lactato"].forEach((k) => { const n = num(v[k]); if (n !== null && !Number.isNaN(n)) punto[k] = n; });
    const nueva = [...serie, punto];
    setSerie(nueva);
    if (nueva.length >= 2) {
      try { setTend(await api.calcularTendencia(nueva)); } catch (e) { /* la serie sigue visible */ }
    }
  };

  const limpiar = () => { setV(VACIO); setRes(null); setErr(null); };
  const limpiarSerie = () => { setSerie([]); setTend(null); };

  const faltanObligatorios = CAMPOS.filter((c) => c.req).some((c) => v[c.k] === "");

  return (
    <div className="page">
      <div style={{ marginBottom: 20 }}>
        <Eyebrow style={{ fontSize: 12, fontWeight: 600 }}>Herramienta clínica</Eyebrow>
        <h1 className="h-page" style={{ marginTop: 8 }}>Gasometría y ácido-base</h1>
        <p style={{ marginTop: 8, color: "var(--ink-2)", fontSize: 14 }}>
          Fórmula de Winter, anión gap corregido, electrolitos y PaO₂/FiO₂. Cálculo
          determinista, con la fórmula a la vista; no se guarda en el expediente.
        </p>
      </div>

      {err && (
        <div className="card" style={{ borderLeft: "3px solid var(--danger)", marginBottom: 16 }}>
          <Eyebrow>Dato fuera de rango</Eyebrow>
          <div style={{ fontSize: 13, marginTop: 6, color: "var(--ink-2)" }}>{err}</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 24 }} className="pacientes-grid">
        {/* CAPTURA */}
        <section className="card">
          <Eyebrow>Valores del estudio</Eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 12, marginTop: 12 }}>
            {CAMPOS.map((c) => (
              <div key={c.k}>
                <label className="field-label" htmlFor={`g-${c.k}`}>
                  {c.label}{c.req ? " *" : ""}
                </label>
                <input
                  id={`g-${c.k}`} className="input mono" type="number" step="any" inputMode="decimal"
                  value={v[c.k]} onChange={set(c.k)} placeholder={c.ph}
                  aria-label={c.label} style={{ width: "100%", fontSize: 12 }}
                />
              </div>
            ))}
          </div>
          <div className="row g-8 center wrap" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={calcular} disabled={busy || faltanObligatorios}>
              {busy ? "Calculando…" : "Interpretar"}
            </button>
            <button className="btn sm" onClick={agregarASerie} disabled={faltanObligatorios}>+ Añadir a la serie</button>
            <button className="btn ghost sm" onClick={limpiar}>Limpiar</button>
          </div>
          {faltanObligatorios && (
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 10 }}>
              pH, PCO₂ y HCO₃⁻ son obligatorios; el resto enriquece la lectura.
            </div>
          )}
        </section>

        {/* LECTURA */}
        <aside>
          {!res ? (
            <div className="card" style={{ color: "var(--ink-2)", fontStyle: "italic", fontSize: 13 }}>
              Captura al menos pH, PCO₂ y HCO₃⁻ para interpretar el estudio.
            </div>
          ) : (
            <div className="card">
              <Eyebrow>Lectura</Eyebrow>
              <div className="row center g-8" style={{ marginTop: 6, flexWrap: "wrap" }}>
                <h2 className="h-section" style={{ fontSize: 22 }}>{res.trastorno_primario}</h2>
                {res.certeza === "probable" && <Pill>probable</Pill>}
              </div>
              {res.valores && (
                // Resumen de lo capturado. Blindado: que falte un campo no puede
                // tumbar la pantalla entera del médico.
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 4 }}>
                  pH {res.valores.ph} · PCO₂ {res.valores.pco2} · HCO₃⁻ {res.valores.hco3}
                </div>
              )}
              <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-2)", marginTop: 10 }}>
                {res.motivo}
              </div>

              <div className="col g-14" style={{ marginTop: 16 }}>
                {res.compensacion && (
                  <Fila etiqueta="Compensación" valor={res.compensacion.lectura}
                        detalle={`${res.compensacion.parametro} esperado ${res.compensacion.min}–${res.compensacion.max} · medido ${res.compensacion.medido} · ${res.compensacion.formula}`} />
                )}
                {res.anion_gap && (
                  <Fila etiqueta="Anión gap"
                        valor={`${res.anion_gap.usado} mEq/L — ${res.anion_gap.elevado ? "elevado" : "normal"}`}
                        detalle={res.anion_gap.corregido !== undefined
                          ? `crudo ${res.anion_gap.valor} · corregido por albúmina ${res.anion_gap.corregido} · ${res.anion_gap.formula}`
                          : `sin albúmina: no se pudo corregir · ${res.anion_gap.formula}`} />
                )}
                {res.delta_delta?.aplica && (
                  <Fila etiqueta="Delta / Delta" valor={res.delta_delta.lectura}
                        detalle={`ratio ${res.delta_delta.ratio} · ${res.delta_delta.formula}`} />
                )}
                {res.correcciones?.sodio && (
                  <Fila etiqueta="Na⁺ corregido" valor={`${res.correcciones.sodio.katz} mEq/L`}
                        detalle={`Hillier (2.4): ${res.correcciones.sodio.hillier} · ${res.correcciones.sodio.formula}`} />
                )}
                {res.correcciones?.calcio && (
                  <Fila etiqueta="Ca corregido" valor={`${res.correcciones.calcio.valor} mg/dL`}
                        detalle={res.correcciones.calcio.formula} />
                )}
                {res.oxigenacion && (
                  <Fila etiqueta="PaO₂ / FiO₂" valor={`${res.oxigenacion.valor} — ${res.oxigenacion.clasificacion}`}
                        detalle={res.oxigenacion.formula} />
                )}
                {res.hallazgos?.length > 0 && (
                  <Fila etiqueta="Hallazgos" valor={
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {res.hallazgos.map((h, i) => <li key={i} style={{ marginBottom: 3 }}>{h}</li>)}
                    </ul>
                  } />
                )}
              </div>

              <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 14, lineHeight: 1.5 }}>
                {res.aviso}
              </div>
            </div>
          )}

          {serie.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="row between center">
                <div>
                  <Eyebrow>Gasometrías seriadas</Eyebrow>
                  <h2 className="h-section" style={{ fontSize: 20, marginTop: 6 }}>Serie ({serie.length})</h2>
                </div>
                <button className="btn ghost sm" onClick={limpiarSerie}>Vaciar</button>
              </div>
              <div className="table-scroll" style={{ marginTop: 12 }}>
                <table className="mono" style={{ fontSize: 11, borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--ink-2)" }}>
                      {["hora", "pH", "PCO₂", "HCO₃⁻", "lactato"].map((h) => (
                        <th key={h} style={{ padding: "4px 12px 6px 0", fontWeight: 400, letterSpacing: ".06em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {serie.map((p, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--hair)" }}>
                        <td style={{ padding: "6px 12px 6px 0" }}>{p.hora}</td>
                        <td style={{ padding: "6px 12px 6px 0" }}>{p.ph ?? "—"}</td>
                        <td style={{ padding: "6px 12px 6px 0" }}>{p.pco2 ?? "—"}</td>
                        <td style={{ padding: "6px 12px 6px 0" }}>{p.hco3 ?? "—"}</td>
                        <td style={{ padding: "6px 12px 6px 0" }}>{p.lactato ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tend?.suficiente ? (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--hair)" }}>
                  <div className="field-label">Tendencia</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 4 }}>{tend.resumen}</div>
                  <div className="mono" style={{ fontSize: 9.5, color: "var(--gold)", marginTop: 4, lineHeight: 1.6 }}>
                    {Object.entries(tend.parametros).map(([k, p]) => `${k}: ${p.inicial} → ${p.actual} (${p.direccion})`).join(" · ")}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 12, fontStyle: "italic" }}>
                  Añade una segunda gasometría para ver la tendencia.
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default Calculadoras;
