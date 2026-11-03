import React from "react";
import { Eyebrow, Pill, Corners } from "./shared";
import { api } from "../api/client";
import MotivoConsulta from "./motivo_consulta";
import { usePatients } from "../api/MegiDataProvider";
import AudioPlayer from "./audio_player";
import PreconsultaPanel from "./preconsulta_panel";
import ExpedienteLLM from "./expediente_llm";

// ============ PACIENTES · DIRECTORIO + HISTORIAL (v0.0.1) ============
const SECTIONS = [
  { k: "S", name: "Subjetivo" }, { k: "O", name: "Objetivo" },
  { k: "A", name: "Análisis" }, { k: "P", name: "Plan" },
];

const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-MX", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch (e) { return iso; }
};

const Pacientes = ({ onStart, user, onReview, focusPatient }) => {
  // Motivo de ESTA consulta. No se prellena con `selected.reason`: ese es el del
  // alta del paciente y puede tener meses — quien se registró por lumbalgia en
  // marzo puede volver en julio por otra cosa. Prellenarlo con el viejo haría
  // que el médico lo aceptara sin mirar, que es peor que dejarlo vacío.
  const [pidiendoMotivo, setPidiendoMotivo] = React.useState(false);
  const patients = usePatients();
  // Lo que el médico tenía abierto aquí (búsqueda, paciente, consulta desplegada)
  // sobrevive a salir y volver: «Revisar nota» y el atrás del navegador vuelven a
  // montar esta pantalla, y antes volvía en blanco (con cientos de pacientes,
  // eso es volver a buscar). Se guarda en la sesión del navegador, por pestaña.
  const guardado = React.useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem("megi.pacientes") || "null") || {}; } catch (e) { return {}; }
  }, []);
  const [query, setQuery] = React.useState(guardado.query || "");
  const [selected, setSelected] = React.useState(() => (guardado.selectedId && patients.find((p) => p.id === guardado.selectedId)) || null);
  const [history, setHistory] = React.useState(null);
  const [loadingHist, setLoadingHist] = React.useState(false);
  const [openConsult, setOpenConsult] = React.useState(null);
  const restaurarConsult = React.useRef(guardado.openConsult || null);   // se aplica cuando llega el historial

  // Los pacientes pueden llegar después del primer render: se completa la selección guardada.
  React.useEffect(() => {
    if (!selected && guardado.selectedId) {
      const p = patients.find((x) => x.id === guardado.selectedId);
      if (p) setSelected(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients]);

  React.useEffect(() => {
    try {
      sessionStorage.setItem("megi.pacientes", JSON.stringify({ query, selectedId: selected?.id || null, openConsult }));
    } catch (e) { /* sin almacenamiento: no pasa nada */ }
  }, [query, selected, openConsult]);
  const [appointments, setAppointments] = React.useState([]);
  const [vitalsHist, setVitalsHist] = React.useState([]);

  const filtered = patients.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    (p.curp || "").toLowerCase().includes(query.toLowerCase()) ||
    p.reason.toLowerCase().includes(query.toLowerCase())
  );

  // "MEGI, abrir paciente X" (Fase 2): enfoca ese expediente al entrar a la vista.
  React.useEffect(() => {
    if (focusPatient?.patient) {
      setSelected(focusPatient.patient);
      setQuery(focusPatient.patient.name || "");
    }
  }, [focusPatient?.n]);

  React.useEffect(() => {
    if (!selected) { setHistory(null); return; }
    let alive = true;
    setLoadingHist(true); setHistory(null); setAppointments([]); setVitalsHist([]);
    // Al volver se reabre la consulta que estaba desplegada; en un cambio de paciente se cierra.
    const reabrir = restaurarConsult.current; restaurarConsult.current = null;
    setOpenConsult(reabrir);
    api.getPatientConsultations(selected.id)
      .then((h) => { if (alive) { setHistory(h); if (reabrir && !h.some((c) => c.id === reabrir)) setOpenConsult(null); } })
      .catch(() => { if (alive) setHistory([]); })
      .finally(() => { if (alive) setLoadingHist(false); });
    api.getPatientAppointments(selected.id).then((a) => { if (alive) setAppointments(a); }).catch(() => {});
    api.getPatientVitals(selected.id).then((v) => { if (alive) setVitalsHist(v); }).catch(() => {});
    return () => { alive = false; };
  }, [selected]);

  return (
    <div className="page">
      <div style={{ marginBottom: 24 }}>
        <Eyebrow style={{ fontSize: 12, fontWeight: 600 }}>Expediente local</Eyebrow>
        <h1 className="h-page" style={{ marginTop: 8 }}>Pacientes</h1>
        <p style={{ marginTop: 8, color: "var(--ink-2)", fontSize: 14 }}>
          Directorio completo y el historial de consultas de cada paciente.
        </p>
      </div>

      {patients.length === 0 ? (
        <div className="framed" style={{ padding: 48, textAlign: "center" }}>
          <Corners />
          <div style={{ fontFamily: "var(--font-logo)", fontWeight: 600, fontSize: 22, marginBottom: 8 }}>
            Aún no hay pacientes
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
            Agenda pacientes desde la Agenda; aquí aparecerá su expediente e historial.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.25fr)", gap: 24 }} className="pacientes-grid">
          {/* LISTA */}
          <section>
            <div style={{ position: "relative", marginBottom: 14 }}>
              <input className="input" placeholder="Buscar por nombre, CURP o motivo…" value={query}
                onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 32 }} aria-label="Buscar paciente" />
              <span style={{ position: "absolute", left: 12, top: 10, color: "var(--ink-2)", fontFamily: "var(--font-mono)", fontSize: 13 }}>⌕</span>
            </div>
            <div className="col g-8">
              {filtered.map((p) => (
                <button key={p.id} onClick={() => setSelected(p)} className="patient-row"
                  style={{
                    textAlign: "left", cursor: "pointer", width: "100%",
                    border: "1px solid " + (selected?.id === p.id ? "var(--forest)" : "var(--hair)"),
                    background: selected?.id === p.id ? "var(--cream-2)" : "var(--surface)",
                    borderRadius: "var(--radius)", padding: "12px 14px",
                  }}>
                  <div className="row between center">
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>{p.id}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 3 }}>
                    {[`${p.age} años`, p.sex === "F" ? "F" : "M", p.reason].filter(Boolean).join(" · ")}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic", padding: 8 }}>
                  Sin coincidencias.
                </div>
              )}
            </div>
          </section>

          {/* DETALLE */}
          <aside>
            {!selected ? (
              <div className="card" style={{ color: "var(--ink-2)", fontStyle: "italic", fontSize: 13 }}>
                Selecciona un paciente para ver su expediente e historial.
              </div>
            ) : (
              <div className="col g-16">
                {/* perfil */}
                <div className="card">
                  <div className="row between center" style={{ marginBottom: 12 }}>
                    <div>
                      <h3 className="h-section" style={{ fontSize: 20 }}>{selected.name}</h3>
                      <Eyebrow>{selected.id} · {selected.age} años · {selected.sex === "F" ? "Femenino" : "Masculino"}</Eyebrow>
                    </div>
                    {!pidiendoMotivo ? (
                      <button className="btn primary sm"
                              onClick={() => setPidiendoMotivo(true)}>
                        NUEVA CONSULTA →
                      </button>
                    ) : (
                      <button className="btn sm" onClick={() => setPidiendoMotivo(false)}>Cancelar</button>
                    )}
                  </div>
                  {pidiendoMotivo && (
                    <div style={{ marginBottom: 12 }}>
                      <MotivoConsulta
                        paciente={selected}
                        onCancel={() => setPidiendoMotivo(false)}
                        onConfirm={(motivo) => { onStart(selected, motivo); setPidiendoMotivo(false); }}
                      />
                    </div>
                  )}
                  <dl className="kv" style={{ marginTop: 4 }}>
                    <dt>Motivo de alta</dt><dd>{selected.reason}</dd>
                    <dt>CURP</dt><dd className="mono" style={{ fontSize: 11 }}>{selected.curp || "—"}</dd>
                    <dt>NSS</dt><dd className="mono" style={{ fontSize: 11 }}>{selected.nss || "—"}</dd>
                    <dt>Alergias</dt>
                    <dd style={{ color: selected.allergies?.length ? "var(--danger)" : "inherit" }}>
                      {selected.allergies?.length ? selected.allergies.join(" · ") : "Ninguna conocida"}
                    </dd>
                    <dt>Crónicos</dt><dd>{selected.chronic?.length ? selected.chronic.join(" · ") : "—"}</dd>
                  </dl>
                </div>

                {/* Lectura del expediente por el modelo: resumen y preguntas */}
                <ExpedienteLLM patient={selected} />

                {/* Antes de empezar: qué preguntar por edad e historial */}
                <PreconsultaPanel patientId={selected.id} />

                {/* historial */}
                <div className="card">
                  <Eyebrow>Historial de consultas</Eyebrow>
                  <div className="col g-8" style={{ marginTop: 12 }}>
                    {loadingHist && <div style={{ fontSize: 12, color: "var(--ink-2)" }}>Cargando…</div>}
                    {!loadingHist && history && history.length === 0 && (
                      <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic" }}>
                        Sin consultas registradas todavía.
                      </div>
                    )}
                    {history && history.map((c) => (
                      <div key={c.id} style={{ border: "1px solid var(--hair)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                        <button onClick={() => setOpenConsult(openConsult === c.id ? null : c.id)}
                          style={{ width: "100%", textAlign: "left", cursor: "pointer", background: "transparent", border: 0, padding: "10px 12px" }}>
                          <div className="row between center">
                            <span style={{ fontSize: 12.5 }}>{fmtDate(c.started_at)}</span>
                            <Pill variant={c.finalized ? "accent" : ""}>{c.finalized ? "nota lista" : c.status}</Pill>
                          </div>
                        </button>
                        {openConsult === c.id && (
                          <ConsultDetail consult={c} isAdmin={user?.role === "admin"} patient={selected} onReview={onReview} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* PRÓXIMAS CITAS / SEGUIMIENTOS */}
                <div className="card">
                  <Eyebrow>Próximas citas y seguimientos</Eyebrow>
                  <div className="col g-6" style={{ marginTop: 12 }}>
                    {appointments.length === 0 && (
                      <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic" }}>Sin citas agendadas.</div>
                    )}
                    {appointments.map((ap) => (
                      <div key={ap.id} className="row between center" style={{ fontSize: 12.5, paddingBottom: 6, borderBottom: "1px dashed var(--hair)" }}>
                        <span><span className="mono" style={{ color: "var(--forest)" }}>{ap.scheduled_date}</span>{ap.time ? ` · ${ap.time}` : ""} · {ap.reason}</span>
                        <Pill variant={ap.status === "pendiente" ? "gold" : ""}>{ap.status}</Pill>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SIGNOS VITALES · TENDENCIA */}
                <div className="card">
                  <Eyebrow>Signos vitales · tendencia</Eyebrow>
                  {vitalsHist.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic", marginTop: 10 }}>Sin registros de vitales.</div>
                  ) : (
                    <div style={{ marginTop: 10, overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                        <thead>
                          <tr>{["Fecha", "TA", "FC", "Temp", "SpO₂", "Peso"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "4px 8px", color: "var(--ink-2)", fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: "1px solid var(--hair)" }}>{h}</th>
                          ))}</tr>
                        </thead>
                        <tbody>
                          {vitalsHist.map((r, i) => (
                            <tr key={i}>
                              <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{fmtDate(r.date).split(",")[0]}</td>
                              {["ta", "fc", "temp", "spo2", "peso"].map((k) => (
                                <td key={k} style={{ padding: "5px 8px", whiteSpace: "nowrap", color: r.vitals[k] ? "var(--ink)" : "var(--ink-2)" }}>{r.vitals[k] || "—"}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
};

// Detalle de una consulta: audio (admin) + transcripción original + SOAP en vivo + nota final.
const ConsultDetail = ({ consult, isAdmin, patient, onReview }) => {
  const [data, setData] = React.useState(null);
  const [tab, setTab] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    api.getSoap(consult.id)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({}); });
    return () => { alive = false; };
  }, [consult.id]);

  if (!data) {
    return <div style={{ padding: "10px 12px 14px", fontSize: 12, color: "var(--ink-2)" }}>Cargando…</div>;
  }

  const tabs = [];
  if (isAdmin && (data.transcript || "").trim()) tabs.push({ k: "tr", label: "Transcripción" });
  if (data.soap && Object.values(data.soap).some(Boolean)) tabs.push({ k: "vivo", label: "SOAP en vivo" });
  tabs.push({ k: "final", label: "Nota final" });
  const active = tab || tabs[0].k;

  return (
    <div style={{ padding: "10px 12px 14px", borderTop: "1px dashed var(--hair)" }}>
      <div className="row between center wrap" style={{ marginBottom: 12, gap: 8 }}>
        <button className="btn sm primary" onClick={() => onReview?.(consult.id, patient)}>
          {consult.status === "approved" || consult.status === "exported" ? "REVISAR NOTA →" : "REVISAR / APROBAR →"}
        </button>
        {isAdmin && (
          <button className="btn ghost sm" onClick={() => window.open(`/?audit=${consult.id}`, "_blank", "noopener")} title="Abrir auditoría en pestaña nueva">AUDITAR ↗</button>
        )}
      </div>
      {isAdmin && (
        <div style={{ marginBottom: 12 }}>
          <Eyebrow>Audio de la consulta</Eyebrow>
          <div style={{ marginTop: 8 }}>
            <AudioPlayer path={`/consultations/${consult.id}/audio.wav`} />
          </div>
        </div>
      )}
      <div className="seg" style={{ marginBottom: 10 }}>
        {tabs.map((t) => (
          <button key={t.k} type="button" className={active === t.k ? "on" : ""} onClick={() => setTab(t.k)}>{t.label}</button>
        ))}
      </div>
      {active === "tr" && (
        <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 320, overflowY: "auto", color: "var(--ink)" }}>
          {(data.transcript || "").trim() || "—"}
        </div>
      )}
      {active === "vivo" && <SoapBlock soap={data.soap} empty="Sin SOAP en vivo." />}
      {active === "final" && <SoapBlock soap={data.final_soap} empty="Esta consulta no tiene nota final." />}
    </div>
  );
};

const SoapBlock = ({ soap, empty }) => {
  if (!soap || !Object.values(soap).some(Boolean)) {
    return <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic" }}>{empty || "—"}</div>;
  }
  return (
    <div>
      {SECTIONS.map((s) => (
        <div key={s.k} style={{ marginTop: 8 }}>
          <Eyebrow>{s.name}</Eyebrow>
          <div style={{ fontSize: 12, lineHeight: 1.55, marginTop: 3, whiteSpace: "pre-wrap", color: soap[s.k] ? "var(--ink)" : "var(--ink-2)" }}>
            {soap[s.k] || "—"}
          </div>
        </div>
      ))}
    </div>
  );
};

export default Pacientes;
