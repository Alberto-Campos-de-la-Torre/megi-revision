import React from "react";
import { Eyebrow } from "./shared";

// ============ CHAT CON MEGI IA (reutilizable) ============
// `preguntar(pregunta, historial)` devuelve {respuesta, fuente, error}. Lo
// usan el expediente del paciente y el pre-diagnóstico de los estudios. La
// etiqueta de fuente la pone el backend: "llm", "mock" o "sin_modelo".

const FUENTE_LABEL = { mock: "simulado · sin modelo", sin_modelo: "sin modelo · servicio no disponible" };

const ChatMegi = ({ titulo, placeholder, ejemplos, preguntar, resetKey, esperando = "MEGI está leyendo…", compact = false }) => {
  const [mensajes, setMensajes] = React.useState([]);
  const [input, setInput] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const finRef = React.useRef(null);

  React.useEffect(() => { setMensajes([]); setInput(""); }, [resetKey]);
  React.useEffect(() => { finRef.current?.scrollIntoView?.({ block: "nearest" }); }, [mensajes, enviando]);

  const enviar = async (e) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || enviando) return;
    setInput("");
    const historial = mensajes.slice(-6).map((m) => ({ rol: m.rol, texto: m.texto }));
    setMensajes((m) => [...m, { rol: "medico", texto: q }]);
    setEnviando(true);
    try {
      const r = await preguntar(q, historial);
      setMensajes((m) => [...m, { rol: "megi", texto: r.respuesta || "", fuente: r.fuente, error: r.error, fuentes: r.fuentes || [] }]);
    } catch (e2) {
      setMensajes((m) => [...m, { rol: "megi", texto: "", error: e2.message }]);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{ marginTop: compact ? 10 : 14, borderTop: "1px solid var(--hair)", paddingTop: compact ? 8 : 12 }} role="region" aria-label={titulo}>
      <Eyebrow>{titulo}</Eyebrow>
      <div className="col g-8" style={{ marginTop: 8, maxHeight: 300, overflowY: "auto" }}>
        {mensajes.length === 0 && ejemplos && (
          <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic" }}>{ejemplos}</div>
        )}
        {mensajes.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.rol === "medico" ? "flex-end" : "flex-start", maxWidth: "92%",
            background: m.rol === "medico" ? "var(--cream-2)" : "var(--sage-soft)",
            border: "1px solid " + (m.rol === "medico" ? "var(--hair)" : "var(--sage)"),
            borderRadius: 10, padding: "8px 10px", fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap",
          }}>
            {m.rol === "megi" && (
              <div className="mono" style={{ fontSize: 9, color: "var(--ink-2)", marginBottom: 3, letterSpacing: ".06em" }}>
                MEGI{m.fuente && m.fuente !== "llm" ? ` · ${FUENTE_LABEL[m.fuente] || m.fuente}` : ""}
              </div>
            )}
            {m.texto}
            {m.error && !m.texto && <span style={{ color: "var(--danger)" }}>No se pudo responder: {m.error}</span>}
            {m.fuentes && m.fuentes.length > 0 && (
              <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.4 }}>
                {m.fuentes.map((f, j) => <div key={j}>[{f.citation_id || `S${j + 1}`}] {f.citation || f.title}{f.page ? ` · p. ${f.page}` : ""}</div>)}
              </div>
            )}
          </div>
        ))}
        {enviando && <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic" }}>{esperando}</div>}
        <div ref={finRef} />
      </div>
      <form className="row g-8" style={{ marginTop: 10 }} onSubmit={enviar}>
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder}
               disabled={enviando} aria-label={placeholder} style={{ flex: 1 }} />
        <button type="submit" className="btn primary sm" disabled={enviando || !input.trim()}>{enviando ? "…" : "PREGUNTAR"}</button>
      </form>
    </div>
  );
};

export default ChatMegi;
