// ============ AGENTIC RESEARCH PANEL ============
// Simula al LLM "entrando" a sistemas externos (PACS, LIS, EHR)
// para buscar información sin API directa.

const AGENT_SOURCES = {
  rx: {
    label: "Rayos X",
    icon: "⌬",
    system: "PACS · Carestream",
    steps: [
      "Conectando a portal PACS…",
      "Autenticando con cédula 7845302…",
      "Buscando estudios de Jorge A. Delgado…",
      "Leyendo 3 estudios de imagen…",
      "Extrayendo hallazgos relevantes…",
    ],
    results: [
      {
        date: "02 abr 2026",
        title: "Tórax PA y lateral",
        finding: "Silueta cardiaca dentro de límites normales. ICT 0.48. Sin infiltrados ni consolidaciones. Hilios vasculares sin alteración.",
        tag: "Normal",
        source: "PACS · Carestream · Est. 884-2042",
      },
      {
        date: "14 ago 2025",
        title: "Rx columna lumbar",
        finding: "Osteofitos marginales L3-L4. Disminución del espacio intervertebral L4-L5 compatible con discopatía degenerativa leve.",
        tag: "Hallazgo crónico",
        source: "PACS · Carestream · Est. 721-9984",
      },
      {
        date: "18 feb 2024",
        title: "Tomografía de tórax (contraste)",
        finding: "Calcificaciones coronarias en ADA. Score de Agatston 180 (riesgo moderado). Parénquima pulmonar sin nódulos.",
        tag: "Relevante al caso",
        hot: true,
        source: "PACS · Carestream · Est. 445-0021",
      },
    ],
  },
  lab: {
    label: "Laboratorio",
    icon: "⌁",
    system: "LIS · Clinilab",
    steps: [
      "Conectando a portal Clinilab…",
      "Ingresando con credenciales guardadas…",
      "Buscando estudios de los últimos 12 meses…",
      "Parseando 7 órdenes previas…",
      "Resaltando valores fuera de rango…",
    ],
    results: [
      {
        date: "02 abr 2026",
        title: "Perfil de lípidos",
        finding: "Col total 218 mg/dL (↑) · LDL 142 (↑) · HDL 38 (↓) · TG 195 (↑). Persiste dislipidemia pese a estatina.",
        tag: "Fuera de rango",
        hot: true,
        source: "Clinilab · Orden 2604-881",
      },
      {
        date: "02 abr 2026",
        title: "Química sanguínea",
        finding: "Glucosa 108 mg/dL · Cr 0.9 · BUN 16 · TGO 28 · TGP 31. Glucosa alterada en ayuno.",
        tag: "Atención",
        source: "Clinilab · Orden 2604-881",
      },
      {
        date: "14 mar 2026",
        title: "Hemoglobina glucosilada",
        finding: "HbA1c 5.9 % (prediabetes). Se recomienda seguimiento cada 3-6 meses.",
        tag: "Prediabetes",
        source: "Clinilab · Orden 1403-112",
      },
      {
        date: "08 dic 2025",
        title: "Biometría hemática",
        finding: "Hb 15.2 · Hto 45 · Leucos 7,200 · Plaq 245,000. Sin alteraciones.",
        tag: "Normal",
        source: "Clinilab · Orden 0812-340",
      },
    ],
  },
  notes: {
    label: "Notas previas",
    icon: "❘❘",
    system: "Expediente · MEGI Archive",
    steps: [
      "Consultando expediente electrónico…",
      "Descargando 4 consultas previas…",
      "Extrayendo SOAP relevantes…",
      "Identificando evolución sintomática…",
    ],
    results: [
      {
        date: "02 abr 2026",
        title: "Consulta externa · Dra. Martínez",
        finding: "Paciente refirió control adecuado de TA, sin dolor torácico en esa visita. Se ajustó atorvastatina a 40 mg. Peso estable.",
        tag: "Hace 16 días",
        source: "MEGI · Nota 2042-04",
      },
      {
        date: "14 feb 2026",
        title: "Consulta externa · Dra. Martínez",
        finding: "Primer reporte de molestia torácica leve, intermitente. Se consideró de origen muscular. Sin repercusión hemodinámica.",
        tag: "Síntoma previo",
        hot: true,
        source: "MEGI · Nota 2042-02",
      },
      {
        date: "18 nov 2025",
        title: "Nota cardiología · Dr. Ibarra",
        finding: "Ecocardiograma con FEVI 58%, sin alteraciones segmentarias. Se recomienda control factorial estricto.",
        tag: "Interconsulta",
        source: "MEGI · Ref 2042-IC-11",
      },
    ],
  },
};

const AgenticResearch = ({ patient, compact = false }) => {
  const [active, setActive] = React.useState(null); // null | 'rx' | 'lab' | 'notes'
  const [status, setStatus] = React.useState("idle"); // idle | running | done
  const [step, setStep] = React.useState(0);
  const [doneSources, setDoneSources] = React.useState(new Set());

  const startAgent = (key) => {
    setActive(key);
    setStatus("running");
    setStep(0);
  };

  React.useEffect(() => {
    if (status !== "running" || !active) return;
    const src = AGENT_SOURCES[active];
    if (step >= src.steps.length) {
      setStatus("done");
      setDoneSources((s) => new Set([...s, active]));
      return;
    }
    const t = setTimeout(() => setStep(step + 1), 650 + Math.random() * 400);
    return () => clearTimeout(t);
  }, [status, step, active]);

  const reset = () => { setActive(null); setStatus("idle"); setStep(0); };

  const src = active ? AGENT_SOURCES[active] : null;

  if (compact) {
    return (
      <div style={{
        background: "var(--surface)",
        border: "1px dashed var(--hair)",
        padding: "10px 14px",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 14,
        alignItems: "center",
        width: "100%",
      }}>
        <div>
          <Eyebrow>Agente</Eyebrow>
          <div style={{ fontSize: 12, fontWeight: 500, marginTop: 2 }}>
            Consulta sistemas externos
          </div>
        </div>

        {!active && (
          <div style={{ display: "flex", gap: 8 }}>
            {Object.entries(AGENT_SOURCES).map(([key, s]) => (
              <button
                key={key}
                onClick={() => startAgent(key)}
                style={{
                  flex: 1,
                  display: "grid",
                  gridTemplateColumns: "18px 1fr auto",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  background: "var(--cream)",
                  border: "1px solid var(--hair)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "var(--font-ui)",
                  color: "var(--ink)",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--cream-2)";
                  e.currentTarget.style.borderColor = "var(--forest)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--cream)";
                  e.currentTarget.style.borderColor = "var(--hair)";
                }}
              >
                <span className="mono" style={{ fontSize: 13, color: "var(--gold)" }}>{s.icon}</span>
                <span style={{ fontSize: 11.5, fontWeight: 500 }}>{s.label}</span>
                <span className="mono" style={{
                  fontSize: 9,
                  color: doneSources.has(key) ? "var(--forest)" : "var(--ink-2)",
                  letterSpacing: "0.06em",
                }}>
                  {doneSources.has(key) ? "✓" : "→"}
                </span>
              </button>
            ))}
          </div>
        )}

        {active && status === "running" && (
          <div style={{ padding: "0 10px" }}>
            <div className="row center g-10" style={{ marginBottom: 4 }}>
              <span className="mono" style={{ fontSize: 13, color: "var(--gold)" }}>{src.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{src.label}</span>
              <span className="mono" style={{ fontSize: 9, color: "var(--ink-2)", letterSpacing: "0.1em" }}>
                {src.system}
              </span>
            </div>
            <div className="mono" style={{
              fontSize: 11, color: "var(--ink)",
              letterSpacing: "0.02em",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{
                width: 8, height: 8,
                background: "var(--gold)",
                display: "inline-block",
                animation: "pulse 1s infinite",
              }} />
              {src.steps[Math.min(step, src.steps.length - 1)]}
              <span className="mono" style={{ fontSize: 9, color: "var(--ink-2)", marginLeft: "auto" }}>
                {step + 1}/{src.steps.length}
              </span>
            </div>
          </div>
        )}

        {active && status === "done" && (
          <div style={{
            display: "flex", gap: 8, overflowX: "auto",
            padding: "2px 0",
          }}>
            {src.results.map((r, i) => (
              <div key={i} style={{
                minWidth: 220,
                padding: "7px 10px",
                background: r.hot ? "var(--cream-2)" : "var(--cream)",
                border: "1px solid var(--hair)",
                borderLeft: `2px solid ${r.hot ? "var(--gold)" : "var(--hair)"}`,
              }}>
                <div className="row between" style={{ marginBottom: 2 }}>
                  <span className="mono" style={{ fontSize: 9, color: "var(--ink-2)", letterSpacing: "0.08em" }}>
                    {r.date}
                  </span>
                  <span className="mono" style={{
                    fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase",
                    color: r.hot ? "var(--gold)" : "var(--ink-2)",
                    fontWeight: r.hot ? 600 : 400,
                  }}>{r.tag}</span>
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.25 }}>
                  {r.title}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--ink-2)", lineHeight: 1.4, marginTop: 3,
                  overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                  {r.finding}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {active && (
            <button className="btn ghost sm" onClick={reset} style={{ padding: "4px 10px", fontSize: 9 }}>
              ← FUENTES
            </button>
          )}
          <Pill variant="accent" pulse={status === "running"}>
            {status === "running" ? "buscando" : status === "done" ? `${src?.results.length} hallazgos` : "listo"}
          </Pill>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: "16px 18px", borderBottom: "1px dashed var(--hair)" }}>
        <div className="row between center">
          <div>
            <Eyebrow>Agente de investigación</Eyebrow>
            <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>
              Consulta sistemas externos
            </div>
          </div>
          <Pill variant="accent" pulse={status === "running"}>
            {status === "running" ? "buscando…" : "listo"}
          </Pill>
        </div>
        <div className="mono" style={{
          fontSize: 9.5, color: "var(--ink-2)", letterSpacing: "0.08em",
          marginTop: 8, lineHeight: 1.5,
        }}>
          Sin API directa. El agente navega portales con tus credenciales
          guardadas y extrae la información como lo haría un humano.
        </div>
      </div>

      {/* Source buttons */}
      {!active && (
        <div style={{ padding: 14, display: "grid", gap: 8 }}>
          {Object.entries(AGENT_SOURCES).map(([key, s]) => (
            <button
              key={key}
              onClick={() => startAgent(key)}
              style={{
                display: "grid",
                gridTemplateColumns: "28px 1fr auto",
                alignItems: "center",
                gap: 12,
                padding: "11px 14px",
                background: "var(--surface)",
                border: "1px solid var(--hair)",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "var(--font-ui)",
                color: "var(--ink)",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--cream-2)";
                e.currentTarget.style.borderColor = "var(--forest)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--surface)";
                e.currentTarget.style.borderColor = "var(--hair)";
              }}
            >
              <span className="mono" style={{
                fontSize: 16, color: "var(--gold)",
              }}>{s.icon}</span>
              <span>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                <div className="mono" style={{
                  fontSize: 9, color: "var(--ink-2)",
                  letterSpacing: "0.1em", marginTop: 2,
                }}>
                  {s.system}
                </div>
              </span>
              <span className="mono" style={{
                fontSize: 11,
                color: doneSources.has(key) ? "var(--forest)" : "var(--ink-2)",
              }}>
                {doneSources.has(key) ? "✓ revisado" : "ejecutar →"}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Running state */}
      {active && status === "running" && (
        <div style={{ padding: "14px 18px 18px" }}>
          <div className="row between center" style={{ marginBottom: 12 }}>
            <div className="row center g-8">
              <span className="mono" style={{ fontSize: 14, color: "var(--gold)" }}>{src.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{src.label}</span>
            </div>
            <span className="mono" style={{ fontSize: 9, color: "var(--ink-2)", letterSpacing: "0.12em" }}>
              {src.system}
            </span>
          </div>
          <div className="col g-6">
            {src.steps.slice(0, step + 1).map((st, i) => (
              <div key={i} className="row center g-10" style={{
                fontSize: 11.5,
                color: i < step ? "var(--ink-2)" : "var(--ink)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.02em",
              }}>
                <span style={{
                  width: 10, height: 10,
                  border: "1px solid",
                  borderColor: i < step ? "var(--forest)" : "var(--gold)",
                  background: i < step ? "var(--forest)" : "transparent",
                  display: "inline-block",
                  animation: i === step ? "pulse 1s infinite" : "none",
                }} />
                {st}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {active && status === "done" && (
        <div style={{ padding: "14px 18px 18px", maxHeight: 420, overflowY: "auto" }}>
          <div className="row between center" style={{ marginBottom: 12 }}>
            <div className="row center g-8">
              <span className="mono" style={{ fontSize: 14, color: "var(--gold)" }}>{src.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{src.label}</span>
              <Pill variant="gold">{src.results.length} hallazgos</Pill>
            </div>
            <button className="btn ghost sm" onClick={reset} style={{ padding: "3px 10px", fontSize: 9 }}>
              ← OTRAS FUENTES
            </button>
          </div>
          <div className="col g-10">
            {src.results.map((r, i) => (
              <div key={i} style={{
                padding: "11px 12px",
                background: r.hot ? "var(--cream-2)" : "var(--surface)",
                border: "1px solid var(--hair)",
                borderLeft: `2px solid ${r.hot ? "var(--gold)" : "var(--hair)"}`,
              }}>
                <div className="row between" style={{ marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)", letterSpacing: "0.1em" }}>
                    {r.date}
                  </span>
                  <span className="mono" style={{
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: r.hot ? "var(--gold)" : "var(--ink-2)",
                    fontWeight: r.hot ? 600 : 400,
                  }}>
                    {r.tag}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4 }}>
                  {r.title}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                  {r.finding}
                </div>
                <div className="mono" style={{
                  fontSize: 9, color: "var(--gold)",
                  letterSpacing: "0.04em",
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: "1px dashed var(--hair)",
                }}>
                  ↳ {r.source}
                </div>
                <div className="row g-6" style={{ marginTop: 8 }}>
                  <button className="btn ghost sm" style={{ padding: "3px 10px", fontSize: 9 }}>
                    ADJUNTAR A NOTA
                  </button>
                  <button className="btn ghost sm" style={{ padding: "3px 10px", fontSize: 9 }}>
                    VER ORIGINAL
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

window.AgenticResearch = AgenticResearch;
