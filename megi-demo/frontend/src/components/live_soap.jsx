// ============ CONSULTA EN VIVO: chunked-batch (fuente de verdad) + SOAP agéntico ============
// Captura PCM 16k a través de la SESIÓN ÚNICA de audio (lib/audio_session.js):
// esta pantalla ya NO abre su propio getUserMedia. Cada ~10s envía un segmento
// (con solape) al backend -> ASR v1.5 batch -> stitch -> transcript confirmado
// -> gemma actualiza S/O/A/P. El SOAP consume SOLO texto confirmado.
// Mientras se dicta un comando ("MEGI, ..."), la sesión excluye este carril:
// ese audio jamás llega aquí.
import React from "react";
import { Eyebrow, Pill } from "./shared";
import PendientesPanel from "./pendientes_panel";
import { api } from "../api/client";
import ConsultaVoice from "./consulta_voice";
import ConsultaFeed from "./consulta_feed";
import AlertasFda from "./alertas_fda";
import {
  encodeWav,
  pauseClinical,
  resumeClinical,
  startConsultation,
  stopConsultation,
  subscribeAudioSession,
} from "../lib/audio_session";

// 20 s es el punto del ASR v2.1, medido sobre dictado médico real: mismo WER
// que a 10 s (22.0 %) con 40 % menos de cómputo — 3 chunks en 4.1 s frente a 5
// en 7.1 s. A 30 s ya se degrada (23.9 %). Menos chunks son además menos
// costuras, y cada `stitch` es una ocasión de perder palabras en el borde.
// v1.5 usaba 10 s; el cambio de modelo movió el óptimo.
// ¿Se consolidó la nota? El backend responde `status: "done"`; los estados
// clínicos de la validación ("ready", "requires_review", "draft_only") también
// significan que HAY nota —un backend anterior a la separación los devolvía
// como `status`, y con "ready" la pantalla daba la nota por no generada.
export const notaGenerada = (res) =>
  !!res && (res.status === "done" || ["ready", "requires_review", "draft_only"].includes(res.status));

const CHUNK_MS = 20000;     // objetivo de segmento
const OVERLAP_S = 2;        // solape para no perder palabras en el borde

const SECTIONS = [
  { k: "S", name: "Subjetivo" }, { k: "O", name: "Objetivo" },
  { k: "A", name: "Análisis" }, { k: "P", name: "Plan" },
];

// `onTech` recibe { transcript, turns, events } para el panel técnico de la
// pantalla padre: esa información es para nosotros, no para el médico.
// `onEstado` informa a la pantalla padre si se graba, si se está consolidando y si
// la nota final ya existe: el botón «Finalizar y revisar» depende de eso.
// `motivo` alimenta el seguimiento de lo que falta preguntar (services/cobertura.py).
const LiveSoap = ({ consultationId, ensureConsultation, user, onFinish, voiceEnabled,
                    motivo, preguntasMotivo = [], onTech, onEstado }) => {
  const cidRef = React.useRef(consultationId || null);
  const [recording, setRecording] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [commandCapture, setCommandCapture] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const [turns, setTurns] = React.useState([]);   // Fase 10B: segmentos etiquetados por hablante
  const [soap, setSoap] = React.useState({ S: "", O: "", A: "", P: "" });
  const [sources, setSources] = React.useState([]);
  const [events, setEvents] = React.useState([]);
  const [warnings, setWarnings] = React.useState([]);
  const [gaps, setGaps] = React.useState([]);   // huecos de interrogatorio (apoyo)
  const [liveAlerts, setLiveAlerts] = React.useState(null);   // verificador FDA sobre lo dicho hasta ahora
  const [rehab, setRehab] = React.useState(null);             // protocolo de rehabilitación detectado
  const [rehabInsertado, setRehabInsertado] = React.useState(null);   // { lateralidad, lado_pendiente, insertados }
  const [rehabInsertando, setRehabInsertando] = React.useState(false);
  const [finalizing, setFinalizing] = React.useState(false);
  const [finalResult, setFinalResult] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [pendientes, setPendientes] = React.useState(null);  // qué falta preguntar

  const pcmRef = React.useRef([]);          // muestras 16k acumuladas (flat)
  const lastEndRef = React.useRef(0);       // índice hasta el que ya se envió
  const chunkIdxRef = React.useRef(0);
  const timerRef = React.useRef(null);
  const t0Ref = React.useRef(null);
  const chainRef = React.useRef(Promise.resolve());   // serializa los envíos de chunks

  const addEvent = (label) => {
    if (t0Ref.current == null) t0Ref.current = Date.now();
    const ms = Date.now() - t0Ref.current;
    const ts = `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
    setEvents((p) => [...p, { ts, label }]);
  };

  const flushChunk = async (isFinal = false) => {
    const total = pcmRef.current.length;
    const start = Math.max(0, lastEndRef.current - OVERLAP_S * 16000);
    if (total - start < 16000 && !isFinal) return;           // <1s nuevo: espera
    if (total - lastEndRef.current < 8000 && isFinal && lastEndRef.current > 0) return;
    const slice = Float32Array.from(pcmRef.current.slice(start, total));
    lastEndRef.current = total;
    const idx = chunkIdxRef.current++;
    const file = new File([encodeWav(slice)], `chunk_${idx}.wav`, { type: "audio/wav" });
    addEvent(`chunk_${idx} enviado (${(slice.length / 16000).toFixed(1)}s)`);
    try {
      const r = await api.uploadChunk({ file, consultationId: cidRef.current, chunkIdx: idx });
      setTranscript(r.transcript || "");
      addEvent(`chunk_${idx} transcrito (${r.status})`);
      if (r.wake_scrubbed) addEvent(`chunk_${idx}: frase de comando filtrada del transcript clínico`);
      // Fase 10B: acumula los segmentos etiquetados (con dedup del solape entre chunks).
      if (Array.isArray(r.speaker_segments) && r.speaker_segments.length) {
        setTurns((prev) => {
          const recent = new Set(prev.slice(-12).map((t) => t.text));
          const add = r.speaker_segments.filter((s) => s.text && !recent.has(s.text));
          return [...prev, ...add].slice(-30);
        });
      }
      if (r.added_text) {
        const s = await api.soapUpdate({ consultationId: cidRef.current, newConfirmedText: r.added_text, chunkIdx: idx });
        if (s.soap) setSoap(s.soap);
        if (s.warnings?.length) setWarnings(s.warnings);
        setGaps(Array.isArray(s.gaps) ? s.gaps : []);
        if (s.alertas_fda) setLiveAlerts(s.alertas_fda);
        if (s.rehabilitacion?.es_rehabilitacion) setRehab(s.rehabilitacion);
        if (s.sources?.length) {
          setSources((prev) => {
            const seen = new Set(prev.map((x) => x.citation));
            return [...prev, ...s.sources.filter((x) => !seen.has(x.citation))];
          });
        }
        const rt = s.retrieval || {};
        addEvent(`SOAP actualizado (${s.status})${rt.needs_rag ? ` · RAG ${rt.cited_count || 0}/${rt.retrieved_count || 0}` : ""}`);
      }
    } catch (e) {
      addEvent("error: " + e.message);
    }
  };

  const start = async () => {
    setErr(null);
    setFinalResult(null);
    setWarnings([]);
    setGaps([]);
    setLiveAlerts(null);
    setRehab(null);
    setRehabInsertado(null);
    setTranscript("");
    setTurns([]);
    setSoap({ S: "", O: "", A: "", P: "" });
    setSources([]);
    pcmRef.current = [];
    lastEndRef.current = 0;
    chunkIdxRef.current = 0;
    try {
      // Crea la consulta justo al iniciar la grabación (no antes).
      cidRef.current = ensureConsultation ? await ensureConsultation() : consultationId;
    } catch (e) {
      // El detalle importa: el caso más probable es que falte el motivo, y el
      // backend dice qué hacer. Un «no se pudo» genérico deja al médico sin pista.
      setErr(e?.message || "No se pudo crear la consulta.");
      return;
    }
    try {
      // Sesión única de audio: un solo getUserMedia; el router decide qué carril
      // recibe cada frame (clínico vs comando).
      await startConsultation({
        onFrame: (frame) => { for (let i = 0; i < frame.length; i++) pcmRef.current.push(frame[i]); },
      });
      setRecording(true);
      setPaused(false);
      addEvent("recording_started");
      // Serializa: cada tick encadena su flush al anterior (nunca se solapan).
      timerRef.current = setInterval(() => {
        chainRef.current = chainRef.current.then(() => flushChunk(false)).catch(() => {});
      }, CHUNK_MS);
    } catch (e) {
      setErr("micrófono: " + e.message);
    }
  };

  const stop = async () => {
    clearInterval(timerRef.current);
    setRecording(false);
    setPaused(false);
    addEvent("recording_stopped · flush final");
    stopConsultation();
    // Espera a que terminen los chunks en vuelo y luego el flush final, para que la
    // nota se consolide con TODA la transcripción (no antes de los últimos chunks).
    try { await chainRef.current; } catch (e) { /* noop */ }
    try { await flushChunk(true); } catch (e) { /* noop */ }
    if (!cidRef.current) return false;
    return consolidar();
  };

  // Nota final. Separada de `stop` para poder REINTENTARLA sin volver a grabar:
  // si el LLM falla, el médico se quedaba sin nada que revisar.
  const consolidar = async () => {
    if (!cidRef.current || finalizing) return false;
    setFinalizing(true);
    addEvent("consolidacion_final_started");
    try {
      const res = await api.soapFinalize({ consultationId: cidRef.current });
      setFinalResult(res);
      // Las sugerencias y alertas se CONSERVAN tras consolidar: el médico las
      // revisa junto con la nota final (antes se vaciaban aquí y desaparecían
      // justo al pulsar detener).
      const finalWarnings = res.validation?.warnings || res.warnings || [];
      if (finalWarnings.length) setWarnings(finalWarnings);
      addEvent(`SOAP final (${res.status || "done"}${res.clinical_status ? " · " + res.clinical_status : ""})`);
      return notaGenerada(res);
    } catch (e) {
      addEvent("error: consolidacion final: " + e.message);
      setFinalResult({ status: "error", error: e.message, soap: soap, clinical_facts: {}, validation: { flags: [], warnings: [e.message] } });
      return false;
    } finally {
      setFinalizing(false);
    }
  };

  // "Agregar a nota SOAP": el backend pega el protocolo en el Plan (persistido) y
  // devuelve la nota; el médico lo edita al aprobar. Si ya hay nota final, el
  // backend también la actualiza, así revisión lo ve.
  const insertarRehab = async (protocoloId, lateralidad) => {
    if (!cidRef.current || rehabInsertando) return;
    setRehabInsertando(true);
    try {
      const r = await api.rehabInsertar({ consultationId: cidRef.current, protocoloId, lateralidad });
      if (r.soap) {
        setSoap(r.soap);
        setFinalResult((prev) => (prev ? { ...prev, soap: r.soap } : prev));
      }
      setRehabInsertado({ lateralidad: r.lateralidad, lateralidad_inferida: r.lateralidad_inferida,
                          lado_pendiente: r.lado_pendiente, insertados: r.insertados });
      addEvent(`rehabilitación agregada al Plan (${r.insertados} pasos${r.lado_pendiente ? ", lado por definir" : ""})`);
    } catch (e) {
      addEvent("error: rehabilitación: " + e.message);
    } finally {
      setRehabInsertando(false);
    }
  };

  // Pausa/continuar del carril clínico (por voz o UI): frames descartados en pausa.
  const pause = () => { if (pauseClinical()) { setPaused(true); addEvent("recording_paused"); } };
  const resume = () => { if (resumeClinical()) { setPaused(false); addEvent("recording_resumed"); } };

  // Finalizar por voz: detiene, consolida la nota y pasa a revisión.
  // Solo pasa a revisión si la nota final quedó generada; si no, se queda aquí
  // con el botón de reintento a la vista.
  const stopAndReview = async () => { const ok = await stop(); if (ok) onFinish?.(); };

  // Refleja el estado de la sesión (captura de comando en curso).
  // Qué falta preguntar. Se recalcula con cada trozo de transcripción confirmada;
  // es determinista en el backend (sin LLM), así que no le quita GPU a la
  // transcripción. Va aparte del SOAP a propósito: si gemma falla, el médico
  // sigue viendo sus recordatorios.
  React.useEffect(() => {
    const cid = cidRef.current;
    if (!cid || !recording) return undefined;
    let alive = true;
    // `preguntasMotivo`: las que el modelo propuso en la pre-consulta; viajan en
    // el cuerpo porque la consulta no existía cuando se generaron.
    api.pendientesEnVivo({ consultationId: cid, motivo, preguntasMotivo })
      .then((r) => { if (alive) setPendientes(r); })
      .catch(() => { /* apoyo: si falla, no estorba */ });
    return () => { alive = false; };
  }, [transcript, motivo, recording, preguntasMotivo]);

  React.useEffect(() => subscribeAudioSession((st) => setCommandCapture(st.mode === "command_capture")), []);

  React.useEffect(() => () => { clearInterval(timerRef.current); stopConsultation(); }, []);

  React.useEffect(() => {
    onEstado?.({ recording, finalizing, hasFinal: !!finalResult, finalStatus: finalResult?.status || null,
                 notaLista: notaGenerada(finalResult) });
  }, [recording, finalizing, finalResult]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Transcripción, hablantes y eventos van al panel técnico del padre.
  React.useEffect(() => { onTech?.({ transcript, turns, events }); }, [transcript, turns, events]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card">
      <div className="row between center" style={{ marginBottom: 12 }}>
        <div>
          <h3 className="h-section" style={{ fontSize: 18 }}>Consulta en vivo · nota automática</h3>
          <Eyebrow>La nota S / O / A / P se construye sola mientras hablas</Eyebrow>
        </div>
        <div className="row g-8 center">
          <Pill
            variant={commandCapture ? "danger" : paused ? "gold" : recording ? "accent" : ""}
            pulse={recording && !paused && !commandCapture}
          >
            {commandCapture ? "comando en captura" : paused ? "en pausa" : recording ? "grabando" : "detenido"}
          </Pill>
          {!recording && <button className="btn primary sm" onClick={start} aria-label="Iniciar consulta en vivo">● INICIAR</button>}
          {recording && !paused && <button className="btn ghost sm" onClick={pause} aria-label="Pausar escucha">❚❚ PAUSAR</button>}
          {recording && paused && <button className="btn ghost sm" onClick={resume} aria-label="Continuar escucha">▶ CONTINUAR</button>}
          {recording && <button className="btn sm" onClick={stop} aria-label="Detener consulta en vivo">■ DETENER</button>}
        </div>
      </div>
      {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{err}</div>}

      {/* Comandos por voz de la consulta (Fase 7): pausa/continuar/finalizar.
          Solo en la versión "Consulta asistida por voz". */}
      {voiceEnabled && (
        <>
          <ConsultaVoice
            user={user}
            recording={recording}
            paused={paused}
            getConsultationId={() => cidRef.current}
            onStart={start}
            onPause={pause}
            onResume={resume}
            onStopAndReview={stopAndReview}
          />
          <div style={{ height: 12 }} />
        </>
      )}

      <div className="soap-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* SOAP en construcción */}
        <div>
          <Eyebrow>Nota en construcción</Eyebrow>
          <div className="col g-8" style={{ marginTop: 8 }}>
            {SECTIONS.map((s) => (
              <div key={s.k} style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 8 }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--forest)", lineHeight: 1 }}>{s.k}</div>
                <div>
                  <Eyebrow>{s.name}</Eyebrow>
                  <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 2, color: soap[s.k] ? "var(--ink)" : "var(--ink-2)", fontStyle: soap[s.k] ? "normal" : "italic" }}>
                    {soap[s.k] || "—"}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {warnings.length > 0 && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--surface)", borderLeft: "3px solid var(--warn)" }}>
              {warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: "var(--ink-2)" }}>⚠ {w}</div>)}
            </div>
          )}
          {sources.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--hair)" }}>
              <Eyebrow>Fuentes clínicas</Eyebrow>
              <div className="col g-4" style={{ marginTop: 6 }}>
                {sources.map((s, i) => (
                  <div key={i} className="mono" style={{ fontSize: 10, color: "var(--gold)" }}>
                    {s.citation_id ? `[${s.citation_id}] ` : "↳ "}{s.citation}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sugerencias y alertas conforme avanza la consulta (la transcripción
            y los eventos técnicos están en el panel técnico de la pantalla). */}
        <div>
          {/* Dos miradas distintas sobre la misma consulta, las dos
              deterministas: arriba lo que falta PREGUNTAR según el motivo de
              hoy; debajo, los huecos de seguridad del fármaco y las alarmas
              referidas sin exploración registrada. La transcripción y los
              eventos ya no viven aquí: van al panel técnico de la pantalla. */}
          <PendientesPanel datos={pendientes} />
          <ConsultaFeed alertas={liveAlerts} gaps={gaps} rehab={rehab} recording={recording} finished={!!finalResult}
            onInsertarRehab={insertarRehab} rehabInsertado={rehabInsertado} rehabInsertando={rehabInsertando} />
        </div>
      </div>
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--hair)" }}>
        <div className="row between center" style={{ marginBottom: 10 }}>
          <div>
            <Eyebrow>Nota final</Eyebrow>
            <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>
              Revisada con los hechos clínicos y las alertas de seguridad
            </div>
          </div>
          <Pill variant={finalResult?.official_note ? "accent" : finalResult ? "gold" : ""}>
            {finalizing ? "revisando" : finalResult?.official_note ? "lista" : finalResult ? "requiere revisión" : "pendiente"}
          </Pill>
        </div>
        {finalizing && (
          <div style={{ fontSize: 12, color: "var(--ink-2)" }}>Revisando hechos clínicos, negaciones, alertas y medicamentos…</div>
        )}
        {!finalizing && !finalResult && (
          <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic" }}>
            Detén la grabación para generar la nota final.
          </div>
        )}
        {!finalizing && finalResult && !notaGenerada(finalResult) && !recording && (
          <div className="row g-10 center" style={{ marginBottom: 10, padding: "8px 10px", background: "var(--surface)", borderLeft: "3px solid var(--danger)" }}>
            <span style={{ fontSize: 12 }}>
              La nota final no se generó ({finalResult.error || finalResult.status}). Sin ella no hay nada que revisar.
            </span>
            <button className="btn sm" onClick={consolidar} aria-label="Reintentar la nota final">↻ Reintentar nota final</button>
          </div>
        )}
        {finalResult && (
          <FinalSoapResult result={finalResult} />
        )}
      </div>
    </div>
  );
};

const FinalSoapResult = ({ result }) => {
  const soap = result.soap || {};
  const facts = result.clinical_facts || {};
  const flags = result.validation?.flags || [];
  return (
    <div className="soap-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div className="col g-8">
        {SECTIONS.map((s) => (
          <div key={s.k} style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 8 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--forest)", lineHeight: 1 }}>{s.k}</div>
            <div>
              <Eyebrow>{s.name}</Eyebrow>
              <div style={{ fontSize: 12, lineHeight: 1.55, marginTop: 2, whiteSpace: "pre-wrap" }}>
                {soap[s.k] || "—"}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div>
        <Eyebrow>Validación · alertas</Eyebrow>
        <div className="col g-6" style={{ marginTop: 8 }}>
          {(flags.length ? flags : [{ message: "Sin alertas bloqueantes detectadas." }]).map((flag, i) => (
            <div key={i} style={{
              fontSize: 11.5,
              lineHeight: 1.45,
              padding: "7px 9px",
              borderLeft: `3px solid ${flag.severity === "blocker" ? "var(--danger)" : "var(--warn)"}`,
              background: "var(--surface)",
            }}>
              {flag.message}
            </div>
          ))}
        </div>
        {/* Verificador FDA (tabla de contraindicaciones): receta × dx × ficha del paciente. */}
        <AlertasFda seguridad={result.alertas_seguridad || facts.alertas_seguridad} />
        {/* Diagnósticos con CIE-10 del catálogo (nunca códigos inventados). */}
        {(facts.diagnosticos?.length || facts.diagnosticos_diferenciales?.length) ? (
          <div style={{ marginTop: 12 }}>
            <Eyebrow>Diagnósticos (CIE-10)</Eyebrow>
            {(facts.diagnosticos || []).map((d, i) => (
              <div key={`dx${i}`} style={{ fontSize: 11.5, lineHeight: 1.45, marginTop: 4 }}>
                <span className="mono" style={{ color: d.code ? (d.match === "aproximado" ? "var(--gold)" : "var(--forest)") : "var(--gold)", fontSize: 10 }}>
                  {d.code || "sin código"}
                </span>{" "}
                <span>{d.texto}{d.principal ? " (principal)" : ""}</span>
                {d.match === "aproximado" && (
                  <span style={{ fontSize: 10, color: "var(--gold)" }} title={`Código aproximado — el catálogo sugirió “${d.label}”; verifica antes de firmar`}> · aprox. ⚠</span>
                )}
              </div>
            ))}
            {(facts.diagnosticos_diferenciales?.length > 0) && (
              <div style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 4 }}>
                Diferenciales: {facts.diagnosticos_diferenciales.map((d) => `${d.texto}${d.code ? ` (${d.code})` : ""}`).join(" · ")}
              </div>
            )}
          </div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <Eyebrow>Hechos clínicos usados</Eyebrow>
          <FactLine label="Presentes" items={facts.sintomas_presentes} />
          <FactLine label="Negados" items={facts.sintomas_negados} />
          <FactLine label="Alarmas condicionales" items={facts.datos_alarma_condicionales} />
        </div>
        {/* Medicamentos por rol: la receta NO debe mezclar lo que el paciente ya
            toma, lo que se automedicó o lo que se suspende, con lo prescrito. */}
        {(facts.medicamentos?.length || facts.medicamentos_habitual?.length ||
          facts.medicamentos_suspender?.length || facts.medicamentos_automedicacion?.length) ? (
          <div style={{ marginTop: 12 }}>
            <Eyebrow>Medicamentos</Eyebrow>
            <MedLine label="Se receta hoy" items={facts.medicamentos} color="var(--sage-2)" />
            <MedLine label="Tratamiento habitual" items={facts.medicamentos_habitual} color="var(--ink-2)" />
            <MedLine label="A suspender" items={facts.medicamentos_suspender} color="var(--danger)" />
            <MedLine label="Automedicación referida" items={facts.medicamentos_automedicacion} color="var(--gold)" />
          </div>
        ) : null}
      </div>
    </div>
  );
};

const MedLine = ({ label, items, color }) => {
  if (!items?.length) return null;
  const fmt = (m) => [m.nombre, m.dosis, m.frecuencia].filter(Boolean).join(" ");
  return (
    <div style={{ fontSize: 11.5, lineHeight: 1.45, marginTop: 6 }}>
      <span className="mono" style={{ color, fontSize: 10 }}>{label}: </span>
      <span>{items.map(fmt).join(" · ")}</span>
    </div>
  );
};

const FactLine = ({ label, items }) => (
  <div style={{ fontSize: 11.5, lineHeight: 1.45, marginTop: 6 }}>
    <span className="mono" style={{ color: "var(--ink-2)", fontSize: 10 }}>{label}: </span>
    <span>{items?.length ? items.join(", ") : "—"}</span>
  </div>
);

export default LiveSoap;
