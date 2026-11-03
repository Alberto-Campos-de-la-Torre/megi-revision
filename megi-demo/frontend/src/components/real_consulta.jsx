// ============ CONSULTA CON GRABACIÓN REAL (v0.0.1) ============
// Activa en modos local_mock / real. Reemplaza el timeline simulado por eventos
// reales: graba con MediaRecorder, sube al backend (que convierte a wav16k y llama
// al ASR service), y muestra transcript / resultado de identificador reales.
import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api, asrStreamUrl } from "../api/client";
import LiveSoap from "./live_soap";
import PreconsultaPanel from "./preconsulta_panel";
import EstudiosStrip, { PrediagnosticoMegi } from "./estudios_strip";
import TechTranscript from "./tech_transcript";
import { setLeaveGuard, confirmLeave } from "../lib/leave_guard";
import useRecorder from "../lib/use_recorder";

// Grabación manual, streaming y shadow: herramientas de diagnóstico que ya no
// se muestran (el panel técnico ahora enseña la transcripción y los eventos de
// la consulta en vivo). Se conservan detrás de esta bandera por si hay que
// volver a comparar batch vs streaming.
const SHOW_LEGACY_TECH = false;

const AVISO_SALIR_GRABANDO =
  "Hay una grabación en curso.\n\nSi sales ahora se pierde el audio que todavía " +
  "no se haya enviado. ¿Salir de la consulta?";

const RealConsulta = ({ patient, motivo, consultationId, ensureConsultation, onBack, onFinish, user, voiceEnabled }) => {
  const [events, setEvents] = React.useState([]);
  const [transcript, setTranscript] = React.useState("");
  // Preguntas sobre el motivo propuestas por el modelo en «Antes de empezar»:
  // se guardan aquí para que el seguimiento en vivo también las vigile.
  const [preguntasMotivo, setPreguntasMotivo] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [tech, setTech] = React.useState({ transcript: "", turns: [], events: [] });   // de LiveSoap
  // Estado de la consulta en vivo: «Finalizar y revisar» solo se habilita cuando la
  // nota final ya existe. Antes se podía pulsar a media grabación (o cuando el LLM
  // había fallado) y la revisión se abría vacía.
  const [estado, setEstado] = React.useState({ recording: false, finalizing: false, hasFinal: false, finalStatus: null, notaLista: false });
  // `notaLista` la decide LiveSoap (notaGenerada): "done" o cualquier veredicto
  // clínico de la validación; comparar aquí con "done" a secas dejaba el botón
  // bloqueado con la nota ya generada.
  const notaLista = !!estado.notaLista;
  const pista = estado.finalizing ? "Generando la nota final…"
    : estado.recording ? "Detén la grabación para generar la nota final"
    : estado.hasFinal && !notaLista ? "La nota final falló: reintenta desde la nota"
    : !estado.hasFinal ? "Graba y detén la consulta para generar la nota final" : "";

  // La barra clínica es sticky, pero la barra superior de la app también lo es
  // (top: 0): quedaba debajo de ella al bajar. Se ancla justo bajo la topbar,
  // midiendo su alto real (cambia con la densidad y el ancho de pantalla).
  const [topH, setTopH] = React.useState(0);
  React.useEffect(() => {
    const el = document.querySelector(".topbar");
    if (!el) return undefined;
    const upd = () => setTopH(Math.round(el.getBoundingClientRect().height));
    upd();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(upd) : null;
    ro?.observe(el);
    window.addEventListener("resize", upd);
    return () => { ro?.disconnect(); window.removeEventListener("resize", upd); };
  }, []);
  const t0 = React.useRef(null);

  const gen = useRecorder();

  // identificador

  const addEvent = (label) => {
    if (t0.current == null) t0.current = Date.now();
    const ms = Date.now() - t0.current;
    const ts = `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
    setEvents((prev) => [...prev, { ts, label }]);
  };

  const startGen = async () => {
    try { await gen.start(); addEvent("mic_permission_granted"); addEvent("recording_started"); }
    catch (e) { addEvent("error: micrófono denegado"); }
  };
  const stopGen = () => { gen.stop(); addEvent("recording_stopped"); };

  const sendGen = async () => {
    if (!gen.blob) return;
    setBusy(true);
    addEvent("upload_started");
    try {
      const cid = await ensureConsultation();
      const file = new File([gen.blob], "consulta.webm", { type: gen.blob.type });
      addEvent("asr_processing");
      const r = await api.uploadAudio({ file, consultationId: cid, audioKind: "general_consultation" });
      addEvent(`upload_done (${r.duration_ms} ms audio)`);
      addEvent(`asr_done (${r.transcription_status})`);
      setTranscript(r.transcript || "");
    } catch (e) {
      addEvent("error: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  // --- streaming en vivo (WS + AudioWorklet) ---
  const [streaming, setStreaming] = React.useState(false);
  const [liveText, setLiveText] = React.useState("");
  const [shadow, setShadow] = React.useState(null);
  const [streamErr, setStreamErr] = React.useState(null);
  const wsRef = React.useRef(null);
  const ctxRef = React.useRef(null);
  const micRef = React.useRef(null);

  const stopMedia = () => {
    try { micRef.current?.getTracks().forEach((t) => t.stop()); } catch (e) { /* noop */ }
    try { ctxRef.current?.close(); } catch (e) { /* noop */ }
    micRef.current = null; ctxRef.current = null;
  };

  const startStream = async () => {
    setStreamErr(null); setShadow(null); setLiveText("");
    addEvent("stream_connecting");
    try {
      const ws = new WebSocket(await asrStreamUrl(consultationId));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === "partial") setLiveText(m.text);
        else if (m.type === "final") {
          setShadow(m); addEvent(`stream_final (sim ${m.content_similarity})`);
          setStreaming(false); stopMedia();
        } else if (m.type === "error") { setStreamErr(m.detail); addEvent("error: " + m.detail); }
      };
      ws.onerror = () => setStreamErr("WS error (¿backend en :8000 y ASR en :8010?)");
      ws.onopen = async () => {
        try {
          const ctx = new AudioContext();
          ctxRef.current = ctx;
          await ctx.audioWorklet.addModule("/megi-worklet.js");
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micRef.current = stream;
          const src = ctx.createMediaStreamSource(stream);
          const node = new AudioWorkletNode(ctx, "megi-streamer");
          node.port.onmessage = (e) => { if (ws.readyState === 1) ws.send(e.data); };
          src.connect(node);  // sin conectar a destination (evita eco)
          setStreaming(true);
          addEvent("recording_started (streaming)");
        } catch (e) {
          setStreamErr("micrófono: " + e.message); addEvent("error: micrófono");
          try { ws.close(); } catch (_) { /* noop */ }
        }
      };
    } catch (e) {
      setStreamErr(e.message);
    }
  };

  const stopStream = () => {
    addEvent("recording_stopped (streaming) · procesando shadow…");
    stopMedia();  // deja de capturar; el WS sigue para recibir el 'final'
    try { wsRef.current?.send(JSON.stringify({ cmd: "stop" })); } catch (e) { /* noop */ }
  };

  // Solo UX: refleja/controla los grabadores que esta pantalla posee (no la lógica interna).
  const anyRecording = gen.recording || streaming;
  const stopAll = () => { gen.stop(); if (streaming) stopStream(); };

  // Salir con el micrófono abierto tira el audio. Se avisa en los DOS caminos
  // de salida —el botón "← Agenda" y la flecha del navegador— desde una sola
  // guardia, para que no puedan divergir.
  //
  // Mira TAMBIÉN `estado.recording`: la grabación de la consulta vive ahora
  // dentro de LiveSoap, así que vigilar solo los grabadores de esta pantalla
  // dejaría sin aviso justo el caso que importa.
  const grabando = anyRecording || estado.recording;
  React.useEffect(() => {
    if (!grabando) return undefined;
    return setLeaveGuard(() => AVISO_SALIR_GRABANDO);
  }, [grabando]);
  const allergies = patient.allergies?.length ? patient.allergies.join(" · ") : "Ninguna conocida";
  const chronic = patient.chronic?.length ? patient.chronic.join(" · ") : "—";

  return (
    <div className="page" style={{ paddingTop: 12 }}>
      {/* BARRA CLÍNICA FIJA — siempre visible durante la consulta */}
      <div className="clinical-bar no-print" style={{ top: topH }}>
        <div className="row center g-14" style={{ minWidth: 0 }}>
          <button className="btn ghost sm" onClick={() => { if (confirmLeave()) onBack(); }} aria-label="Volver a la agenda">← Agenda</button>
          <div style={{ minWidth: 0 }}>
            <div className="cb-name">{patient.name}</div>
            <div className="cb-meta">
              {patient.age} años · {patient.sex === "F" ? "Femenino" : "Masculino"} ·{" "}
              {/* El motivo de HOY, no el del alta: es lo que el médico acaba de
                  escribir y lo que describe esta consulta. */}
              <strong>{motivo || patient.reason}</strong>
            </div>
          </div>
        </div>

        <div className="cb-flags">
          <span className="cb-flag">
            <span className="cb-flag-label">Alergias</span>
            <span style={{ color: patient.allergies?.length ? "var(--danger)" : "var(--ink-2)", fontWeight: patient.allergies?.length ? 600 : 400 }}>{allergies}</span>
          </span>
          <span className="cb-flag">
            <span className="cb-flag-label">Crónicos</span>
            <span>{chronic}</span>
          </span>
        </div>

        <div className="row center g-10" style={{ flexShrink: 0 }}>
          <span className="cb-rec" aria-live="polite">
            <span className={"rec-dot" + (anyRecording ? " on" : "")} aria-hidden="true" />
            {anyRecording ? "Grabando" : "En espera"}
          </span>
          {anyRecording && (
            <button className="btn danger sm" onClick={stopAll} aria-label="Detener grabación">■ Detener</button>
          )}
          <div className="col" style={{ alignItems: "flex-end", gap: 2 }}>
            <button className="btn primary" onClick={onFinish} disabled={!notaLista}
              title={notaLista ? "Pasar a revisión de la nota" : pista}
              aria-label="Finalizar y revisar">Finalizar y revisar →</button>
            {!notaLista && <span style={{ fontSize: 10, color: "var(--ink-2)", whiteSpace: "nowrap" }}>{pista}</span>}
          </div>
        </div>
      </div>

      {/* FLUJO PRINCIPAL (clínico) */}
      <section className="consulta-main">
        {/* Preámbulo: el motivo de hoy + qué preguntar por edad e historial.
            A la vista y no dentro de un desplegable: es lo que hay que leer
            ANTES de dar al micrófono, y plegado no lo leía nadie. */}
        {/* Orden (11-oct): Estudios del Paciente (una línea) -> Pre-diagnóstico MEGI ->
            Antes de empezar -> SOAP. El detalle de cada lectura no se repite en la
            tira: va en el pre-diagnóstico. */}
        {patient?.id && (
          <div className="no-print" style={{ marginBottom: 12 }}>
            <EstudiosStrip consultationId={consultationId} patientId={patient.id} patient={patient} siempre lineaUnica conPrediagnostico={false} />
          </div>
        )}
        <div className="no-print"><PrediagnosticoMegi consultationId={consultationId} /></div>
        {patient?.id && (
          <div className="no-print" style={{ marginBottom: 12 }}>
            <PreconsultaPanel patientId={patient.id} motivo={motivo} compact onPreguntasMotivo={setPreguntasMotivo} />
          </div>
        )}

        {/* Nota en construcción (SOAP automático) */}
        <LiveSoap consultationId={consultationId} ensureConsultation={ensureConsultation}
                  user={user} onFinish={onFinish} voiceEnabled={voiceEnabled}
                  motivo={motivo} preguntasMotivo={preguntasMotivo} onTech={setTech} onEstado={setEstado} />

      </section>

      {/* PANEL TÉCNICO (colapsado) — para nosotros, no para el médico:
          transcripción confirmada, hablantes y eventos de la consulta en vivo. */}
      <details className="tech-panel no-print">
        <summary>Panel técnico (avanzado) · transcripción confirmada y eventos</summary>
        <div style={{ padding: "0 16px 16px" }}>
          <TechTranscript transcript={tech.transcript} turns={tech.turns} events={tech.events} />
        </div>
        {SHOW_LEGACY_TECH && (
        <div className="tech-grid">
          {/* batch único */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <h3 className="h-section" style={{ fontSize: 16 }}>Consulta general · audio real (batch único)</h3>
              <Pill variant={gen.recording ? "accent" : ""} pulse={gen.recording}>
                {gen.recording ? "grabando" : "en espera"}
              </Pill>
            </div>
            <div className="row g-8 wrap">
              {!gen.recording && <button className="btn primary sm" onClick={startGen}>● GRABAR</button>}
              {gen.recording && <button className="btn sm" onClick={stopGen}>■ DETENER</button>}
              {gen.url && <audio src={gen.url} controls style={{ height: 32 }} />}
              {gen.blob && !gen.recording && (
                <button className="btn sm" onClick={sendGen} disabled={busy}>
                  {busy ? "ENVIANDO…" : "ENVIAR → ASR"}
                </button>
              )}
            </div>
            <div style={{ marginTop: 14 }}>
              <Eyebrow>Transcripción {transcript ? "(real)" : ""}</Eyebrow>
              <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 6, minHeight: 40, color: transcript ? "var(--ink)" : "var(--ink-2)", fontStyle: transcript ? "normal" : "italic" }}>
                {transcript || "Graba y envía para obtener la transcripción real…"}
              </div>
            </div>
          </div>

          {/* streaming en vivo + shadow */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <div>
                <h3 className="h-section" style={{ fontSize: 16 }}>Streaming en vivo</h3>
                <Eyebrow>AudioWorklet 16k → WS → v2.1 · parciales</Eyebrow>
              </div>
              <Pill variant={streaming ? "accent" : ""} pulse={streaming}>
                {streaming ? "en vivo" : "detenido"}
              </Pill>
            </div>
            <div className="row g-8 wrap">
              {!streaming && <button className="btn primary sm" onClick={startStream}>● TRANSCRIBIR EN VIVO</button>}
              {streaming && <button className="btn sm" onClick={stopStream}>■ DETENER Y COMPARAR</button>}
            </div>
            {streamErr && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{streamErr}</div>}
            <div style={{ marginTop: 12 }}>
              <Eyebrow>Transcripción en vivo</Eyebrow>
              <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 6, minHeight: 36, color: liveText ? "var(--ink)" : "var(--ink-2)", fontStyle: liveText ? "normal" : "italic" }}>
                {liveText || "Pulsa transcribir en vivo y habla…"}
                {streaming && <span style={{ display: "inline-block", width: 6, height: 13, background: "var(--forest)", marginLeft: 2, verticalAlign: "middle", animation: "blink 1s infinite" }} />}
              </div>
            </div>
            {shadow && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--hair)" }}>
                <div className="row between center" style={{ marginBottom: 8 }}>
                  <Eyebrow>Shadow · streaming vs batch ({shadow.duration_s}s)</Eyebrow>
                  <Pill variant={shadow.content_similarity >= 0.9 ? "accent" : "gold"}>
                    contenido {Math.round(shadow.content_similarity * 100)}%
                  </Pill>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div className="mono" style={{ fontSize: 9, color: "var(--gold)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Streaming (final)</div>
                    <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>{shadow.streaming_final}</div>
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 9, color: "var(--forest)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Batch (referencia)</div>
                    <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>{shadow.batch}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* línea de tiempo (eventos técnicos) */}
          <div className="card">
            <Eyebrow>Línea de tiempo · eventos reales</Eyebrow>
            <div className="col g-6" style={{ marginTop: 12, maxHeight: 220, overflowY: "auto" }}>
              {events.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic" }}>
                  Los eventos reales (permiso, grabación, upload, ASR) aparecerán aquí.
                </div>
              )}
              {events.map((e, i) => (
                <div key={i} className="row g-10" style={{ fontSize: 11.5, fontFamily: "var(--font-mono)" }}>
                  <span style={{ color: "var(--ink-2)" }}>{e.ts}</span>
                  <span style={{ color: e.label.startsWith("error") ? "var(--danger)" : "var(--ink)" }}>{e.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}
      </details>
    </div>
  );
};

export default RealConsulta;
