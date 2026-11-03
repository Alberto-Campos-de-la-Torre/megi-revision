// ============ SHARED COMPONENTS ============

const Corners = () => (
  <>
    <span className="c-tl" />
    <span className="c-tr" />
    <span className="c-bl" />
    <span className="c-br" />
  </>
);

const Pill = ({ children, variant, pulse, className = "" }) => (
  <span className={`pill ${variant || ""} ${pulse ? "pulse" : ""} ${className}`.trim()}>
    {pulse && <span className="dot" />}
    {children}
  </span>
);

const Eyebrow = ({ children, style }) => (
  <div className="eyebrow" style={style}>{children}</div>
);

const Divider = ({ style }) => <hr className="divider" style={style} />;

const Topbar = ({ view, setView, doctor }) => {
  const items = [
    { id: "dashboard", label: "Agenda" },
    { id: "consulta", label: "Consulta activa" },
    { id: "revision", label: "Revisión" },
    { id: "imprimir", label: "Imprimir" },
  ];
  return (
    <header className="topbar no-print">
      <div className="brand">
        <div style={{ width: 110, height: 36, position: "relative", overflow: "visible", marginRight: 6 }}>
          <window.MegiLogo size={22} color="var(--forest)" accent="var(--gold)" loop={true} maxLoops={2} restPhase={0} />
        </div>
        <div className="brand-text" style={{ fontFamily: '"DM Sans"', fontWeight: 900 }}>
          <span className="name" style={{ fontSize: 15 }}>{"\n"}</span>
          <span className="sub">{"\n"}</span>
        </div>
      </div>
      <nav className="nav">
        {items.map((it) => (
          <button
            key={it.id}
            className={view === it.id ? "active" : ""}
            onClick={() => setView(it.id)}
          >
            {it.label}
          </button>
        ))}
      </nav>
      <div className="user-chip">
        <div className="avatar">C</div>
        <div className="who">
          <span className="n">{doctor.name}</span>
          <span className="c">CED · {doctor.cedula}</span>
        </div>
      </div>
    </header>
  );
};

// Striped placeholder for imagery
const ImgPlaceholder = ({ h = 120, label = "imagen", style }) => (
  <div
    style={{
      height: h,
      background:
        "repeating-linear-gradient(-45deg, var(--cream-2) 0 8px, var(--cream-3) 8px 9px)",
      border: "1px dashed var(--hair)",
      display: "grid",
      placeItems: "center",
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: "var(--ink-2)",
      ...style,
    }}
  >
    {label}
  </div>
);

// Animated waveform
const Waveform = ({ active = true, bars = 48 }) => {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, [active]);

  const heights = React.useMemo(() => {
    // deterministic seed that varies with tick
    return Array.from({ length: bars }, (_, i) => {
      const v = Math.sin((i + tick) * 0.35) * 0.5 + Math.cos((i - tick) * 0.22) * 0.35;
      const r = (v + 1) * 0.5;
      return 10 + Math.abs(r) * 100;
    });
  }, [tick, bars]);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 2,
      height: 56,
      width: "100%",
    }}>
      {heights.map((h, i) => (
        <div key={i} style={{
          flex: 1,
          height: active ? `${h}%` : "20%",
          background: "var(--forest)",
          opacity: active ? 0.85 : 0.3,
          transition: "height 120ms ease-out",
        }} />
      ))}
    </div>
  );
};

const ConfidenceBar = ({ value, color }) => (
  <div style={{
    width: 80, height: 4, background: "var(--cream-2)", position: "relative",
  }}>
    <div style={{
      position: "absolute", left: 0, top: 0, bottom: 0,
      width: `${Math.round(value * 100)}%`,
      background: color || "var(--forest)",
    }} />
  </div>
);

Object.assign(window, {
  Corners, Pill, Eyebrow, Divider, Topbar, ImgPlaceholder, Waveform, ConfidenceBar,
});
