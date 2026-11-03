import React from "react";
import { MegiLogo } from "./logo";
import { Pill } from "./shared";
import { APP_VERSIONS } from "../lib/app_versions";

// ============ SELECTOR DE VERSIÓN ============
// Se muestra después de autenticar y antes de montar el provider clínico.
// Semántica de radiogroup: flechas para cambiar de tarjeta, Enter o el botón
// para confirmar; doble clic sobre una tarjeta inicia directo.
const VersionSelect = ({ user, onSelect, onLogout }) => {
  const [selected, setSelected] = React.useState(APP_VERSIONS[0].id);
  const version = APP_VERSIONS.find((v) => v.id === selected) || APP_VERSIONS[0];

  const submit = (e) => {
    e?.preventDefault();
    onSelect(version.id);
  };

  const onKeyDown = (e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const idx = APP_VERSIONS.findIndex((v) => v.id === selected);
    const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = APP_VERSIONS[(idx + dir + APP_VERSIONS.length) % APP_VERSIONS.length];
    setSelected(next.id);
    document.getElementById(`version-card-${next.id}`)?.focus();
  };

  return (
    <div style={{
      minHeight: "100vh", display: "grid", placeItems: "center", padding: 24,
      backgroundImage: "url('/fondo-login.jpg')",
      backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat",
    }}>
      <form onSubmit={submit} className="framed" style={{ width: "100%", maxWidth: 760, padding: 34, background: "var(--surface)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22 }}>
          {/* MegiLogo mide size*5 de ancho (letras absolutas): el contenedor debe
              medir exactamente eso o las letras se enciman con el texto vecino. */}
          <div style={{ width: 24 * 5, height: 30, position: "relative", flexShrink: 0 }}>
            <MegiLogo size={24} loop={true} maxLoops={1} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">¿Cómo quieres trabajar hoy?</div>
            <h1 className="h-section" style={{ marginTop: 4, fontSize: 24 }}>Hola, {user?.name || user?.username}</h1>
          </div>
          {onLogout && (
            <button type="button" className="btn ghost sm" onClick={onLogout} style={{ marginLeft: "auto" }}>
              SALIR
            </button>
          )}
        </div>

        <div className="version-grid" role="radiogroup" aria-label="Versión de MEGI" onKeyDown={onKeyDown}>
          {APP_VERSIONS.map((v) => {
            const active = selected === v.id;
            return (
              <button
                key={v.id}
                id={`version-card-${v.id}`}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                className="version-card"
                onClick={() => setSelected(v.id)}
                onDoubleClick={() => onSelect(v.id)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="eyebrow" style={active ? { color: "var(--sage-2)" } : undefined}>{v.label}</span>
                  {v.badge && <Pill variant={v.badgeVariant || "sage"}>{v.badge}</Pill>}
                  {active && <span style={{ marginLeft: "auto" }}><Pill variant="sage">seleccionada</Pill></span>}
                </span>
                <strong style={{ display: "block", fontSize: 16, marginBottom: 6 }}>{v.title}</strong>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45, marginBottom: 12 }}>
                  {v.summary}
                </span>
                <span style={{ display: "grid", gap: 6 }}>
                  {v.bullets.map((b) => (
                    <span key={b} style={{ fontSize: 11.5, color: "var(--ink-2)" }}>· {b}</span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "var(--ink-2)", flex: 1, minWidth: 220 }}>
            La versión se guarda para esta sesión; para cambiarla, cierra sesión y vuelve a entrar.
          </div>
          <button type="submit" className="btn primary lg">
            INICIAR {version.label.toUpperCase()}
          </button>
        </div>
      </form>
    </div>
  );
};

export default VersionSelect;
