import React from "react";
import MotivoConsulta from "./motivo_consulta";
import { Eyebrow, Pill, Corners, Divider } from "./shared";
import { api } from "../api/client";
import { useReloadPatients } from "../api/MegiDataProvider";

// ============ DASHBOARD (v0.0.1) ============
const Dashboard = ({ onOpen, onStart, patients, doctor, user }) => {
  // Paciente al que se le va a preguntar el motivo antes de abrir la consulta.
  // La agenda mostraba `p.reason`, que es el del alta: para un paciente que
  // vuelve meses después, ese dato ya no describe la consulta de hoy.
  const [pidiendoMotivo, setPidiendoMotivo] = React.useState(null);
  const [query, setQuery] = React.useState("");
  const [agendar, setAgendar] = React.useState(false);
  const reloadPatients = useReloadPatients();

  // Reloj en vivo: re-renderiza solo cuando cambia el minuto.
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow((prev) => {
      const n = new Date();
      return (n.getHours() !== prev.getHours() || n.getMinutes() !== prev.getMinutes()) ? n : prev;
    }), 1000);
    return () => clearInterval(id);
  }, []);

  // Próximos seguimientos (citas agendadas desde consultas).
  const [upcoming, setUpcoming] = React.useState([]);
  React.useEffect(() => {
    // Solo una lista entra al estado: si el endpoint devolviera otra cosa (un
    // error con forma de objeto, HTML de un proxy), `upcoming.slice` reventaría
    // y el dashboard entero se quedaría en blanco — sin mensaje, igual que la
    // pantalla en blanco de la caché. Un apoyo no puede tumbar la agenda.
    api.getUpcomingAppointments()
      .then((r) => setUpcoming(Array.isArray(r) ? r : []))
      .catch(() => {});
  }, []);

  // La AGENDA es el trabajo del DÍA, no todo el padrón: excluye los expedientes
  // históricos importados (source='imss_ocr') y las consultas ya terminadas. Al
  // buscar por texto sí se incluye todo, para ubicar cualquier expediente.
  const agendaHoy = patients.filter((p) => p.source !== "imss_ocr");
  const filtered = patients.filter((p) => {
    const q = query.trim().toLowerCase();
    const matches = !q ||
      p.name.toLowerCase().includes(q) ||
      (p.curp || "").toLowerCase().includes(q) ||
      p.reason.toLowerCase().includes(q);
    if (!matches) return false;
    if (q) return true;                                  // búsqueda: todo el padrón
    return p.source !== "imss_ocr" && p.status !== "terminada";  // agenda: solo hoy
  });

  const today = now.toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const time = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  const h = now.getHours();
  const greeting = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";

  // Estadísticas de la AGENDA DEL DÍA (sin el histórico importado).
  const stats = {
    total: agendaHoy.length,
    esperando: agendaHoy.filter((p) => p.status === "esperando").length,
    enCurso: agendaHoy.filter((p) => p.status === "en-consulta").length,
    terminada: agendaHoy.filter((p) => p.status === "terminada").length,
  };

  const greetName = user?.name || doctor?.name || "";
  const nextWaiting = agendaHoy.find((p) => p.status === "esperando");

  // Tras agendar: refresca la lista. Si es espontáneo, salta directo a consulta.
  const onScheduled = async (created, startNow) => {
    setAgendar(false);
    await reloadPatients?.();
    // Paciente recién dado de alta: el motivo con el que se registró ES el de hoy.
    if (startNow && created) onStart(created, created.reason);
  };

  return (
    <div className="page">
      {/* Motivo de hoy: se pregunta antes de abrir la consulta, igual que desde
          el expediente. Sin esto la agenda entraba con el motivo del alta. */}
      {pidiendoMotivo && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid",
                      placeItems: "center", background: "rgba(38,48,42,0.35)" }}
             onClick={() => setPidiendoMotivo(null)}>
          <div className="card" style={{ maxWidth: 460, width: "92%" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              {pidiendoMotivo.name}
            </div>
            <MotivoConsulta
              paciente={pidiendoMotivo}
              onCancel={() => setPidiendoMotivo(null)}
              onConfirm={(motivo) => { const p2 = pidiendoMotivo; setPidiendoMotivo(null); onStart(p2, motivo); }}
            />
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="page-head" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "end", gap: 24, marginBottom: 32 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow style={{ fontSize: 12, fontWeight: 600 }}>{today} · {time}</Eyebrow>
          <h1 className="h-page" style={{ marginTop: 8, textWrap: "balance" }}>
            {greeting}, <em style={{ fontStyle: "italic", color: "var(--gold)" }}>{greetName}</em>
          </h1>
          <p style={{ marginTop: 10, color: "var(--ink-2)", fontSize: 14 }}>
            {stats.total === 0
              ? <>No tienes pacientes agendados. <strong style={{ color: "var(--ink)" }}>Agenda el primero</strong> para empezar.</>
              : <>Tienes <strong style={{ color: "var(--ink)" }}>{stats.esperando} esperando</strong> y {stats.total - stats.terminada} consultas pendientes hoy.</>}
          </p>
        </div>
        <div className="row g-12" style={{ flexShrink: 0 }}>
          <button className="btn primary" onClick={() => setAgendar(true)}>
            <span style={{ fontSize: 14 }}>＋</span> AGENDAR PACIENTE
          </button>
        </div>
      </div>

      {/* STATS STRIP */}
      <div className="stat-strip" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, marginBottom: 32, border: "1px solid var(--hair)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-sm)", background: "var(--surface)" }}>
        {[
          { k: "EN AGENDA", v: stats.total },
          { k: "ESPERANDO", v: stats.esperando, color: "var(--gold)" },
          { k: "EN CURSO", v: stats.enCurso, color: "var(--accent)" },
          { k: "TERMINADAS", v: stats.terminada, color: "var(--forest)" },
        ].map((s, i) => (
          <div key={i} style={{ padding: "22px 24px", borderRight: i < 3 ? "1px dashed var(--hair)" : "0", display: "flex", flexDirection: "column", gap: 4 }}>
            <Eyebrow>{s.k}</Eyebrow>
            <div className="mono" style={{ fontSize: 36, lineHeight: 1, color: s.color || "var(--ink)", fontWeight: 300, marginTop: 6 }}>
              {String(s.v).padStart(2, "0")}
            </div>
          </div>
        ))}
      </div>

      {/* SEARCH + AGENDA */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 28 }} className="dashboard-grid">
        <section>
          <div className="row between center wrap g-10" style={{ marginBottom: 16 }}>
            <h2 className="h-section">Agenda del día</h2>
            {patients.length > 0 && (
              <div style={{ position: "relative", flex: 1, minWidth: 150, maxWidth: 280 }}>
                <input className="input" placeholder="Buscar paciente, CURP o motivo…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 32, fontSize: 12.5 }} aria-label="Buscar paciente" />
                <span style={{ position: "absolute", left: 12, top: 10, color: "var(--ink-2)", fontFamily: "var(--font-mono)", fontSize: 13 }}>⌕</span>
              </div>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="framed" style={{ padding: 48, textAlign: "center" }}>
              <Corners />
              <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--ink)", marginBottom: 8 }}>
                {query.trim() ? "Sin coincidencias" : "Agenda del día vacía"}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 20 }}>
                {query.trim()
                  ? "Ningún paciente coincide con la búsqueda. Los expedientes previos están en Pacientes."
                  : "No hay pacientes en la agenda de hoy. Agenda una cita o registra una consulta espontánea (walk-in)."}
              </div>
              {!query.trim() && <button className="btn primary" onClick={() => setAgendar(true)}>＋ AGENDAR PACIENTE</button>}
            </div>
          ) : (
            <div className="framed" style={{ padding: 0 }}>
              <Corners />
              <div className="agenda-head" style={{ display: "grid", gridTemplateColumns: "70px 1fr 180px 120px 120px", padding: "14px 22px", borderBottom: "1px solid var(--hair)", background: "var(--cream-2)" }}>
                {["HORA", "PACIENTE", "MOTIVO", "ESTADO", ""].map((h, i) => (
                  <Eyebrow key={i} style={{ fontSize: 9 }}>{h}</Eyebrow>
                ))}
              </div>

              {filtered.map((p, i) => (
                <div key={p.id} onClick={() => onOpen(p)} className="agenda-row" style={{ display: "grid", gridTemplateColumns: "70px 1fr 180px 120px 120px", padding: "18px 22px", alignItems: "center", borderBottom: i < filtered.length - 1 ? "1px dashed var(--hair)" : "0", cursor: "pointer", transition: "background 0.15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cream-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <div className="mono" style={{ fontSize: 13, color: p.time ? "var(--ink)" : "var(--ink-2)" }}>
                    {p.time || "—"}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>{p.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--ink-2)", letterSpacing: "0.08em" }}>
                      {[p.curp, `${p.age} años`, p.sex].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, color: p.motivo_hoy ? "var(--ink)" : "var(--ink-2)", paddingRight: 16 }}>
                    {p.motivo_hoy || p.reason}
                    <div style={{ fontSize: 9.5, opacity: 0.7 }}>{p.motivo_hoy ? "motivo de hoy" : "motivo de alta"}</div>
                  </div>
                  {/* Un paciente puede llevar dos píldoras (Espontáneo + En consulta):
                      sin hueco entre ellas se leían como una sola. */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                    {p.kind === "espontaneo" && <Pill variant="accent">Espontáneo</Pill>}
                    {p.kind !== "espontaneo" && p.status === "esperando" && <Pill variant="gold">Esperando</Pill>}
                    {p.status === "en-consulta" && <Pill variant="accent" pulse>En consulta</Pill>}
                    {p.status === "terminada" && <Pill>Terminada</Pill>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {/* También para `terminada`: un paciente puede volver el mismo
                        día. Antes ahí salía un botón VER que no hacía nada. */}
                    {/* Con un borrador abierto hoy, se retoma con SU motivo: el
                        médico ya lo escribió y volver a pedírselo es lo que
                        pasaba al salir y regresar. */}
                    {p.consulta_abierta_id ? (
                      <button className="btn sm primary"
                              onClick={(e) => { e.stopPropagation(); onStart(p, p.motivo_hoy); }}>
                        CONTINUAR →
                      </button>
                    ) : (
                      <button className="btn sm primary"
                              onClick={(e) => { e.stopPropagation(); setPidiendoMotivo(p); }}>
                        {p.status === "terminada" ? "OTRA CONSULTA →" : "INICIAR →"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Right */}
        <aside className="col g-24">
          <div className="card">
            <Eyebrow>Próxima consulta</Eyebrow>
            {nextWaiting ? (
              <div style={{ marginTop: 10 }}>
                <div className="mono" style={{ fontSize: 26, color: "var(--forest)" }}>{nextWaiting.time || "—"}</div>
                <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{nextWaiting.name}</div>
                <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 3 }}>{nextWaiting.motivo_hoy || nextWaiting.reason} · {nextWaiting.age} años</div>
                <Divider />
                <button className="btn sm primary"
                        onClick={() => nextWaiting.consulta_abierta_id ? onStart(nextWaiting, nextWaiting.motivo_hoy) : setPidiendoMotivo(nextWaiting)}>
                  {nextWaiting.consulta_abierta_id ? "CONTINUAR →" : "INICIAR CONSULTA →"}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 10, fontStyle: "italic" }}>
                No hay pacientes en espera.
              </div>
            )}
          </div>

          <div className="card">
            <Eyebrow>Próximos seguimientos</Eyebrow>
            <div className="col g-6" style={{ marginTop: 12 }}>
              {upcoming.length === 0 && (
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic" }}>Sin seguimientos agendados.</div>
              )}
              {upcoming.slice(0, 6).map((ap) => (
                <div key={ap.id} style={{ fontSize: 12.5, paddingBottom: 6, borderBottom: "1px dashed var(--hair)" }}>
                  <div className="row between center">
                    <span className="mono" style={{ color: "var(--forest)" }}>{ap.scheduled_date}{ap.time ? ` · ${ap.time}` : ""}</span>
                  </div>
                  <div style={{ color: "var(--ink-2)" }}>{ap.patient_name || ap.patient_id} · {ap.reason}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card card-dashed">
            <Eyebrow>Estado del motor</Eyebrow>
            <div className="col g-12" style={{ marginTop: 14 }}>
              <EngineRow label="Megi-Medical" status="activo" detail="v2.1 · es-MX" />
              <EngineRow label="Megi-LLM" status="activo" detail="26B A4B · 4-bit" />
              <EngineRow label="RAG · GPC CENETEC" status="cargado" detail="Tier 1 · bge-m3" />
            </div>
          </div>
        </aside>
      </div>

      {agendar && <AgendarModal onClose={() => setAgendar(false)} onScheduled={onScheduled} />}
    </div>
  );
};

// ============ FORMULARIO: AGENDAR PACIENTE ============
const AgendarModal = ({ onClose, onScheduled }) => {
  const [kind, setKind] = React.useState("cita");      // cita | espontaneo
  const [form, setForm] = React.useState({ name: "", birthdate: "", age: "", sex: "M", reason: "", curp: "", nss: "", email: "", phone: "", scheduled_date: "", time: "", gestacional_semanas: "" });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // La fecha de nacimiento es la fuente preferida: al elegirla, la edad se
  // calcula sola (el médico puede ajustar la edad si no conoce la fecha exacta).
  const yearsFrom = (v) => {
    const bd = new Date(v);
    return isNaN(bd) ? null : Math.floor((Date.now() - bd.getTime()) / (365.25 * 864e5));
  };
  const setBirthdate = (v) => {
    setForm((f) => {
      const next = { ...f, birthdate: v };
      if (v) {
        const years = yearsFrom(v);
        if (years !== null && years >= 0 && years <= 130) next.age = String(years);
      }
      return next;
    });
  };
  // Si el médico escribe una edad que no cuadra con la fecha, manda la edad y
  // la fecha se quita: el selector puede quedarse con «hoy» sin que nadie lo
  // elija, y una fecha así convertía a un adulto en lactante para todo el
  // sistema (pre-consulta, tamizajes, dosis). El backend aplica la misma regla.
  const setAge = (v) => {
    setForm((f) => {
      const next = { ...f, age: v };
      if (f.birthdate && v !== "") {
        const years = yearsFrom(f.birthdate);
        if (years !== null && Math.abs(years - parseInt(v, 10)) > 1) next.birthdate = "";
      }
      return next;
    });
  };

  const ageYears = parseInt(form.age, 10);
  const esBebe = form.age !== "" && ageYears < 2;   // gestacional solo tiene sentido en bebés
  const valid = form.name.trim() && form.age && form.reason.trim();

  const submit = async (e) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: form.name.trim(),
        age: parseInt(form.age, 10),
        sex: form.sex,
        reason: form.reason.trim(),
        curp: form.curp.trim(),
        nss: form.nss.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        kind,
        scheduled_date: kind === "cita" ? (form.scheduled_date || null) : null,
        time: kind === "cita" ? (form.time || null) : null,
        birthdate: form.birthdate || null,
        gestacional_semanas: (esBebe && form.gestacional_semanas)
          ? parseInt(form.gestacional_semanas, 10) : null,
      };
      const created = await api.createPatient(body);
      onScheduled(created, kind === "espontaneo");
    } catch (e) {
      setErr("No se pudo agendar. Revisa los datos e intenta de nuevo.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay no-print" onClick={onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="row between center" style={{ marginBottom: 18 }}>
          <h2 className="h-section" style={{ fontSize: 22 }}>Agendar paciente</h2>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {/* Tipo */}
        <div className="seg" style={{ marginBottom: 18, width: "100%" }}>
          <button type="button" className={kind === "cita" ? "on" : ""} style={{ flex: 1 }} onClick={() => setKind("cita")}>Con cita</button>
          <button type="button" className={kind === "espontaneo" ? "on" : ""} style={{ flex: 1 }} onClick={() => setKind("espontaneo")}>Espontáneo (walk-in)</button>
        </div>

        <div className="col g-14">
          <div>
            <label className="field-label" htmlFor="ag-name">Nombre completo *</label>
            <input id="ag-name" className="input" value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </div>
          <div className="row g-12">
            <div style={{ flex: 1.4 }}>
              <label className="field-label" htmlFor="ag-birth">Fecha de nacimiento</label>
              <input id="ag-birth" className="input" type="date" max={new Date().toISOString().slice(0, 10)}
                value={form.birthdate} onChange={(e) => setBirthdate(e.target.value)} style={{ fontSize: 12.5 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label" htmlFor="ag-age">Edad *</label>
              <input id="ag-age" className="input" type="number" min="0" max="130" value={form.age} onChange={(e) => setAge(e.target.value)}
                placeholder={form.birthdate ? "auto" : ""}
                title="Si la edad no cuadra con la fecha de nacimiento, la fecha se descarta" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label" htmlFor="ag-sex">Sexo *</label>
              <select id="ag-sex" className="input" value={form.sex} onChange={(e) => set("sex", e.target.value)}>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
              </select>
            </div>
          </div>
          {esBebe && (
            <div>
              <label className="field-label" htmlFor="ag-gest">Semanas de gestación al nacer (para prematuros)</label>
              <input id="ag-gest" className="input" type="number" min="20" max="42" value={form.gestacional_semanas}
                onChange={(e) => set("gestacional_semanas", e.target.value)} placeholder="p. ej. 32 · deja vacío si fue a término" style={{ fontSize: 12.5 }} />
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="ag-reason">Motivo de la consulta *</label>
            <input id="ag-reason" className="input" value={form.reason} onChange={(e) => set("reason", e.target.value)} />
          </div>
          <div className="row g-12">
            <div style={{ flex: 1 }}>
              <label className="field-label" htmlFor="ag-curp">CURP (opcional)</label>
              <input id="ag-curp" className="input mono" value={form.curp} onChange={(e) => set("curp", e.target.value.toUpperCase())} style={{ fontSize: 12 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label" htmlFor="ag-nss">NSS (opcional)</label>
              <input id="ag-nss" className="input mono" value={form.nss} onChange={(e) => set("nss", e.target.value)} style={{ fontSize: 12 }} />
            </div>
          </div>
          <div className="row g-12">
            <div style={{ flex: 1 }}>
              <label className="field-label" htmlFor="ag-email">Correo (opcional)</label>
              <input id="ag-email" className="input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="para enviar nota/receta" style={{ fontSize: 12 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label" htmlFor="ag-phone">WhatsApp / tel. (opcional)</label>
              <input id="ag-phone" className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10 dígitos" style={{ fontSize: 12 }} />
            </div>
          </div>

          {kind === "cita" && (
            <div className="row g-12">
              <div style={{ flex: 1 }}>
                <label className="field-label" htmlFor="ag-date">Fecha de la cita</label>
                <input id="ag-date" className="input" type="date" value={form.scheduled_date} onChange={(e) => set("scheduled_date", e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="field-label" htmlFor="ag-time">Hora</label>
                <input id="ag-time" className="input" type="time" value={form.time} onChange={(e) => set("time", e.target.value)} />
              </div>
            </div>
          )}

          <div style={{ fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.4 }}>
            Las alergias y padecimientos crónicos se agregan al perfil del paciente
            tras la consulta, cuando apruebas la nota médica.
          </div>

          {err && <div style={{ color: "var(--danger)", fontSize: 12 }}>{err}</div>}

          <div className="row g-10" style={{ justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" className="btn ghost" onClick={onClose}>CANCELAR</button>
            <button type="submit" className="btn primary" disabled={!valid || busy}>
              {busy ? "AGENDANDO…" : kind === "espontaneo" ? "AGENDAR E INICIAR →" : "AGENDAR"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

const EngineRow = ({ label, status, detail }) => (
  <div className="row between center">
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</div>
      <div className="mono" style={{ fontSize: 10, color: "var(--ink-2)", letterSpacing: "0.08em" }}>{detail}</div>
    </div>
    <Pill variant={status === "activo" ? "accent" : ""} pulse={status === "activo"}>{status}</Pill>
  </div>
);

export default Dashboard;
