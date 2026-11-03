import React from "react";
import { Eyebrow } from "./shared";
import { api } from "../api/client";
import { classifyCommand, applyProposal, parseMed } from "../lib/voice_mock";
import { shadowParse } from "../lib/voice_shadow";
import { useExpertMode } from "../lib/voice_prefs";
import {
  commandNeedsDoubleConfirm,
  evaluateCommandPolicy,
  permissionsForRole,
  VOICE_CONTEXT,
  VOICE_RISK,
} from "../lib/voice_command_registry";

// ============ MEGI VOZ — EDICIÓN CLÍNICA POR VOZ (Fases 3–4) ============
// Edita la NOTA SOAP, los DIAGNÓSTICOS (CIE-10) y la RECETA por voz, SIEMPRE con
// propuesta → confirmación. Validadores de seguridad antes de aplicar (receta ×
// alergias) y AUDITORÍA persistente por usuario (POST /review/event). Entrada
// escrita (el ASR on-device de comandos entra después).

const SEC_NAME = { subjetivo: "Subjetivo", objetivo: "Objetivo", analisis: "Análisis", plan: "Plan" };
const SOAP_EDITS = new Set(["soap_add", "soap_replace", "soap_delete_last"]);

const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
const fmtDx = (d) => `${d.code || ""} ${d.label || ""}`.trim();
const fmtRx = (r) => [r.drug, r.dose, r.freq].filter(Boolean).join(" ");
const time = () => new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
const sameCode = (a, b) => (a || "").toUpperCase() === (b || "").toUpperCase();

const normalizeDxList = (list) => (list || []).map((d, i) => ({ ...d, primary: i === 0 }));

function changePrimaryDxList(dxList, item) {
  const existing = (dxList || []).find((d) => sameCode(d.code, item.code));
  const primary = { ...(existing || {}), ...item, label: item.label || existing?.label || "", primary: true };
  const rest = (dxList || []).filter((d) => !sameCode(d.code, item.code));
  return normalizeDxList([primary, ...rest]);
}

const toCtx = (soap) => ({
  soap: { subjetivo: soap.S || "", objetivo: soap.O || "", analisis: soap.A || "", plan: soap.P || "" },
});

const EXAMPLES = [
  "MEGI, agrega a plan: control en 7 días",
  "MEGI, cambiar diagnóstico principal a I10",
  "MEGI, agrega diagnóstico hipertensión",
  "MEGI, agrega losartán 50 mg cada 24 horas",
  "MEGI, elimina la última frase del análisis",
];

const ClinicalVoiceEditor = ({ consultationId, soap, setSoap, dxList, setDxList, rxList, setRxList, allergies, chronic, user }) => {
  const [input, setInput] = React.useState("");
  const [pending, setPending] = React.useState(null);
  const [resp, setResp] = React.useState(null);
  const [log, setLog] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [expert] = useExpertMode();          // Fase 5
  const [armed, setArmed] = React.useState(false);  // confirmación reforzada (2 pasos)
  const [alts, setAlts] = React.useState(null);     // sugerencias ante interacción grave

  // Ante un blocker de interacción, pide alternativas (LLM + catálogo) para que
  // el médico las vea e itere. Solo sugiere; nada se aplica.
  const askAlternatives = async (pend) => {
    const ix = (pend.blockers || []).find((b) => b.type === "interaccion" && b.message);
    if (!ix) return;
    setAlts({ loading: true });
    try {
      const proposedNames = (pend.proposed || "").split(";").map((s) => s.trim()).filter(Boolean);
      const [a, b] = (ix.message.split("(")[0] || "").split("+").map((s) => s.trim());
      const r = await api.drugsAlternatives({
        rx_list: proposedNames, farmaco_a: a, farmaco_b: b,
        severidad: ix.severidad || "grave", mecanismo: ix.message,
      });
      setAlts({ ...r, loading: false });
    } catch (e) { setAlts({ error: e.message, loading: false }); }
  };

  const resolveLabel = async (code) => {
    try {
      const r = await api.searchCie10(code);
      const hit = (r.results || []).find((x) => x.code.toUpperCase() === code.toUpperCase()) || (r.results || [])[0];
      return hit ? hit.label : "";
    } catch (e) { return ""; }
  };

  // Propuesta de dx para un item YA RESUELTO {code, label}: la selección
  // estructurada (código o pick-list CIE-10) evita texto libre en diagnósticos.
  const proposeDx = (a, item0, t, command, intent) => {
    const item = { code: (item0.code || "").toUpperCase(), label: item0.label || "" };
    if (a === "add_dx" && dxList.some((d) => sameCode(d.code, item.code))) {
      setPending(null); setResp({ status: "info", utterance: t, message: `${item.code} ya está en la lista.` }); return;
    }
    const proposedList = a === "change_primary_dx"
      ? changePrimaryDxList(dxList, item)
      : normalizeDxList([...dxList, item]);
    const current = a === "change_primary_dx"
      ? (dxList[0] ? fmtDx(dxList[0]) : "(sin principal)")
      : (dxList.map(fmtDx).join("; ") || "(vacío)");
    const proposed = a === "change_primary_dx" ? fmtDx(item) : proposedList.map(fmtDx).join("; ");
    setPending({ kind: "dx", utterance: t, field: a === "change_primary_dx" ? "Dx principal" : "Diagnósticos (CIE-10)",
      current, proposed,
      apply: () => setDxList(proposedList),
      auditKind: "voice_dx", auditPayload: { intent, code: item.code, before: current, after: proposed, command: t },
      command });
    setResp({ status: "proposed", utterance: t });
  };

  const send = async (text) => {
    const t = (text || "").trim();
    if (!t || busy) return;
    setInput("");
    setArmed(false);
    const result = classifyCommand(t, toCtx(soap), { requireWake: !expert });
    if (result.rejected) { setPending(null); setResp({ status: "rejected", utterance: t, message: result.message }); return; }
    const policy = evaluateCommandPolicy(result, {
      context: VOICE_CONTEXT.REVIEW,
      permissions: permissionsForRole(user?.role),
      enforceContext: true,
    });
    if (!policy.allowed) {
      // Comandos de bajo riesgo (navegación, abrir paciente) no son un error del
      // usuario: se le orienta a la barra global en vez del mensaje de política.
      const isLowRiskElsewhere = policy.reason === "context" && policy.command?.risk === VOICE_RISK.LOW;
      setPending(null);
      setResp(isLowRiskElsewhere
        ? { status: "info", utterance: t, message: "Aquí edito la nota, los diagnósticos y la receta. Para navegar o abrir pacientes usa la barra 🎙 (abajo a la derecha)." }
        : { status: "rejected", utterance: t, message: policy.message });
      return;
    }
    const a = result.action;

    // --- SOAP (síncrono) ---
    if (SOAP_EDITS.has(a) && result.proposal) {
      setPending({
        kind: "soap", utterance: t, field: SEC_NAME[result.entities.section] || result.field,
        current: result.proposal.current_value, proposed: result.proposal.proposed_value,
        apply: () => { const n = applyProposal(toCtx(soap), result.proposal); setSoap({ S: n.soap.subjetivo, O: n.soap.objetivo, A: n.soap.analisis, P: n.soap.plan }); },
        auditKind: "voice_soap",
        auditPayload: { intent: result.intent, section: result.entities.section, before: result.proposal.current_value, after: result.proposal.proposed_value, command: t },
        command: policy.command,
      });
      setResp({ status: "proposed", utterance: t });
      return;
    }

    // --- Diagnósticos (por código o por NOMBRE -> búsqueda CIE-10 + pick-list) ---
    if (a === "change_primary_dx" || a === "add_dx" || a === "remove_dx") {
      const code = (result.entities.code || "").toUpperCase();
      const query = (result.entities.query || "").trim();

      if (a === "remove_dx") {
        // Quitar acepta código o nombre, pero SIEMPRE contra la lista actual.
        const match = code
          ? dxList.find((d) => sameCode(d.code, code))
          : dxList.find((d) => norm(fmtDx(d)).includes(norm(query)));
        if (!match) { setPending(null); setResp({ status: "info", utterance: t, message: `No hay un diagnóstico "${code || query}" en la lista.` }); return; }
        const proposed = normalizeDxList(dxList.filter((d) => d !== match));
        setPending({ kind: "dx", utterance: t, field: "Diagnósticos (CIE-10)",
          current: dxList.map(fmtDx).join("; "), proposed: proposed.map(fmtDx).join("; ") || "(vacío)",
          apply: () => setDxList((l) => normalizeDxList(l.filter((d) => !sameCode(d.code, match.code)))),
          auditKind: "voice_dx", auditPayload: { intent: result.intent, code: match.code, before: dxList.map(fmtDx).join("; "), after: proposed.map(fmtDx).join("; "), command: t },
          command: policy.command });
        setResp({ status: "proposed", utterance: t }); return;
      }

      if (code) {
        setBusy(true);
        const label = await resolveLabel(code);
        setBusy(false);
        proposeDx(a, { code, label }, t, policy.command, result.intent);
        return;
      }

      // Por nombre: resolver contra el catálogo CIE-10 (nunca texto libre al dx).
      setBusy(true);
      let options = [];
      try { const r = await api.searchCie10(query); options = (r.results || []).slice(0, 5); } catch (e) { options = []; }
      setBusy(false);
      if (!options.length) {
        setPending(null);
        setResp({ status: "info", utterance: t, message: `No encontré "${query}" en el catálogo CIE-10; intenta otro término o dicta el código.` });
        return;
      }
      if (options.length === 1) { proposeDx(a, options[0], t, policy.command, result.intent); return; }
      // Varias coincidencias: pick-list estructurada para que el médico elija.
      setPending({ kind: "dx_pick", utterance: t, action: a, options, intent: result.intent, command: policy.command });
      setResp({ status: "proposed", utterance: t });
      return;
    }

    // --- Receta (con validador de seguridad receta × alergias) ---
    if (a === "add_med") {
      setBusy(true);
      const med = parseMed(result.entities.med);
      const proposedRx = [...rxList, med];
      let alerts = [];
      let safetyFailed = false;
      try { const s = await api.checkRx({ rx_list: proposedRx, allergies, chronic }); alerts = s.alerts || []; } catch (e) { alerts = []; safetyFailed = true; }
      setBusy(false);
      const blockers = alerts.filter((x) => x.severity === "blocker");
      const warnings = alerts.filter((x) => x.severity === "warn");
      setPending({ kind: "rx", utterance: t, field: "Receta",
        current: rxList.map(fmtRx).join("; ") || "(vacía)", proposed: proposedRx.map(fmtRx).join("; "),
        blockers, warnings, safetyFailed, blocked: safetyFailed || blockers.length > 0,
        apply: () => setRxList((l) => [...l, med]),
        auditKind: "voice_rx", auditPayload: { intent: result.intent, med, before: rxList.map(fmtRx).join("; "), after: proposedRx.map(fmtRx).join("; "), safety: { blockers: blockers.length, warnings: warnings.length }, command: t },
        command: policy.command });
      setResp({ status: "proposed", utterance: t }); return;
    }
    if (a === "remove_med") {
      const q = norm(result.entities.med);
      const match = rxList.find((r) => norm(r.drug).includes(q));
      if (!match) { setPending(null); setResp({ status: "info", utterance: t, message: `No encuentro "${result.entities.med}" en la receta.` }); return; }
      const proposed = rxList.filter((r) => r !== match);
      setPending({ kind: "rx", utterance: t, field: "Receta",
        current: rxList.map(fmtRx).join("; "), proposed: proposed.map(fmtRx).join("; ") || "(vacía)",
        blockers: [], warnings: [], blocked: false,
        // Quita EXACTAMENTE el medicamento mostrado en la propuesta (no todos los
        // que coincidan por substring: "aspirina" no debe borrar "Aspirina protect").
        apply: () => setRxList((l) => l.filter((r) => r !== match)),
        auditKind: "voice_rx", auditPayload: { intent: result.intent, removed: match, before: rxList.map(fmtRx).join("; "), after: proposed.map(fmtRx).join("; "), command: t },
        command: policy.command });
      setResp({ status: "proposed", utterance: t }); return;
    }

    // Fase 9B (shadow): lo que el regex no entendió va al parser LLM solo para registro.
    if (result.intent === "unknown") shadowParse(t, result, "revision");
    setPending(null);
    setResp({ status: "info", utterance: t, message: "Aquí edito la nota, los diagnósticos y la receta. Para navegar usa la barra 🎙 (abajo a la derecha)." });
  };

  const submit = (e) => { e?.preventDefault(); send(input); };

  const confirm = async () => {
    if (!pending || pending.blocked) return;
    // Fase 5: en modo experto (sin "MEGI"), confirmación reforzada de 2 pasos.
    if (commandNeedsDoubleConfirm(pending.command, { expert }) && !armed) { setArmed(true); return; }
    if (!consultationId) {
      setPending((p) => p ? { ...p, auditError: "Sin consulta asociada; no se puede auditar el cambio por voz." } : p);
      setArmed(false);
      return;
    }
    try {
      await api.logReviewEvent({ consultation_id: consultationId, kind: pending.auditKind, payload: pending.auditPayload });
    } catch (e) {
      setPending((p) => p ? { ...p, auditError: "No se pudo registrar auditoría; cambio no aplicado." } : p);
      setArmed(false);
      return;
    }
    pending.apply();
    setLog((l) => [{ t: time(), text: `${labelKind(pending.kind)} · ${pending.field}` }, ...l].slice(0, 20));
    setResp({ status: "executed", utterance: pending.utterance, message: `Aplicado · ${pending.field}.` });
    setPending(null);
    setArmed(false);
  };

  const cancel = () => { setResp({ status: "info", utterance: pending?.utterance, message: "Cambio cancelado." }); setPending(null); setArmed(false); };

  return (
    <div style={{ marginTop: 18, padding: 14, border: "1px solid var(--sage)", borderRadius: 12, background: "var(--sage-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--sage)" }} />
        <Eyebrow>MEGI Voz · editar por voz (nota · dx · receta)</Eyebrow>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink-2)" }}>propuesta → confirmar · auditado</span>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink-2)", margin: "0 0 10px" }}>
        Escribe {expert ? "el comando" : "“MEGI, …”"} para editar la nota, cambiar diagnósticos o la receta.
        Nada se aplica sin tu confirmación; la receta se valida contra alergias.
      </p>
      {expert && (
        <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(200,60,60,.08)", border: "1px solid var(--danger)", fontSize: 11.5, color: "var(--danger)", marginBottom: 10 }}>
          ⚠ Modo experto (sin “MEGI”): las acciones clínicas piden <strong>confirmación reforzada</strong> (doble).
        </div>
      )}

      <form onSubmit={submit} style={{ display: "flex", gap: 6 }}>
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder='MEGI, cambiar diagnóstico principal a I10' style={{ flex: 1, fontSize: 12.5 }} disabled={busy} />
        <button type="submit" className="btn primary sm" disabled={!input.trim() || busy}>{busy ? "…" : "Proponer"}</button>
      </form>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="btn ghost sm" style={{ fontSize: 11 }} disabled={busy}
            onClick={() => send(ex)}>{ex.replace(/^MEGI, /, "")}</button>
        ))}
      </div>

      {pending && pending.kind === "dx_pick" && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--gold)" }}>
          <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 8 }}>
            Encontré varias opciones en CIE-10 para <strong>“{pending.utterance}”</strong> — elige una:
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {pending.options.map((o) => (
              <button key={o.code} type="button" className="btn ghost sm" style={{ justifyContent: "flex-start", fontSize: 12 }}
                onClick={() => proposeDx(pending.action, o, pending.utterance, pending.command, pending.intent)}>
                <span className="mono" style={{ color: "var(--forest)", marginRight: 6 }}>{o.code}</span> {o.label}
              </button>
            ))}
          </div>
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={cancel}>Cancelar</button>
        </div>
      )}

      {pending && pending.kind !== "dx_pick" && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--hair)" }}>
          <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 6 }}>Propuesta · <strong>{pending.field}</strong></div>
          <div style={{ fontSize: 12, textDecoration: "line-through", opacity: .7, whiteSpace: "pre-wrap" }}>{pending.current || "(vacío)"}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink)", whiteSpace: "pre-wrap", marginTop: 4 }}>→ {pending.proposed || "(vacío)"}</div>

          {pending.blockers?.length > 0 && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(200,60,60,.10)", border: "1px solid var(--danger)", fontSize: 12, color: "var(--danger)" }}>
              ⛔ {pending.blockers.map((x) => x.message || x.type).join(" · ")}<br />
              <span style={{ color: "var(--ink-2)" }}>Bloqueado por seguridad. Si procede clínicamente, agrégalo manualmente.</span>
              {pending.blockers.some((b) => b.type === "interaccion") && (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn ghost sm" style={{ fontSize: 11 }} disabled={alts?.loading}
                    onClick={() => askAlternatives(pending)}>
                    {alts?.loading ? "Buscando alternativas…" : "💊 Ver alternativas"}
                  </button>
                </div>
              )}
            </div>
          )}
          {alts && !alts.loading && !alts.error && (
            <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "var(--sage-soft)", border: "1px solid var(--sage)", fontSize: 12 }}>
              {alts.resumen && <div style={{ color: "var(--ink-2)", marginBottom: 6 }}>{alts.resumen}</div>}
              {(alts.sugerencias || []).map((s, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <span className="mono" style={{ fontSize: 9.5, color: "var(--sage-2)", textTransform: "uppercase" }}>{s.accion}</span>{" "}
                  <span>{s.detalle}</span>
                  {s.por_que && <span style={{ color: "var(--ink-2)" }}> — {s.por_que}</span>}
                </div>
              ))}
              <div style={{ fontSize: 10, color: "var(--ink-2)" }}>{alts.nota}</div>
            </div>
          )}
          {alts?.error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--danger)" }}>{alts.error}</div>}
          {pending.warnings?.length > 0 && (
            <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: "rgba(190,150,40,.10)", border: "1px solid var(--gold)", fontSize: 12, color: "var(--ink)" }}>
              ⚠ {pending.warnings.map((x) => x.message || x.type).join(" · ")}
            </div>
          )}
          {pending.safetyFailed && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(200,60,60,.10)", border: "1px solid var(--danger)", fontSize: 12, color: "var(--danger)" }}>
              No se pudo verificar la seguridad de la receta. Cambio bloqueado; reintenta antes de aplicar por voz.
            </div>
          )}
          {pending.auditError && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(200,60,60,.10)", border: "1px solid var(--danger)", fontSize: 12, color: "var(--danger)" }}>
              {pending.auditError}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button className="btn primary sm" onClick={confirm} disabled={pending.blocked}
              style={armed ? { background: "var(--danger)", borderColor: "var(--danger)" } : undefined}>
              {armed ? "¿Seguro? Confirmar de nuevo" : "Confirmar y aplicar"}
            </button>
            <button className="btn ghost sm" onClick={cancel}>Cancelar</button>
            {armed && <span style={{ fontSize: 11, color: "var(--danger)" }}>modo experto</span>}
          </div>
        </div>
      )}

      {resp && !pending && (
        <div style={{ marginTop: 10, fontSize: 12, color: resp.status === "executed" ? "var(--sage)" : resp.status === "rejected" ? "var(--danger)" : "var(--ink-2)" }}>
          {resp.utterance ? <span style={{ color: "var(--ink-2)" }}>“{resp.utterance}” — </span> : null}{resp.message}
        </div>
      )}

      {log.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--hair)" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink-2)", marginBottom: 4 }}>Cambios por voz aplicados (auditados)</div>
          {log.map((e, i) => (<div key={i} style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{e.t} · {e.text}</div>))}
        </div>
      )}
    </div>
  );
};

function labelKind(kind) {
  return { soap: "Nota SOAP", dx: "Diagnóstico", rx: "Receta" }[kind] || "Cambio";
}

export default ClinicalVoiceEditor;
