import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api, apiBlobUrl } from "../api/client";
import EstudiosPaciente, { Miniatura, TipoPill } from "./estudios_paciente";
import ChatMegi from "./chat_megi";

// ============ ESTUDIOS APORTADOS, dentro de la consulta ============
// Tira de miniaturas de lo que el paciente trajo (subido en la pantalla previa
// o desde el teléfono). Solo lectura: se abre el original en otra pestaña.
// Si el médico marcó «sin estudios», lo dice en una línea y no estorba.

// `soap`/`setSoap` solo llegan desde Revisión: ahí la nota es editable y el
// botón «→ Objetivo» añade el texto a la sección O. En la consulta activa no
// hay nota editable y el panel es de solo lectura.
// Marca de origen: E = externo (lo trajo el paciente), I = interno (informe
// hecho en MEGI). En rojo para que se distinga de un vistazo.
export const Origen = ({ tipo, grande = false }) => (
  <span className="mono" title={tipo === "I" ? "Interno: hecho en MEGI" : "Externo: lo trajo el paciente"}
        aria-label={tipo === "I" ? "Interno" : "Externo"}
        style={{ color: "var(--danger)", fontWeight: 700, fontSize: grande ? 14 : 11, border: "1px solid var(--danger)", borderRadius: 4,
                 padding: grande ? "0 5px" : "0 4px", lineHeight: grande ? "19px" : "15px", display: "inline-block" }}>
    {tipo}
  </span>
);

// `siempre`: pintar la tarjeta aunque no haya estudios (en la consulta ocupa
// su mitad junto a «Antes de empezar»). `patientId` trae además los informes
// de radiología hechos en MEGI para ese paciente (internos).
const EstudiosStrip = ({ consultationId, patientId, patient, soap, setSoap, siempre = false, lineaUnica = false, conPrediagnostico = true }) => {
  const [data, setData] = React.useState(null);
  const [internos, setInternos] = React.useState([]);
  const [agregando, setAgregando] = React.useState(false);   // ventana «Agregar Más Estudios»
  React.useEffect(() => {
    let alive = true;
    if (!consultationId) return undefined;
    // Promise.resolve().then(...) también atrapa un cliente parcial (p. ej. un
    // mock de pruebas sin esta función): el panel es apoyo y nunca tira la pantalla.
    const cargar = () => Promise.resolve().then(() => api.getEstudiosAnalisis(consultationId))
      .then((d) => { if (alive && d) setData(d); }).catch(() => {});
    cargar();
    const t = setInterval(cargar, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [consultationId]);
  React.useEffect(() => {
    let alive = true;
    if (!patientId) { setInternos([]); return undefined; }
    Promise.resolve().then(() => api.radiologiaInformes(patientId))
      .then((l) => { if (alive && Array.isArray(l)) setInternos(l); }).catch(() => {});
    return () => { alive = false; };
  }, [patientId]);

  const pasarAObjetivo = (texto) => {
    if (!setSoap || !texto) return;
    const actual = (soap && soap.O) || "";
    setSoap({ ...(soap || {}), O: (actual ? actual.trimEnd() + "\n" : "") + texto });
  };

  if (!consultationId || (!data && !siempre)) return null;
  const lista = (data && data.estudios) || [];
  if (!lista.length && !internos.length && !siempre) {
    return data && data.estado === "sin_estudios"
      ? <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginBottom: 10 }}>El paciente no trajo estudios.</div>
      : null;
  }
  const abrir = async (e) => {
    try { window.open(await apiBlobUrl(api.estudioOriginalPath(consultationId, e.id)), "_blank", "noopener"); } catch (e2) { /* nada */ }
  };
  return (
    <div className="card" style={{ marginBottom: siempre ? 0 : 12, padding: 12 }} role="region" aria-label="Estudios del Paciente">
      {/* leyenda y contador junto al título; a la derecha, agregar más estudios en plena consulta */}
      <div className="row between center" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="row center g-10" style={{ flexWrap: "wrap" }}>
          <Eyebrow>Estudios del Paciente</Eyebrow>
          <span className="row center g-6" style={{ fontSize: lineaUnica ? 13 : 10.5, color: "var(--ink-2)" }}>
            <Origen tipo="E" /> externo · <Origen tipo="I" /> interno · <Pill>{lista.length + internos.length}</Pill>
          </span>
        </div>
        {lineaUnica && (
          <button className="btn primary sm" onClick={() => setAgregando(true)} aria-label="Agregar Más Estudios">Agregar Más Estudios</button>
        )}
      </div>
      {agregando && (
        <EstudiosPaciente modal patient={patient || { id: patientId }} consultationId={consultationId}
                          ensureConsultation={() => Promise.resolve(consultationId)} onClose={() => setAgregando(false)} />
      )}
      {!lista.length && !internos.length && (
        <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic", marginTop: 8 }}>
          {data && data.estado === "sin_estudios" ? "El paciente no trajo estudios." : "Sin estudios todavía."}
        </div>
      )}
      {lineaUnica && (lista.length > 0 || internos.length > 0) && (
        <div className="row center g-10" style={{ marginTop: 8, overflowX: "auto", paddingBottom: 4, flexWrap: "nowrap" }}>
          {lista.map((e) => (
            <button key={e.id} onClick={() => abrir(e)} title={`${e.nombre} · ${e.tipo_label || e.tipo || "identificando…"}`} aria-label={`Abrir ${e.nombre}`}
                    className="row center g-8" style={{ background: "transparent", border: "1px solid var(--hair)", borderRadius: 10, padding: "4px 10px 4px 5px", cursor: "pointer", flexShrink: 0, width: 250, textAlign: "left" }}>
              <Origen tipo="E" grande />
              <Miniatura cid={consultationId} estudio={e} size={56} cover />
              {/* nombre y tipo en columna, cada uno recortado con «…» dentro de la ficha */}
              <span className="col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <span style={{ fontSize: 12, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.nombre}</span>
                <span className="mono" style={{ fontSize: 9, lineHeight: 1.25, color: e.analisis_estado === "descartado" ? "var(--danger)" : "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.analisis_estado === "descartado" ? "descartado" : (e.tipo_label || "identificando…")}
                </span>
              </span>
            </button>
          ))}
          {internos.map((inf) => (
            <span key={inf.id} className="row center g-8" title={inf.impresion || ""}
                  style={{ border: "1px solid var(--hair)", borderRadius: 10, padding: "4px 10px 4px 5px", flexShrink: 0, width: 250 }}>
              <Origen tipo="I" grande />
              <span className="col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <span style={{ fontSize: 12, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inf.modalidad_label || inf.modalidad}{inf.region ? ` de ${inf.region}` : ""}</span>
                <span className="mono" style={{ fontSize: 9, lineHeight: 1.25, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(inf.fecha_estudio || inf.created_at || "").slice(0, 10)} · {inf.status === "firmado" ? "firmado" : "borrador"}</span>
              </span>
            </span>
          ))}
        </div>
      )}
      {!lineaUnica && lista.length > 0 && (
        <div className="row g-8" style={{ marginTop: 8, overflowX: "auto", paddingBottom: 4 }}>
          {lista.map((e) => (
            <div key={e.id} style={{ flexShrink: 0, width: 96, position: "relative" }}>
              <button onClick={() => abrir(e)} title={e.nombre} aria-label={`Abrir ${e.nombre}`}
                      style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer" }}>
                <Miniatura cid={consultationId} estudio={e} size={72} />
              </button>
              <div style={{ position: "absolute", top: 2, left: 2, background: "rgba(255,255,255,.92)", borderRadius: 4 }}><Origen tipo="E" /></div>
              <div style={{ marginTop: 3 }}><TipoPill estudio={e} /></div>
            </div>
          ))}
        </div>
      )}
      {!lineaUnica && internos.length > 0 && (
        <div className="col g-6" style={{ marginTop: 8 }}>
          {internos.map((inf) => (
            <div key={inf.id} className="row center g-8" style={{ fontSize: 12, lineHeight: 1.4 }}>
              <Origen tipo="I" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span>{inf.modalidad_label || inf.modalidad}{inf.region ? ` de ${inf.region}` : ""}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}> · {(inf.fecha_estudio || inf.created_at || "").slice(0, 10)} · {inf.status === "firmado" ? "firmado" : "borrador"}</span>
                {inf.impresion && <div style={{ fontSize: 11.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inf.impresion}</div>}
              </div>
              {setSoap && inf.impresion && <button className="btn ghost sm" onClick={() => pasarAObjetivo(`${inf.modalidad_label || inf.modalidad}${inf.region ? ` de ${inf.region}` : ""} (MEGI, ${(inf.fecha_estudio || "").slice(0, 10)}): ${inf.impresion}`)}
                                                   aria-label={`Pasar al Objetivo: informe ${inf.id}`}>→ Objetivo</button>}
            </div>
          ))}
        </div>
      )}

      {/* lo que leyeron los modelos, estudio por estudio (solo en el modo completo: en
          la consulta ya lo dice el pre-diagnóstico y no se repite) */}
      {!lineaUnica && <div className="col g-6" style={{ marginTop: 10 }}>
        {lista.flatMap((e) => (e.analisis || []).filter((a) => a.resumen).map((a) => (
          <div key={a.id} className="row between" style={{ gap: 8, fontSize: 12, lineHeight: 1.45, borderTop: "1px solid var(--hair)", paddingTop: 6 }}>
            <div style={{ flex: 1 }}>
              <Origen tipo="E" /> <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)" }}>{e.nombre}{a.modelo ? ` · ${a.modelo}` : ""} · </span>{a.resumen}
            </div>
            {setSoap && <button className="btn ghost sm" onClick={() => pasarAObjetivo(`${e.nombre} (${e.tipo_label || e.tipo}): ${a.resumen}`)}
                                aria-label={`Pasar al Objetivo: ${e.nombre}`}>→ Objetivo</button>}
          </div>
        )))}
      </div>}

      {conPrediagnostico && data && data.prediagnostico && (
        <div style={{ marginTop: 10, background: "var(--sage-soft)", border: "1px solid var(--sage)", borderRadius: 10, padding: 10 }}
             role="region" aria-label="Pre-diagnóstico MEGI">
          <div className="row between center" style={{ gap: 8, flexWrap: "wrap" }}>
            <div className="row center g-8">
              <Eyebrow>Pre-diagnóstico MEGI</Eyebrow>
              <Pill variant={data.prediagnostico.fuente === "llm" ? "sage" : "gold"}>
                {data.prediagnostico.fuente === "llm" ? "Megi-LLM" : "simulado · sin modelo de lenguaje"}
              </Pill>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>v{data.prediagnostico.version}</span>
            </div>
            {setSoap && <button className="btn sm" onClick={() => pasarAObjetivo("Estudios aportados (pre-diagnóstico MEGI, revisar): " + data.prediagnostico.texto)}
                                aria-label="Pasar el pre-diagnóstico al Objetivo">→ Objetivo</button>}
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap", marginTop: 6 }}>{data.prediagnostico.texto}</div>
          <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)", marginTop: 6 }}>{data.prediagnostico.aviso}</div>
          <ChatMegi compact titulo="Pregúntale a Megi IA sobre estos estudios" placeholder="Pregunta sobre lo analizado…"
                    ejemplos="«¿qué vio en la placa?», «¿qué salió fuera de rango?», «¿qué guía aplica?»"
                    resetKey={consultationId} preguntar={(pregunta, historial) => api.preguntarEstudios(consultationId, { pregunta, historial })} />
        </div>
      )}
    </div>
  );
};

// Pre-diagnóstico MEGI como bloque propio, a lo ancho (consulta activa). Solo
// lectura; en Revisión el mismo bloque vive dentro de EstudiosStrip con «→ Objetivo».
export const PrediagnosticoMegi = ({ consultationId }) => {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    if (!consultationId) return undefined;
    const cargar = () => Promise.resolve().then(() => api.getEstudiosAnalisis(consultationId))
      .then((d) => { if (alive && d) setData(d); }).catch(() => {});
    cargar();
    const t = setInterval(cargar, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [consultationId]);
  if (!consultationId || !data) return null;
  const pre = data.prediagnostico;
  const analizando = (data.estudios || []).some((e) => e.analisis_estado === "pendiente" || e.analisis_estado === "analizando");
  if (!pre && !analizando) return null;
  return (
    <div className="card" style={{ marginBottom: 12, padding: 12, background: "var(--sage-soft)", border: "1px solid var(--sage)" }}
         role="region" aria-label="Pre-diagnóstico MEGI">
      <div className="row center g-8" style={{ flexWrap: "wrap" }}>
        <Eyebrow>Pre-diagnóstico MEGI</Eyebrow>
        {pre && <Pill variant={pre.fuente === "llm" ? "sage" : "gold"}>{pre.fuente === "llm" ? "Megi-LLM" : "simulado · sin modelo de lenguaje"}</Pill>}
        {pre && <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>v{pre.version}</span>}
        {analizando && <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>analizando estudios…</span>}
      </div>
      {pre && <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap", marginTop: 6 }}>{pre.texto}</div>}
      {pre && <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)", marginTop: 6 }}>{pre.aviso}</div>}
      <ChatMegi compact titulo="Pregúntale a Megi IA sobre estos estudios" placeholder="Pregunta sobre lo analizado…"
                ejemplos="«¿qué vio en la placa?», «¿qué salió fuera de rango?», «¿qué guía aplica?»"
                resetKey={consultationId} preguntar={(pregunta, historial) => api.preguntarEstudios(consultationId, { pregunta, historial })} />
    </div>
  );
};

export default EstudiosStrip;
