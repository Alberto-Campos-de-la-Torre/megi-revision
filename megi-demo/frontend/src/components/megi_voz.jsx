import React from "react";
import { Eyebrow, Pill } from "./shared";
import {
  classifyCommand, applyProposal, initialContext,
  EXAMPLE_COMMANDS, LISTENING,
} from "../lib/voice_mock";

// ============ MEGI VOZ — PROTOTIPO (Fase 1) ============
// UI de "Consulta asistida por voz" SIN ejecución real: selector de modo, panel
// de estado, mock de comandos reconocidos y modal de propuesta con confirmar/
// cancelar. No toca el SOAP/dx/receta reales; opera sobre un contexto de ejemplo.
// Decisión de producto: palabra de activación "MEGI" obligatoria.

const riskPill = (risk) => {
  if (risk === "clinical_sensitive") return { label: "sensible", variant: "gold" };
  if (risk === "low") return { label: "directa", variant: "accent" };
  return { label: "ambigua", variant: "muted" };
};

const Row = ({ k, children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "128px 1fr", gap: 10, padding: "6px 0", borderTop: "1px solid var(--hair)" }}>
    <span style={{ fontSize: 12, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: ".04em" }}>{k}</span>
    <span style={{ fontSize: 13, color: "var(--ink)" }}>{children}</span>
  </div>
);

const MegiVoz = () => {
  const [mode, setMode] = React.useState(null);            // null | "auto" | "assisted"
  const [ctx, setCtx] = React.useState(initialContext);
  const [listening, setListening] = React.useState(LISTENING.COMMAND);
  const [last, setLast] = React.useState(null);            // última clasificación
  const [proposal, setProposal] = React.useState(null);    // propuesta abierta (modal)
  const [log, setLog] = React.useState([]);
  const [input, setInput] = React.useState("");

  const addLog = (entry) => setLog((l) => [{ ...entry, t: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }, ...l].slice(0, 40));

  const run = (text) => {
    const res = classifyCommand(text, ctx);
    setLast(res);
    if (!res.wake_word_detected) {
      setListening(LISTENING.COMMAND);
      addLog({ utterance: res.utterance, intent: "—", risk: "ambiguous", status: "rechazado (sin “MEGI”)" });
      return;
    }
    if (res.requires_confirmation && res.proposal) {
      setProposal(res.proposal);
      setListening(LISTENING.CONFIRM);
      addLog({ utterance: res.utterance, intent: res.intent, risk: res.risk_level, status: "propuesto · pendiente de confirmar" });
      return;
    }
    if (res.risk_level === "ambiguous") {
      setListening(LISTENING.COMMAND);
      addLog({ utterance: res.utterance, intent: res.intent, risk: "ambiguous", status: "ambiguo · pidió aclaración" });
      return;
    }
    // Baja sensibilidad -> "aplicada" directo (simulada).
    setListening(LISTENING.COMMAND);
    addLog({ utterance: res.utterance, intent: res.intent, risk: res.risk_level, status: "aplicada (simulada)" });
  };

  const submit = (e) => {
    e?.preventDefault();
    if (!input.trim()) return;
    run(input.trim());
    setInput("");
  };

  const confirmProposal = () => {
    const applied = applyProposal(ctx, proposal);
    setCtx(applied);
    addLog({ utterance: `↳ confirmar ${proposal.intent}`, intent: proposal.intent, risk: "clinical_sensitive", status: "aplicada (simulada)" });
    setLast((p) => ({ ...(p || {}), message: "Cambio aplicado (simulado)." }));
    setProposal(null);
    setListening(LISTENING.COMMAND);
  };

  const cancelProposal = () => {
    addLog({ utterance: `↳ cancelar ${proposal.intent}`, intent: proposal.intent, risk: "clinical_sensitive", status: "cancelada" });
    setLast((p) => ({ ...(p || {}), message: "Cambio cancelado." }));
    setProposal(null);
    setListening(LISTENING.COMMAND);
  };

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 className="h-page" style={{ margin: 0 }}>MEGI Voz</h1>
        <Pill variant="gold">PROTOTIPO · sin ejecución real</Pill>
      </div>
      <p style={{ color: "var(--ink-2)", fontSize: 14, marginTop: 8, maxWidth: 720 }}>
        Vista previa de <strong>Consulta asistida por voz</strong> (Fase 1). Los comandos se
        clasifican de forma simulada y las acciones sensibles piden confirmación. Nada de esto
        modifica notas, diagnósticos ni recetas reales.
      </p>
      <p style={{ color: "var(--ink-2)", fontSize: 13, marginTop: 4, maxWidth: 720 }}>
        💡 Los comandos de <strong>navegación y pacientes ya funcionan de verdad</strong> desde el
        botón 🎙 flotante (abajo a la derecha), disponible en toda la app.
      </p>

      {/* SELECTOR DE MODO */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, margin: "22px 0" }}>
        {[
          { id: "auto", title: "Consulta automática", desc: "Flujo actual: MEGI escucha, transcribe y arma el SOAP. No controla la interfaz." },
          { id: "assisted", title: "Consulta asistida por voz", desc: "Además acepta comandos “MEGI, …” para navegar, editar y proponer cambios (con confirmación)." },
        ].map((m) => (
          <button key={m.id} type="button" onClick={() => setMode(m.id)}
            className="framed"
            style={{
              textAlign: "left", padding: 18, cursor: "pointer", background: "var(--surface)",
              borderColor: mode === m.id ? "var(--sage)" : "var(--hair)",
              boxShadow: mode === m.id ? "0 0 0 2px var(--sage-soft)" : "none",
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <strong style={{ fontSize: 15 }}>{m.title}</strong>
              {mode === m.id && <Pill variant="accent">activo</Pill>}
            </div>
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{m.desc}</span>
          </button>
        ))}
      </div>

      {mode === "auto" && (
        <div className="framed" style={{ padding: 18, background: "var(--surface)" }}>
          <Eyebrow>Modo actual</Eyebrow>
          <p style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 8 }}>
            La consulta automática es el flujo que ya usas hoy. El control por voz vive en
            <strong> Consulta asistida por voz</strong>.
          </p>
        </div>
      )}

      {mode === "assisted" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)", gap: 18, alignItems: "start" }}>
          {/* CONSOLA DE COMANDOS (mock) */}
          <div className="framed" style={{ padding: 18, background: "var(--surface)" }}>
            <Eyebrow>Simulador de comandos</Eyebrow>
            <form onSubmit={submit} style={{ display: "flex", gap: 8, margin: "12px 0 6px" }}>
              <input className="input" value={input} onChange={(e) => setInput(e.target.value)}
                placeholder='Escribe: "MEGI, cambiar diagnóstico principal a I10"' style={{ flex: 1 }} />
              <button type="submit" className="btn primary" disabled={!input.trim()}>Enviar</button>
            </form>
            <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 12 }}>
              La palabra <strong>“MEGI”</strong> es obligatoria (decisión de producto).
            </div>
            {EXAMPLE_COMMANDS.map((g) => (
              <div key={g.group} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink-2)", marginBottom: 6 }}>{g.group}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {g.items.map((cmd) => (
                    <button key={cmd} type="button" className="btn ghost sm" onClick={() => run(cmd)}
                      style={{ fontSize: 12 }} title="Ejecutar comando de ejemplo (simulado)">
                      {cmd.replace(/^MEGI, /, "")}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* PANEL DE ESTADO + CONTEXTO + AUDITORÍA */}
          <div style={{ display: "grid", gap: 18 }}>
            {/* Panel MEGI Voz */}
            <div className="framed" style={{ padding: 18, background: "var(--surface)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: listening === LISTENING.CONFIRM ? "var(--gold)" : "var(--sage)", display: "inline-block" }} />
                <strong style={{ fontSize: 14 }}>MEGI Voz</strong>
                <span style={{ marginLeft: "auto" }}><Pill variant="muted">{listening}</Pill></span>
              </div>
              <Row k="Modo">Consulta asistida por voz</Row>
              <Row k="Activación">palabra “MEGI” requerida</Row>
              <Row k="Último">{last ? <em>“{last.utterance}”</em> : "—"}</Row>
              <Row k="Intención">{last ? <>{last.intent} {last.wake_word_detected && <Pill variant={riskPill(last.risk_level).variant}>{riskPill(last.risk_level).label}</Pill>}</> : "—"}</Row>
              <Row k="MEGI dice">{last?.message || (proposal ? proposal.confirmation_prompt : "—")}</Row>
            </div>

            {/* Contexto clínico de ejemplo (para ver el efecto simulado) */}
            <div className="framed" style={{ padding: 18, background: "var(--surface)" }}>
              <Eyebrow>Contexto de ejemplo (simulado)</Eyebrow>
              <Row k="Dx principal">{ctx.primaryDx}</Row>
              <Row k="Diagnósticos">{ctx.dxList.join("; ")}</Row>
              <Row k="Receta">{ctx.meds.join("; ") || "(vacía)"}</Row>
              <Row k="Plan (P)">{ctx.soap.plan}</Row>
              <Row k="Análisis (A)">{ctx.soap.analisis}</Row>
            </div>

            {/* Auditoría mock */}
            <div className="framed" style={{ padding: 18, background: "var(--surface)" }}>
              <Eyebrow>Auditoría de comandos (simulada)</Eyebrow>
              {log.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 8 }}>Aún no hay comandos. Prueba uno de la izquierda.</p>
              ) : (
                <div style={{ marginTop: 8, display: "grid", gap: 6, maxHeight: 240, overflow: "auto" }}>
                  {log.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, display: "grid", gridTemplateColumns: "56px 1fr auto", gap: 8, alignItems: "center", padding: "4px 0", borderTop: i ? "1px solid var(--hair)" : "none" }}>
                      <span style={{ color: "var(--ink-2)" }}>{e.t}</span>
                      <span style={{ color: "var(--ink)" }}>“{e.utterance}”</span>
                      <span style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{e.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE PROPUESTA (acción sensible) */}
      {proposal && (
        <div role="dialog" aria-modal="true" style={{
          position: "fixed", inset: 0, background: "rgba(20,25,22,.45)", display: "grid",
          placeItems: "center", padding: 24, zIndex: 60,
        }}>
          <div className="framed" style={{ width: "100%", maxWidth: 480, padding: 24, background: "var(--surface)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Pill variant="gold">acción sensible</Pill>
              <strong style={{ fontSize: 15 }}>Confirmar cambio</strong>
            </div>
            <p style={{ fontSize: 14, color: "var(--ink)", marginBottom: 14 }}>{proposal.confirmation_prompt}</p>
            <Row k="Campo">{proposal.field}</Row>
            <div style={{ margin: "12px 0", display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, color: "var(--ink-2)" }}>Valor actual</div>
              <div style={{ fontSize: 13, padding: "8px 10px", borderRadius: 8, background: "var(--surface-2, #f3f4f2)", textDecoration: "line-through", opacity: .8 }}>{proposal.current_value}</div>
              <div style={{ fontSize: 12, color: "var(--ink-2)" }}>Valor propuesto</div>
              <div style={{ fontSize: 13, padding: "8px 10px", borderRadius: 8, background: "var(--sage-soft)", border: "1px solid var(--sage)" }}>{proposal.proposed_value}</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gold)", display: "inline-block" }} />
              esperando confirmación por voz (“sí” / “no”) o botón
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn primary" onClick={confirmProposal} style={{ flex: 1, justifyContent: "center" }}>Confirmar</button>
              <button className="btn ghost" onClick={cancelProposal} style={{ flex: 1, justifyContent: "center" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MegiVoz;
