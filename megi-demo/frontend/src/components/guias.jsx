import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";

// ============ GUÍAS CLÍNICAS · BIBLIOTECA NAVEGABLE (v0.0.1) ============
// Lee el índice RAG desde el backend (sin tocar el modelo MLX). Navega/lee/busca
// por texto en las guías GPC ya indexadas.
//
// Dos vistas del lector (22-sep): «Texto» (los fragmentos indexados, como
// siempre) y «Documento original» (el PDF tal cual, con sus tablas, algoritmos
// e imágenes: el médico sabe dónde mirar). «pág. N» en un fragmento o en un
// resultado de búsqueda abre el PDF en esa página. Si el servidor no tiene el
// PDF, la vista no se ofrece y todo sigue como antes.
const Guias = () => {
  const [docs, setDocs] = React.useState(null);
  const [total, setTotal] = React.useState(0);
  const [filter, setFilter] = React.useState("");
  const [selected, setSelected] = React.useState(null);   // doc_id
  const [reader, setReader] = React.useState(null);        // {doc, chunks}
  const [loadingReader, setLoadingReader] = React.useState(false);
  const [matches, setMatches] = React.useState(null);      // resultados de búsqueda en contenido
  const [searching, setSearching] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [mode, setMode] = React.useState("biblioteca");   // biblioteca | chat
  const [vista, setVista] = React.useState("texto");       // texto | pdf
  const [pdfUrl, setPdfUrl] = React.useState(null);        // object URL del PDF de la guía abierta
  const [pdfErr, setPdfErr] = React.useState(null);
  const [pagina, setPagina] = React.useState(1);

  React.useEffect(() => {
    api.getGuidelines("")
      .then((r) => { setDocs(r.docs); setTotal(r.total); })
      .catch((e) => setErr(e.message));
  }, []);

  const filtered = (docs || []).filter((d) =>
    (d.title || "").toLowerCase().includes(filter.toLowerCase())
  );

  const openDoc = async (docId, { page = 1, enPdf = false } = {}) => {
    const mismo = docId === selected;
    setSelected(docId);
    setMatches(null);
    setPagina(page || 1);
    if (enPdf) setVista("pdf");
    if (mismo && reader) return;                 // mismo doc: solo cambia página/vista
    setLoadingReader(true);
    setReader(null);
    setVista(enPdf ? "pdf" : "texto");
    try { setReader(await api.getGuideline(docId)); }
    catch (e) { setErr(e.message); }
    finally { setLoadingReader(false); }
  };

  // El PDF se baja UNA vez por guía (con sesión) y se libera al cambiar o salir.
  React.useEffect(() => {
    setPdfUrl(null); setPdfErr(null);
    if (!reader?.doc?.pdf_available) return undefined;
    let alive = true, url = null;
    api.guidelinePdfUrl(reader.doc.doc_id)
      .then((u) => { if (alive) { url = u; setPdfUrl(u); } else { URL.revokeObjectURL(u); } })
      .catch((e) => { if (alive) setPdfErr(e.message); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [reader?.doc?.doc_id, reader?.doc?.pdf_available]);

  const searchContent = async () => {
    const q = filter.trim();
    if (!q) { setMatches(null); return; }
    setSearching(true);
    try { const r = await api.searchGuidelines(q); setMatches(r.matches); }
    catch (e) { setErr(e.message); }
    finally { setSearching(false); }
  };

  return (
    <div className="page">
      <div style={{ marginBottom: 20 }}>
        <Eyebrow style={{ fontSize: 12, fontWeight: 600 }}>Referencia clínica</Eyebrow>
        <h1 className="h-page" style={{ marginTop: 8 }}>Guías clínicas</h1>
        <p style={{ marginTop: 8, color: "var(--ink-2)", fontSize: 14 }}>
          {total ? `${total} guías GPC indexadas.` : "Biblioteca de guías GPC."} Navega, busca por tema o pregunta a Megi-LLM.
        </p>
        <div className="seg" style={{ marginTop: 14 }}>
          <button type="button" className={mode === "biblioteca" ? "on" : ""} onClick={() => setMode("biblioteca")}>Biblioteca</button>
          <button type="button" className={mode === "chat" ? "on" : ""} onClick={() => setMode("chat")}>Preguntar a Megi-LLM</button>
        </div>
      </div>

      {err && <div className="card" style={{ borderLeft: "3px solid var(--danger)", marginBottom: 16 }}>
        <Eyebrow>Error</Eyebrow><div style={{ fontSize: 13, marginTop: 6, color: "var(--ink-2)" }}>{err}</div>
      </div>}

      {mode === "chat" && <ChatGuias />}

      {mode === "biblioteca" && (
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 24 }} className="pacientes-grid">
        {/* LISTA */}
        <section>
          <div className="row g-8 center" style={{ marginBottom: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input className="input" placeholder="Filtrar por título o tema…" value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") searchContent(); }}
                style={{ paddingLeft: 32 }} aria-label="Buscar guía" />
              <span style={{ position: "absolute", left: 12, top: 10, color: "var(--ink-2)", fontFamily: "var(--font-mono)", fontSize: 13 }}>⌕</span>
            </div>
            <button className="btn sm" onClick={searchContent} disabled={searching || !filter.trim()} title="Buscar dentro del texto de las guías">
              {searching ? "…" : "EN TEXTO"}
            </button>
          </div>
          {matches && (
            <button className="btn ghost sm" onClick={() => setMatches(null)} style={{ marginBottom: 8 }}>← volver al listado</button>
          )}

          <div className="col g-8" style={{ maxHeight: "70vh", overflowY: "auto", paddingRight: 4 }}>
            {!docs && !err && <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Cargando guías…</div>}

            {/* resultados de búsqueda en contenido */}
            {matches && matches.length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic" }}>Sin coincidencias en el texto.</div>
            )}
            {matches && matches.map((m, i) => (
              <div key={i} style={{ ...listBtnStyle(false), cursor: "default" }}>
                <button onClick={() => openDoc(m.doc_id, { page: m.page_start })}
                        style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{m.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.45 }}>{m.snippet}</div>
                </button>
                <div className="row g-8 center" style={{ marginTop: 5 }}>
                  <span className="mono" style={{ fontSize: 9.5, color: "var(--gold)" }}>{m.citation}</span>
                  {m.page_start && (
                    <button className="btn ghost sm" style={{ padding: "0 6px", fontSize: 10 }}
                            onClick={() => openDoc(m.doc_id, { page: m.page_start, enPdf: true })}
                            aria-label={`Ver pág. ${m.page_start} en el documento original`}>
                      ver en el PDF
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* listado de documentos */}
            {!matches && filtered.map((d) => (
              <button key={d.doc_id} onClick={() => openDoc(d.doc_id)} style={listBtnStyle(selected === d.doc_id)}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{d.title}</div>
                <div className="row g-6 center" style={{ marginTop: 6 }}>
                  <Pill variant="sage">{d.source}</Pill>
                  <Pill>{d.doc_type}</Pill>
                  <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)" }}>{d.chunk_count} fragmentos</span>
                </div>
              </button>
            ))}
            {!matches && docs && filtered.length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic" }}>Sin guías que coincidan.</div>
            )}
          </div>
        </section>

        {/* LECTOR */}
        <aside>
          {!selected ? (
            <div className="card" style={{ color: "var(--ink-2)", fontStyle: "italic", fontSize: 13 }}>
              Selecciona una guía para leerla.
            </div>
          ) : loadingReader ? (
            <div className="card" style={{ fontSize: 13, color: "var(--ink-2)" }}>Cargando guía…</div>
          ) : reader ? (
            <div className="card">
              <Eyebrow>{reader.doc.source} · {reader.doc.doc_type}</Eyebrow>
              <h2 className="h-section" style={{ fontSize: 22, marginTop: 6 }}>{reader.doc.title}</h2>
              <div className="row between center" style={{ marginTop: 6, gap: 10, flexWrap: "wrap" }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)" }}>
                  {reader.chunks.length} fragmentos · págs. {reader.doc.page_start ?? "?"}–{reader.doc.page_end ?? "?"}
                </div>
                <div className="row g-8 center">
                  <div className="seg" role="tablist" aria-label="Vista de la guía">
                    <button type="button" role="tab" aria-selected={vista === "texto"}
                            className={vista === "texto" ? "on" : ""} onClick={() => setVista("texto")}>Texto</button>
                    <button type="button" role="tab" aria-selected={vista === "pdf"}
                            className={vista === "pdf" ? "on" : ""} onClick={() => setVista("pdf")}
                            disabled={!reader.doc.pdf_available}
                            title={reader.doc.pdf_available ? "Ver el PDF tal cual" : "El servidor no tiene el PDF de esta guía"}>
                      Documento original
                    </button>
                  </div>
                  {vista === "pdf" && pdfUrl && (
                    <a className="btn ghost sm" href={`${pdfUrl}#page=${pagina}`} target="_blank" rel="noopener noreferrer"
                       aria-label="Abrir el PDF en una pestaña nueva">↗ pestaña</a>
                  )}
                </div>
              </div>

              {vista === "pdf" ? (
                <div style={{ marginTop: 12 }}>
                  {pdfErr && (
                    <div style={{ fontSize: 12.5, color: "var(--danger)" }}>No se pudo cargar el PDF: {pdfErr}</div>
                  )}
                  {!pdfErr && !pdfUrl && (
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Cargando el documento…</div>
                  )}
                  {pdfUrl && (
                    <iframe key={`${reader.doc.doc_id}-${pagina}`} title={`PDF · ${reader.doc.title}`}
                            src={`${pdfUrl}#page=${pagina}&view=FitH`}
                            style={{ width: "100%", height: "70vh", border: "1px solid var(--hair)",
                                     borderRadius: "var(--radius)", background: "#fff" }} />
                  )}
                  <div style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 6 }}>
                    Documento original tal como lo publica {reader.doc.source}. Si tu navegador no lo muestra
                    embebido, usa «↗ pestaña».
                  </div>
                </div>
              ) : (
                <div className="col g-14" style={{ marginTop: 16, maxHeight: "66vh", overflowY: "auto", paddingRight: 6 }}>
                  {reader.chunks.map((c) => (
                    <div key={c.chunk_id} style={{ paddingBottom: 12, borderBottom: "1px dashed var(--hair)" }}>
                      <div className="row g-8 center" style={{ marginBottom: 4 }}>
                        <span className="mono" style={{ fontSize: 9.5, color: "var(--gold)" }}>
                          pág. {c.page_start ?? "?"}{c.page_end && c.page_end !== c.page_start ? `–${c.page_end}` : ""}
                        </span>
                        {reader.doc.pdf_available && c.page_start && (
                          <button className="btn ghost sm" style={{ padding: "0 6px", fontSize: 10 }}
                                  onClick={() => { setPagina(c.page_start); setVista("pdf"); }}
                                  aria-label={`Ver pág. ${c.page_start} en el documento original`}>
                            ver en el PDF
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </aside>
      </div>
      )}
    </div>
  );
};

// ============ CHAT RAG · PREGUNTAR A MEGI-LLM ============
const ChatGuias = () => {
  const [messages, setMessages] = React.useState([]);   // {role, text, sources?, error?}
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const endRef = React.useRef(null);

  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  const send = async (e) => {
    e?.preventDefault();
    const q = input.trim();
    if (!q || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setSending(true);
    try {
      const r = await api.chatGuidelines({ question: q });
      setMessages((m) => [...m, { role: "assistant", text: r.answer, sources: r.sources, error: r.error }]);
    } catch (e2) {
      setMessages((m) => [...m, { role: "assistant", text: "", error: e2.message }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", height: "70vh" }}>
      <div style={{ flex: 1, overflowY: "auto", paddingRight: 6 }}>
        {messages.length === 0 && (
          <div style={{ color: "var(--ink-2)", fontSize: 13, fontStyle: "italic", padding: "8px 2px" }}>
            Pregunta sobre manejo, diagnóstico o tratamiento. Megi-LLM responde apoyándose en las guías GPC y cita la fuente.
            <div style={{ marginTop: 10, fontStyle: "normal" }}>
              <Eyebrow>Ejemplos</Eyebrow>
              <div className="col g-6" style={{ marginTop: 8 }}>
                {["Manejo inicial de faringoamigdalitis", "Criterios de referencia en hipertensión", "Tratamiento de primera línea para DM2"].map((ex) => (
                  <button key={ex} className="btn ghost sm" style={{ justifyContent: "flex-start" }} onClick={() => setInput(ex)}>{ex}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="col g-14">
          {messages.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
              <div style={{
                fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", padding: "10px 14px",
                borderRadius: "var(--radius)",
                background: m.role === "user" ? "var(--forest)" : "var(--cream-2)",
                color: m.role === "user" ? "#fff" : "var(--ink)",
              }}>
                {m.error ? <span style={{ color: m.role === "user" ? "#fff" : "var(--danger)" }}>⚠ {m.error}</span> : m.text}
              </div>
              {m.sources && m.sources.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <Eyebrow>Fuentes</Eyebrow>
                  <div className="col g-4" style={{ marginTop: 4 }}>
                    {m.sources.map((s) => (
                      <div key={s.citation_id} className="mono" style={{ fontSize: 10, color: "var(--gold)" }}>
                        [{s.citation_id}] {s.citation}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {sending && <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic" }}>Megi-LLM está consultando las guías…</div>}
          <div ref={endRef} />
        </div>
      </div>

      <form onSubmit={send} className="row g-8 center" style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--hair)" }}>
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe tu pregunta clínica…" disabled={sending} aria-label="Pregunta" />
        <button type="submit" className="btn primary" disabled={sending || !input.trim()}>{sending ? "…" : "ENVIAR"}</button>
      </form>
      <div style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 8 }}>
        Apoyo basado en GPC; no sustituye el juicio clínico. Verifica las fuentes citadas.
      </div>
    </div>
  );
};

const listBtnStyle = (active) => ({
  textAlign: "left", cursor: "pointer", width: "100%",
  border: "1px solid " + (active ? "var(--forest)" : "var(--hair)"),
  background: active ? "var(--cream-2)" : "var(--surface)",
  borderRadius: "var(--radius)", padding: "12px 14px",
});

export default Guias;
