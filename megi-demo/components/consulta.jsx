// ============ CONSULTA ACTIVA ============
const Consulta = ({ patient, onFinish, onBack, showTranscript }) => {
  const [elapsed, setElapsed] = React.useState(0);
  const [running, setRunning] = React.useState(true);
  const [visibleLines, setVisibleLines] = React.useState(0);
  const { TRANSCRIPT, SUGGESTED_DX, VITALS } = window.MEGI_DATA;
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  React.useEffect(() => {
    const shown = TRANSCRIPT.filter((l) => l.t <= elapsed).length;
    setVisibleLines(shown);
  }, [elapsed]);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLines]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const lines = TRANSCRIPT.slice(0, visibleLines);

  // Progressive SOAP build
  const progress = Math.min(1, elapsed / 120);

  return (
    <div className="page" style={{ paddingTop: 20 }}>
      {/* STATUS BAR */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        marginBottom: 22,
        padding: "14px 20px",
        background: "var(--surface)",
        border: "1px solid var(--hair)",
        position: "relative",
      }}>
        <div className="row center g-16">
          <button className="btn ghost sm" onClick={onBack}>← AGENDA</button>
          <Divider style={{ width: 1, height: 22, margin: 0, borderLeft: "1px solid var(--hair)", borderTop: 0 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{patient.name}</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-2)", letterSpacing: "0.08em" }}>
              {patient.curp} · {patient.age}A · {patient.sex} · NSS {patient.nss}
            </div>
          </div>
        </div>
        <div className="row center g-12">
          <Pill variant="accent" pulse>REC · Whisper-MLX</Pill>
          <div className="mono" style={{ fontSize: 22, letterSpacing: "0.05em", color: "var(--forest)" }}>
            {mm}:{ss}
          </div>
        </div>
        <div className="row g-8" style={{ justifySelf: "end" }}>
          <button className="btn ghost sm" onClick={() => setRunning(!running)}>
            {running ? "⏸ PAUSAR" : "▶ CONTINUAR"}
          </button>
          <button className="btn primary sm" onClick={onFinish}>
            FINALIZAR Y REVISAR →
          </button>
        </div>
      </div>

      {/* WAVEFORM + AGENT SIDE BY SIDE */}
      <div style={{ marginBottom: 22, display: "grid", gridTemplateColumns: "1fr 380px", gap: 20, alignItems: "stretch" }}>
        <div style={{ display: "flex" }}>
          <window.AgenticResearch patient={patient} compact />
        </div>
        <div style={{ padding: "12px 20px", background: "var(--surface)", border: "1px dashed var(--hair)", display: "flex", flexDirection: "column" }}>
          <div className="row between center" style={{ marginBottom: 6 }}>
            <Eyebrow>Escuchando</Eyebrow>
            <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>
              {lines.length} seg · 0.94
            </span>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <Waveform active={running} bars={48} />
          </div>
        </div>
      </div>

      {/* MAIN 3-COL GRID */}
      <div style={{
        display: "grid",
        gridTemplateColumns: showTranscript ? "340px 1fr 380px" : "1fr 380px",
        gap: 20,
        minHeight: 580,
      }}>
        {/* LEFT: live transcript */}
        {showTranscript && (
          <section className="card" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "18px 20px 12px", borderBottom: "1px dashed var(--hair)" }}>
              <div className="row between center">
                <h3 className="h-section" style={{ fontSize: 18 }}>Transcripción</h3>
                <Pill>en vivo</Pill>
              </div>
              <Eyebrow style={{ marginTop: 6 }}>es-MX · diarización auto</Eyebrow>
            </div>
            <div
              ref={scrollRef}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "14px 20px",
                maxHeight: 540,
              }}
            >
              {lines.length === 0 && (
                <div style={{ color: "var(--ink-2)", fontSize: 12, fontStyle: "italic", marginTop: 12 }}>
                  Esperando audio…
                </div>
              )}
              {lines.map((l, i) => (
                <div key={i} style={{
                  marginBottom: 14,
                  animation: i === lines.length - 1 ? "fadeIn 0.35s" : "none",
                }}>
                  <div className="row g-8 center" style={{ marginBottom: 3 }}>
                    <span className="mono" style={{
                      fontSize: 9,
                      letterSpacing: "0.18em",
                      color: l.s === "MED" ? "var(--forest)" : "var(--gold)",
                      fontWeight: 600,
                    }}>
                      {l.s === "MED" ? "MÉDICO" : "PACIENTE"}
                    </span>
                    <span className="mono" style={{ fontSize: 9, color: "var(--ink-2)" }}>
                      {String(Math.floor(l.t / 60)).padStart(2, "0")}:{String(l.t % 60).padStart(2, "0")}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    color: l.s === "MED" ? "var(--ink)" : "var(--ink-2)",
                    paddingLeft: l.s === "PAC" ? 12 : 0,
                    borderLeft: l.s === "PAC" ? "2px solid var(--gold)" : "none",
                  }}>
                    {l.text}
                  </div>
                </div>
              ))}
              {running && lines.length > 0 && (
                <div style={{
                  display: "inline-block",
                  width: 8, height: 14,
                  background: "var(--forest)",
                  animation: "blink 1s infinite",
                  verticalAlign: "middle",
                }} />
              )}
            </div>
          </section>
        )}

        {/* CENTER: live summary (the star) */}
        <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="framed" style={{ padding: 24 }}>
            <Corners />
            <div className="row between center" style={{ marginBottom: 18, gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <Eyebrow>Resumen ejecutivo · generándose</Eyebrow>
                <h2 className="h-section" style={{ marginTop: 8 }}>Lo más importante</h2>
              </div>
              <Pill variant="gold" pulse>gemma-4 · razonando</Pill>
            </div>
            <ProgressStrip progress={progress} />

            <LiveSummary elapsed={elapsed} />
          </div>

          {/* SOAP that appears progressively */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <h3 className="h-section" style={{ fontSize: 18 }}>Nota SOAP · en borrador</h3>
              <Pill>{progress >= 1 ? "completa" : "construyendo"}</Pill>
            </div>
            <SoapBuilder elapsed={elapsed} />
          </div>
        </section>

        {/* RIGHT: patient + diagnosis + vitals */}
        <aside className="col g-16">
          <div className="card">
            <Eyebrow>Paciente</Eyebrow>
            <div style={{ marginTop: 10, fontSize: 14, fontWeight: 500 }}>
              {patient.name}
            </div>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Edad</dt><dd>{patient.age} años · {patient.sex === "F" ? "Femenino" : "Masculino"}</dd>
              <dt>CURP</dt><dd className="mono" style={{ fontSize: 11 }}>{patient.curp}</dd>
              <dt>NSS</dt><dd className="mono" style={{ fontSize: 11 }}>{patient.nss}</dd>
              <dt>Motivo</dt><dd>{patient.reason}</dd>
              <dt>Crónicos</dt><dd>{patient.chronic.join(" · ") || "—"}</dd>
              <dt>Alergias</dt><dd style={{ color: patient.allergies.length ? "var(--danger)" : "inherit" }}>
                {patient.allergies.join(" · ") || "Ninguna conocida"}
              </dd>
            </dl>
          </div>

          {/* Vitals capturados */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 10 }}>
              <Eyebrow>Signos vitales · detectados</Eyebrow>
              <Pill variant="accent">auto</Pill>
            </div>
            <VitalsLive elapsed={elapsed} />
          </div>

          {/* Suggested DX */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <Eyebrow>Sugerencia CIE-10</Eyebrow>
              <span className="mono" style={{ fontSize: 9, color: "var(--ink-2)" }}>
                {elapsed > 90 ? "3 hallazgos" : elapsed > 45 ? "1 hallazgo" : "analizando…"}
              </span>
            </div>
            {elapsed > 45 ? (
              <DxList max={elapsed > 90 ? 3 : 1} compact />
            ) : (
              <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic", padding: "12px 0" }}>
                Los códigos aparecerán conforme avance la consulta…
              </div>
            )}
          </div>
        </aside>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes blink {
          0%, 50% { opacity: 1; }
          50.01%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};

const ProgressStrip = ({ progress }) => {
  const stages = ["Escuchando", "Estructurando", "Codificando", "Prescripción", "Listo"];
  const current = Math.min(stages.length - 1, Math.floor(progress * stages.length));
  return (
    <div style={{ display: "flex", gap: 2, marginBottom: 20 }}>
      {stages.map((s, i) => (
        <div key={s} style={{ flex: 1 }}>
          <div style={{
            height: 3,
            background: i <= current ? "var(--forest)" : "var(--cream-2)",
            transition: "background 0.3s",
          }} />
          <div className="mono" style={{
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: i === current ? "var(--forest)" : "var(--ink-2)",
            marginTop: 5,
            fontWeight: i === current ? 600 : 400,
          }}>
            {s}
          </div>
        </div>
      ))}
    </div>
  );
};

const LiveSummary = ({ elapsed }) => {
  // Summary bullets appear progressively
  const items = [
    { at: 20, label: "Motivo", text: "Dolor torácico opresivo de 3 semanas de evolución" },
    { at: 35, label: "Perfil del dolor", text: "Retroesternal, desencadenado por esfuerzo, cede en reposo" },
    { at: 55, label: "Síntomas asociados", text: "Diaforesis y disnea leve · niega síncope o irradiación" },
    { at: 70, label: "Antecedentes relevantes", text: "HTA y dislipidemia bajo tratamiento · adherencia parcial" },
    { at: 90, label: "Exploración", text: "TA 140/90 · FC 78 rítmica · auscultación sin soplos" },
    { at: 110, label: "Impresión", text: "Angina de pecho probable (I20.9) — requiere estudios complementarios" },
    { at: 120, label: "Plan inmediato", text: "ECG hoy · prueba de esfuerzo <7 días · AAS 100mg + NTG SL PRN" },
  ];
  const visible = items.filter(it => elapsed >= it.at);

  return (
    <div className="col g-12">
      {visible.map((it, i) => (
        <div key={i} style={{
          display: "grid",
          gridTemplateColumns: "170px 1fr",
          gap: 16,
          paddingBottom: i < visible.length - 1 ? 12 : 0,
          borderBottom: i < visible.length - 1 ? "1px dashed var(--hair)" : "0",
          animation: "fadeIn 0.5s",
        }}>
          <div className="mono" style={{
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--gold)",
            paddingTop: 2,
          }}>
            {it.label}
          </div>
          <div className="display" style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            lineHeight: 1.35,
            color: "var(--ink)",
          }}>
            {it.text}
          </div>
        </div>
      ))}
      {visible.length === 0 && (
        <div style={{
          padding: "28px 0",
          color: "var(--ink-2)",
          fontSize: 13,
          fontStyle: "italic",
          fontFamily: "var(--font-display)",
        }}>
          Conforme hables con tu paciente, los puntos clave aparecerán aquí…
        </div>
      )}
    </div>
  );
};

const SoapBuilder = ({ elapsed }) => {
  const { SOAP } = window.MEGI_DATA;
  const sections = [
    { k: "S", name: "Subjetivo", at: 25, text: SOAP.s },
    { k: "O", name: "Objetivo", at: 75, text: SOAP.o },
    { k: "A", name: "Análisis", at: 105, text: SOAP.a },
    { k: "P", name: "Plan", at: 115, text: SOAP.p },
  ];

  return (
    <div className="col g-12">
      {sections.map((s) => {
        const active = elapsed >= s.at;
        const chars = active ? Math.min(s.text.length, Math.round((elapsed - s.at) * 24)) : 0;
        const shown = s.text.slice(0, chars);
        return (
          <div key={s.k} style={{
            display: "grid",
            gridTemplateColumns: "40px 1fr",
            gap: 12,
            paddingBottom: 10,
            borderBottom: "1px dashed var(--hair)",
            opacity: active ? 1 : 0.4,
          }}>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: 34,
              fontWeight: 400,
              color: active ? "var(--forest)" : "var(--ink-2)",
              lineHeight: 1,
            }}>
              {s.k}
            </div>
            <div>
              <Eyebrow>{s.name}</Eyebrow>
              <div style={{
                fontSize: 12.5,
                lineHeight: 1.55,
                marginTop: 4,
                color: "var(--ink)",
                whiteSpace: "pre-wrap",
              }}>
                {active ? shown : "Aún no capturado"}
                {active && chars < s.text.length && (
                  <span style={{
                    display: "inline-block",
                    width: 2, height: 12,
                    background: "var(--forest)",
                    marginLeft: 2,
                    animation: "blink 1s infinite",
                  }} />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const VitalsLive = ({ elapsed }) => {
  const { VITALS } = window.MEGI_DATA;
  const items = [
    { k: "TA", v: VITALS.ta, at: 75 },
    { k: "FC", v: VITALS.fc, at: 80 },
    { k: "FR", v: VITALS.fr, at: 85 },
    { k: "SpO₂", v: VITALS.spo2, at: 88 },
    { k: "Temp", v: VITALS.temp, at: 90 },
    { k: "Peso", v: VITALS.peso, at: 95 },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
      {items.map((it) => {
        const active = elapsed >= it.at;
        return (
          <div key={it.k} style={{
            display: "flex", flexDirection: "column", gap: 2,
            opacity: active ? 1 : 0.3,
            transition: "opacity 0.3s",
          }}>
            <span className="mono" style={{
              fontSize: 9, letterSpacing: "0.16em",
              textTransform: "uppercase", color: "var(--ink-2)",
            }}>{it.k}</span>
            <span className="mono" style={{ fontSize: 14, color: active ? "var(--ink)" : "var(--ink-2)" }}>
              {active ? it.v : "— —"}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const DxList = ({ max = 3, compact = false, onEdit, editable = false, selected = [], toggleSelected }) => {
  const { SUGGESTED_DX } = window.MEGI_DATA;
  const list = SUGGESTED_DX.slice(0, max);
  return (
    <div className="col g-10">
      {list.map((dx, i) => (
        <div key={dx.code} style={{
          padding: compact ? "10px 0" : "14px 16px",
          border: compact ? "0" : "1px solid var(--hair)",
          borderTop: compact && i > 0 ? "1px dashed var(--hair)" : (compact ? "0" : "1px solid var(--hair)"),
          background: compact ? "transparent" : (dx.primary ? "var(--cream-2)" : "var(--surface)"),
          position: "relative",
        }}>
          <div className="row between center" style={{ marginBottom: 6 }}>
            <div className="row center g-8">
              {editable && (
                <input
                  type="checkbox"
                  checked={selected.includes(dx.code)}
                  onChange={() => toggleSelected?.(dx.code)}
                  style={{ accentColor: "var(--forest)" }}
                />
              )}
              <span className="mono" style={{
                fontSize: 11,
                background: dx.primary ? "var(--forest)" : "transparent",
                color: dx.primary ? "var(--cream)" : "var(--forest)",
                border: dx.primary ? "0" : "1px solid var(--forest)",
                padding: "2px 7px",
                letterSpacing: "0.06em",
                fontWeight: 600,
              }}>
                {dx.code}
              </span>
              {dx.primary && <Pill variant="gold">primario</Pill>}
            </div>
            <div className="row center g-8">
              <ConfidenceBar value={dx.confidence} color={dx.primary ? "var(--forest)" : "var(--gold)"} />
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>
                {Math.round(dx.confidence * 100)}%
              </span>
            </div>
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 6 }}>
            {dx.label}
          </div>
          {!compact && (
            <>
              <ul style={{
                margin: "8px 0", paddingLeft: 16,
                fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.5,
              }}>
                {dx.evidence.map((e, j) => <li key={j}>{e}</li>)}
              </ul>
              <div style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--gold)",
                letterSpacing: "0.04em",
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px dashed var(--hair)",
              }}>
                ↳ {dx.source}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
};

Object.assign(window, { Consulta, DxList });
