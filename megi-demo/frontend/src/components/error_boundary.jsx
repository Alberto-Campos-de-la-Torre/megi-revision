import React from "react";

// Atrapa errores de render para que una pantalla nunca deje la app en blanco
// (ni pierda el estado de la consulta). Muestra un fallback con "Volver".
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[megi] error de render", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="page" style={{ paddingTop: 40 }}>
          <div className="card" style={{ borderLeft: "3px solid var(--danger)", maxWidth: 640 }}>
            <h2 className="h-section" style={{ fontSize: 22 }}>Algo salió mal en esta pantalla</h2>
            <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginTop: 8 }}>
              No se perdió la consulta: el audio, la transcripción y la nota siguen guardados.
              Puedes volver e intentar de nuevo.
            </p>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 8 }}>
              {String(this.state.error?.message || this.state.error)}
            </div>
            <button className="btn primary" style={{ marginTop: 16 }}
              onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>
              ← Volver al inicio
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
