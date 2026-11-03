// ============ DASHBOARD ============
const Dashboard = ({ onOpen, onStart, patients, doctor }) => {
  const [query, setQuery] = React.useState("");
  const filtered = patients.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.curp.toLowerCase().includes(query.toLowerCase()) ||
    p.reason.toLowerCase().includes(query.toLowerCase())
  );

  const today = new Date().toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const stats = {
    total: patients.length,
    esperando: patients.filter(p => p.status === "esperando").length,
    enCurso: patients.filter(p => p.status === "en-consulta").length,
    terminada: patients.filter(p => p.status === "terminada").length,
  };

  return (
    <div className="page">
      {/* HEADER */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "end",
        gap: 24,
        marginBottom: 32,
      }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow>{today}</Eyebrow>
          <h1 className="h-page" style={{ marginTop: 8, textWrap: "balance" }}>
            Buenos días, <em style={{ fontStyle: "italic", color: "var(--gold)" }}>Dra. Martínez</em>
          </h1>
          <p style={{ marginTop: 10, color: "var(--ink-2)", fontSize: 14 }}>
            Tienes <strong style={{ color: "var(--ink)" }}>{stats.esperando} pacientes esperando</strong> y {stats.total - stats.terminada} consultas programadas hoy.
          </p>
        </div>
        <div className="row g-12" style={{ flexShrink: 0 }}>
          <button className="btn ghost">
            <span>⤓</span> EXPORTAR AGENDA
          </button>
          <button className="btn primary" onClick={() => onStart()}>
            <span style={{ fontSize: 14 }}>＋</span> NUEVA CONSULTA
          </button>
        </div>
      </div>

      {/* STATS STRIP */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 0,
        marginBottom: 32,
        border: "1px solid var(--hair)",
        background: "var(--surface)",
      }}>
        {[
          { k: "EN AGENDA", v: stats.total, mono: true },
          { k: "ESPERANDO", v: stats.esperando, color: "var(--gold)" },
          { k: "EN CURSO", v: stats.enCurso, color: "var(--accent)" },
          { k: "TERMINADAS", v: stats.terminada, color: "var(--forest)" },
        ].map((s, i) => (
          <div key={i} style={{
            padding: "22px 24px",
            borderRight: i < 3 ? "1px dashed var(--hair)" : "0",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}>
            <Eyebrow>{s.k}</Eyebrow>
            <div className="mono" style={{
              fontSize: 36,
              lineHeight: 1,
              color: s.color || "var(--ink)",
              fontWeight: 300,
              marginTop: 6,
            }}>
              {String(s.v).padStart(2, "0")}
            </div>
          </div>
        ))}
      </div>

      {/* SEARCH + AGENDA */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 28 }}>
        {/* Left: agenda list */}
        <section>
          <div className="row between center" style={{ marginBottom: 16 }}>
            <h2 className="h-section">Agenda del día</h2>
            <div style={{ position: "relative", width: 280 }}>
              <input
                className="input"
                placeholder="Buscar paciente, CURP o motivo…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ paddingLeft: 22, fontSize: 12.5 }}
              />
              <span style={{
                position: "absolute", left: 0, top: 8, color: "var(--ink-2)",
                fontFamily: "var(--font-mono)", fontSize: 12,
              }}>⌕</span>
            </div>
          </div>

          <div className="framed" style={{ padding: 0 }}>
            <Corners />
            {/* header row */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "70px 1fr 180px 120px 120px",
              padding: "14px 22px",
              borderBottom: "1px solid var(--hair)",
              background: "var(--cream-2)",
            }}>
              {["HORA", "PACIENTE", "MOTIVO", "ESTADO", ""].map((h, i) => (
                <Eyebrow key={i} style={{ fontSize: 9 }}>{h}</Eyebrow>
              ))}
            </div>

            {filtered.map((p, i) => (
              <div
                key={p.id}
                onClick={() => onOpen(p)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px 1fr 180px 120px 120px",
                  padding: "18px 22px",
                  alignItems: "center",
                  borderBottom: i < filtered.length - 1 ? "1px dashed var(--hair)" : "0",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--cream-2)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <div className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>
                  {p.time}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>
                    {p.name}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--ink-2)", letterSpacing: "0.08em" }}>
                    {p.curp} · {p.age} años · {p.sex}
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", paddingRight: 16 }}>
                  {p.reason}
                </div>
                <div>
                  {p.status === "esperando" && <Pill variant="gold">Esperando</Pill>}
                  {p.status === "en-consulta" && <Pill variant="accent" pulse>En consulta</Pill>}
                  {p.status === "terminada" && <Pill>Terminada</Pill>}
                </div>
                <div style={{ textAlign: "right" }}>
                  {p.status === "esperando" && (
                    <button
                      className="btn sm primary"
                      onClick={(e) => { e.stopPropagation(); onStart(p); }}
                    >
                      INICIAR →
                    </button>
                  )}
                  {p.status === "en-consulta" && (
                    <button className="btn sm" onClick={(e) => { e.stopPropagation(); onStart(p); }}>
                      VOLVER →
                    </button>
                  )}
                  {p.status === "terminada" && (
                    <button className="btn sm ghost" onClick={(e) => e.stopPropagation()}>
                      VER
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Right: quick info */}
        <aside className="col g-24">
          <div className="card">
            <Eyebrow>Próxima consulta</Eyebrow>
            <div style={{ marginTop: 10 }}>
              <div className="mono" style={{ fontSize: 26, color: "var(--forest)" }}>09:00</div>
              <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>
                María G. Hernández
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 3 }}>
                Control de DM2 · 47 años
              </div>
            </div>
            <Divider />
            <div className="col g-8">
              <div className="row between" style={{ fontSize: 12 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)", letterSpacing: "0.16em", textTransform: "uppercase" }}>Última visita</span>
                <span>14 mar 2026</span>
              </div>
              <div className="row between" style={{ fontSize: 12 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)", letterSpacing: "0.16em", textTransform: "uppercase" }}>Alergias</span>
                <span style={{ color: "var(--danger)" }}>Penicilina</span>
              </div>
              <div className="row between" style={{ fontSize: 12 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)", letterSpacing: "0.16em", textTransform: "uppercase" }}>Crónicos</span>
                <span>DM2 · HTA</span>
              </div>
            </div>
          </div>

          <div className="card card-dashed">
            <Eyebrow>Estado del motor</Eyebrow>
            <div className="col g-12" style={{ marginTop: 14 }}>
              <EngineRow label="Whisper-MLX" status="activo" detail="large-v3 · es-MX" />
              <EngineRow label="Gemma 4" status="activo" detail="instruct · 27B" />
              <EngineRow label="CIE-10 ES" status="cargado" detail="14,400 códigos" />
              <EngineRow label="GPC CENETEC" status="cargado" detail="843 guías · 2025" />
              <EngineRow label="Cuadro Básico" status="cargado" detail="Sector Salud · v2025" />
            </div>
          </div>

          <div className="card">
            <Eyebrow>Atajos</Eyebrow>
            <div className="col g-8" style={{ marginTop: 12 }}>
              <ShortcutRow k="⌘ N" v="Nueva consulta" />
              <ShortcutRow k="⌘ K" v="Buscar paciente" />
              <ShortcutRow k="␣" v="Pausar escucha" />
              <ShortcutRow k="⌘ ↵" v="Validar y cerrar" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

const EngineRow = ({ label, status, detail }) => (
  <div className="row between center">
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</div>
      <div className="mono" style={{ fontSize: 10, color: "var(--ink-2)", letterSpacing: "0.08em" }}>
        {detail}
      </div>
    </div>
    <Pill variant={status === "activo" ? "accent" : ""} pulse={status === "activo"}>
      {status}
    </Pill>
  </div>
);

const ShortcutRow = ({ k, v }) => (
  <div className="row between center" style={{ fontSize: 12 }}>
    <span style={{ color: "var(--ink-2)" }}>{v}</span>
    <span className="mono" style={{
      fontSize: 10,
      padding: "3px 8px",
      border: "1px solid var(--hair)",
      letterSpacing: "0.08em",
      color: "var(--ink)",
    }}>{k}</span>
  </div>
);

window.Dashboard = Dashboard;
