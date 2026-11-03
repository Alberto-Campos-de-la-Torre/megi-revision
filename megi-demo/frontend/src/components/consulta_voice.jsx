import React from "react";
import { api } from "../api/client";
import { classifyCommand } from "../lib/voice_mock";
import { shadowParse } from "../lib/voice_shadow";
import { useExpertMode, useHandsFreePref } from "../lib/voice_prefs";
import {
  evaluateCommandPolicy,
  permissionsForRole,
  VOICE_CONTEXT,
  VOICE_RISK,
} from "../lib/voice_command_registry";
import {
  beginCommandCapture,
  cancelCommandCapture,
  disableHandsFree,
  enableHandsFree,
  encodeWav,
  endCommandCapture,
} from "../lib/audio_session";
import { UtteranceSegmenter } from "../lib/wake_vad";

// ============ MEGI VOZ — COMANDOS DENTRO DE LA CONSULTA (Fases 7-8) ============
// Controla la grabación clínica por voz: pausar/continuar directo (no destruye
// nada) y "finalizar la consulta" con propuesta → confirmación + auditoría
// persistente (fail-closed: sin auditoría no se aplica). El dictado usa la
// SESIÓN ÚNICA de audio: mientras se captura el comando, el carril clínico
// queda excluido y el comando jamás entra a la nota SOAP.
//
// Fase 8 — MANOS LIBRES (opt-in, solo esta pantalla): un segmentador VAD local
// separa enunciados cortos del stream; solo esos se sondean contra el ASR local
// y el backend verifica la palabra "MEGI" (sin ella, el audio se descarta y el
// texto nunca llega aquí). Ejecuta SOLO pausar/continuar; "finalizar" muestra
// la confirmación en pantalla. Indicador visible permanente mientras está activo.

const EXAMPLES = ["MEGI, pausar escucha", "MEGI, continuar escucha", "MEGI, finaliza la consulta"];

// Manos libres solo ejecuta control de grabación; nada clínico ni navegación.
const HANDS_FREE_ALLOWED = new Set(["pause_recording", "resume_recording", "stop_recording"]);

const ConsultaVoice = ({ user, recording, paused, getConsultationId, onStart, onPause, onResume, onStopAndReview }) => {
  const [input, setInput] = React.useState("");
  const [resp, setResp] = React.useState(null);
  const [pending, setPending] = React.useState(null); // propuesta de finalizar
  const [busy, setBusy] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);
  const [flash, setFlash] = React.useState(false);
  const [handsFree, setHandsFree] = useHandsFreePref(); // preferencia GLOBAL persistente (Fase 8.1)
  const [expert] = useExpertMode();
  const permissions = React.useMemo(() => permissionsForRole(user?.role), [user?.role]);

  React.useEffect(() => () => cancelCommandCapture(), []); // desmontar = descartar dictado

  // Destello verde en el micrófono cuando un comando HABLADO se ejecutó bien.
  React.useEffect(() => {
    if (resp?.status !== "executed" || !["local_asr", "hands_free"].includes(resp.inputMode)) return undefined;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(t);
  }, [resp]);

  const micAura = capturing ? " mic-listening" : flash ? " mic-success" : "";

  const audit = async (intent, before, after, command) => {
    const cid = getConsultationId?.();
    if (!cid) throw new Error("Sin consulta asociada; no se puede auditar el comando.");
    await api.logReviewEvent({
      consultation_id: cid,
      kind: "voice_recording",
      payload: { intent, before, after, command },
    });
  };

  const send = async (text, meta = {}) => {
    const t = (text || "").trim();
    if (!t || busy) return;
    setInput("");
    // Pulsar Dictar YA es la activación: los comandos dictados no exigen "MEGI"
    // en el transcript (el ASR a veces recorta la primera palabra del audio).
    const requireWake = meta.inputMode === "local_asr" ? false : !expert;
    const result = classifyCommand(t, {}, { requireWake });
    if (result.rejected) { setPending(null); setResp({ status: "rejected", utterance: t, message: result.message }); return; }

    // Fase 9B (shadow): comandos no entendidos van al parser LLM solo para registro.
    if (result.intent === "unknown") shadowParse(t, result, "consulta");

    // Manos libres: whitelist estricta — solo control de grabación.
    if (meta.inputMode === "hands_free" && !HANDS_FREE_ALLOWED.has(result.action)) {
      setResp({ status: "info", utterance: t, message: "En manos libres solo controlo pausar/continuar/finalizar. Para lo demás usa Dictar o escribe el comando." });
      return;
    }

    const policy = evaluateCommandPolicy(result, {
      context: VOICE_CONTEXT.CONSULTATION,
      permissions,
      enforceContext: true,
    });
    if (!policy.allowed) {
      const isLowRiskElsewhere = policy.reason === "context" && policy.command?.risk === VOICE_RISK.LOW;
      setPending(null);
      setResp(isLowRiskElsewhere
        ? { status: "info", utterance: t, message: "Aquí controlo la grabación. Para navegar o abrir pacientes usa la barra 🎙 (abajo a la derecha)." }
        : { status: "rejected", utterance: t, message: policy.message });
      return;
    }

    const a = result.action;
    const inputMode = meta.inputMode || "text";

    if (a === "start_recording") {
      if (recording) { setResp({ status: "info", utterance: t, message: "La consulta ya está grabando." }); return; }
      setBusy(true);
      try { await onStart(); setResp({ status: "executed", utterance: t, message: "Escucha de la consulta iniciada.", inputMode }); }
      catch (e) { setResp({ status: "rejected", utterance: t, message: e.message }); }
      finally { setBusy(false); }
      return;
    }

    if (a === "pause_recording" || a === "resume_recording") {
      const wantsPause = a === "pause_recording";
      if (!recording) { setResp({ status: "info", utterance: t, message: "No hay una grabación en curso." }); return; }
      if (wantsPause === !!paused) {
        setResp({ status: "info", utterance: t, message: wantsPause ? "La escucha ya está en pausa." : "La escucha ya está activa." });
        return;
      }
      setBusy(true);
      try {
        await audit(result.intent, wantsPause ? "grabando" : "pausada", wantsPause ? "pausada" : "grabando", t);
        (wantsPause ? onPause : onResume)();
        setResp({ status: "executed", utterance: t, message: wantsPause ? "Escucha en pausa (el audio no se está capturando)." : "Escucha reanudada.", inputMode });
      } catch (e) {
        setResp({ status: "rejected", utterance: t, message: e.message });
      } finally { setBusy(false); }
      return;
    }

    if (a === "stop_recording") {
      if (!recording) { setResp({ status: "info", utterance: t, message: "No hay una grabación en curso que finalizar." }); return; }
      setPending({ utterance: t, intent: result.intent, inputMode });
      setResp(null);
      return;
    }

    setPending(null);
    setResp({ status: "info", utterance: t, message: "Aquí controlo la grabación (pausar, continuar, finalizar). Lo clínico se edita en Revisión." });
  };

  const confirmStop = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await audit(pending.intent, "en curso", "detenida (pasar a revisión)", pending.utterance);
    } catch (e) {
      setPending((p) => (p ? { ...p, auditError: e.message + " Cambio no aplicado." } : p));
      setBusy(false);
      return;
    }
    setPending(null);
    setResp({ status: "executed", utterance: pending.utterance, message: "Finalizando la consulta y pasando a revisión…", inputMode: pending.inputMode });
    try { await onStopAndReview(); } catch (e) { setResp({ status: "rejected", utterance: pending.utterance, message: e.message }); }
    setBusy(false);
  };

  const cancelStop = () => { setResp({ status: "info", utterance: pending?.utterance, message: "Finalización cancelada; la consulta sigue." }); setPending(null); };

  // ---- Manos libres (Fase 8) ----
  // Ref al `send` más reciente: el segmentador vive entre renders y no debe
  // capturar closures viejos de recording/paused/busy.
  const sendRef = React.useRef(send);
  sendRef.current = send;
  const probeBusyRef = React.useRef(false);

  React.useEffect(() => {
    if (!handsFree || !recording) return undefined;
    const seg = new UtteranceSegmenter({
      onUtterance: (samples) => {
        if (probeBusyRef.current) return; // un sondeo a la vez; los demás se descartan
        probeBusyRef.current = true;
        (async () => {
          try {
            const file = new File([encodeWav(samples)], "wake-probe.wav", { type: "audio/wav" });
            const r = await api.probeWakeCommand({ file, consultationId: getConsultationId?.() || null });
            if (r.wake_word_detected && r.command_text) {
              // Fase 10: con huella registrada, manos libres exige la voz del
              // médico (sin_enrolar conserva el comportamiento previo).
              if (r.speaker && r.speaker !== "medico" && r.speaker !== "sin_enrolar") {
                setResp({ status: "info", utterance: r.command_text, message: "Comando ignorado: la voz no coincide con el médico registrado." });
              } else {
                await sendRef.current(r.command_text, { inputMode: "hands_free" });
              }
            }
          } catch (e) { /* sondeo fallido: silencioso, no interrumpe la consulta */ }
          finally { probeBusyRef.current = false; }
        })();
      },
    });
    Promise.resolve(enableHandsFree(seg)).catch(() => { /* mic denegado: sin manos libres */ });
    // Solo apaga SU segmentador (el controlador global de la barra tiene el suyo).
    return () => disableHandsFree(seg);
  }, [handsFree, recording]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push-to-command con la sesión única: excluye el carril clínico al capturar.
  const startDictation = async () => {
    if (capturing || busy) return;
    try {
      const ok = await beginCommandCapture();
      if (!ok) return;
      setCapturing(true);
      setResp({ status: "info", utterance: "", message: "Escuchando comando… la nota clínica NO captura este audio." });
    } catch (e) {
      setResp({ status: "info", utterance: "", message: "Micrófono no disponible; escribe el comando." });
    }
  };

  const stopDictation = async () => {
    const cap = endCommandCapture();
    setCapturing(false);
    if (!cap || cap.durationMs < 300) { setResp({ status: "info", utterance: "", message: "Comando demasiado corto; intenta de nuevo." }); return; }
    setBusy(true);
    try {
      const file = new File([cap.blob], "voice-command.wav", { type: "audio/wav" });
      const r = await api.transcribeVoiceCommand({ file, consultationId: getConsultationId?.() || null });
      const transcript = (r.transcript || "").trim();
      if (!transcript) setResp({ status: "info", utterance: "", message: "El ASR local no devolvió texto para el comando." });
      else { setBusy(false); await send(transcript, { inputMode: "local_asr" }); return; }
    } catch (e) {
      setResp({ status: "info", utterance: "", message: e.message || "No se pudo transcribir el comando." });
    }
    setBusy(false);
  };

  const color = { executed: "var(--sage)", rejected: "var(--danger)" };

  return (
    <div className="no-print" style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--hair)", borderRadius: 10, background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: capturing ? "var(--danger)" : "var(--sage)" }} />
        <span className="eyebrow">MEGI Voz · control de la consulta</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: 10.5 }}>
          {capturing && <span style={{ color: "var(--danger)" }}>comando en captura · nota en pausa</span>}
          {!capturing && paused && recording && <span style={{ color: "var(--gold)" }}>escucha clínica en pausa</span>}
          {/* Indicador PERMANENTE del modo manos libres (requisito de la fase). */}
          {handsFree && recording && !capturing && (
            <span style={{ color: "var(--listen)", fontWeight: 600 }} title='Manos libres activo: di "MEGI, pausar escucha", "MEGI, continuar escucha" o "MEGI, finaliza la consulta"'>
              <span className="hf-dot" />manos libres — di “MEGI, …”
            </span>
          )}
        </span>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} style={{ display: "flex", gap: 6 }}>
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={expert ? "finaliza la consulta…" : "MEGI, finaliza la consulta…"} style={{ flex: 1, fontSize: 12.5 }} disabled={busy} />
        <button type="button" className={"btn ghost sm" + micAura} onClick={capturing ? stopDictation : startDictation} disabled={busy}
          title={capturing ? "MEGI te está escuchando… pulsa para terminar" : "Dictar comando (excluye el audio clínico mientras hablas)"}>
          {capturing ? "■ Detener" : "🎙 Dictar"}
        </button>
        <button type="submit" className="btn primary sm" disabled={!input.trim() || busy}>{busy ? "…" : "Ir"}</button>
      </form>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" }}>
        {EXAMPLES.map((q) => (
          <button key={q} type="button" className="btn ghost sm" style={{ fontSize: 11 }} disabled={busy}
            onClick={() => send(expert ? q.replace(/^MEGI, /, "") : q)}>{q.replace(/^MEGI, /, "")}</button>
        ))}
        <button type="button" className="btn ghost sm" style={{ fontSize: 11, marginLeft: "auto", color: handsFree ? "var(--listen)" : undefined }}
          onClick={() => setHandsFree(!handsFree)}
          title={handsFree
            ? "Apagar manos libres"
            : "Manos libres: MEGI escucha continuamente EN ESTA PANTALLA y solo reacciona a “MEGI, pausar/continuar/finalizar”. Finalizar siempre pide confirmación en pantalla."}>
          {handsFree ? "👂 Manos libres: ON" : "👂 Manos libres"}
        </button>
      </div>
      {handsFree && !recording && (
        <div style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 6 }}>
          Manos libres global activo (navegación por voz); al iniciar la grabación este panel
          toma el control con pausar/continuar/finalizar.
        </div>
      )}

      {pending && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, border: "1px solid var(--gold)", background: "var(--surface)" }}>
          <div style={{ fontSize: 12, color: "var(--ink-2)" }}>Propuesta · <strong>consulta</strong></div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>en curso → <strong>detenida (pasar a revisión)</strong></div>
          {pending.auditError && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--danger)" }}>{pending.auditError}</div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn primary sm" onClick={confirmStop} disabled={busy}>Confirmar y finalizar</button>
            <button className="btn ghost sm" onClick={cancelStop} disabled={busy}>Cancelar</button>
          </div>
        </div>
      )}

      {resp && !pending && (
        <div style={{ marginTop: 8, fontSize: 12, color: color[resp.status] || "var(--ink-2)" }}>
          {resp.utterance ? <span style={{ color: "var(--ink-2)" }}>“{resp.utterance}” — </span> : null}{resp.message}
          {resp.inputMode === "local_asr" && <span style={{ fontSize: 10.5, color: "var(--ink-2)" }}> · entrada: ASR local</span>}
        </div>
      )}
    </div>
  );
};

export default ConsultaVoice;
