import React from "react";
import { api } from "../api/client";
import { classifyCommand } from "../lib/voice_mock";
import { routeCommand } from "../lib/voice_router";
import { shadowParse } from "../lib/voice_shadow";
import { useExpertMode, useHandsFreePref } from "../lib/voice_prefs";
import { permissionsForRole, VOICE_CONTEXT } from "../lib/voice_command_registry";
import {
  beginCommandCapture,
  cancelCommandCapture,
  disableHandsFree,
  enableHandsFree,
  encodeWav,
  endCommandCapture,
  getAudioSessionState,
  subscribeAudioSession,
} from "../lib/audio_session";
import { UtteranceSegmenter } from "../lib/wake_vad";

// ============ MEGI VOZ — BARRA DE COMANDOS GLOBAL (Fases 2 + 5 + 7) ============
// Lanzador flotante disponible en toda la app. Ejecuta de verdad los comandos de
// baja sensibilidad (navegar, abrir/buscar paciente); los sensibles se muestran
// como propuesta. Fase 5: "modo experto" opcional que desactiva la palabra "MEGI",
// con indicador visible permanente y métricas de comandos sin activación.
// Fase 7: el dictado NO abre su propio getUserMedia — usa la sesión única de
// audio, así el comando queda excluido del carril clínico si hay consulta.

const QUICK = ["MEGI, ir a pacientes", "MEGI, ir a agenda", "MEGI, ir a guías"];

// Manos libres GLOBAL (Fase 8.1): fuera de consulta solo navegación y pacientes
// — el mismo nivel de riesgo que esta barra ya ejecuta. Dentro de consulta el
// panel de la consulta toma el control (pausa/continuar/finalizar).
const HF_GLOBAL_ALLOWED = new Set([
  "set_view", "go_back", "open_active", "open_patient", "search_patient", "start_consult",
]);

const STATUS_COLOR = {
  executed: "var(--sage)", info: "var(--ink-2)", not_found: "var(--gold)",
  ambiguous: "var(--gold)", needs_confirmation: "var(--gold)", rejected: "var(--danger)",
};

const VoiceBar = ({ actions, patients, user }) => {
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [resp, setResp] = React.useState(null);
  const [expert, setExpert] = useExpertMode();
  const [metrics, setMetrics] = React.useState({ noWake: 0, unrecognized: 0 });
  const [asr, setAsr] = React.useState({ recording: false, busy: false });
  const [flash, setFlash] = React.useState(false);
  const [enrolling, setEnrolling] = React.useState(0);  // Fase 10: segundos restantes de lectura
  const [session, setSession] = React.useState(getAudioSessionState);
  const [hfPref, setHfPref] = useHandsFreePref(); // Fase 8.1: mic siempre activo
  const inputRef = React.useRef(null);
  const permissions = React.useMemo(() => permissionsForRole(user?.role), [user?.role]);

  React.useEffect(() => subscribeAudioSession(setSession), []);

  // Destello verde en el micrófono cuando un comando HABLADO se ejecutó bien:
  // cierra el ciclo activé → me escuchó (aura azul) → me entendió (flash verde).
  React.useEffect(() => {
    if (resp?.status !== "executed" || !["local_asr", "hands_free"].includes(resp.inputMode)) return undefined;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(t);
  }, [resp]);

  // Clase del aura: azul respirando al escuchar (dictado o enrolamiento),
  // flash verde al reconocer.
  const micAura = asr.recording || enrolling > 0 ? " mic-listening" : flash ? " mic-success" : "";

  React.useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const send = React.useCallback((text, meta = {}) => {
    const t = (text || "").trim();
    if (!t) return;
    // Push-to-command: pulsar Dictar YA es la activación deliberada, así que un
    // comando dictado no exige "MEGI" en el transcript (el ASR a veces se come
    // la primera palabra del audio). Los comandos escritos sí la exigen.
    const requireWake = meta.inputMode === "local_asr" ? false : !expert;
    const result = classifyCommand(t, {}, { requireWake });

    // Fase 9B (shadow): lo que el regex no entiende va al parser LLM SOLO para
    // registro/comparación — no ejecuta ni cambia lo que ve el usuario.
    if (!result.rejected && result.intent === "unknown") shadowParse(t, result, "global_bar");

    // Manos libres global: whitelist estricta (navegación y pacientes).
    if (meta.inputMode === "hands_free" && !HF_GLOBAL_ALLOWED.has(result.action)) {
      setResp({
        status: "info", utterance: t, inputMode: "hands_free",
        message: "En manos libres (fuera de consulta) solo navegación y pacientes. Para lo demás usa Dictar o escribe.",
      });
      return;
    }

    const routed = routeCommand(result, { actions, patients, context: VOICE_CONTEXT.GLOBAL, permissions });
    // Métricas de "falsos positivos" del modo experto: comandos aceptados sin
    // "MEGI" y comandos no reconocidos (posibles disparos accidentales).
    if (expert && routed.status !== "rejected") {
      setMetrics((m) => ({
        noWake: m.noWake + (result.wake_word_detected ? 0 : 1),
        unrecognized: m.unrecognized + (result.intent === "unknown" ? 1 : 0),
      }));
    }
    setResp({ ...routed, intent: result.intent, utterance: t, inputMode: meta.inputMode || "text" });
    setInput("");
    // Manos libres con el panel cerrado: si el comando necesita interacción
    // (desambiguar paciente), abrimos el panel para que el usuario elija.
    if (meta.inputMode === "hands_free" && routed.status === "ambiguous") setOpen(true);
  }, [actions, expert, patients, permissions]);

  // Ref al `send` más reciente para el segmentador (vive entre renders).
  const sendRef = React.useRef(send);
  sendRef.current = send;

  // ---- Fase 10: enrolamiento de la voz del médico (huella vocal) ----
  const [spk, setSpk] = React.useState(null);           // estado del perfil de voz
  const [pwStep, setPwStep] = React.useState(false);    // regrabar exige contraseña
  const [enrollPw, setEnrollPw] = React.useState("");
  const enrollPwRef = React.useRef("");
  const enrollTimerRef = React.useRef(null);
  const ENROLL_S = 25;

  React.useEffect(() => {
    if (open) api.speakerStatus().then(setSpk).catch(() => setSpk({ enrolled: false }));
  }, [open]);

  const finishEnroll = React.useCallback(async () => {
    clearInterval(enrollTimerRef.current);
    const cap = endCommandCapture();
    setEnrolling(0);
    if (!cap || cap.durationMs < 10000) {
      setResp({ status: "info", message: "El enrolamiento necesita al menos 10s de voz; intenta de nuevo.", utterance: "" });
      return;
    }
    setAsr((s) => ({ ...s, busy: true }));
    try {
      const file = new File([cap.blob], "enroll.wav", { type: "audio/wav" });
      const r = await api.enrollSpeaker({ file, password: enrollPwRef.current || undefined });
      setSpk({ enrolled: true, created_at: r.created_at });
      setResp({ status: "executed", message: "Voz registrada: los comandos manos libres ahora exigen tu voz.", utterance: "" });
    } catch (e) {
      setResp({ status: "info", message: e.message || "No se pudo registrar la voz.", utterance: "" });
    } finally {
      enrollPwRef.current = "";  // la contraseña nunca se retiene en memoria
      setAsr((s) => ({ ...s, busy: false }));
    }
  }, []);

  const startEnroll = async () => {
    if (session.consultationActive || asr.recording || asr.busy || enrolling) return;
    try {
      const ok = await beginCommandCapture();
      if (!ok) return;
    } catch (e) {
      setResp({ status: "info", message: "No se pudo acceder al micrófono para el enrolamiento.", utterance: "" });
      return;
    }
    let left = ENROLL_S;
    setEnrolling(left);
    enrollTimerRef.current = setInterval(() => {
      left -= 1;
      setEnrolling(left);
      if (left <= 0) finishEnroll();
    }, 1000);
  };

  const cancelEnroll = React.useCallback(() => {
    clearInterval(enrollTimerRef.current);
    cancelCommandCapture();
    setEnrolling(0);
  }, []);

  // Cerrar el panel a media lectura descarta el enrolamiento (mic nunca queda solo)
  // y limpia el paso de contraseña.
  React.useEffect(() => { if (!open && enrolling) cancelEnroll(); }, [open, enrolling, cancelEnroll]);
  React.useEffect(() => { if (!open) { setPwStep(false); setEnrollPw(""); } }, [open]);

  // ---- Manos libres GLOBAL (Fase 8.1): micrófono siempre activo ----
  // Fuera de consulta esta barra posee el tap; al grabar una consulta, el panel
  // de la consulta lo toma (este efecto se repliega) y al terminar lo re-arma.
  const probeBusyRef = React.useRef(false);
  React.useEffect(() => {
    if (!hfPref || session.consultationActive) return undefined;
    const seg = new UtteranceSegmenter({
      onUtterance: (samples) => {
        if (probeBusyRef.current) return;
        probeBusyRef.current = true;
        (async () => {
          try {
            const file = new File([encodeWav(samples)], "wake-probe.wav", { type: "audio/wav" });
            const r = await api.probeWakeCommand({ file, consultationId: actions.getActiveConsultationId?.() || null });
            if (r.wake_word_detected && r.command_text) {
              // Fase 10: con huella registrada, manos libres exige la voz del médico.
              if (r.speaker && r.speaker !== "medico" && r.speaker !== "sin_enrolar") {
                setResp({ status: "info", utterance: r.command_text, message: "Comando ignorado: la voz no coincide con el médico registrado.", inputMode: "hands_free" });
              } else {
                sendRef.current(r.command_text, { inputMode: "hands_free" });
              }
            }
          } catch (e) { /* sondeo fallido: silencioso */ }
          finally { probeBusyRef.current = false; }
        })();
      },
    });
    Promise.resolve(enableHandsFree(seg)).catch(() => {
      setResp({ status: "info", utterance: "", message: "No se pudo abrir el micrófono para manos libres; revisa el permiso del navegador." });
    });
    return () => disableHandsFree(seg);
  }, [hfPref, session.consultationActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => { e?.preventDefault(); send(input); };

  // Cancela el dictado SIN transcribir (descarta el audio). La sesión única
  // restaura el carril clínico o cierra la captura temporal según corresponda.
  const cancelDictation = React.useCallback(() => {
    cancelCommandCapture();
    setAsr({ recording: false, busy: false });
  }, []);

  // El micrófono nunca queda capturando comando sin indicador visible: al cerrar
  // el panel o desmontar la barra se descarta cualquier dictado en curso.
  React.useEffect(() => { if (!open) cancelDictation(); }, [open, cancelDictation]);
  React.useEffect(() => cancelDictation, [cancelDictation]);

  const startDictation = async () => {
    if (asr.busy || asr.recording) return;
    try {
      // Sesión única de audio: si hay consulta grabando, el carril clínico queda
      // excluido mientras se dicta el comando (el comando no entra a la nota).
      const ok = await beginCommandCapture();
      if (!ok) return;
      setAsr({ recording: true, busy: false });
      setResp({ status: "info", message: "Escuchando comando por ASR local… (excluido del audio clínico)", utterance: "" });
    } catch (e) {
      setAsr({ recording: false, busy: false });
      setResp({ status: "info", message: "No se pudo acceder al micrófono; escribe el comando.", utterance: "" });
    }
  };

  const stopDictation = async () => {
    const cap = endCommandCapture();
    if (!cap || cap.durationMs < 300) {
      setAsr({ recording: false, busy: false });
      setResp({ status: "info", message: "Comando demasiado corto; intenta de nuevo.", utterance: "" });
      return;
    }
    setAsr({ recording: false, busy: true });
    try {
      const file = new File([cap.blob], "voice-command.wav", { type: "audio/wav" });
      const r = await api.transcribeVoiceCommand({
        file,
        consultationId: actions.getActiveConsultationId?.() || null,
      });
      const transcript = (r.transcript || "").trim();
      if (!transcript) {
        setResp({ status: "info", message: "El ASR local no devolvió texto para el comando.", utterance: "" });
      } else {
        send(transcript, { inputMode: "local_asr" });
      }
    } catch (e) {
      setResp({ status: "info", message: e.message || "No se pudo transcribir el comando hablado.", utterance: "" });
    } finally {
      setAsr({ recording: false, busy: false });
    }
  };

  const pickCandidate = (p) => {
    const act = resp?.pickAction || "openExpediente";
    actions[act]?.(p);
    const verb = act === "startConsulta" ? "Iniciando consulta de" : "Abriendo el expediente de";
    setResp({ status: "executed", message: `${verb} ${p.name}.`, utterance: resp?.utterance });
  };

  return (
    <>
      {/* Lanzador flotante — indicador permanente cuando el modo experto está
          activo; aura azul mientras se dicta (visible aunque el panel esté tapado). */}
      <button
        className={"no-print" + micAura}
        onClick={() => setOpen((v) => !v)}
        title={asr.recording ? "MEGI te está escuchando…" : expert ? "MEGI Voz — MODO EXPERTO (sin “MEGI”)" : "MEGI Voz — comandos"}
        aria-label="MEGI Voz — comandos"
        style={{
          position: "fixed", right: 16, bottom: 64, zIndex: 41,
          width: 40, height: 40, borderRadius: "50%",
          border: `1px solid ${expert ? "var(--danger)" : "var(--hair)"}`,
          background: open ? "var(--sage)" : "var(--surface)",
          color: open ? "#fff" : "var(--ink-2)", cursor: "pointer", fontSize: 17,
          boxShadow: expert ? "0 0 0 3px rgba(200,60,60,.22)" : "0 2px 10px rgba(0,0,0,0.08)",
        }}
      >🎙{expert && <span style={{ position: "absolute", top: -2, right: -2, width: 10, height: 10, borderRadius: "50%", background: "var(--danger)", border: "1.5px solid var(--surface)" }} />}
        {/* Punto azul respirando: manos libres armado (mic abierto escuchando "MEGI"). */}
        {session.handsFree && <span className="hf-dot" style={{ position: "absolute", top: -2, left: -2, margin: 0, border: "1.5px solid var(--surface)", width: 10, height: 10 }} />}
      </button>

      {open && (
        <div className="framed no-print" style={{
          position: "fixed", right: 16, bottom: 112, zIndex: 41, width: 360, maxWidth: "calc(100vw - 32px)",
          padding: 16, background: "var(--surface)", boxShadow: "0 8px 30px rgba(0,0,0,0.14)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: expert ? "var(--danger)" : "var(--sage)" }} />
            <strong style={{ fontSize: 14 }}>MEGI Voz</strong>
            <span style={{ fontSize: 11, color: "var(--ink-2)", marginLeft: "auto" }}>{expert ? "modo experto" : "comandos"}</span>
          </div>

          {/* Interruptor del micrófono siempre activo (Fase 8.1) — "donde está el mic". */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, margin: "6px 0 10px", padding: "8px 10px",
            borderRadius: 8, border: `1px solid ${hfPref ? "var(--listen)" : "var(--hair)"}`,
            background: hfPref ? "rgba(58,125,255,.07)" : "var(--cream-2)",
          }}>
            {hfPref && <span className="hf-dot" />}
            <span style={{ fontSize: 11.5, flex: 1, color: hfPref ? "var(--ink)" : "var(--ink-2)" }}>
              {hfPref
                ? (session.handsFree ? "Micrófono siempre activo — di “MEGI, …” en cualquier momento." : "Micrófono siempre activo (armando…)")
                : "Micrófono en reposo: solo Dictar o comandos escritos."}
            </span>
            <button type="button" className="btn ghost sm" style={{ fontSize: 10.5 }} onClick={() => setHfPref(!hfPref)}>
              {hfPref ? "APAGAR" : "ENCENDER"}
            </button>
          </div>

          {/* Fase 10: huella vocal del médico — manos libres exige tu voz. */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px", padding: "8px 10px",
            borderRadius: 8, border: "1px solid var(--hair)", background: "var(--surface)",
          }}>
            {enrolling > 0 ? (
              <>
                <span className="hf-dot" />
                <span style={{ fontSize: 11.5, flex: 1, lineHeight: 1.45 }}>
                  Lee en voz alta (<strong>{enrolling}s</strong>): “Soy quien atiende esta consulta.
                  MEGI, ir a pacientes. MEGI, pausar escucha. MEGI, continuar escucha.
                  MEGI, finaliza la consulta. La nota se revisa antes de firmarse.”
                </span>
                <button type="button" className="btn ghost sm" style={{ fontSize: 10.5 }} onClick={cancelEnroll}>CANCELAR</button>
              </>
            ) : pwStep ? (
              <>
                {/* Regrabar = reemplazar el biométrico: re-autenticación obligatoria. */}
                <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>Contraseña para regrabar:</span>
                <input className="input" type="password" value={enrollPw} autoFocus
                  onChange={(e) => setEnrollPw(e.target.value)} style={{ flex: 1, fontSize: 12, padding: "4px 8px" }}
                  onKeyDown={(e) => { if (e.key === "Enter" && enrollPw) { enrollPwRef.current = enrollPw; setEnrollPw(""); setPwStep(false); startEnroll(); } }} />
                <button type="button" className="btn primary sm" style={{ fontSize: 10.5 }} disabled={!enrollPw}
                  onClick={() => { enrollPwRef.current = enrollPw; setEnrollPw(""); setPwStep(false); startEnroll(); }}>
                  CONTINUAR
                </button>
                <button type="button" className="btn ghost sm" style={{ fontSize: 10.5 }}
                  onClick={() => { setEnrollPw(""); setPwStep(false); }}>✕</button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 11.5, flex: 1, color: "var(--ink-2)" }}>
                  {spk?.enrolled
                    ? "🔒 Voz del médico registrada: manos libres solo obedece tu voz."
                    : "Voz sin registrar: cualquier voz puede usar manos libres."}
                </span>
                <button type="button" className="btn ghost sm" style={{ fontSize: 10.5 }}
                  onClick={() => (spk?.enrolled ? setPwStep(true) : startEnroll())}
                  disabled={session.consultationActive || asr.recording || asr.busy}
                  title={session.consultationActive
                    ? "Disponible fuera de una consulta grabando"
                    : spk?.enrolled ? "Regrabar exige tu contraseña" : "Graba ~25s leyendo el texto guiado"}>
                  {spk?.enrolled ? "REGRABAR" : "REGISTRAR MI VOZ"}
                </button>
              </>
            )}
          </div>

          {expert ? (
            <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(200,60,60,.08)", border: "1px solid var(--danger)", marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600 }}>⚠ Modo experto activo — sin palabra “MEGI”.</div>
              <div style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 2 }}>
                Los comandos se aceptan sin activación; las acciones clínicas piden confirmación reforzada.
                Sin “MEGI”: {metrics.noWake} · no reconocidos: {metrics.unrecognized}.
              </div>
              <button type="button" className="btn primary sm" style={{ marginTop: 8 }} onClick={() => setExpert(false)}>
                Volver a modo seguro
              </button>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "var(--ink-2)", margin: "0 0 10px" }}>
              Escribe un comando iniciando con <strong>“MEGI”</strong>. Navegación y pacientes se ejecutan;
              lo clínico sensible se propone (aún no se aplica).
            </p>
          )}

          <form onSubmit={submit} style={{ display: "flex", gap: 6 }}>
            <input ref={inputRef} className="input" value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={expert ? "ir a pacientes…" : "MEGI, abrir paciente…"} style={{ flex: 1 }} />
            <button type="button" className={"btn ghost" + micAura} onClick={asr.recording ? stopDictation : startDictation}
              disabled={asr.busy} title={asr.recording ? "MEGI te está escuchando… pulsa para terminar" : "Dictar comando con ASR local"}>
              {asr.recording ? "Detener" : asr.busy ? "ASR…" : "Dictar"}
            </button>
            <button type="submit" className="btn primary" disabled={!input.trim()}>Ir</button>
          </form>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {QUICK.map((q) => (
              <button key={q} type="button" className="btn ghost sm" style={{ fontSize: 11 }}
                onClick={() => send(expert ? q.replace(/^MEGI, /, "") : q)}>{q.replace(/^MEGI, /, "")}</button>
            ))}
          </div>

          {!expert && (
            <button type="button" className="btn ghost sm" style={{ fontSize: 11, marginTop: 10 }}
              onClick={() => setExpert(true)} title="Preferencia avanzada">
              Activar modo experto (sin “MEGI”)
            </button>
          )}

          {resp && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--hair)" }}>
              <div style={{ fontSize: 11, color: "var(--ink-2)", marginBottom: 4 }}>“{resp.utterance}”</div>
              <div style={{ fontSize: 13, color: STATUS_COLOR[resp.status] || "var(--ink)" }}>{resp.message}</div>
              {resp.inputMode === "local_asr" && (
                <div style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 3 }}>entrada: ASR local</div>
              )}

              {resp.status === "ambiguous" && resp.candidates && (
                <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  {resp.candidates.slice(0, 6).map((p) => (
                    <button key={p.id} type="button" className="btn ghost sm" style={{ justifyContent: "flex-start" }}
                      onClick={() => pickCandidate(p)}>
                      {p.name}{p.age ? ` · ${p.age}a` : ""}{p.reason ? ` · ${p.reason}` : ""}
                    </button>
                  ))}
                </div>
              )}

              {resp.status === "needs_confirmation" && resp.proposal && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <div style={{ color: "var(--ink-2)" }}>Propuesta ({resp.proposal.field}):</div>
                  <div style={{ textDecoration: "line-through", opacity: .7 }}>{resp.proposal.current_value}</div>
                  <div style={{ color: "var(--ink)" }}>→ {resp.proposal.proposed_value}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default VoiceBar;
