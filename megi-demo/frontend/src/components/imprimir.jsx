import React from "react";
import { Pill } from "./shared";
import { api } from "../api/client";

// ============ IMPRESIÓN NOM-004 + RECETA (v0.0.1) ============
// Imprime la nota REAL de la consulta: SOAP final + hechos clínicos
// (api.getSoap) y los Dx/receta capturados por el médico en revisión
// (reviewData). El contenido enlatado de demo (SOAP/Dx/Rx/vitales fijos y la
// hoja de resumen con prosa hardcodeada) se eliminó. El sello (hash SHA-256) lo
// calcula el backend sobre la nota real (GET /export/consultation/:id).

const EMPTY_SOAP = { S: "", O: "", A: "", P: "" };

const Imprimir = ({ patient, doctor, consultationId, reviewData, onBack }) => {
  const [soap, setSoap] = React.useState(reviewData?.soap || EMPTY_SOAP);
  const [facts, setFacts] = React.useState(null);
  const [exportInfo, setExportInfo] = React.useState(null);
  const [tab, setTab] = React.useState("nota");
  // Fase 11: solo se OFRECEN los documentos que la consulta amerita (lo dicho
  // en consulta -> incapacidad/envío/estudios); el resto queda tras "+ otros".
  const [sugs, setSugs] = React.useState(null);
  const [savedKinds, setSavedKinds] = React.useState(new Set());
  const [showAll, setShowAll] = React.useState(false);

  const today = new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
  const time = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

  const dx = reviewData?.selected_dx || [];
  const rx = reviewData?.rx_list || [];
  const curp = reviewData?.curp || patient.curp;
  const nss = reviewData?.nss || patient.nss;
  const allergies = reviewData?.allergies ?? patient.allergies;

  // ---- Compartir / enviar al paciente (deep-links + export FHIR) ----
  const shareText =
    `Hola ${patient.short || patient.name}, esta es la información de tu consulta del ${today}.\n` +
    (dx.length ? `Diagnóstico: ${dx.map((d) => [d.code, d.label].filter(Boolean).join(" ")).join("; ")}\n` : "") +
    (soap.P ? `Indicaciones: ${soap.P}\n` : "") +
    `Atte. ${doctor?.name || "su médico"}. (La nota/receta completa va impresa o en PDF.)`;
  const mailHref = patient.email
    ? `mailto:${patient.email}?subject=${encodeURIComponent("Tu consulta médica")}&body=${encodeURIComponent(shareText)}`
    : null;
  const waDigits = (patient.phone || "").replace(/\D/g, "");
  const waPhone = waDigits.length === 10 ? `52${waDigits}` : waDigits;
  const waHref = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(shareText)}` : null;
  const downloadFhir = async () => {
    try {
      const fhir = await api.getFhir(consultationId);
      const blob = new Blob([JSON.stringify(fhir, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${consultationId}-fhir.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.warn("[megi] export fhir", e); }
  };

  React.useEffect(() => {
    let alive = true;
    if (!consultationId) return;
    (async () => {
      try {
        const r = await api.getSoap(consultationId);
        if (alive) {
          setSoap(reviewData?.soap || r.final_soap || r.soap || EMPTY_SOAP);
          setFacts(r.clinical_facts || null);
        }
      } catch (e) { console.warn("[megi] getSoap impresión", e); }
      try {
        const exp = await api.exportConsultation(consultationId);
        if (alive) setExportInfo(exp);
      } catch (e) { console.warn("[megi] export no disponible", e); }
      try {
        const s = await api.getDocumentSuggestions(consultationId);
        if (alive) setSugs(s);
      } catch (e) { if (alive) setSugs({}); console.warn("[megi] sugerencias de documentos", e); }
      try {
        const docs = await api.getConsultationDocuments(consultationId);
        if (alive) setSavedKinds(new Set((docs || []).map((d) => d.kind)));
      } catch (e) { /* sin documentos previos */ }
    })();
    return () => { alive = false; };
  }, [consultationId]);

  // Pestañas: nota y resumen siempre; receta solo con medicamentos; el resto
  // solo si la consulta lo amerita o ya hay un documento sellado de ese tipo.
  const applies = {
    nota: true,
    resumen: true,
    receta: rx.length > 0,
    referencia: !!sugs?.referencia?.aplica || savedKinds.has("referencia"),
    orden: !!sugs?.orden_estudios?.aplica || savedKinds.has("orden_estudios"),
    incapacidad: !!sugs?.incapacidad?.aplica || savedKinds.has("incapacidad"),
  };
  const ALL_TABS = [
    { id: "nota", label: "Nota médica NOM-004" },
    { id: "receta", label: "Receta" },
    { id: "referencia", label: "Referencia" },
    { id: "orden", label: "Orden de estudios" },
    { id: "incapacidad", label: "Incapacidad" },
    { id: "resumen", label: "Resumen paciente" },
  ];
  const visibleTabs = ALL_TABS.filter((t) => showAll || applies[t.id]);
  const hiddenCount = ALL_TABS.length - visibleTabs.length;
  React.useEffect(() => {
    // Si la pestaña activa dejó de ofrecerse (p. ej. al cargar sugerencias), vuelve a la nota.
    if (!showAll && !applies[tab]) setTab("nota");
  }, [sugs, showAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const hashShort = exportInfo?.content_hash
    ? exportInfo.content_hash.replace("sha256:", "").slice(0, 12)
    : "········";

  return (
    <div className="page" style={{ paddingTop: 20 }}>
      <div className="no-print" style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div className="row center g-12" style={{ marginBottom: 10 }}>
            <button className="btn ghost sm" onClick={onBack}>← REVISIÓN</button>
            <Pill>firma: mock · no legal</Pill>
            <Pill>hash {hashShort}</Pill>
          </div>
          <h1 className="h-page" style={{ fontSize: 36 }}>Listo para <em style={{ color: "var(--gold)" }}>imprimir</em></h1>
        </div>
        <div className="row g-8 wrap" style={{ justifyContent: "flex-end" }}>
          <a className="btn" href={mailHref || undefined} target="_blank" rel="noopener noreferrer"
            style={mailHref ? undefined : { opacity: 0.45, pointerEvents: "none" }}
            title={mailHref ? "Enviar resumen por correo" : "El paciente no tiene correo"}>✉ CORREO</a>
          <a className="btn" href={waHref || undefined} target="_blank" rel="noopener noreferrer"
            style={waHref ? undefined : { opacity: 0.45, pointerEvents: "none" }}
            title={waHref ? "Enviar resumen por WhatsApp" : "El paciente no tiene teléfono"}>WHATSAPP</a>
          <button className="btn" onClick={downloadFhir} title="Descargar export estructurado FHIR (interoperabilidad)">⤓ FHIR</button>
          <button className="btn primary lg" onClick={() => window.print()}>⎙ IMPRIMIR / PDF</button>
        </div>
      </div>

      <div className="no-print" style={{ display: "flex", gap: 0, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        {visibleTabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="mono"
            style={{
              background: tab === t.id ? "var(--forest)" : "transparent",
              color: tab === t.id ? "var(--cream)" : "var(--ink-2)",
              border: "1px solid " + (tab === t.id ? "var(--forest)" : "var(--hair)"),
              padding: "10px 18px", fontSize: 10, letterSpacing: "0.18em",
              textTransform: "uppercase", cursor: "pointer", marginRight: -1,
              opacity: applies[t.id] ? 1 : 0.55,
            }}
            title={applies[t.id]
              ? (["referencia", "orden", "incapacidad"].includes(t.id) && !savedKinds.has(t.id === "orden" ? "orden_estudios" : t.id)
                ? "Sugerido: la consulta lo menciona" : undefined)
              : "La consulta no lo menciona; disponible por si lo necesitas"}>
            {["referencia", "orden", "incapacidad"].includes(t.id) && applies[t.id] && sugs ? "● " : ""}{t.label}
          </button>
        ))}
        {hiddenCount > 0 && !showAll && (
          <button className="mono" onClick={() => setShowAll(true)}
            style={{ background: "transparent", color: "var(--ink-2)", border: "1px dashed var(--hair)",
              padding: "10px 14px", fontSize: 10, letterSpacing: "0.14em", cursor: "pointer" }}
            title="Documentos que la consulta no mencionó (puedes crearlos manualmente)">
            + {hiddenCount} MÁS
          </button>
        )}
        {showAll && (
          <button className="mono" onClick={() => setShowAll(false)}
            style={{ background: "transparent", color: "var(--ink-2)", border: "1px dashed var(--hair)",
              padding: "10px 14px", fontSize: 10, letterSpacing: "0.14em", cursor: "pointer" }}>
            − SOLO LOS DE LA CONSULTA
          </button>
        )}
      </div>

      {/* Sheet preview */}
      <div style={{
        background: "white", color: "#1a1a1a", margin: "0 auto", maxWidth: 820,
        padding: "48px 56px", boxShadow: "0 2px 28px rgba(0,0,0,0.08)",
        fontFamily: "var(--font-ui)", fontSize: 12, lineHeight: 1.55,
      }}>
        {tab === "nota" && <NotaSheet patient={patient} doctor={doctor} today={today} time={time} soap={soap} dx={dx} curp={curp} nss={nss} allergies={allergies} folio={consultationId} exportInfo={exportInfo} />}
        {tab === "receta" && <RecetaSheet patient={patient} doctor={doctor} today={today} rx={rx} />}
        {tab === "referencia" && <ReferenciaSheet key={sugs ? "ref-s" : "ref"} patient={patient} doctor={doctor} today={today} consultationId={consultationId} soap={soap} dx={dx} sug={sugs?.referencia} />}
        {tab === "orden" && <OrdenSheet key={sugs ? "ord-s" : "ord"} patient={patient} doctor={doctor} today={today} consultationId={consultationId} soap={soap} dx={dx} sug={sugs?.orden_estudios} />}
        {tab === "incapacidad" && <IncapacidadSheet key={sugs ? "inc-s" : "inc"} patient={patient} doctor={doctor} today={today} consultationId={consultationId} dx={dx} sug={sugs?.incapacidad} />}
        {tab === "resumen" && <ResumenSheet patient={patient} doctor={doctor} today={today} soap={soap} facts={facts} />}
      </div>
    </div>
  );
};

const SheetHeader = ({ doctor, title }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "flex-start", paddingBottom: 14, borderBottom: "2px solid #1a1a1a", marginBottom: 18 }}>
    <div>
      <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22, fontWeight: 500, lineHeight: 1 }}>{doctor.name}</div>
      <div style={{ fontSize: 10.5, color: "#555", marginTop: 4, lineHeight: 1.45 }}>
        {doctor.specialty}<br/>
        Céd. Prof. <strong>{doctor.cedula}</strong> · Céd. Esp. <strong>{doctor.cedula_esp}</strong>
      </div>
    </div>
    <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", textAlign: "center", color: "#8b7355", paddingTop: 6 }}>{title}</div>
    <div style={{ textAlign: "right", fontSize: 10.5, color: "#555", lineHeight: 1.45 }}>
      {doctor.institution}<br/>{doctor.address}<br/>Tel. {doctor.phone}
    </div>
  </div>
);

const Row = ({ label, value, cols = 1 }) => (
  <div style={{ gridColumn: `span ${cols}` }}>
    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", color: "#888" }}>{label}</div>
    <div style={{ fontSize: 11.5, marginTop: 2, borderBottom: "1px solid #ddd", paddingBottom: 3 }}>{value || " "}</div>
  </div>
);

const Section = ({ title, children, style }) => (
  <div style={{ marginTop: 14, ...style }}>
    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 9, letterSpacing: "0.24em", textTransform: "uppercase", color: "#2d3b2d", borderBottom: "1px solid #2d3b2d", paddingBottom: 3, marginBottom: 8 }}>{title}</div>
    {children}
  </div>
);

const NotaSheet = ({ patient, doctor, today, time, soap, dx, curp, nss, allergies, folio, exportInfo }) => (
  <>
    <SheetHeader doctor={doctor} title="Nota Médica · NOM-004-SSA3-2012" />

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px 20px", marginBottom: 14 }}>
      <Row label="Fecha" value={today} />
      <Row label="Hora" value={time} />
      <Row label="Folio" value={folio || "—"} />
      <Row label="Tipo de nota" value="Consulta externa" />
    </div>

    <Section title="Datos del paciente">
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "8px 20px" }}>
        <Row label="Nombre completo" value={patient.name} />
        <Row label="Edad / sexo" value={`${patient.age} años · ${patient.sex === "F" ? "Femenino" : "Masculino"}`} />
        <Row label="Expediente" value={patient.id} />
        <Row label="CURP" value={<span style={{ fontFamily: "JetBrains Mono" }}>{curp}</span>} />
        <Row label="NSS" value={<span style={{ fontFamily: "JetBrains Mono" }}>{nss}</span>} />
        <Row label="Alergias" value={(allergies || []).join(", ") || "Negadas"} />
      </div>
    </Section>

    <Section title="Motivo de la consulta">
      <div style={{ fontSize: 12 }}>{patient.reason}</div>
    </Section>

    <Section title="Interrogatorio (Subjetivo)">
      <div style={{ fontSize: 11.5, textAlign: "justify", whiteSpace: "pre-wrap" }}>{soap.S || "—"}</div>
    </Section>

    <Section title="Exploración física (Objetivo)">
      <div style={{ fontSize: 11.5, textAlign: "justify", whiteSpace: "pre-wrap" }}>{soap.O || "—"}</div>
    </Section>

    {dx.length > 0 && (
      <Section title="Diagnósticos · CIE-10">
        {dx.map((d, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 1fr auto", gap: 10, padding: "6px 0", borderBottom: "1px dashed #ddd", fontSize: 11.5 }}>
            <span style={{ fontFamily: "JetBrains Mono", fontWeight: 600 }}>{d.code || "—"}</span>
            <span>{d.label || "—"}</span>
            <span style={{ fontFamily: "JetBrains Mono", fontSize: 9, color: "#8b7355" }}>{d.primary ? "Primario" : "Asociado"}</span>
          </div>
        ))}
      </Section>
    )}

    <Section title="Análisis clínico">
      <div style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>{soap.A || "—"}</div>
    </Section>

    <Section title="Plan terapéutico">
      <div style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>{soap.P || "—"}</div>
    </Section>

    <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
      <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 6 }}>
        <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 15 }}>{doctor.name}</div>
        <div style={{ fontSize: 10, color: "#555" }}>Céd. Prof. {doctor.cedula} · {doctor.specialty}</div>
      </div>
      <div style={{ border: "1px dashed #888", padding: 10, textAlign: "center", fontFamily: "JetBrains Mono, monospace", fontSize: 8.5, color: "#555", lineHeight: 1.5 }}>
        <div style={{ letterSpacing: "0.2em", textTransform: "uppercase" }}>Sello de contenido · MEGI</div>
        <div>{exportInfo ? "SHA-256 · " + exportInfo.content_hash.replace("sha256:", "").slice(0, 24) + "…" : "SHA-256 · calculando…"}</div>
        <div>Firma: {exportInfo?.signature_status || "mock_not_legal_signature"} (no legal)</div>
      </div>
    </div>
  </>
);

const RecetaSheet = ({ patient, doctor, today, rx }) => (
  <>
    <SheetHeader doctor={doctor} title="Receta Médica" />

    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "10px 20px", marginBottom: 16 }}>
      <Row label="Paciente" value={patient.name} />
      <Row label="Edad" value={`${patient.age} años`} />
      <Row label="Fecha" value={today} />
    </div>

    <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 56, color: "#8b7355", lineHeight: 0.9, marginBottom: 4 }}>℞</div>

    <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 14 }}>
      {rx.length === 0 && (
        <div style={{ fontSize: 12, color: "#777", fontStyle: "italic", padding: "10px 0" }}>Sin medicamentos prescritos.</div>
      )}
      {rx.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "30px 1fr", gap: 12, padding: "14px 0", borderBottom: "1px dashed #ddd" }}>
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 16, color: "#8b7355" }}>{i + 1}.</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{r.drug} <span style={{ color: "#2d3b2d" }}>{r.dose}</span></div>
            <div style={{ fontSize: 11.5, marginTop: 3 }}>{[r.freq, r.route, r.duration].filter(Boolean).join(" · ") || " "}</div>
            {r.indication && <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 8.5, color: "#8b7355", marginTop: 5, letterSpacing: "0.05em" }}>↳ {r.indication}</div>}
          </div>
        </div>
      ))}
    </div>

    <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
      <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 6 }}>
        <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 15 }}>{doctor.name}</div>
        <div style={{ fontSize: 10, color: "#555" }}>Céd. Prof. {doctor.cedula}</div>
      </div>
    </div>
  </>
);

const ResumenSheet = ({ patient, doctor, today, soap, facts }) => {
  const alarmas = facts?.datos_alarma_condicionales || [];
  const firstName = (patient.short || patient.name || "").split(" ").slice(0, 2).join(" ");
  return (
    <>
      <SheetHeader doctor={doctor} title="Resumen para el paciente" />

      <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 24, fontWeight: 500, marginBottom: 4 }}>
        Hola, {firstName}
      </div>
      <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>
        Esta es la información más importante de tu consulta de hoy.
      </div>

      <Section title="Indicaciones (plan)">
        <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>{soap.P || "Sin indicaciones registradas."}</div>
      </Section>

      {alarmas.length > 0 && (
        <Section title="Señales de alarma · acude a urgencias">
          <ul style={{ fontSize: 12, lineHeight: 1.6, paddingLeft: 20, margin: 0 }}>
            {alarmas.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </Section>
      )}
    </>
  );
};

// Campo editable estilo documento (línea con etiqueta), imprimible.
const DocField = ({ label, value, onChange, area, placeholder }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", color: "#888", marginBottom: 3 }}>{label}</div>
    {area ? (
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", minHeight: 56, fontFamily: "var(--font-ui)", fontSize: 12, lineHeight: 1.5, border: "1px solid #ddd", borderRadius: 6, padding: "8px 10px", resize: "vertical", color: "#1a1a1a" }} />
    ) : (
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", fontFamily: "var(--font-ui)", fontSize: 12.5, border: 0, borderBottom: "1px solid #ccc", padding: "5px 2px", color: "#1a1a1a", outline: "none" }} />
    )}
  </div>
);

const ReferenciaSheet = ({ patient, doctor, today, consultationId, soap, dx, sug }) => {
  const [form, setForm] = React.useState({
    dirigido_a: "",
    servicio: sug?.servicio || "",
    motivo: sug?.motivo || patient.reason || "",
    dx: (dx || []).map((d) => [d.code, d.label].filter(Boolean).join(" ")).join("; "),
    resumen: soap.A || "",
    hallazgos: soap.O || "",
  });
  const [saved, setSaved] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (busy || !consultationId) { if (!consultationId) setErr("Sin consulta asociada."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.createDocument({
        consultation_id: consultationId, patient_id: patient.id, kind: "referencia",
        content: { ...form, paciente: patient.name, curp: patient.curp, nss: patient.nss, fecha: today },
      });
      setSaved(r);
    } catch (e) { setErr("No se pudo guardar."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <SheetHeader doctor={doctor} title="Referencia / Interconsulta" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: 10 }}>
        <DocField label="Dirigido a (médico / unidad)" value={form.dirigido_a} onChange={(v) => set("dirigido_a", v)} placeholder="Dr(a). / Hospital…" />
        <DocField label="Servicio / especialidad" value={form.servicio} onChange={(v) => set("servicio", v)} placeholder="Cardiología, 2º nivel…" />
      </div>

      <Section title="Datos del paciente">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "8px 20px" }}>
          <Row label="Nombre" value={patient.name} />
          <Row label="Edad / sexo" value={`${patient.age} años · ${patient.sex === "F" ? "F" : "M"}`} />
          <Row label="Fecha" value={today} />
          <Row label="CURP" value={<span style={{ fontFamily: "JetBrains Mono" }}>{patient.curp}</span>} />
        </div>
      </Section>

      <Section title="Motivo del envío">
        <DocField label="Motivo" value={form.motivo} onChange={(v) => set("motivo", v)} />
      </Section>
      <Section title="Diagnóstico(s)">
        <DocField label="Dx (CIE-10)" value={form.dx} onChange={(v) => set("dx", v)} placeholder="Código y descripción" />
      </Section>
      <Section title="Resumen clínico">
        <DocField label="Resumen / análisis" value={form.resumen} onChange={(v) => set("resumen", v)} area />
      </Section>
      <Section title="Hallazgos relevantes">
        <DocField label="Exploración / estudios" value={form.hallazgos} onChange={(v) => set("hallazgos", v)} area />
      </Section>

      <div style={{ marginTop: 28, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
        <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 6 }}>
          <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 15 }}>{doctor.name}</div>
          <div style={{ fontSize: 10, color: "#555" }}>Céd. Prof. {doctor.cedula} · {doctor.specialty}</div>
        </div>
        <div style={{ border: "1px dashed #888", padding: 10, textAlign: "center", fontFamily: "JetBrains Mono, monospace", fontSize: 8.5, color: "#555", lineHeight: 1.5 }}>
          <div style={{ letterSpacing: "0.2em", textTransform: "uppercase" }}>Sello de contenido · MEGI</div>
          <div>{saved ? "SHA-256 · " + saved.content_hash.replace("sha256:", "").slice(0, 24) + "…" : "Sin sellar"}</div>
          <div>{saved ? `Generó: ${saved.created_by}` : "no legal"}</div>
        </div>
      </div>

      <div className="no-print" style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn primary" onClick={save} disabled={busy || !!saved}>
          {busy ? "GUARDANDO…" : saved ? "✓ SELLADA" : "GUARDAR Y SELLAR"}
        </button>
        {err && <span style={{ color: "var(--danger)", fontSize: 12 }}>{err}</span>}
        {saved && <span style={{ fontSize: 12, color: "var(--ink-2)" }}>Queda en el expediente y en la auditoría.</span>}
      </div>
    </>
  );
};

// Guardado/sellado compartido para documentos clínicos.
const useDocSeal = (consultationId, patient, today) => {
  const [saved, setSaved] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const save = async (kind, content) => {
    if (busy || saved) return;
    if (!consultationId) { setErr("Sin consulta asociada."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.createDocument({
        consultation_id: consultationId, patient_id: patient.id, kind,
        content: { ...content, paciente: patient.name, curp: patient.curp, nss: patient.nss, fecha: today },
      });
      setSaved(r);
    } catch (e) { setErr("No se pudo guardar."); }
    finally { setBusy(false); }
  };
  return { save, saved, busy, err };
};

const DocSeal = ({ doctor, saved }) => (
  <div style={{ marginTop: 28, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
    <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 6 }}>
      <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 15 }}>{doctor.name}</div>
      <div style={{ fontSize: 10, color: "#555" }}>Céd. Prof. {doctor.cedula} · {doctor.specialty}</div>
    </div>
    <div style={{ border: "1px dashed #888", padding: 10, textAlign: "center", fontFamily: "JetBrains Mono, monospace", fontSize: 8.5, color: "#555", lineHeight: 1.5 }}>
      <div style={{ letterSpacing: "0.2em", textTransform: "uppercase" }}>Sello de contenido · MEGI</div>
      <div>{saved ? "SHA-256 · " + saved.content_hash.replace("sha256:", "").slice(0, 24) + "…" : "Sin sellar"}</div>
      <div>{saved ? `Generó: ${saved.created_by}` : "no legal"}</div>
    </div>
  </div>
);

const DocSaveBar = ({ onSave, saved, busy, err }) => (
  <div className="no-print" style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
    <button className="btn primary" onClick={onSave} disabled={busy || !!saved}>
      {busy ? "GUARDANDO…" : saved ? "✓ SELLADO" : "GUARDAR Y SELLAR"}
    </button>
    {err && <span style={{ color: "var(--danger)", fontSize: 12 }}>{err}</span>}
    {saved && <span style={{ fontSize: 12, color: "var(--ink-2)" }}>Queda en el expediente y en la auditoría.</span>}
  </div>
);

const dxLine = (dx) => (dx || []).map((d) => [d.code, d.label].filter(Boolean).join(" ")).join("; ");

const OrdenSheet = ({ patient, doctor, today, consultationId, soap, dx, sug }) => {
  const [form, setForm] = React.useState({
    tipo: sug?.tipo || "Laboratorio", estudios: sug?.estudios || "", dx: dxLine(dx),
    justificacion: sug?.justificacion || soap.A || "", notas: "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const { save, saved, busy, err } = useDocSeal(consultationId, patient, today);
  return (
    <>
      <SheetHeader doctor={doctor} title="Solicitud de estudios" />
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "8px 20px", marginBottom: 10 }}>
        <Row label="Paciente" value={patient.name} />
        <Row label="Edad / sexo" value={`${patient.age} años · ${patient.sex === "F" ? "F" : "M"}`} />
        <Row label="Fecha" value={today} />
      </div>
      <Section title="Tipo de estudio"><DocField label="Tipo" value={form.tipo} onChange={(v) => set("tipo", v)} placeholder="Laboratorio / Imagen / Gabinete" /></Section>
      <Section title="Estudios solicitados"><DocField label="Estudios" value={form.estudios} onChange={(v) => set("estudios", v)} area placeholder="BH, química sanguínea, ECG, Rx de tórax…" /></Section>
      <Section title="Diagnóstico / justificación">
        <DocField label="Dx (CIE-10)" value={form.dx} onChange={(v) => set("dx", v)} />
        <DocField label="Justificación clínica" value={form.justificacion} onChange={(v) => set("justificacion", v)} area />
      </Section>
      <Section title="Indicaciones / preparación"><DocField label="Notas" value={form.notas} onChange={(v) => set("notas", v)} area placeholder="Ayuno 8 h, suspender medicamentos, etc." /></Section>
      <DocSeal doctor={doctor} saved={saved} />
      <DocSaveBar onSave={() => save("orden_estudios", form)} saved={saved} busy={busy} err={err} />
    </>
  );
};

const IncapacidadSheet = ({ patient, doctor, today, consultationId, dx, sug }) => {
  const [form, setForm] = React.useState({
    tipo: "Incapacidad temporal", ramo: sug?.ramo || "Enfermedad general", dx: dxLine(dx),
    dias: sug?.dias || "", desde: today, observaciones: sug?.observaciones || "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const { save, saved, busy, err } = useDocSeal(consultationId, patient, today);
  return (
    <>
      <SheetHeader doctor={doctor} title="Incapacidad / Certificado médico" />
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "8px 20px", marginBottom: 10 }}>
        <Row label="Paciente" value={patient.name} />
        <Row label="Edad / sexo" value={`${patient.age} años · ${patient.sex === "F" ? "F" : "M"}`} />
        <Row label="CURP" value={<span style={{ fontFamily: "JetBrains Mono" }}>{patient.curp}</span>} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
        <DocField label="Tipo de documento" value={form.tipo} onChange={(v) => set("tipo", v)} placeholder="Incapacidad temporal / Certificado médico" />
        <DocField label="Ramo / motivo" value={form.ramo} onChange={(v) => set("ramo", v)} placeholder="Enfermedad general / Riesgo de trabajo / Maternidad" />
      </div>
      <Section title="Diagnóstico"><DocField label="Dx (CIE-10)" value={form.dx} onChange={(v) => set("dx", v)} /></Section>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
        <DocField label="Días de incapacidad" value={form.dias} onChange={(v) => set("dias", v)} placeholder="p. ej. 3" />
        <DocField label="A partir de" value={form.desde} onChange={(v) => set("desde", v)} />
      </div>
      <Section title="Observaciones"><DocField label="Observaciones" value={form.observaciones} onChange={(v) => set("observaciones", v)} area /></Section>
      <DocSeal doctor={doctor} saved={saved} />
      <DocSaveBar onSave={() => save("incapacidad", form)} saved={saved} busy={busy} err={err} />
    </>
  );
};

export default Imprimir;
