// ============ TWEAKS PANEL ============
const Tweaks = ({ config, setConfig, onClose }) => {
  const set = (k, v) => setConfig({ ...config, [k]: v });

  const accents = [
    { id: "teal", c: "#3a7d7b" },
    { id: "blue", c: "#3a5e8b" },
    { id: "forest", c: "#2d3b2d" },
    { id: "gold", c: "#8b7355" },
    { id: "rust", c: "#8b4a3a" },
  ];

  return (
    <div className="tweaks no-print">
      <div className="row between center">
        <div>
          <h4>Tweaks</h4>
          <div className="tweaks-sub">Preferencias del médico</div>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: 0, cursor: "pointer",
          color: "var(--ink-2)", fontSize: 18,
        }}>×</button>
      </div>

      <div className="tweak-row">
        <span className="label">Tema</span>
        <div className="seg">
          <button className={config.theme === "light" ? "on" : ""} onClick={() => set("theme", "light")}>Claro</button>
          <button className={config.theme === "dark" ? "on" : ""} onClick={() => set("theme", "dark")}>Oscuro</button>
        </div>
      </div>

      <div className="tweak-row">
        <span className="label">Acento</span>
        <div className="swatch-row">
          {accents.map((a) => (
            <div key={a.id}
              className={"swatch " + (config.accent === a.id ? "on" : "")}
              onClick={() => set("accent", a.id)}
              style={{ background: a.c }}
              title={a.id}
            />
          ))}
        </div>
      </div>

      <div className="tweak-row">
        <span className="label">Densidad</span>
        <div className="seg">
          <button className={config.density === "compact" ? "on" : ""} onClick={() => set("density", "compact")}>Compacto</button>
          <button className={config.density === "cozy" ? "on" : ""} onClick={() => set("density", "cozy")}>Cómodo</button>
        </div>
      </div>

      <div className="tweak-row">
        <span className="label">Tamaño texto</span>
        <div className="seg">
          <button className={config.textSize === "sm" ? "on" : ""} onClick={() => set("textSize", "sm")}>A</button>
          <button className={config.textSize === "md" ? "on" : ""} onClick={() => set("textSize", "md")}>A</button>
          <button className={config.textSize === "lg" ? "on" : ""} onClick={() => set("textSize", "lg")}
            style={{ fontSize: 12 }}>A</button>
          <button className={config.textSize === "xl" ? "on" : ""} onClick={() => set("textSize", "xl")}
            style={{ fontSize: 14 }}>A</button>
        </div>
      </div>

      <div className="tweak-row">
        <span className="label">Transcripción</span>
        <div className="seg">
          <button className={config.showTranscript ? "on" : ""} onClick={() => set("showTranscript", true)}>Mostrar</button>
          <button className={!config.showTranscript ? "on" : ""} onClick={() => set("showTranscript", false)}>Ocultar</button>
        </div>
      </div>

      <div className="tweak-row">
        <span className="label">Institución</span>
        <div className="seg">
          <button className={config.inst === "priv" ? "on" : ""} onClick={() => set("inst", "priv")}>Priv.</button>
          <button className={config.inst === "imss" ? "on" : ""} onClick={() => set("inst", "imss")}>IMSS</button>
          <button className={config.inst === "issste" ? "on" : ""} onClick={() => set("inst", "issste")}>ISSSTE</button>
        </div>
      </div>
    </div>
  );
};

window.Tweaks = Tweaks;
