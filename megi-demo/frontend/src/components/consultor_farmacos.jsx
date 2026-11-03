import React from "react";
import { api } from "../api/client";

// ============ CONSULTOR DE FÁRMACOS (tipo Drugs.com, integrado) ============
// Lanzador flotante 💊 disponible en toda la app: el médico pregunta dudas sobre
// interacciones/seguridad antes o durante la consulta. Responde con RAG sobre su
// catálogo aprobado + fichas FDA traducidas (gemma). Si se le pasa `rxContext`
// (la receta actual), lo usa como contexto. Es apoyo, no prescribe.

const EJEMPLOS = [
  "¿Puedo dar tramadol con sertralina?",
  "¿Naproxeno es seguro en enfermedad renal?",
  "Dosis máxima de gabapentina",
];

const ConsultorFarmacos = ({ rxContext = [] }) => {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [turns, setTurns] = React.useState([]); // {q, a, drugs, error}
  const [busy, setBusy] = React.useState(false);
  const boxRef = React.useRef(null);

  React.useEffect(() => { if (open) boxRef.current?.scrollTo?.(0, boxRef.current.scrollHeight); }, [turns, open]);

  const ask = async (text) => {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: question, a: null }]);
    try {
      const r = await api.drugsConsult({ question, rx_context: rxContext });
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: r.answer, drugs: r.drugs_detectados } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: e.message } : x)));
    } finally { setBusy(false); }
  };

  return (
    <>
      <button className="no-print" onClick={() => setOpen((v) => !v)}
        title="Consultor de fármacos — dudas de interacciones"
        aria-label="Consultor de fármacos"
        style={{
          position: "fixed", right: 16, bottom: 112, zIndex: 40, width: 40, height: 40,
          borderRadius: "50%", border: "1px solid var(--hair)",
          background: open ? "var(--forest)" : "var(--surface)", color: open ? "#fff" : "var(--ink-2)",
          cursor: "pointer", fontSize: 18, boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
        }}>💊</button>

      {open && (
        <div className="framed no-print" style={{
          position: "fixed", right: 16, bottom: 160, zIndex: 40, width: 380, maxWidth: "calc(100vw - 32px)",
          padding: 14, background: "var(--surface)", boxShadow: "0 8px 30px rgba(0,0,0,0.14)",
          display: "flex", flexDirection: "column", maxHeight: "70vh",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 15 }}>💊</span>
            <strong style={{ fontSize: 14 }}>Consultor de fármacos</strong>
            {rxContext.length > 0 && <span style={{ fontSize: 10.5, color: "var(--sage-2)", marginLeft: "auto" }}>receta actual: {rxContext.length}</span>}
          </div>
          <p style={{ fontSize: 11, color: "var(--ink-2)", margin: "0 0 8px" }}>
            Dudas de interacciones y seguridad, con base en tu catálogo + fichas FDA. Apoyo, no prescribe.
          </p>

          <div ref={boxRef} style={{ flex: 1, overflowY: "auto", display: "grid", gap: 10, marginBottom: 8 }}>
            {turns.length === 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {EJEMPLOS.map((e) => (
                  <button key={e} type="button" className="btn ghost sm" style={{ fontSize: 11 }} onClick={() => ask(e)}>{e}</button>
                ))}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t.q}</div>
                {t.drugs?.length > 0 && (
                  <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)", margin: "2px 0" }}>detectados: {t.drugs.join(" · ")}</div>
                )}
                {t.error ? <div style={{ fontSize: 12, color: "var(--danger)" }}>{t.error}</div>
                  : t.a == null ? <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic" }}>Consultando…</div>
                    : <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--ink)" }}>{t.a}</div>}
              </div>
            ))}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); ask(); }} style={{ display: "flex", gap: 6 }}>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="¿tramadol con sertralina?" style={{ flex: 1, fontSize: 12.5 }} disabled={busy} />
            <button type="submit" className="btn primary sm" disabled={!q.trim() || busy}>{busy ? "…" : "Preguntar"}</button>
          </form>
        </div>
      )}
    </>
  );
};

export default ConsultorFarmacos;
