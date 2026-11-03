// ============ REVISIÓN Y VALIDACIÓN ============
const Revision = ({ patient, onApprove, onBack }) => {
  const { SOAP, SUGGESTED_DX, SUGGESTED_RX, VITALS, FLAGS } = window.MEGI_DATA;
  const [soap, setSoap] = React.useState(SOAP);
  const [editing, setEditing] = React.useState(null);
  const [selectedDx, setSelectedDx] = React.useState(SUGGESTED_DX.map(d => d.code));
  const [rxList, setRxList] = React.useState(SUGGESTED_RX);
  const [notes, setNotes] = React.useState("");

  const toggleDx = (code) =>
    setSelectedDx((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );

  const removeRx = (i) => setRxList(rxList.filter((_, j) => j !== i));

  return (
    <div className="page" style={{ paddingTop: 20 }}>
      {/* HEADER */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "end",
        gap: 24,
        marginBottom: 26,
      }}>
        <div style={{ minWidth: 0 }}>
          <div className="row center g-12 wrap" style={{ marginBottom: 10 }}>
            <button className="btn ghost sm" onClick={onBack}>← VOLVER</button>
            <Pill variant="accent">consulta finalizada · 14:32</Pill>
            <Pill>duración 18:42</Pill>
          </div>
          <h1 className="h-page" style={{ fontSize: "calc(34px * var(--text-scale))", textWrap: "balance" }}>
            Revisa y valida <em style={{ color: "var(--gold)" }}>antes de imprimir</em>
          </h1>
          <p style={{ color: "var(--ink-2)", fontSize: 14, marginTop: 8 }}>
            {patient.name} · {patient.age} años · {patient.reason}
          </p>
        </div>
        <div className="row g-10" style={{ flexShrink: 0 }}>
          <button className="btn ghost">
            DESCARTAR
          </button>
          <button className="btn">
            GUARDAR BORRADOR
          </button>
          <button className="btn primary lg" onClick={onApprove}>
            ✓ APROBAR E IMPRIMIR
          </button>
        </div>
      </div>

      {/* EXECUTIVE SUMMARY (hero card) */}
      <div className="framed" style={{ padding: 28, marginBottom: 22, background: "var(--cream-2)" }}>
        <Corners />
        <div className="row between" style={{ marginBottom: 14 }}>
          <div>
            <Eyebrow>Resumen ejecutivo para validación</Eyebrow>
            <h2 className="h-section" style={{ marginTop: 6, fontSize: 26 }}>
              Lo más importante de esta consulta
            </h2>
          </div>
          <Pill variant="gold">generado por gemma-4</Pill>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 40, marginTop: 16 }}>
          <div>
            <div className="display" style={{
              fontFamily: "var(--font-display)",
              fontSize: 22, lineHeight: 1.4,
              color: "var(--ink)",
              marginBottom: 16,
              textWrap: "pretty",
            }}>
              Masculino de 60 años con <strong>dolor torácico opresivo de esfuerzo</strong> de 3 semanas,
              sobre antecedente de HTA y dislipidemia. Exploración sin datos de insuficiencia cardiaca.
              El cuadro sugiere <em style={{ color: "var(--gold)" }}>angina estable</em>;
              se solicita ECG y prueba de esfuerzo, y se inicia AAS + nitroglicerina PRN.
            </div>
            <div className="col g-8">
              {FLAGS.map((f, i) => (
                <div key={i} className="row center g-10" style={{
                  fontSize: 12,
                  padding: "8px 12px",
                  background: "var(--surface)",
                  borderLeft: `3px solid ${
                    f.level === "warn" ? "var(--warn)" :
                    f.level === "info" ? "var(--accent)" :
                    "var(--forest)"
                  }`,
                }}>
                  <span className="mono" style={{
                    fontSize: 9, letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: f.level === "warn" ? "var(--warn)" :
                           f.level === "info" ? "var(--accent)" :
                           "var(--forest)",
                    fontWeight: 600,
                  }}>
                    {f.level === "warn" ? "atención" : f.level === "info" ? "nota" : "ok"}
                  </span>
                  <span>{f.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{
            background: "var(--surface)",
            border: "1px dashed var(--hair)",
            padding: 20,
          }}>
            <Eyebrow>Acciones principales</Eyebrow>
            <div className="col g-10" style={{ marginTop: 12 }}>
              {[
                { n: "1", t: "ECG 12 derivaciones hoy" },
                { n: "2", t: "Prueba de esfuerzo < 7 días" },
                { n: "3", t: "Laboratorios: perfil lip., Cr, troponina I" },
                { n: "4", t: "AAS 100 mg c/24 h" },
                { n: "5", t: "NTG SL 0.4 mg PRN (máx. 3 dosis)" },
                { n: "6", t: "Cita seguimiento 7 días" },
              ].map((a) => (
                <div key={a.n} className="row center g-12" style={{
                  padding: "8px 0",
                  borderBottom: "1px dashed var(--hair)",
                }}>
                  <span className="mono" style={{
                    fontSize: 10,
                    width: 22, height: 22,
                    border: "1px solid var(--forest)",
                    color: "var(--forest)",
                    display: "grid", placeItems: "center",
                    letterSpacing: 0,
                  }}>{a.n}</span>
                  <span style={{ fontSize: 13 }}>{a.t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* GRID: SOAP + DX + RX */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
        {/* LEFT: SOAP editable */}
        <section className="card">
          <div className="row between center" style={{ marginBottom: 14 }}>
            <h3 className="h-section" style={{ fontSize: 20 }}>Nota SOAP · editable</h3>
            <Pill>NOM-004-SSA3-2012</Pill>
          </div>

          {[
            { k: "s", name: "Subjetivo", letter: "S" },
            { k: "o", name: "Objetivo", letter: "O" },
            { k: "a", name: "Análisis", letter: "A" },
            { k: "p", name: "Plan", letter: "P" },
          ].map((sec) => (
            <div key={sec.k} style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr",
              gap: 14,
              padding: "16px 0",
              borderBottom: "1px dashed var(--hair)",
            }}>
              <div style={{
                fontFamily: "var(--font-display)",
                fontSize: 40,
                color: "var(--forest)",
                lineHeight: 1,
              }}>{sec.letter}</div>
              <div>
                <div className="row between center" style={{ marginBottom: 6 }}>
                  <Eyebrow>{sec.name}</Eyebrow>
                  <button
                    className="btn ghost sm"
                    style={{ padding: "3px 10px", fontSize: 9 }}
                    onClick={() => setEditing(editing === sec.k ? null : sec.k)}
                  >
                    {editing === sec.k ? "LISTO" : "EDITAR"}
                  </button>
                </div>
                {editing === sec.k ? (
                  <textarea
                    className="textarea"
                    value={soap[sec.k]}
                    onChange={(e) => setSoap({ ...soap, [sec.k]: e.target.value })}
                    style={{ fontSize: 12.5, minHeight: 120 }}
                  />
                ) : (
                  <div style={{
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    color: "var(--ink)",
                  }}>
                    {soap[sec.k]}
                  </div>
                )}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 16 }}>
            <Eyebrow>Notas adicionales del médico</Eyebrow>
            <textarea
              className="textarea"
              placeholder="Agrega observaciones privadas o correcciones a la nota generada…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ marginTop: 6, fontSize: 12.5 }}
            />
          </div>
        </section>

        {/* RIGHT: DX + RX + GPC */}
        <aside className="col g-16">
          {/* DIAGNÓSTICOS */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <h3 className="h-section" style={{ fontSize: 18 }}>Diagnósticos · CIE-10</h3>
              <button className="btn ghost sm">+ AGREGAR</button>
            </div>
            <DxList max={3} editable selected={selectedDx} toggleSelected={toggleDx} />
          </div>

          {/* RECETA */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <div>
                <h3 className="h-section" style={{ fontSize: 18 }}>Receta médica</h3>
                <Eyebrow>Cuadro Básico · Sector Salud</Eyebrow>
              </div>
              <button className="btn ghost sm">+ MEDICAMENTO</button>
            </div>
            <div className="col g-10">
              {rxList.map((rx, i) => (
                <div key={i} style={{
                  border: "1px solid var(--hair)",
                  background: rx.new ? "var(--cream-2)" : "var(--surface)",
                  padding: "12px 14px",
                  position: "relative",
                }}>
                  <div className="row between" style={{ marginBottom: 4 }}>
                    <div className="row center g-8">
                      <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                        {rx.drug} <span style={{ color: "var(--forest)" }}>{rx.dose}</span>
                      </span>
                      {rx.new && <Pill variant="gold">nuevo</Pill>}
                    </div>
                    <button
                      onClick={() => removeRx(i)}
                      style={{
                        background: "none", border: 0, cursor: "pointer",
                        color: "var(--ink-2)", fontSize: 16, padding: 0,
                      }}
                    >×</button>
                  </div>
                  <div className="mono" style={{
                    fontSize: 10.5,
                    color: "var(--ink-2)",
                    letterSpacing: "0.04em",
                    marginBottom: 6,
                  }}>
                    {rx.freq} · {rx.route} · {rx.duration}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-2)", fontStyle: "italic", marginBottom: 5 }}>
                    {rx.note}
                  </div>
                  <div className="mono" style={{
                    fontSize: 9.5,
                    color: "var(--gold)",
                    letterSpacing: "0.04em",
                    paddingTop: 6,
                    borderTop: "1px dashed var(--hair)",
                  }}>
                    ↳ {rx.indication} · {rx.cb}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Referencias GPC */}
          <div className="card card-dashed">
            <Eyebrow>Referencias CENETEC · GPC</Eyebrow>
            <div className="col g-8" style={{ marginTop: 12 }}>
              {[
                { id: "IMSS-080-08", t: "Cardiopatía isquémica crónica" },
                { id: "IMSS-076-08", t: "Hipertensión arterial sistémica" },
                { id: "SS-233-09", t: "Dislipidemias en el adulto" },
              ].map((g) => (
                <div key={g.id} style={{
                  padding: "8px 10px",
                  background: "var(--surface)",
                  borderLeft: "2px solid var(--gold)",
                }}>
                  <div className="mono" style={{
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    color: "var(--gold)",
                    fontWeight: 600,
                  }}>{g.id}</div>
                  <div style={{ fontSize: 12, marginTop: 2 }}>{g.t}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* FIXED APPROVE BAR */}
      <div style={{
        position: "sticky",
        bottom: 16,
        marginTop: 28,
        padding: "14px 22px",
        background: "var(--surface)",
        border: "1px solid var(--forest)",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        boxShadow: "0 -8px 24px rgba(0,0,0,0.06)",
      }}>
        <div>
          <Eyebrow>Al aprobar</Eyebrow>
          <div style={{ fontSize: 13, marginTop: 3 }}>
            Se firmará digitalmente con tu cédula <span className="mono">7845302</span>,
            se guardará en el expediente y se generará la nota NOM-004 + receta imprimibles.
          </div>
        </div>
        <div className="row g-10">
          <button className="btn ghost">VER PDF</button>
          <button className="btn primary lg" onClick={onApprove}>
            ✓ APROBAR E IMPRIMIR
          </button>
        </div>
      </div>
    </div>
  );
};

window.Revision = Revision;
