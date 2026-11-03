import React from "react";
import { MegiLogo } from "./logo";
import { ServiceHealth } from "./service_health";

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

const Topbar = ({ view, setView, doctor, user, appVersion, onLogout, onChangePassword, onMiPerfil, health }) => {
  const voiceEnabled = !!appVersion?.features?.voiceAgent;
  const items = [
    { id: "dashboard", label: "Agenda" },
    { id: "pacientes", label: "Pacientes" },
    { id: "guias", label: "Guías" },
    { id: "anestesio", label: "Anestesio" },
    { id: "radiologia", label: "Radiología" },
    { id: "estadisticas", label: "Estadísticas" },
    ...(voiceEnabled ? [{ id: "voz", label: "MEGI Voz" }] : []),
    ...(user?.role === "admin" ? [{ id: "administracion", label: "Administración" }] : []),
  ];
  return (
    <header className="topbar no-print">
      <div className="brand">
        <div style={{ width: 120, height: 34, position: "relative", overflow: "visible" }}>
          <MegiLogo size={22} loop={true} maxLoops={1} restPhase={0} />
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
      <div className="row center g-10 topbar-actions" style={{ justifySelf: "end" }}>
        <ServiceHealth health={health} />
        <div className="user-chip">
          <div className="avatar">{(user?.name || doctor?.name || "U").trim()[0]}</div>
          <div className="who">
            <span className="n">{user?.name || doctor?.name}</span>
            <span className="c">
              {user?.role === "admin" ? "ADMINISTRADOR" : (user?.role || "").toUpperCase()}
              {appVersion?.label ? ` · ${appVersion.label}` : ""}
            </span>
          </div>
        </div>
        {onMiPerfil && (
          <button className="btn ghost sm" onClick={onMiPerfil} title="Mi perfil profesional (cédula)" aria-label="Mi perfil profesional">MI PERFIL</button>
        )}
        {onChangePassword && (
          <button className="btn ghost sm" onClick={onChangePassword} title="Cambiar contraseña" aria-label="Cambiar contraseña">CONTRASEÑA</button>
        )}
        {onLogout && (
          <button className="btn ghost sm" onClick={onLogout} title="Cerrar sesión" aria-label="Cerrar sesión">SALIR</button>
        )}
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

export {
  Corners, Pill, Eyebrow, Divider, Topbar, ImgPlaceholder, Waveform, ConfidenceBar,
};
