import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";
import useRecorder from "../lib/use_recorder";

// ============ RADIOLOGÍA: informe de estudio ============
// Flujo propio y distinto al de consulta: el radiólogo no tiene al paciente
// delante, informa un ESTUDIO. Elegir estudio → dictar → revisar → firmar.
//
// Dos reglas que se ven en pantalla:
//   - El dictado crudo se conserva y se puede consultar siempre.
//   - Un informe firmado queda sellado: para corregir, se hace uno nuevo.
//
// Imágenes del estudio (21-sep): hasta 4 por informe (JPG/PNG/WebP/DICOM).
// «Analizar con MEGI» pide al modelo una lectura que aparece en un panel
// APARTE, con aviso; nada entra a las secciones hasta que el radiólogo pulsa
// «Usar como borrador», y aun así queda editable y sin firmar.

const MAX_IMAGENES = 4;
const ACEPTA = ".jpg,.jpeg,.png,.webp,.dcm,.dicom,image/jpeg,image/png,image/webp,application/dicom";

const SECCIONES = [
  { k: "tecnica", label: "Técnica", filas: 3 },
  { k: "comparacion", label: "Comparación", filas: 2 },
  { k: "hallazgos", label: "Hallazgos", filas: 8, req: true },
  { k: "impresion", label: "Impresión diagnóstica", filas: 4, req: true },
  { k: "recomendaciones", label: "Recomendaciones", filas: 2 },
];

const listBtnStyle = (active) => ({
  textAlign: "left", cursor: "pointer", width: "100%",
  border: "1px solid " + (active ? "var(--forest)" : "var(--hair)"),
  background: active ? "var(--cream-2)" : "var(--surface)",
  borderRadius: "var(--radius)", padding: "12px 14px",
});

// Miniatura protegida: baja la vista con sesión y libera el object URL al irse.
const Miniatura = ({ informeId, imagen, onBorrar, puedeBorrar }) => {
  const [src, setSrc] = React.useState(null);
  React.useEffect(() => {
    let url = null, alive = true;
    api.radiologiaVistaUrl(informeId, imagen.id)
      .then((u) => { if (alive) { url = u; setSrc(u); } else { URL.revokeObjectURL(u); } })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [informeId, imagen.id]);
  const meta = imagen.dicom_meta || {};
  return (
    <figure style={{ margin: 0, width: 132 }}>
      <div style={{ width: 132, height: 100, background: "#000", borderRadius: 6, overflow: "hidden",
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
        {src ? <img src={src} alt={imagen.nombre_original || imagen.id}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
             : <span style={{ color: "#888", fontSize: 11 }}>cargando…</span>}
      </div>
      <figcaption className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.4 }}>
        {imagen.formato.toUpperCase()}{meta.modality ? ` · ${meta.modality}` : ""} · {imagen.ancho}×{imagen.alto}
        {meta.frames > 1 ? ` · corte ${meta.frame_usado + 1}/${meta.frames}` : ""}
        {puedeBorrar && (
          <button className="btn ghost sm" style={{ marginLeft: 6, padding: "0 6px", fontSize: 10 }}
                  onClick={() => onBorrar(imagen)} aria-label={`Quitar ${imagen.nombre_original || imagen.id}`}>
            quitar
          </button>
        )}
      </figcaption>
    </figure>
  );
};

const LECTURA = [
  { k: "tecnica", label: "Técnica" },
  { k: "hallazgos", label: "Hallazgos" },
  { k: "impresion", label: "Impresión" },
  { k: "limitaciones", label: "Limitaciones" },
];

const Radiologia = ({ patients = [] }) => {
  const [modalidades, setModalidades] = React.useState([]);
  const [informes, setInformes] = React.useState([]);
  const [activo, setActivo] = React.useState(null);
  const [nuevo, setNuevo] = React.useState({ patient_id: "", modalidad: "radiografia", region: "", indicacion: "" });
  const [err, setErr] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);
  const [guardando, setGuardando] = React.useState(false);
  const [transcribiendo, setTranscribiendo] = React.useState(false);
  const [verDictado, setVerDictado] = React.useState(false);
  const [imagenes, setImagenes] = React.useState([]);
  const [subiendo, setSubiendo] = React.useState(false);
  const [analizando, setAnalizando] = React.useState(false);
  const rec = useRecorder();

  React.useEffect(() => {
    api.radiologiaModalidades().then(setModalidades).catch(() => setModalidades([]));
    api.radiologiaInformes().then(setInformes).catch((e) => setErr(e.message));
  }, []);

  const firmado = activo?.status === "firmado";

  // Las imágenes se piden al abrir un informe (la lista no las trae).
  React.useEffect(() => {
    if (!activo?.id) { setImagenes([]); return; }
    let alive = true;
    api.radiologiaImagenes(activo.id)
      .then((l) => { if (alive) setImagenes(l || []); })
      .catch(() => { if (alive) setImagenes([]); });
    return () => { alive = false; };
  }, [activo?.id]);

  const subirImagenes = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !activo || firmado) return;
    const hueco = MAX_IMAGENES - imagenes.length;
    if (files.length > hueco) {
      setErr(`caben ${hueco} imagen(es) más (máximo ${MAX_IMAGENES} por informe)`);
      return;
    }
    setSubiendo(true); setErr(null);
    try {
      for (const file of files) {
        const img = await api.radiologiaSubirImagen({ id: activo.id, file });
        setImagenes((p) => [...p, img]);
      }
      setAviso(`${files.length} imagen(es) guardada(s) con el informe`);
    } catch (ex) { setErr(ex.message); } finally { setSubiendo(false); }
  };

  const borrarImagen = async (img) => {
    if (!window.confirm(`¿Quitar la imagen ${img.nombre_original || img.id}?`)) return;
    setErr(null);
    try {
      await api.radiologiaBorrarImagen(activo.id, img.id);
      setImagenes((p) => p.filter((x) => x.id !== img.id));
      // El backend invalida la lectura: ya no mira lo mismo.
      setActivo((p) => ({ ...p, analisis_ia: null }));
    } catch (ex) { setErr(ex.message); }
  };

  const analizar = async () => {
    setAnalizando(true); setErr(null);
    try {
      const a = await api.radiologiaAnalizar(activo.id);
      setActivo((p) => ({ ...p, analisis_ia: a }));
      setAviso(`lectura asistida lista en ${Math.round((a.latency_ms || 0) / 1000)} s · revísala antes de usarla`);
    } catch (ex) { setErr(ex.message); } finally { setAnalizando(false); }
  };

  // Copia la lectura a las secciones del informe. Si la sección ya tiene
  // texto se AÑADE debajo: nunca se pisa lo que dictó o escribió el radiólogo.
  const usarComoBorrador = () => {
    const l = activo?.analisis_ia?.lectura || {};
    setActivo((p) => {
      const n = { ...p };
      for (const k of ["tecnica", "hallazgos", "impresion"]) {
        const nuevo = (l[k] || "").trim();
        if (!nuevo) continue;
        const actual = (p[k] || "").trim();
        n[k] = actual ? `${actual}\n\n${nuevo}` : nuevo;
      }
      if ((l.limitaciones || "").trim()) {
        const actual = (p.recomendaciones || "").trim();
        const lim = `Limitaciones del estudio: ${l.limitaciones.trim()}`;
        n.recomendaciones = actual ? `${actual}\n\n${lim}` : lim;
      }
      return n;
    });
    setAviso("borrador copiado a las secciones: revísalo, corrígelo y guarda");
  };

  const crear = async () => {
    if (!nuevo.patient_id) return;
    setErr(null);
    try {
      const r = await api.radiologiaCrear(nuevo);
      setInformes((p) => [r, ...p]);
      setActivo(r);
      setAviso(null);
    } catch (e) { setErr(e.message); }
  };

  const cambiar = (k) => (e) => setActivo((p) => ({ ...p, [k]: e.target.value }));

  const guardar = async () => {
    setGuardando(true); setErr(null);
    try {
      const cuerpo = Object.fromEntries(SECCIONES.map((s) => [s.k, activo[s.k] || ""]));
      const r = await api.radiologiaEditar(activo.id, { ...cuerpo, region: activo.region, indicacion: activo.indicacion });
      setActivo(r);
      setInformes((p) => p.map((x) => (x.id === r.id ? r : x)));
      setAviso("guardado");
    } catch (e) { setErr(e.message); } finally { setGuardando(false); }
  };

  const firmar = async () => {
    setErr(null);
    try {
      const r = await api.radiologiaFirmar(activo.id);
      setActivo(r);
      setInformes((p) => p.map((x) => (x.id === r.id ? r : x)));
      setAviso("informe firmado y sellado");
    } catch (e) { setErr(e.message); }
  };

  const alternarDictado = async () => {
    if (rec.recording) { rec.stop(); return; }
    setErr(null);
    try { await rec.start(); } catch (e) { setErr("no se pudo abrir el micrófono"); }
  };

  // Al terminar de grabar: sube el dictado, el backend transcribe y reparte.
  React.useEffect(() => {
    if (!rec.blob || rec.recording || !activo || firmado) return;
    let alive = true;
    setTranscribiendo(true);
    const file = new File([rec.blob], "dictado.webm", { type: rec.blob.type });
    api.radiologiaDictar({ id: activo.id, file })
      .then((r) => {
        if (!alive) return;
        setActivo(r);
        const d = r.dictado || {};
        setAviso(d.via === "encabezados" ? `repartido por encabezados: ${(d.aplicadas || []).join(", ")}`
          : d.via === "llm" ? `ordenado por MEGI: ${(d.aplicadas || []).join(", ")}`
          : "no se reconocieron secciones: el dictado quedó en Hallazgos");
      })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) { setTranscribiendo(false); rec.reset(); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.blob, rec.recording]);

  const paciente = (id) => patients.find((p) => p.id === id)?.name || id;
  const faltan = SECCIONES.filter((s) => s.req && !(activo?.[s.k] || "").trim());

  return (
    <div className="page">
      <div style={{ marginBottom: 20 }}>
        <Eyebrow style={{ fontSize: 12, fontWeight: 600 }}>Informe de estudio</Eyebrow>
        <h1 className="h-page" style={{ marginTop: 8 }}>Radiología</h1>
        <p style={{ marginTop: 8, color: "var(--ink-2)", fontSize: 14 }}>
          {informes.length ? `${informes.length} informes en tus pacientes.` : "Dictado de informes radiológicos."}
          {" "}Dicta o escribe, revisa las secciones y firma; al firmar queda sellado.
        </p>
      </div>

      {err && (
        <div className="card no-print" style={{ borderLeft: "3px solid var(--danger)", marginBottom: 16 }}>
          <Eyebrow>Error</Eyebrow>
          <div style={{ fontSize: 13, marginTop: 6, color: "var(--ink-2)" }}>{err}</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 24 }} className="pacientes-grid">
        {/* LISTA + ALTA */}
        <section className="no-print">
          <div className="card">
            <Eyebrow>Nuevo informe</Eyebrow>
            <div className="col g-12" style={{ marginTop: 12 }}>
              <div>
                <label className="field-label" htmlFor="ir-paciente">Paciente *</label>
                <select id="ir-paciente" className="input" aria-label="Paciente" value={nuevo.patient_id}
                        onChange={(e) => setNuevo((p) => ({ ...p, patient_id: e.target.value }))}
                        style={{ width: "100%" }}>
                  <option value="">Selecciona…</option>
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="ir-modalidad">Modalidad</label>
                <select id="ir-modalidad" className="input" aria-label="Modalidad" value={nuevo.modalidad}
                        onChange={(e) => setNuevo((p) => ({ ...p, modalidad: e.target.value }))}
                        style={{ width: "100%" }}>
                  {modalidades.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="ir-region">Región</label>
                <input id="ir-region" className="input" aria-label="Región" placeholder="tórax, abdomen, cráneo…"
                       value={nuevo.region} onChange={(e) => setNuevo((p) => ({ ...p, region: e.target.value }))}
                       style={{ width: "100%" }} />
              </div>
              <div>
                <label className="field-label" htmlFor="ir-indicacion">Indicación clínica</label>
                <input id="ir-indicacion" className="input" aria-label="Indicación" placeholder="por qué se pidió el estudio"
                       value={nuevo.indicacion} onChange={(e) => setNuevo((p) => ({ ...p, indicacion: e.target.value }))}
                       style={{ width: "100%" }} />
              </div>
              <button className="btn primary" onClick={crear} disabled={!nuevo.patient_id}>Crear</button>
            </div>
          </div>

          {informes.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Eyebrow>Informes ({informes.length})</Eyebrow>
              <div className="col g-8" style={{ marginTop: 10, maxHeight: "56vh", overflowY: "auto", paddingRight: 4 }}>
                {informes.map((i) => (
                  <button key={i.id} onClick={() => { setActivo(i); setAviso(null); setErr(null); setVerDictado(false); }}
                          style={listBtnStyle(activo?.id === i.id)}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {paciente(i.patient_id)} · {i.modalidad_label}{i.region ? ` de ${i.region}` : ""}
                    </div>
                    <div className="row g-6 center" style={{ marginTop: 6 }}>
                      <Pill variant={i.status === "firmado" ? "sage" : ""}>{i.status}</Pill>
                      <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)" }}>{i.fecha_estudio}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* INFORME */}
        <aside>
          {!activo ? (
            <div className="card" style={{ color: "var(--ink-2)", fontStyle: "italic", fontSize: 13 }}>
              Crea un informe o selecciona uno de la lista para trabajarlo.
            </div>
          ) : (
            <div className="card">
              <Eyebrow>{paciente(activo.patient_id)} · {activo.fecha_estudio}</Eyebrow>
              <div className="row between center" style={{ marginTop: 6, gap: 12, flexWrap: "wrap" }}>
                <h2 className="h-section" style={{ fontSize: 22 }}>
                  {activo.modalidad_label}{activo.region ? ` de ${activo.region}` : ""}
                </h2>
                {firmado && <Pill variant="sage">firmado</Pill>}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 4 }}>
                {activo.id}{activo.indicacion ? ` · indicación: ${activo.indicacion}` : ""}
              </div>

              <div className="row g-8 center wrap no-print" style={{ marginTop: 14 }}>
                {!firmado && (
                  <button className="btn sm" onClick={alternarDictado} disabled={transcribiendo}
                          aria-label={rec.recording ? "Detener dictado" : "Dictar informe"}>
                    {rec.recording ? "■ Detener" : "● Dictar"}
                  </button>
                )}
                {!firmado && <button className="btn sm" onClick={guardar} disabled={guardando}>Guardar</button>}
                {!firmado && (
                  <button className="btn primary sm" onClick={firmar} disabled={faltan.length > 0}
                          title={faltan.length ? `Faltan: ${faltan.map((f) => f.label).join(", ")}` : "Sellar el informe"}>
                    Firmar
                  </button>
                )}
                <button className="btn ghost sm" onClick={() => window.print()}>Imprimir</button>
              </div>

              {transcribiendo && (
                <div className="no-print" style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 10 }}>
                  Transcribiendo el dictado…
                </div>
              )}
              {aviso && (
                <div className="no-print" style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 10 }}>{aviso}</div>
              )}

              {/* IMÁGENES DEL ESTUDIO */}
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--hair)" }}>
                <div className="row between center" style={{ gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div className="field-label">Imágenes del estudio</div>
                    <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>
                      {imagenes.length ? `${imagenes.length} de ${MAX_IMAGENES}` : "JPG, PNG, WebP o DICOM · hasta 4"}
                      {imagenes.length > 0 && !firmado ? " · su huella se sella al firmar" : ""}
                    </div>
                  </div>
                  {!firmado && (
                    <div className="row g-8 center no-print">
                      <label className="btn sm" style={{ cursor: subiendo || imagenes.length >= MAX_IMAGENES ? "not-allowed" : "pointer",
                                                        opacity: subiendo || imagenes.length >= MAX_IMAGENES ? 0.5 : 1 }}>
                        {subiendo ? "Subiendo…" : "+ Imagen"}
                        <input type="file" accept={ACEPTA} multiple aria-label="Subir imagen del estudio"
                               onChange={subirImagenes} disabled={subiendo || imagenes.length >= MAX_IMAGENES}
                               style={{ display: "none" }} />
                      </label>
                      <button className="btn primary sm" onClick={analizar}
                              disabled={analizando || subiendo || imagenes.length === 0}
                              title={imagenes.length ? "Pedir a MEGI una lectura de las imágenes" : "Sube al menos una imagen"}>
                        {analizando ? "Analizando…" : "Analizar con MEGI"}
                      </button>
                    </div>
                  )}
                </div>
                {imagenes.length > 0 && (
                  <div className="row g-12" style={{ marginTop: 10, flexWrap: "wrap" }}>
                    {imagenes.map((im) => (
                      <Miniatura key={im.id} informeId={activo.id} imagen={im} onBorrar={borrarImagen} puedeBorrar={!firmado} />
                    ))}
                  </div>
                )}
                {analizando && (
                  <div className="no-print" style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 10 }}>
                    MEGI está mirando {imagenes.length === 1 ? "la imagen" : `las ${imagenes.length} imágenes`}… suele tardar de 15 a 40 s.
                  </div>
                )}
              </div>

              {/* ANÁLISIS ASISTIDO (aparte del informe) */}
              {activo.analisis_ia?.lectura && (
                <div className="no-print" role="region" aria-label="Análisis asistido"
                     style={{ marginTop: 14, padding: "12px 14px", borderRadius: "var(--radius)",
                              border: "1px dashed var(--gold)", background: "var(--cream-2)" }}>
                  <div className="row between center" style={{ gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div className="row g-6 center">
                        <span className="field-label" style={{ margin: 0 }}>Análisis asistido</span>
                        <Pill variant="gold">no es un diagnóstico</Pill>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.5 }}>
                        Lectura propuesta por un modelo general, no validado para imagen médica. Es un
                        borrador para que lo revises: no forma parte del informe hasta que lo copies,
                        lo corrijas y lo firmes.
                      </div>
                    </div>
                    {!firmado && (
                      <button className="btn sm" onClick={usarComoBorrador}>Usar como borrador</button>
                    )}
                  </div>
                  <div className="col g-8" style={{ marginTop: 10 }}>
                    {LECTURA.filter((s) => (activo.analisis_ia.lectura[s.k] || "").trim()).map((s) => (
                      <div key={s.k}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: 0.4 }}>{s.label}</div>
                        <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", marginTop: 2 }}>
                          {activo.analisis_ia.lectura[s.k]}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)", marginTop: 8 }}>
                    {activo.analisis_ia.n_imagenes} imagen(es) · {activo.analisis_ia.at?.slice(0, 16).replace("T", " ")}
                    {activo.analisis_ia.model ? ` · ${String(activo.analisis_ia.model).split("/").pop()}` : ""}
                  </div>
                </div>
              )}

              <div className="col g-14" style={{ marginTop: 16 }}>
                {SECCIONES.map((s) => (
                  <div key={s.k}>
                    <label className="field-label" htmlFor={`ir-${s.k}`}>
                      {s.label}{s.req && !firmado ? " *" : ""}
                    </label>
                    {firmado ? (
                      <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", marginTop: 4,
                                    color: activo[s.k] ? "var(--ink)" : "var(--ink-2)" }}>
                        {activo[s.k] || "—"}
                      </div>
                    ) : (
                      <textarea id={`ir-${s.k}`} className="textarea" aria-label={s.label} rows={s.filas}
                                value={activo[s.k] || ""} onChange={cambiar(s.k)} style={{ marginTop: 4 }} />
                    )}
                  </div>
                ))}
              </div>

              {firmado && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--hair)" }}>
                  <div className="field-label">Firma</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 4 }}>
                    {activo.created_by} · {activo.signed_at}
                  </div>
                  <div className="mono" style={{ fontSize: 9.5, color: "var(--gold)", marginTop: 4, wordBreak: "break-all" }}>
                    {activo.content_hash}
                  </div>
                </div>
              )}

              {activo.transcript && (
                <div className="no-print" style={{ marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--hair)" }}>
                  <button className="btn ghost sm" onClick={() => setVerDictado((v) => !v)}>
                    {verDictado ? "Ocultar" : "Ver"} dictado original
                  </button>
                  {verDictado && (
                    <div style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 10, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>
                      {activo.transcript}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default Radiologia;
