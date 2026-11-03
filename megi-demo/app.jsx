// ============ MAIN APP ============
const { useState, useEffect } = React;

const ACCENT_COLORS = {
  teal: "#3a7d7b",
  blue: "#3a5e8b",
  forest: "#2d3b2d",
  gold: "#8b7355",
  rust: "#8b4a3a",
};

const TEXT_SCALES = { sm: 0.9, md: 1.0, lg: 1.12, xl: 1.25 };
const DENSITY = { compact: 0.85, cozy: 1.0 };

const App = () => {
  const { PATIENTS, DOCTOR } = window.MEGI_DATA;

  const [splash, setSplash] = useState(() => !sessionStorage.getItem("megi.splash.done"));
  // persistent view
  const [view, setView] = useState(() => localStorage.getItem("megi.view") || "dashboard");
  const [patient, setPatient] = useState(() => {
    const id = localStorage.getItem("megi.patient");
    return PATIENTS.find((p) => p.id === id) || PATIENTS[1]; // Jorge default
  });
  useEffect(() => { localStorage.setItem("megi.view", view); }, [view]);
  useEffect(() => { if (patient) localStorage.setItem("megi.patient", patient.id); }, [patient]);

  // Tweaks (wrapped in EDITMODE markers for host persistence)
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "theme": "light",
    "accent": "teal",
    "density": "cozy",
    "textSize": "md",
    "showTranscript": true,
    "inst": "priv"
  }/*EDITMODE-END*/;

  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem("megi.config");
    return saved ? { ...TWEAK_DEFAULTS, ...JSON.parse(saved) } : TWEAK_DEFAULTS;
  });
  const [showTweaks, setShowTweaks] = useState(false);

  useEffect(() => {
    localStorage.setItem("megi.config", JSON.stringify(config));

    const root = document.documentElement;
    root.setAttribute("data-theme", config.theme);
    root.style.setProperty("--accent", ACCENT_COLORS[config.accent] || ACCENT_COLORS.teal);
    root.style.setProperty("--text-scale", TEXT_SCALES[config.textSize] || 1);
    root.style.setProperty("--density", DENSITY[config.density] || 1);

    // persist to disk
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: config }, "*");
  }, [config]);

  // edit-mode protocol
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === "__activate_edit_mode") setShowTweaks(true);
      if (e.data?.type === "__deactivate_edit_mode") setShowTweaks(false);
    };
    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", handler);
  }, []);

  const openPatient = (p) => {
    setPatient(p);
    setView("consulta");
  };
  const startConsulta = (p) => {
    if (p) setPatient(p);
    setView("consulta");
  };
  const finishConsulta = () => setView("revision");
  const approve = () => setView("imprimir");

  return (
    <div className="app" data-screen-label={`Megi Medico — ${view}`}>
      {splash && (
        <window.MegiSplash onDone={() => {
          sessionStorage.setItem("megi.splash.done", "1");
          setSplash(false);
        }} />
      )}
      <Topbar view={view} setView={setView} doctor={DOCTOR} />

      {view === "dashboard" && (
        <div data-screen-label="01 Dashboard">
          <Dashboard
            patients={PATIENTS}
            doctor={DOCTOR}
            onOpen={openPatient}
            onStart={startConsulta}
          />
        </div>
      )}
      {view === "consulta" && (
        <div data-screen-label="02 Consulta activa">
          <Consulta
            patient={patient}
            onBack={() => setView("dashboard")}
            onFinish={finishConsulta}
            showTranscript={config.showTranscript}
          />
        </div>
      )}
      {view === "revision" && (
        <div data-screen-label="03 Revisión">
          <Revision
            patient={patient}
            onBack={() => setView("consulta")}
            onApprove={approve}
          />
        </div>
      )}
      {view === "imprimir" && (
        <div data-screen-label="04 Imprimir">
          <Imprimir
            patient={patient}
            doctor={DOCTOR}
            onBack={() => setView("revision")}
          />
        </div>
      )}

      {showTweaks && (
        <Tweaks config={config} setConfig={setConfig} onClose={() => setShowTweaks(false)} />
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
