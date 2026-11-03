import React from "react";
import { Corners, Eyebrow, Pill } from "./shared";
import { api } from "../api/client";
import ChatMegi from "./chat_megi";
import RehabSugerencia from "./rehab_sugerencia";
import EstudiosStrip from "./estudios_strip";
import AlertasFda from "./alertas_fda";

// ============ REVISIÓN Y VALIDACIÓN (v0.0.1) ============
// Muestra la nota SOAP REAL de la consulta (consolidada por el pipeline:
// api.getSoap(consultationId)) + alertas/hechos clínicos reales. Dx (CIE-10) y
// receta son captura MANUAL del médico: el pipeline aún no emite estructura
// CIE-10/receta (eso es trabajo posterior). El contenido enlatado de demo
// (resumen ejecutivo, Dx/Rx/vitales fijos, referencias GPC fijas) se eliminó.

const SECTIONS = [
  { k: "S", name: "Subjetivo" },
  { k: "O", name: "Objetivo" },
  { k: "A", name: "Análisis" },
  { k: "P", name: "Plan" },
];
const EMPTY_SOAP = { S: "", O: "", A: "", P: "" };
const VITAL_FIELDS = [
  { k: "ta", label: "TA", ph: "120/80 mmHg" }, { k: "fc", label: "FC", ph: "lpm" },
  { k: "fr", label: "FR", ph: "rpm" }, { k: "temp", label: "Temp", ph: "°C" },
  { k: "spo2", label: "SpO₂", ph: "%" }, { k: "peso", label: "Peso", ph: "kg" },
  { k: "talla", label: "Talla", ph: "m" }, { k: "imc", label: "IMC", ph: "" },
];

// Coacciona a string cualquier hecho clínico (el LLM a veces devuelve objetos,
// p. ej. alergias como {alergeno, reaccion}); evita crashear el render.
const toName = (x) => {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (typeof x === "object") return x.alergeno || x.nombre || x.descripcion || x.label || x.text || JSON.stringify(x);
  return String(x);
};

const Revision = ({ patient, consultationId, onApprove, onBack, user }) => {
  const [loading, setLoading] = React.useState(true);
  const [loadErr, setLoadErr] = React.useState(null);
  const [soap, setSoap] = React.useState(EMPTY_SOAP);
  const [validation, setValidation] = React.useState(null);
  const [facts, setFacts] = React.useState(null);
  const [finalized, setFinalized] = React.useState(false);
  const [editing, setEditing] = React.useState(null);

  // Dx (CIE-10) y receta: captura manual (sin datos enlatados).
  const [dxList, setDxList] = React.useState([]);
  const [rxList, setRxList] = React.useState([]);
  const [notes, setNotes] = React.useState("");

  // Confirmación de identidad — manual; la captura por voz vive en la consulta.
  const [curp, setCurp] = React.useState(patient.curp || "");
  const [nss, setNss] = React.useState(patient.nss || "");

  // Perfil médico: alergias/crónicos que se persisten al paciente al aprobar
  // (el visto bueno del médico). Prellenado con lo que ya tenga el paciente.
  const [allergies, setAllergies] = React.useState(patient.allergies || []);
  const [chronic, setChronic] = React.useState(patient.chronic || []);
  const [allergyDraft, setAllergyDraft] = React.useState("");
  const [chronicDraft, setChronicDraft] = React.useState("");
  const addAllergy = () => { const v = allergyDraft.trim(); if (v) { setAllergies((l) => [...new Set([...l, v])]); setAllergyDraft(""); } };
  const addChronic = () => { const v = chronicDraft.trim(); if (v) { setChronic((l) => [...new Set([...l, v])]); setChronicDraft(""); } };

  React.useEffect(() => {
    let alive = true;
    if (!consultationId) { setLoading(false); setLoadErr("Sin consulta asociada."); return; }
    (async () => {
      try {
        const r = await api.getSoap(consultationId);
        if (!alive) return;
        const real = r.final_soap || r.soap || EMPTY_SOAP;
        setSoap({ ...EMPTY_SOAP, ...real });
        setValidation(r.validation || null);
        setFacts(r.clinical_facts || null);
        setFinalized(!!r.final_soap);
      } catch (e) {
        if (alive) setLoadErr(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [consultationId]);

  // Prellenar la RECETA con los medicamentos que el modelo escuchó (si está vacía).
  // El médico la edita; la verificación de seguridad la valida contra alergias.
  React.useEffect(() => {
    if (!facts) return;
    const meds = facts.medicamentos || [];
    setRxList((cur) => {
      if (cur.length > 0 || meds.length === 0) return cur;
      return meds
        .map((m) => (typeof m === "string"
          ? { drug: m, dose: "", freq: "", indication: "", heard: true }
          : { drug: m.nombre || "", dose: m.dosis || "", freq: m.frecuencia || "", indication: m.indicacion || "", heard: true }))
        .filter((r) => r.drug);
    });
  }, [facts]);

  // Sugerencias escuchadas para el perfil médico (coaccionadas a string).
  const heardAllergies = (facts?.alergias || []).map(toName).filter(Boolean);
  const heardChronic = (facts?.antecedentes_cronicos || []).map(toName).filter(Boolean);

  // ---- Signos vitales estructurados (prellenados de lo escuchado) ----
  const [vitals, setVitals] = React.useState({});
  React.useEffect(() => {
    if (!facts) return;
    const sv = Object.fromEntries(Object.entries(facts.signos_vitales || {}).map(([k, v]) => [k, toName(v)]));
    setVitals((cur) => (Object.keys(cur).length ? cur : sv));
  }, [facts]);
  const setVital = (k, v) => setVitals((p) => ({ ...p, [k]: v }));

  // ---- Agendar seguimiento ----
  const plus7 = () => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); };
  const [followDate, setFollowDate] = React.useState(plus7());
  const [followReason, setFollowReason] = React.useState("Control / seguimiento");
  const [followSaved, setFollowSaved] = React.useState(false);
  const [followErr, setFollowErr] = React.useState(null);
  const agendarSeguimiento = async () => {
    if (!consultationId) { setFollowErr("Sin consulta asociada."); return; }
    setFollowErr(null);
    try {
      await api.createAppointment({ patient_id: patient.id, consultation_id: consultationId, scheduled_date: followDate, reason: followReason });
      setFollowSaved(true);
    } catch (e) { setFollowErr("No se pudo agendar."); }
  };

  // ---- Verificación de seguridad: receta × alergias × crónicos ----
  const [safetyAlerts, setSafetyAlerts] = React.useState([]);
  const [safetyAck, setSafetyAck] = React.useState(false);
  const [safetyCheckFailed, setSafetyCheckFailed] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    api.checkRx({ rx_list: rxList, allergies, chronic })
      .then((r) => { if (alive) { setSafetyAlerts(r.alerts || []); setSafetyCheckFailed(false); } })
      .catch(() => { if (alive) { setSafetyAlerts([]); setSafetyCheckFailed(true); } });
    return () => { alive = false; };
  }, [rxList, allergies, chronic]);
  const safetyBlockers = safetyAlerts.filter((a) => a.severity === "blocker");
  React.useEffect(() => { setSafetyAck(false); }, [safetyBlockers.length]);
  // Falla CERRADO: si no se pudo verificar la seguridad, no se permite aprobar.
  const safetyOk = !safetyCheckFailed && (safetyBlockers.length === 0 || safetyAck);

  // ---- Checklist bloqueante (confirmación manual del médico) ----
  const CHECKLIST = [
    { k: "identidad", t: "Identidad del paciente validada (CURP / NSS)" },
    { k: "soap", t: "Nota revisada y corregida" },
    { k: "dx", t: "Diagnósticos capturados" },
    { k: "rx", t: "Receta revisada" },
    { k: "alertas", t: "Alertas y advertencias resueltas o confirmadas" },
  ];
  const [checks, setChecks] = React.useState({});
  const toggleCheck = (k) => setChecks((p) => ({ ...p, [k]: !p[k] }));
  const pendingChecks = CHECKLIST.filter((c) => !checks[c.k]);
  // No se aprueba sin consulta, sin checklist, o con alertas de alergia sin confirmar.
  const canApprove = pendingChecks.length === 0 && !loading && !!consultationId && safetyOk;

  // ---- Dx / Rx manuales ----
  const [dxDraft, setDxDraft] = React.useState({ code: "", label: "" });
  const addDx = () => {
    if (!dxDraft.code.trim() && !dxDraft.label.trim()) return;
    setDxList((l) => [...l, { ...dxDraft, primary: l.length === 0 }]);
    setDxDraft({ code: "", label: "" });
  };
  const removeDx = (i) => setDxList((l) => l.filter((_, j) => j !== i));

  // Buscador CIE-10 (set curado)
  const [cieQuery, setCieQuery] = React.useState("");
  const [cieResults, setCieResults] = React.useState([]);
  React.useEffect(() => {
    const q = cieQuery.trim();
    if (!q) { setCieResults([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.searchCie10(q).then((r) => { if (alive) setCieResults(r.results || []); }).catch(() => {});
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [cieQuery]);
  const addCie = (it) => {
    setDxList((l) => (l.some((d) => d.code === it.code) ? l : [...l, { code: it.code, label: it.label, primary: l.length === 0 }]));
    setCieQuery(""); setCieResults([]);
  };

  // Impresión diagnóstica escuchada por el modelo -> prellenar el CIE-10.
  const heardDx = (facts?.impresion_diagnostica || []).map(toName).filter(Boolean);
  const [addedHeardDx, setAddedHeardDx] = React.useState([]);
  const addHeardDx = async (text) => {
    setAddedHeardDx((s) => (s.includes(text) ? s : [...s, text]));
    let dx = { code: "", label: text };
    try {
      const r = await api.searchCie10(text);
      const top = (r.results || [])[0];
      // Solo auto-asigna el CIE-10 si el match es FUERTE (≥2 términos), para no
      // meter un código equivocado; si es débil, deja el texto y el médico codifica.
      if (top && (top.score || 0) >= 2) dx = { code: top.code, label: top.label };
    } catch (e) { /* si falla, deja el texto */ }
    setDxList((l) => (l.some((d) => (d.code && d.code === dx.code) || (d.label || "").toLowerCase() === (dx.label || "").toLowerCase())
      ? l : [...l, { ...dx, primary: l.length === 0 }]));
  };

  const [rxDraft, setRxDraft] = React.useState({ drug: "", dose: "", freq: "", indication: "" });
  const addRx = () => {
    if (!rxDraft.drug.trim()) return;
    setRxList((l) => [...l, { ...rxDraft }]);
    setRxDraft({ drug: "", dose: "", freq: "", indication: "" });
  };
  const removeRx = (i) => setRxList((l) => l.filter((_, j) => j !== i));

  // ---- Guardar / aprobar ----
  const [savedAt, setSavedAt] = React.useState(null);
  const buildPayload = () => ({
    consultation_id: consultationId,
    soap,
    selected_dx: dxList,
    rx_list: rxList,
    notes,
    curp,
    nss,
  });
  const saveDraft = async () => {
    try {
      const r = await api.reviewSave(buildPayload());
      setSavedAt(r?.saved_at || "ok");
    } catch (e) {
      console.warn("[megi] guardar borrador", e);
    }
  };
  const [approveErr, setApproveErr] = React.useState(null);
  const approveAndPrint = async () => {
    if (!canApprove) return;
    setApproveErr(null);
    // La aprobación es el paso crítico: si falla, NO se imprime/sella.
    try {
      await api.reviewApprove({
        consultation_id: consultationId,
        actor: user?.username,
        soap, selected_dx: dxList, rx_list: rxList, notes,
        safety_alerts: safetyAlerts, safety_ack: safetyBlockers.length > 0 ? safetyAck : null,
        vitals, allergies, chronic,
      });
    } catch (e) {
      setApproveErr(e.message || "No se pudo aprobar; no se imprimirá.");
      return;
    }
    // Perfil: best-effort tras aprobar (no bloquea la nota ya aprobada).
    try { await api.updatePatientProfile(patient.id, { allergies, chronic }); }
    catch (e) { console.warn("[megi] actualizar perfil", e); }
    onApprove({ ...buildPayload(), allergies, chronic });
  };

  // ---- alertas reales ----
  const flags = validation?.flags || [];
  const warnings = validation?.warnings || [];
  const alerts = [
    ...flags.map((f) => ({ severity: f.severity || "warn", text: f.message || String(f) })),
    ...warnings.map((w) => ({ severity: "warn", text: typeof w === "string" ? w : w.message })),
  ];

  return (
    <div className="page" style={{ paddingTop: 20 }}>
      {/* HEADER */}
      <div className="page-head" style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "end",
        gap: 24,
        marginBottom: 26,
      }}>
        <div style={{ minWidth: 0 }}>
          <div className="row center g-12 wrap" style={{ marginBottom: 10 }}>
            <button className="btn ghost sm" onClick={onBack} aria-label="Volver a la consulta">← VOLVER</button>
            <Pill variant={finalized ? "accent" : "gold"}>
              {loading ? "cargando nota…" : finalized ? "nota consolidada" : "borrador (sin finalizar)"}
            </Pill>
            {validation?.status && <Pill>{validation.status}</Pill>}
          </div>
          <h1 className="h-page" style={{ fontSize: 34, textWrap: "balance" }}>
            Revisa y valida <em style={{ color: "var(--gold)" }}>antes de imprimir</em>
          </h1>
          <p style={{ color: "var(--ink-2)", fontSize: 14, marginTop: 8 }}>
            {patient.name} · {patient.age} años · {patient.reason}
          </p>
        </div>
        <div className="row g-10" style={{ flexShrink: 0 }}>
          <button className="btn" onClick={saveDraft} aria-label="Guardar borrador">
            {savedAt ? "✓ GUARDADO" : "GUARDAR BORRADOR"}
          </button>
          <button
            className="btn primary lg"
            onClick={approveAndPrint}
            disabled={!canApprove}
            title={canApprove ? "Aprobar e imprimir" : `Faltan ${pendingChecks.length} puntos de revisión`}
            aria-label="Aprobar e imprimir"
          >
            ✓ APROBAR E IMPRIMIR
          </button>
        </div>
      </div>

      {loadErr && (
        <div className="card" style={{ marginBottom: 22, borderLeft: "3px solid var(--danger)" }}>
          <Eyebrow>No se pudo cargar la nota real</Eyebrow>
          <div style={{ fontSize: 13, marginTop: 6, color: "var(--ink-2)" }}>
            {loadErr}. Verifica que la consulta se haya grabado y finalizado.
          </div>
        </div>
      )}

      {/* RESUMEN CLÍNICO REAL (Análisis + alertas + hechos) */}
      <div className="framed" style={{ padding: 28, marginBottom: 22, background: "var(--cream-2)" }}>
        <Corners />
        <div className="row between center wrap" style={{ marginBottom: 14, gap: 12 }}>
          <div>
            <Eyebrow>Resumen clínico de la consulta</Eyebrow>
            <h2 className="h-section" style={{ marginTop: 6, fontSize: 24 }}>Análisis y alertas</h2>
          </div>
          <Pill variant={validation?.official_note ? "accent" : "gold"}>
            {validation?.official_note ? "nota oficial" : "requiere revisión médica"}
          </Pill>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 32 }}>
          <div>
            <Eyebrow>Análisis (A)</Eyebrow>
            <div className="display" style={{
              fontFamily: "var(--font-display)", fontSize: 19, lineHeight: 1.4,
              color: "var(--ink)", marginTop: 8, marginBottom: 16, whiteSpace: "pre-wrap",
            }}>
              {soap.A || (loading ? "Cargando…" : "Sin análisis registrado en la nota.")}
            </div>
            {facts && (
              <div style={{ marginTop: 10 }}>
                <Eyebrow>Hechos clínicos</Eyebrow>
                <FactLine label="Presentes" items={facts.sintomas_presentes} />
                <FactLine label="Negados" items={facts.sintomas_negados} />
                <FactLine label="Alarmas condicionales" items={facts.datos_alarma_condicionales} />
              </div>
            )}
          </div>
          <div>
            <Eyebrow>Alertas de seguridad</Eyebrow>
            <div className="col g-8" style={{ marginTop: 8 }}>
              {alerts.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic" }}>
                  {loading ? "Cargando…" : "Sin alertas bloqueantes detectadas."}
                </div>
              )}
              {alerts.map((a, i) => (
                <div key={i} style={{
                  fontSize: 12, lineHeight: 1.45, padding: "8px 12px",
                  background: "var(--surface)",
                  borderLeft: `3px solid ${a.severity === "blocker" ? "var(--danger)" : "var(--warn)"}`,
                }}>{a.text}</div>
              ))}
            </div>
            {/* Verificador FDA del cierre (tabla de contraindicaciones), con cita. */}
            <AlertasFda seguridad={facts?.alertas_seguridad} />
          </div>
        </div>
      </div>

      {/* GRID: SOAP editable + Dx/Rx/identidad */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }} className="revision-grid">
        {/* LEFT: SOAP editable (real) */}
        <section className="card">
          <div className="row between center" style={{ marginBottom: 14 }}>
            <h3 className="h-section" style={{ fontSize: 20 }}>Nota SOAP · editable</h3>
            <Pill>NOM-004-SSA3-2012</Pill>
          </div>

          {SECTIONS.map((sec) => (
            <div key={sec.k} style={{
              display: "grid", gridTemplateColumns: "44px 1fr", gap: 14,
              padding: "16px 0", borderBottom: "1px dashed var(--hair)",
            }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 40, color: "var(--forest)", lineHeight: 1 }}>{sec.k}</div>
              <div>
                <div className="row between center" style={{ marginBottom: 6 }}>
                  <Eyebrow>{sec.name}</Eyebrow>
                  <button
                    className="btn ghost sm"
                    style={{ padding: "3px 10px", fontSize: 9 }}
                    onClick={() => setEditing(editing === sec.k ? null : sec.k)}
                    aria-label={`Editar ${sec.name}`}
                  >
                    {editing === sec.k ? "LISTO" : "EDITAR"}
                  </button>
                </div>
                {editing === sec.k ? (
                  <textarea
                    className="textarea"
                    value={soap[sec.k]}
                    onChange={(e) => setSoap({ ...soap, [sec.k]: e.target.value })}
                    style={{ fontSize: 12.5, minHeight: 120 }}
                  />
                ) : (
                  <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", color: soap[sec.k] ? "var(--ink)" : "var(--ink-2)", fontStyle: soap[sec.k] ? "normal" : "italic" }}>
                    {soap[sec.k] || "—"}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Autocompletado de indicaciones: se ofrece junto al Plan, que es
              donde el médico las escribiría a mano. Solo aparece si la consulta
              es de rehabilitación; nada entra al plan sin que él lo pulse. */}
          <RehabSugerencia consultationId={consultationId} soap={soap} setSoap={setSoap} />

          {/* Estudios que trajo el paciente y su pre-diagnóstico: nada entra a la
              nota solo; «→ Objetivo» lo añade a O y el médico lo edita. */}
          <EstudiosStrip consultationId={consultationId} patientId={patient?.id} soap={soap} setSoap={setSoap} />

          {/* Megi IA sobre ESTA consulta: por qué se puso un medicamento o un dx,
              posibles errores u omisiones, antecedentes del paciente que convenga
              recordar. Ve la transcripción, el SOAP automático, la nota tal como
              el médico la está dejando, dx, receta, estudios y consultas previas
              de este paciente; con el servicio real, además guías (RAG). Mismas
              reglas que el chat de guías: solo con esos datos, citando, prudente. */}
          <div className="card no-print" style={{ marginTop: 12 }}>
            <ChatMegi titulo="Megi IA · sobre esta consulta" placeholder="Pregunta sobre esta consulta, la receta, la nota o el paciente…"
                      ejemplos="Por ejemplo: «¿por qué se indicó amoxicilina?», «¿la nota omite algo de lo que dijo el paciente?», «¿hay interacción con lo que ya toma?», «¿qué tenía en la consulta anterior?»."
                      esperando="Megi IA está revisando la consulta…"
                      resetKey={consultationId}
                      preguntar={(pregunta, historial) => api.preguntarConsulta(consultationId, { pregunta, historial, soap, dx: dxList, rx: rxList })} />
          </div>

          <div style={{ marginTop: 16 }}>
            <Eyebrow>Notas adicionales del médico</Eyebrow>
            <textarea
              className="textarea"
              placeholder="Observaciones privadas o correcciones a la nota generada…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ marginTop: 6, fontSize: 12.5 }}
            />
          </div>
        </section>

        {/* RIGHT: Dx + Rx + identidad */}
        <aside className="col g-16">
          {/* DIAGNÓSTICOS (manual) */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <div>
                <h3 className="h-section" style={{ fontSize: 18 }}>Diagnósticos · CIE-10</h3>
                <Eyebrow>captura manual</Eyebrow>
              </div>
            </div>
            <div className="col g-8">
              {dxList.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic" }}>
                  Aún no hay diagnósticos. Agrégalos abajo.
                </div>
              )}
              {dxList.map((dx, i) => (
                <div key={i} className="row between center" style={{ border: "1px solid var(--hair)", padding: "8px 12px", background: dx.primary ? "var(--cream-2)" : "var(--surface)" }}>
                  <div className="row center g-8" style={{ minWidth: 0 }}>
                    <span className="mono" style={{ fontSize: 11, border: "1px solid var(--forest)", color: "var(--forest)", padding: "2px 7px", fontWeight: 600 }}>{dx.code || "—"}</span>
                    <span style={{ fontSize: 13 }}>{dx.label || "—"}</span>
                    {dx.primary && <Pill variant="gold">primario</Pill>}
                  </div>
                  <button onClick={() => removeDx(i)} aria-label="Quitar diagnóstico" style={{ background: "none", border: 0, cursor: "pointer", color: "var(--ink-2)", fontSize: 16 }}>×</button>
                </div>
              ))}
            </div>
            {/* Buscador CIE-10 */}
            <div style={{ marginTop: 12, position: "relative" }}>
              <input className="input" placeholder="Buscar CIE-10 por código o padecimiento…" value={cieQuery}
                onChange={(e) => setCieQuery(e.target.value)} style={{ fontSize: 12 }} aria-label="Buscar CIE-10" />
              {cieResults.length > 0 && (
                <div style={{ position: "absolute", zIndex: 20, left: 0, right: 0, marginTop: 4, background: "var(--surface)", border: "1px solid var(--hair)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-md)", maxHeight: 220, overflowY: "auto" }}>
                  {cieResults.map((it) => (
                    <button key={it.code} type="button" onClick={() => addCie(it)}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: "1px dashed var(--hair)", padding: "8px 10px", cursor: "pointer", fontSize: 12 }}>
                      <span className="mono" style={{ color: "var(--forest)", fontWeight: 600 }}>{it.code}</span> · {it.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="row g-8 center" style={{ marginTop: 8 }}>
              <input className="input mono" placeholder="CIE-10" value={dxDraft.code} onChange={(e) => setDxDraft({ ...dxDraft, code: e.target.value })} style={{ width: 90, fontSize: 12 }} aria-label="Código CIE-10" />
              <input className="input" placeholder="Descripción (manual)" value={dxDraft.label} onChange={(e) => setDxDraft({ ...dxDraft, label: e.target.value })} style={{ flex: 1, fontSize: 12 }} aria-label="Descripción del diagnóstico" />
              <button className="btn sm" onClick={addDx}>+ AGREGAR</button>
            </div>
            {heardDx.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="mono" style={{ fontSize: 9, color: "var(--ink-2)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>
                  Escuchado en la consulta (impresión diagnóstica)
                </div>
                <div className="col g-6">
                  {heardDx.map((t, i) => (
                    addedHeardDx.includes(t) ? (
                      <span key={i} className="row center g-4" style={{ fontSize: 11.5, padding: "5px 8px", color: "var(--sage-2)", background: "var(--sage-soft)", borderRadius: 6 }}>
                        ✓ {t}<span style={{ fontSize: 9, opacity: 0.7 }}>agregado</span>
                      </span>
                    ) : (
                      <button key={i} type="button" onClick={() => addHeardDx(t)}
                        style={{ textAlign: "left", fontSize: 11.5, lineHeight: 1.4, padding: "6px 9px", border: "1px dashed var(--gold)", color: "var(--ink)", background: "transparent", borderRadius: 6, cursor: "pointer" }}
                        title="Agregar como diagnóstico (busca el CIE-10 con mejor match)">
                        <span style={{ color: "var(--gold)", fontWeight: 600 }}>＋ </span>{t}
                      </button>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RECETA (manual) */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <div>
                <h3 className="h-section" style={{ fontSize: 18 }}>Receta médica</h3>
                <Eyebrow>captura manual</Eyebrow>
              </div>
            </div>
            <div className="col g-8">
              {rxList.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic" }}>
                  Aún no hay medicamentos. Agrégalos abajo.
                </div>
              )}
              {rxList.map((rx, i) => (
                <div key={i} style={{ border: "1px solid var(--hair)", padding: "10px 12px", position: "relative" }}>
                  <div className="row between">
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                      {rx.drug} <span style={{ color: "var(--forest)" }}>{rx.dose}</span>
                    </span>
                    <button onClick={() => removeRx(i)} aria-label="Quitar medicamento" style={{ background: "none", border: 0, cursor: "pointer", color: "var(--ink-2)", fontSize: 16 }}>×</button>
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 4 }}>
                    {[rx.freq, rx.indication].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
              ))}
            </div>
            <div className="col g-6" style={{ marginTop: 10 }}>
              <div className="row g-8">
                <input className="input" placeholder="Medicamento" value={rxDraft.drug} onChange={(e) => setRxDraft({ ...rxDraft, drug: e.target.value })} style={{ flex: 2, fontSize: 12 }} aria-label="Medicamento" />
                <input className="input" placeholder="Dosis" value={rxDraft.dose} onChange={(e) => setRxDraft({ ...rxDraft, dose: e.target.value })} style={{ flex: 1, fontSize: 12 }} aria-label="Dosis" />
              </div>
              <div className="row g-8 center">
                <input className="input" placeholder="Frecuencia" value={rxDraft.freq} onChange={(e) => setRxDraft({ ...rxDraft, freq: e.target.value })} style={{ flex: 1, fontSize: 12 }} aria-label="Frecuencia" />
                <input className="input" placeholder="Indicación" value={rxDraft.indication} onChange={(e) => setRxDraft({ ...rxDraft, indication: e.target.value })} style={{ flex: 1, fontSize: 12 }} aria-label="Indicación" />
                <button className="btn sm" onClick={addRx}>+ AGREGAR</button>
              </div>
            </div>
          </div>

          {/* VERIFICACIÓN DE SEGURIDAD (receta × alergias × crónicos) */}
          <div className="card" style={(safetyBlockers.length || safetyCheckFailed) ? { borderColor: "var(--danger)" } : undefined}>
            <div className="row between center" style={{ marginBottom: 4 }}>
              <h3 className="h-section" style={{ fontSize: 18 }}>Verificación de seguridad</h3>
              <Pill variant={safetyCheckFailed ? "danger" : safetyBlockers.length ? "danger" : safetyAlerts.length ? "gold" : "accent"}>
                {safetyCheckFailed ? "no verificado" : safetyBlockers.length ? `${safetyBlockers.length} alergia` : safetyAlerts.length ? `${safetyAlerts.length} aviso` : "sin alertas"}
              </Pill>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginBottom: 10 }}>
              Cruza la receta con alergias y crónicos. Apoyo, no exhaustivo.
            </div>
            {safetyCheckFailed && (
              <div style={{ fontSize: 12.5, color: "var(--danger)", marginBottom: 8 }}>
                ⚠ No se pudo verificar la seguridad de la receta. No se puede aprobar hasta reintentar (edita la receta para reintentar).
              </div>
            )}
            {safetyAlerts.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic" }}>Sin conflictos detectados.</div>
            ) : (
              <div className="col g-6">
                {safetyAlerts.map((a, i) => (
                  <div key={i} style={{
                    fontSize: 12, lineHeight: 1.45, padding: "8px 10px",
                    background: "var(--surface)",
                    borderLeft: `3px solid ${a.severity === "blocker" ? "var(--danger)" : "var(--warn)"}`,
                  }}>
                    <span style={{ fontWeight: 600, color: a.severity === "blocker" ? "var(--danger)" : "var(--warn)" }}>
                      {a.severity === "blocker" ? "⚠ Alergia · " : "Aviso · "}
                    </span>
                    {a.message}
                  </div>
                ))}
              </div>
            )}
            {safetyBlockers.length > 0 && (
              <label className="check-item" style={{ marginTop: 10, borderLeftColor: "var(--danger)" }}>
                <input type="checkbox" checked={safetyAck} onChange={(e) => setSafetyAck(e.target.checked)} />
                <span style={{ fontSize: 12.5 }}>Reviso y <strong>asumo la responsabilidad</strong> de prescribir a pesar de la alerta de alergia.</span>
              </label>
            )}
          </div>

          {/* IDENTIDAD (confirmación manual) */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <h3 className="h-section" style={{ fontSize: 18 }}>Identidad del paciente</h3>
              <Eyebrow>confirmar</Eyebrow>
            </div>
            <div className="col g-10">
              <div>
                <label className="field-label" htmlFor="rev-curp">CURP</label>
                <input id="rev-curp" className="input mono" value={curp} onChange={(e) => setCurp(e.target.value.toUpperCase())} style={{ fontSize: 12 }} />
              </div>
              <div>
                <label className="field-label" htmlFor="rev-nss">NSS</label>
                <input id="rev-nss" className="input mono" value={nss} onChange={(e) => setNss(e.target.value)} style={{ fontSize: 12 }} />
              </div>
            </div>
          </div>

          {/* PERFIL MÉDICO (se persiste al paciente al aprobar) */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 4 }}>
              <h3 className="h-section" style={{ fontSize: 18 }}>Perfil médico</h3>
              <Eyebrow>se guarda al aprobar</Eyebrow>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.4, marginBottom: 12 }}>
              Confirma alergias y padecimientos crónicos escuchados en la consulta. Al
              aprobar la nota se agregan al expediente del paciente.
            </div>

            <ChipField label="Alergias" items={allergies} setItems={setAllergies} draft={allergyDraft} setDraft={setAllergyDraft} onAdd={addAllergy} danger placeholder="p. ej. Penicilina" suggestions={heardAllergies} />
            <div style={{ height: 12 }} />
            <ChipField label="Crónicos" items={chronic} setItems={setChronic} draft={chronicDraft} setDraft={setChronicDraft} onAdd={addChronic} placeholder="p. ej. DM2, HTA" suggestions={heardChronic} />
          </div>

          {/* SIGNOS VITALES (prellenados de lo escuchado, se guardan al aprobar) */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 4 }}>
              <h3 className="h-section" style={{ fontSize: 18 }}>Signos vitales</h3>
              <Eyebrow>tendencia</Eyebrow>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginBottom: 10 }}>
              Prellenados con lo escuchado; confirma o corrige. Se guardan al aprobar.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              {VITAL_FIELDS.map((f) => (
                <div key={f.k}>
                  <label className="field-label">{f.label}</label>
                  <input className="input" value={vitals[f.k] || ""} onChange={(e) => setVital(f.k, e.target.value)} placeholder={f.ph} style={{ fontSize: 12 }} />
                </div>
              ))}
            </div>
          </div>

          {/* AGENDAR SEGUIMIENTO */}
          <div className="card">
            <div className="row between center" style={{ marginBottom: 8 }}>
              <h3 className="h-section" style={{ fontSize: 18 }}>Seguimiento</h3>
              {followSaved && <Pill variant="accent">agendado</Pill>}
            </div>
            {followSaved ? (
              <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                Cita de {followReason.toLowerCase()} agendada para el {followDate}.
              </div>
            ) : (
              <div className="col g-10">
                <div className="row g-10">
                  <div style={{ flex: 1 }}>
                    <label className="field-label" htmlFor="follow-date">Fecha</label>
                    <input id="follow-date" className="input" type="date" value={followDate} onChange={(e) => setFollowDate(e.target.value)} style={{ fontSize: 12 }} />
                  </div>
                  <div style={{ flex: 1.4 }}>
                    <label className="field-label" htmlFor="follow-reason">Motivo</label>
                    <input id="follow-reason" className="input" value={followReason} onChange={(e) => setFollowReason(e.target.value)} style={{ fontSize: 12 }} />
                  </div>
                </div>
                {followErr && <div style={{ color: "var(--danger)", fontSize: 12 }}>{followErr}</div>}
                <button className="btn sm" onClick={agendarSeguimiento} disabled={!followDate}>＋ AGENDAR SEGUIMIENTO</button>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* CHECKLIST DE REVISIÓN (bloqueante) */}
      <div className="review-checklist" style={{ marginTop: 28 }}>
        <div className="row between center wrap" style={{ marginBottom: 10 }}>
          <Eyebrow>Checklist de revisión · obligatorio antes de aprobar</Eyebrow>
          <Pill variant={canApprove ? "accent" : "gold"}>
            {canApprove ? "completo" : `${pendingChecks.length} pendiente${pendingChecks.length === 1 ? "" : "s"}`}
          </Pill>
        </div>
        <div className="checklist-grid">
          {CHECKLIST.map((c) => (
            <label key={c.k} className={"check-item" + (checks[c.k] ? " done" : "")}>
              <input type="checkbox" checked={!!checks[c.k]} onChange={() => toggleCheck(c.k)} aria-label={c.t} />
              <span>{c.t}</span>
            </label>
          ))}
        </div>
      </div>

      {/* BARRA DE APROBACIÓN */}
      <div style={{
        position: "sticky", bottom: 16, marginTop: 18, padding: "14px 22px",
        background: "var(--surface)",
        border: `1px solid ${canApprove ? "var(--forest)" : "var(--hair)"}`,
        borderRadius: "var(--radius)",
        display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center",
        boxShadow: "var(--shadow-md)",
      }}>
        <div>
          <Eyebrow>Al aprobar</Eyebrow>
          <div style={{ fontSize: 13, marginTop: 3 }}>
            {canApprove ? (
              <>Se sella el contenido (hash SHA-256) de la nota real y se guarda en el expediente local; se genera
              la nota NOM-004 + receta imprimibles. <span className="mono">Firma mock · no legal en esta versión.</span></>
            ) : (
              <span style={{ color: approveErr ? "var(--danger)" : "var(--ink-2)" }}>
                {approveErr
                  ? `⚠ ${approveErr}`
                  : safetyCheckFailed
                    ? "No se pudo verificar la seguridad de la receta; reintenta para poder aprobar."
                    : !safetyOk
                      ? "Confirma la alerta de alergia (asume la responsabilidad) para poder aprobar."
                      : `Completa los ${pendingChecks.length} punto${pendingChecks.length === 1 ? "" : "s"} del checklist para poder aprobar e imprimir.`}
              </span>
            )}
          </div>
        </div>
        <div className="row g-10">
          <button
            className="btn primary lg"
            onClick={approveAndPrint}
            disabled={!canApprove}
            title={canApprove ? "Aprobar e imprimir" : `Faltan ${pendingChecks.length} puntos de revisión`}
            aria-label="Aprobar e imprimir"
          >
            ✓ APROBAR E IMPRIMIR
          </button>
        </div>
      </div>
    </div>
  );
};

const FactLine = ({ label, items }) => (
  <div style={{ fontSize: 11.5, lineHeight: 1.45, marginTop: 6 }}>
    <span className="mono" style={{ color: "var(--ink-2)", fontSize: 10 }}>{label}: </span>
    <span>{items?.length ? items.map(toName).join(", ") : "—"}</span>
  </div>
);

const ChipField = ({ label, items, setItems, draft, setDraft, onAdd, danger, placeholder, suggestions }) => {
  const remove = (i) => setItems((l) => l.filter((_, j) => j !== i));
  const has = (s) => items.some((it) => (it || "").toLowerCase() === (s || "").toLowerCase());
  return (
    <div>
      <label className="field-label">{label}</label>
      <div className="row g-6 wrap" style={{ marginTop: 4, marginBottom: items.length ? 8 : 0 }}>
        {items.map((it, i) => (
          <span key={i} className="row center g-6" style={{
            fontSize: 12, padding: "3px 8px", border: "1px solid var(--hair)",
            color: danger ? "var(--danger)" : "var(--ink)", background: "var(--surface)",
          }}>
            {it}
            <button type="button" onClick={() => remove(i)} aria-label={`Quitar ${it}`} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--ink-2)", fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
          </span>
        ))}
      </div>
      <div className="row g-8 center" style={{ marginTop: 6 }}>
        <input className="input" value={draft} placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
          style={{ flex: 1, fontSize: 12 }} aria-label={`Agregar ${label}`} />
        <button type="button" className="btn sm" onClick={onAdd}>+ AGREGAR</button>
      </div>
      {suggestions && suggestions.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="mono" style={{ fontSize: 9, color: "var(--ink-2)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>
            Escuchado en la consulta
          </div>
          <div className="row g-6 wrap">
            {suggestions.map((s, i) => (
              has(s) ? (
                <span key={i} className="row center g-4" style={{ fontSize: 11, padding: "3px 8px", color: "var(--sage-2)", background: "var(--sage-soft)", borderRadius: 6 }}>
                  ✓ {s}<span style={{ fontSize: 9, opacity: 0.7 }}>validado</span>
                </span>
              ) : (
                <button key={i} type="button" onClick={() => setItems((l) => [...new Set([...l, s])])}
                  style={{ fontSize: 11, padding: "3px 8px", border: "1px dashed var(--gold)", color: "var(--gold)", background: "transparent", borderRadius: 6, cursor: "pointer" }}>
                  + {s}
                </button>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Revision;
