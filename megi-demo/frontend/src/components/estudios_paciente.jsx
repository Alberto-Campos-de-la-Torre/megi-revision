import React from "react";
import QRCode from "qrcode";
import { Eyebrow, Pill } from "./shared";
import { api, apiBlobUrl } from "../api/client";
import ChatMegi from "./chat_megi";
import EcoEstudio from "./eco_estudio";

// ============ ESTUDIOS QUE TRAE EL PACIENTE (antes del SOAP) ============
// Tras «Nueva consulta» ya no se abre el SOAP: primero esta pantalla. El
// médico sube lo que el paciente trajo de dos formas:
//   - arrastrando archivos o eligiéndolos del disco (fotos, PDF, DICOM);
//   - desde el teléfono: un QR con un código de 15 minutos abre /subir/<código>
//     y lo que se fotografía ahí aparece aquí solo (se consulta cada 3 s).
// «Continuar sin estudios» deja constancia en la consulta y pasa al SOAP.
//
// La consulta se crea al entrar (ensureConsultation): los archivos necesitan
// una consulta a la que pertenecer, y a esta pantalla solo se llega al decir
// «a esto viene el paciente», que ya es empezar.

const ACEPTA = "image/*,.heic,.heif,application/pdf,.pdf,.dcm,.dicom,.hea,.dat,.atr,.csv,.txt";
const POLL_MS = 3000;

const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtRestante = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Miniatura con sesión: <img src> no manda Authorization, así que se baja como blob.
// `cover`: la imagen llena el cuadro (recorte centrado) en vez de encajar entera.
export const Miniatura = ({ cid, estudio, size = 92, cover = false }) => {
  const [url, setUrl] = React.useState(null);
  React.useEffect(() => {
    let alive = true; let objUrl = null;
    if (!estudio.tiene_vista) return undefined;
    apiBlobUrl(api.estudioVistaPath(cid, estudio.id))
      .then((u) => { objUrl = u; if (alive) setUrl(u); else URL.revokeObjectURL(u); })
      .catch(() => {});
    return () => { alive = false; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [cid, estudio.id, estudio.tiene_vista]);
  const box = { width: size, height: size, borderRadius: 8, background: "#111", display: "flex",
                alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 };
  if (url) return <div style={box}><img src={url} alt={estudio.nombre} style={cover ? { width: "100%", height: "100%", objectFit: "cover" } : { maxWidth: "100%", maxHeight: "100%" }} /></div>;
  return (
    <div style={{ ...box, background: "var(--cream-2)", color: "var(--ink-2)", border: "1px solid var(--hair)" }}>
      <span className="mono" style={{ fontSize: 11, letterSpacing: ".08em" }}>{(estudio.formato || "?").toUpperCase()}</span>
    </div>
  );
};

// Qué identificó el clasificador: la etiqueta la decide el backend (TIPOS_LABEL).
export const TipoPill = ({ estudio }) => {
  const st = estudio.analisis_estado || "pendiente";
  if (st === "descartado") {
    return <Pill variant="danger" title={estudio.triaje?.motivo || "descartado"}>descartado · {estudio.triaje?.motivo || "no es un estudio"}</Pill>;
  }
  if (!estudio.tipo) return <Pill>{st === "error" ? "sin analizar" : "identificando…"}</Pill>;
  const bueno = ["ecografia_mama", "ecografia_tiroides", "torax", "columna", "abdomen", "pdf_texto", "ecg", "ecg_senal", "ecg_senal_parte", "documento_foto", "documento_csv"].includes(estudio.tipo);
  return <Pill variant={bueno ? "accent" : "gold"} title={estudio.tipo_label || estudio.tipo}>{estudio.tipo_label || estudio.tipo}</Pill>;
};

// `modal`: la misma zona de subida (arrastrar/elegir + QR) como ventana emergente
// dentro de la consulta («Agregar Más Estudios»), sin pre-diagnóstico ni botones
// de continuar; `onClose` la cierra. Lo subido se analiza en segundo plano igual.
// `radiologia`: misma zona de subida dentro de la sección Radiología (carpeta
// del paciente): sin botones de continuar, con la lectura titulada como tal.
const EstudiosPaciente = ({ patient, motivo, consultationId, ensureConsultation, onContinue, onBack, modal = false, onClose, radiologia = false }) => {
  const [cid, setCid] = React.useState(consultationId || null);
  const [err, setErr] = React.useState(null);
  const [estudios, setEstudios] = React.useState([]);
  const [max, setMax] = React.useState(20);
  const [subiendo, setSubiendo] = React.useState(0);        // archivos en vuelo
  const [fallos, setFallos] = React.useState([]);           // {nombre, detalle}
  const [arrastrando, setArrastrando] = React.useState(false);
  const [enlace, setEnlace] = React.useState(null);         // {token, url, expires_at}
  const [qr, setQr] = React.useState(null);                 // data URL
  const [restante, setRestante] = React.useState(0);
  const [generando, setGenerando] = React.useState(false);
  const [saliendo, setSaliendo] = React.useState(false);
  const inputRef = React.useRef(null);

  // 1) la consulta existe antes de subir nada
  React.useEffect(() => {
    let alive = true;
    if (cid) return undefined;
    ensureConsultation()
      .then((id) => { if (alive) setCid(id); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) lista de estudios, refrescada mientras la pantalla está abierta (el
  //    teléfono sube por su cuenta y aquí tiene que verse sin tocar nada)
  const [pre, setPre] = React.useState(null);               // pre-diagnóstico vigente
  const [servicio, setServicio] = React.useState(null);     // {url, disponible}
  const [regenerando, setRegenerando] = React.useState(false);
  const cargar = React.useCallback(() => {
    if (!cid) return Promise.resolve();
    // Trae estudios + tipo identificado + análisis + pre-diagnóstico: el backend
    // los va completando en segundo plano después de cada subida.
    return api.getEstudiosAnalisis(cid)
      .then((d) => { setEstudios(d.estudios || []); if (d.max) setMax(d.max); setPre(d.prediagnostico || null); setServicio(d.servicio_modelos || null); })
      .catch((e) => setErr(e.message));
  }, [cid]);

  const regenerar = async () => {
    if (!cid || regenerando) return;
    setRegenerando(true);
    try { setPre(await api.regenerarPrediagnostico(cid)); } catch (e) { setErr(e.message); } finally { setRegenerando(false); }
  };

  React.useEffect(() => {
    if (!cid) return undefined;
    cargar();
    const t = setInterval(cargar, POLL_MS);
    return () => clearInterval(t);
  }, [cid, cargar]);

  // 3) cuenta atrás del enlace; al caducar, el QR deja de valer y se avisa
  React.useEffect(() => {
    if (!enlace) return undefined;
    const fin = new Date(enlace.expires_at).getTime();
    const tick = () => setRestante(Math.max(0, Math.round((fin - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [enlace]);

  // 4) al salir de la pantalla el enlace se revoca: el QR en una pantalla
  //    apagada no debe seguir aceptando archivos
  const enlaceRef = React.useRef(null);
  enlaceRef.current = enlace ? cid : null;
  React.useEffect(() => () => { if (enlaceRef.current) api.revocarEnlaceSubida(enlaceRef.current).catch(() => {}); }, []);

  const subirArchivos = async (files) => {
    const lista = Array.from(files || []).filter(Boolean);
    if (!lista.length || !cid) return;
    setFallos([]);
    setSubiendo((n) => n + lista.length);
    for (const f of lista) {
      try {
        const e = await api.subirEstudio(cid, f);
        setEstudios((prev) => (prev.some((x) => x.id === e.id) ? prev : [...prev, e]));
      } catch (e2) {
        setFallos((prev) => [...prev, { nombre: f.name, detalle: e2.message }]);
      } finally {
        setSubiendo((n) => n - 1);
      }
    }
  };

  const onDrop = (e) => {
    e.preventDefault(); setArrastrando(false);
    subirArchivos(e.dataTransfer?.files);
  };

  const borrar = async (id) => {
    try { await api.borrarEstudio(cid, id); setEstudios((prev) => prev.filter((x) => x.id !== id)); }
    catch (e) { setErr(e.message); }
  };

  const generarQr = async () => {
    if (!cid) return;
    setGenerando(true); setErr(null);
    try {
      const l = await api.crearEnlaceSubida(cid);
      const data = await QRCode.toDataURL(l.url, { width: 232, margin: 1, errorCorrectionLevel: "M" });
      setEnlace(l); setQr(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setGenerando(false);
    }
  };

  const continuar = async (sinEstudios) => {
    if (!cid || saliendo) return;
    setSaliendo(true);
    try {
      await api.estadoEstudios(cid, sinEstudios ? "sin_estudios" : "con_estudios");
    } catch (e) {
      // Un fallo al dejar constancia no debe impedir pasar consulta.
    }
    if (enlace) { api.revocarEnlaceSubida(cid).catch(() => {}); setEnlace(null); setQr(null); }
    onContinue();
  };

  const caducado = enlace && restante === 0;
  const llenos = estudios.length >= max;
  const abrirOriginal = async (e) => {
    try { window.open(await apiBlobUrl(api.estudioOriginalPath(cid, e.id)), "_blank", "noopener"); }
    catch (e2) { setErr(e2.message); }
  };

  const cuerpo = (
    <div className={modal || radiologia ? "" : "page"} style={modal || radiologia ? undefined : { paddingTop: 12 }} data-screen-label={modal || radiologia ? undefined : "01b Estudios del paciente"}>
      <div className="row between center" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div className="row center g-14">
          {!modal && <button className="btn ghost sm" onClick={onBack} aria-label="Volver al expediente">← Expediente</button>}
          <div>
            <h2 className="h-section" style={{ fontSize: 22, margin: 0 }}>{modal ? "Agregar más estudios" : radiologia ? `Estudios radiológicos de ${patient?.name}` : `Estudios que trae ${patient?.name}`}</h2>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              {modal ? patient?.name : null}{modal && patient?.name ? " · " : ""}{patient?.age} años · {patient?.sex === "F" ? "Femenino" : "Masculino"}{motivo ? <> · <strong>{motivo}</strong></> : null}
            </div>
          </div>
        </div>
        {modal ? (
          <button className="btn primary" onClick={onClose} aria-label="Cerrar" title={subiendo > 0 ? "Lo que esté subiendo se completa en segundo plano" : "Cerrar"}>
            {subiendo > 0 ? "Subiendo… cerrar" : "Cerrar"}
          </button>
        ) : radiologia ? (
          <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{subiendo > 0 ? "Subiendo…" : "Cada estudio se identifica y se manda a su modelo al llegar."}</span>
        ) : (
          <div className="row center g-8">
            <button className="btn" onClick={() => continuar(true)} disabled={!cid || saliendo || estudios.length > 0}
                    title={estudios.length ? "Ya hay estudios subidos" : "El paciente no trajo estudios"}>
              Continuar sin estudios
            </button>
            <button className="btn primary" onClick={() => continuar(false)} disabled={!cid || saliendo || subiendo > 0}
                    aria-label="Continuar a la consulta">
              {subiendo > 0 ? "Subiendo…" : "Continuar a la consulta →"}
            </button>
          </div>
        )}
      </div>

      <p style={{ fontSize: 12, color: "var(--ink-2)" }}>Todos los modelos MEGI son experimentales, para investigación sin uso comercial. Las ecografías de mama y tiroides requieren selección de órgano y caja manual.</p>
      {err && <div className="card" style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(300px, 1fr)", gap: 16, alignItems: "start" }}>
        {/* ---- archivos digitales: arrastrar o elegir ---- */}
        <div className="card">
          <div className="row between center">
            <Eyebrow>Archivos digitales</Eyebrow>
            <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{estudios.length} de {max}</span>
          </div>
          <div role="button" tabIndex={0} aria-label="Zona para soltar archivos"
               onClick={() => !llenos && inputRef.current?.click()}
               onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
               onDragOver={(e) => { e.preventDefault(); if (!arrastrando) setArrastrando(true); }}
               onDragLeave={() => setArrastrando(false)}
               onDrop={onDrop}
               style={{
                 marginTop: 10, padding: "26px 16px", textAlign: "center", cursor: llenos ? "not-allowed" : "pointer",
                 border: `2px dashed ${arrastrando ? "var(--forest)" : "var(--sage)"}`, borderRadius: 12,
                 background: arrastrando ? "var(--sage-soft)" : "var(--surface)", transition: "background .15s",
                 opacity: !cid || llenos ? 0.6 : 1,
               }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {arrastrando ? "Suelta aquí los archivos" : "Arrastra aquí los estudios o haz clic para elegirlos"}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 4 }}>
              Fotos, PDF de laboratorio, DICOM, registros de ECG (.hea + .dat) y CSV · hasta 60 MB cada uno
            </div>
            <input ref={inputRef} type="file" multiple accept={ACEPTA} style={{ display: "none" }}
                   aria-label="Elegir archivos" disabled={!cid || llenos}
                   onChange={(e) => { subirArchivos(e.target.files); e.target.value = ""; }} />
          </div>

          {fallos.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--danger)" }}>
              {fallos.map((f, i) => <div key={i}>No se subió «{f.nombre}»: {f.detalle}</div>)}
            </div>
          )}

          {estudios.length > 0 && (
            <div className="col g-8" style={{ marginTop: 14 }}>
              {estudios.map((e) => (
                // Rejilla fija: miniatura | información (se recorta, nunca se encima) | acciones.
                // Las etiquetas van en su propia fila bajo el nombre y el texto largo del
                // análisis se corta por palabra, así nada se superpone a la imagen.
                <div key={e.id} style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr) auto", gap: 10, alignItems: "start",
                                         border: "1px solid var(--hair)", borderRadius: 10, padding: 8 }}>
                  <Miniatura cid={cid} estudio={e} size={64} cover />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.nombre || "(sin nombre)"}</div>
                    <div className="row center g-6" style={{ flexWrap: "wrap", marginTop: 3 }}>
                      <TipoPill estudio={e} />
                      <Pill variant={e.origen === "telefono" ? "sage" : ""}>{e.origen === "telefono" ? "teléfono" : "escritorio"}</Pill>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)" }}>
                        {(e.formato || "").toUpperCase()} · {fmtBytes(e.bytes || 0)}{e.ancho ? ` · ${e.ancho}×${e.alto}` : ""}
                      </span>
                    </div>
                    {(e.analisis || []).map((a) => (
                      <div key={a.id} style={{ fontSize: 11.5, lineHeight: 1.4, marginTop: 4, overflowWrap: "anywhere",
                                               color: a.status === "error" ? "var(--danger)" : "var(--ink)" }}>
                        {a.modelo && a.status === "done" && <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)" }}>{a.modelo} · </span>}
                        {a.status === "error" ? `No se pudo analizar: ${a.error}` : a.resumen}
                      </div>
                    ))}
                    {e.tiene_vista && e.formato !== "pdf" && e.analisis_estado !== "descartado" && <EcoEstudio cid={cid} estudio={e} onAnalizado={cargar} />}
                  </div>
                  <div className="col g-4" style={{ alignItems: "stretch" }}>
                    <button className="btn ghost sm" onClick={() => abrirOriginal(e)} aria-label={`Abrir ${e.nombre}`}>Ver</button>
                    <button className="btn ghost sm" onClick={() => borrar(e.id)} aria-label={`Quitar ${e.nombre}`} style={{ color: "var(--danger)" }}>Quitar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {estudios.length === 0 && subiendo === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic", marginTop: 12 }}>
              Todavía no hay estudios en esta consulta.
            </div>
          )}
          {subiendo > 0 && <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 8 }}>Subiendo {subiendo} archivo{subiendo > 1 ? "s" : ""}…</div>}
        </div>

        {/* ---- desde el teléfono: QR ---- */}
        <div className="card">
          <Eyebrow>Fotografiar con el teléfono</Eyebrow>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.45 }}>
            Si el paciente trae los estudios en papel, escanea el código con el teléfono, toma las fotos y aparecerán aquí solas.
          </div>
          {!qr && (
            <button className="btn primary" style={{ marginTop: 12 }} onClick={generarQr} disabled={!cid || generando} aria-label="Generar código QR">
              {generando ? "Generando…" : "Generar código QR"}
            </button>
          )}
          {qr && (
            <div className="col center" style={{ marginTop: 12, gap: 8, alignItems: "center" }}>
              <div style={{ background: "#fff", padding: 8, borderRadius: 10, border: "1px solid var(--hair)", opacity: caducado ? 0.35 : 1 }}>
                <img src={qr} alt="Código QR para subir desde el teléfono" width={232} height={232} />
              </div>
              {!caducado ? (
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>caduca en {fmtRestante(restante)}</div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--danger)" }}>El código caducó.</div>
              )}
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-2)", wordBreak: "break-all", textAlign: "center" }}>{enlace.url}</div>
              <button className="btn sm" onClick={generarQr} disabled={generando}>{caducado ? "Generar otro" : "Renovar código"}</button>
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 12, lineHeight: 1.4 }}>
            El código sirve 15 minutos, solo para esta consulta, y se anula al salir de esta pantalla. En el teléfono no se ve nada del expediente.
          </div>
        </div>
      </div>

      {/* ---- pre-diagnóstico: lo que los modelos leyeron en los estudios (no en la ventana emergente) ---- */}
      {!modal && estudios.length > 0 && (
        <div className="card" style={{ marginTop: 16 }} role="region" aria-label={radiologia ? "Lectura radiológica MEGI" : "Pre-diagnóstico de los estudios"}>
          <div className="row between center" style={{ gap: 8, flexWrap: "wrap" }}>
            <div className="row center g-8" style={{ flexWrap: "wrap" }}>
              <Eyebrow>{radiologia ? "Lectura radiológica MEGI" : "Pre-diagnóstico de los estudios"}</Eyebrow>
              {pre && <Pill variant={pre.fuente === "llm" ? "sage" : pre.fuente === "mock" ? "gold" : "danger"}>
                {pre.fuente === "llm" ? "Megi-LLM" : pre.fuente === "mock" ? "simulado · sin modelo de lenguaje" : "sin modelo · servicio no disponible"}
              </Pill>}
              {pre && <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>v{pre.version}</span>}
              {servicio && !servicio.disponible && <Pill variant="danger">modelos de imagen no disponibles</Pill>}
            </div>
            <button className="btn sm" onClick={regenerar} disabled={regenerando || !cid} aria-label="Regenerar pre-diagnóstico">
              {regenerando ? "…" : "REGENERAR"}
            </button>
          </div>
          {estudios.some((e) => e.analisis_estado === "pendiente" || e.analisis_estado === "analizando") && (
            <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 8 }}>Analizando estudios…</div>
          )}
          {pre?.texto && <div style={{ fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap", marginTop: 10 }}>{pre.texto}</div>}
          {pre?.aviso && <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)", marginTop: 8, letterSpacing: ".04em" }}>{pre.aviso}</div>}

          {/* Megi IA sobre lo analizado ahora mismo: hechos de los modelos + pre-diagnóstico vigente */}
          <ChatMegi titulo="Pregúntale a Megi IA sobre estos estudios" placeholder="Pregunta sobre lo analizado…"
                    ejemplos={radiologia ? "Por ejemplo: «¿qué vio en la placa de tórax?», «¿dónde señala el nódulo?», «¿qué dice el modelo de columna sobre la curvatura?»." : "Por ejemplo: «¿qué vio en la radiografía de tórax?», «¿qué valores salieron fuera de rango?», «¿qué guía aplica a la glucosa?»."}
                    resetKey={cid} preguntar={(pregunta, historial) => api.preguntarEstudios(cid, { pregunta, historial })} />
        </div>
      )}
    </div>
  );

  if (!modal) return cuerpo;
  // Ventana emergente: clic fuera o «Cerrar» la cierra; el análisis de lo
  // subido sigue en el servidor y la consulta lo recoge sola al refrescar.
  return (
    <div className="modal-overlay no-print" onClick={onClose} role="dialog" aria-modal="true" aria-label="Agregar más estudios">
      <div className="modal-card" style={{ maxWidth: "min(1500px, 96vw)" }} onClick={(e) => e.stopPropagation()}>
        {cuerpo}
      </div>
    </div>
  );
};

export default EstudiosPaciente;
