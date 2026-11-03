import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";

// ============ EXPEDIENTE LEÍDO POR EL MODELO: resumen + preguntas ============
// Debajo de la tarjeta del paciente. Pide al backend un resumen del expediente
// (historial, consultas, estudios, envíos, citas) y deja preguntarle al modelo
// sobre el paciente. El backend decide quién responde: gemma (fuente "llm"),
// o la versión sin modelo cuando corre en local_mock ("mock") o el servicio
// MLX no contesta ("sin_modelo"); aquí solo se muestra con su etiqueta.
//
// MEGI resume; el expediente manda. Nada de esto se guarda en la nota.

const FUENTE = {
  llm: { label: "Megi-LLM", variant: "sage" },
  mock: { label: "simulado · sin modelo", variant: "gold" },
  sin_modelo: { label: "sin modelo · servicio no disponible", variant: "danger" },
};

// Color y signo de cada tema para separar la lectura de un vistazo.
const TEMA = {
  paciente: { color: "var(--forest)", signo: "●" },
  consultas: { color: "var(--accent)", signo: "✚" },
  estudios: { color: "var(--gold)", signo: "◫" },
  aportados: { color: "var(--gold)", signo: "⇡" },
  envios: { color: "var(--sage-2)", signo: "➤" },
  citas: { color: "var(--ink-2)", signo: "▣" },
};

// Una sección de la lectura: título en color, texto y puntos, con fondo claro
// y borde izquierdo de su tema. Contraste alto: tinta plena sobre superficie.
const Seccion = ({ sec }) => {
  const t = TEMA[sec.clave] || TEMA.citas;
  if (!sec.texto && !(sec.items || []).length) return null;
  return (
    <section aria-label={sec.titulo}
             style={{ background: "var(--surface)", border: "1px solid var(--hair)", borderLeft: `4px solid ${t.color}`,
                      borderRadius: 10, padding: "10px 12px" }}>
      <div className="row center g-6" style={{ marginBottom: 4 }}>
        <span aria-hidden="true" style={{ color: t.color, fontSize: 11 }}>{t.signo}</span>
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: t.color, fontWeight: 700 }}>{sec.titulo}</span>
      </div>
      {sec.texto && <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--ink)" }}>{sec.texto}</div>}
      {(sec.items || []).length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.55, color: "var(--ink)" }}>
          {sec.items.map((it, i) => <li key={i} style={{ marginBottom: 2 }}>{it}</li>)}
        </ul>
      )}
    </section>
  );
};

const fmtHora = (iso) => {
  try { return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return ""; }
};

const ExpedienteLLM = ({ patient }) => {
  const patientId = patient?.id;
  const [resumen, setResumen] = React.useState(null);     // respuesta del backend
  const [cargando, setCargando] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [mensajes, setMensajes] = React.useState([]);     // {rol: "medico"|"megi", texto, fuente?, error?}
  const [input, setInput] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const finRef = React.useRef(null);

  const cargar = React.useCallback(() => {
    if (!patientId) return undefined;
    let alive = true;
    setCargando(true); setErr(null);
    api.getExpedienteResumen(patientId)
      .then((d) => { if (alive) setResumen(d); })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setCargando(false); });
    return () => { alive = false; };
  }, [patientId]);

  // Paciente nuevo: resumen nuevo y conversación en blanco. Lo que se preguntó
  // de otro paciente no debe quedar a la vista.
  React.useEffect(() => {
    setResumen(null); setMensajes([]); setInput("");
    return cargar();
  }, [patientId, cargar]);

  // jsdom no implementa scrollIntoView: se llama solo si existe.
  React.useEffect(() => { finRef.current?.scrollIntoView?.({ block: "nearest" }); }, [mensajes, enviando]);

  const preguntar = async (e) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || enviando || !patientId) return;
    setInput("");
    const historial = mensajes.slice(-6).map((m) => ({ rol: m.rol, texto: m.texto }));
    setMensajes((m) => [...m, { rol: "medico", texto: q }]);
    setEnviando(true);
    try {
      const r = await api.preguntarExpediente(patientId, { pregunta: q, historial });
      setMensajes((m) => [...m, { rol: "megi", texto: r.respuesta || "", fuente: r.fuente, error: r.error }]);
    } catch (e2) {
      setMensajes((m) => [...m, { rol: "megi", texto: "", error: e2.message }]);
    } finally {
      setEnviando(false);
    }
  };

  if (!patientId) return null;
  const fuente = FUENTE[resumen?.fuente] || null;
  const c = resumen?.conteos || {};

  return (
    <div className="card" role="region" aria-label="Lectura del expediente">
      <div className="row between center" style={{ gap: 8, flexWrap: "wrap" }}>
        <div className="row center" style={{ gap: 8, flexWrap: "wrap" }}>
          <Eyebrow>Lectura del expediente</Eyebrow>
          {fuente && <Pill variant={fuente.variant}>{fuente.label}</Pill>}
        </div>
        <button className="btn sm" onClick={cargar} disabled={cargando} aria-label="Regenerar resumen">
          {cargando ? "…" : "REGENERAR"}
        </button>
      </div>

      {resumen && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <Pill>{c.consultas ?? 0} consultas</Pill>
          <Pill>{c.estudios ?? 0} estudios</Pill>
          <Pill>{c.aportados ?? 0} aportados</Pill>
          <Pill>{c.envios ?? 0} envíos</Pill>
          <Pill>{c.documentos ?? 0} documentos</Pill>
          <Pill>{c.citas ?? 0} citas</Pill>
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        {cargando && !resumen && (
          <div style={{ fontSize: 12, color: "var(--ink-2)" }}>Leyendo el expediente…</div>
        )}
        {err && (
          <div style={{ fontSize: 12, color: "var(--danger)" }}>No se pudo generar el resumen: {err}</div>
        )}
        {/* Con modelo: su redacción arriba (en su propio bloque) y debajo las secciones
            por tema. Sin modelo: solo las secciones (el texto corrido las repetiría). */}
        {resumen?.resumen && resumen.fuente === "llm" && (
          <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--ink)", background: "var(--sage-soft)",
                        border: "1px solid var(--sage)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
            {resumen.resumen}
          </div>
        )}
        {resumen?.secciones?.length > 0 ? (
          <div className="col g-8">
            {resumen.secciones.map((sec) => <Seccion key={sec.clave} sec={sec} />)}
          </div>
        ) : (resumen?.resumen && resumen.fuente !== "llm" && (
          <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--ink)" }}>{resumen.resumen}</div>
        ))}
        {resumen?.fuente === "sin_modelo" && resumen.error && (
          <div style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 6 }}>
            El servicio del modelo no respondió ({resumen.error}); esto es un ordenamiento del expediente, no una redacción.
          </div>
        )}
        {resumen?.aviso && (
          <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)", marginTop: 8, letterSpacing: ".04em" }}>
            {resumen.aviso}{resumen.generado_en ? ` · ${fmtHora(resumen.generado_en)}` : ""}
          </div>
        )}
      </div>

      {/* preguntas sobre el paciente */}
      <div style={{ marginTop: 14, borderTop: "1px solid var(--hair)", paddingTop: 12 }}>
        <Eyebrow>Pregúntale a MEGI sobre este paciente</Eyebrow>
        <div className="col g-8" style={{ marginTop: 8, maxHeight: 320, overflowY: "auto" }}>
          {mensajes.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic" }}>
              Por ejemplo: «¿qué tratamiento se le indicó la última vez?», «¿tiene estudios de tórax?», «¿a dónde se le envió?».
            </div>
          )}
          {mensajes.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.rol === "medico" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              background: m.rol === "medico" ? "var(--cream-2)" : "var(--sage-soft)",
              border: "1px solid " + (m.rol === "medico" ? "var(--hair)" : "var(--sage)"),
              borderRadius: 10, padding: "8px 10px", fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap",
            }}>
              {m.rol === "megi" && (
                <div className="mono" style={{ fontSize: 9, color: "var(--ink-2)", marginBottom: 3, letterSpacing: ".06em" }}>
                  MEGI{m.fuente && m.fuente !== "llm" ? ` · ${FUENTE[m.fuente]?.label || m.fuente}` : ""}
                </div>
              )}
              {m.texto}
              {m.error && !m.texto && (
                <span style={{ color: "var(--danger)" }}>No se pudo responder: {m.error}</span>
              )}
            </div>
          ))}
          {enviando && <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic" }}>MEGI está leyendo el expediente…</div>}
          <div ref={finRef} />
        </div>
        <form className="row g-8" style={{ marginTop: 10 }} onSubmit={preguntar}>
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)}
                 placeholder="Pregunta sobre el paciente…" disabled={enviando} aria-label="Pregunta sobre el paciente"
                 style={{ flex: 1 }} />
          <button type="submit" className="btn primary sm" disabled={enviando || !input.trim()}>
            {enviando ? "…" : "PREGUNTAR"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ExpedienteLLM;
