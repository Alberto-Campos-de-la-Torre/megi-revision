// ============ IMPRESIÓN NOM-004 + RECETA ============
const Imprimir = ({ patient, doctor, onBack }) => {
  const { SOAP, SUGGESTED_DX, SUGGESTED_RX, VITALS } = window.MEGI_DATA;
  const [tab, setTab] = React.useState("nota");
  const today = new Date().toLocaleDateString("es-MX", {
    day: "2-digit", month: "long", year: "numeric",
  });
  const time = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="page" style={{ paddingTop: 20 }}>
      <div className="no-print" style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        marginBottom: 20,
      }}>
        <div>
          <div className="row center g-12" style={{ marginBottom: 10 }}>
            <button className="btn ghost sm" onClick={onBack}>← REVISIÓN</button>
            <Pill variant="accent" pulse>firmado digitalmente</Pill>
            <Pill>hash a7f3·e29c·1145</Pill>
          </div>
          <h1 className="h-page" style={{ fontSize: 36 }}>Listo para <em style={{ color: "var(--gold)" }}>imprimir</em></h1>
        </div>
        <div className="row g-10">
          <button className="btn ghost">⤓ PDF</button>
          <button className="btn">✉ ENVIAR AL PACIENTE</button>
          <button className="btn primary lg" onClick={() => window.print()}>
            ⎙ IMPRIMIR AHORA
          </button>
        </div>
      </div>

      <div className="no-print" style={{ display: "flex", gap: 0, marginBottom: 20 }}>
        {[
          { id: "nota", label: "Nota médica NOM-004" },
          { id: "receta", label: "Receta" },
          { id: "resumen", label: "Resumen paciente" },
        ].map((t) => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            className="mono"
            style={{
              background: tab === t.id ? "var(--forest)" : "transparent",
              color: tab === t.id ? "var(--cream)" : "var(--ink-2)",
              border: "1px solid " + (tab === t.id ? "var(--forest)" : "var(--hair)"),
              padding: "10px 18px",
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              cursor: "pointer",
              marginRight: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sheet preview */}
      <div style={{
        background: "white",
        color: "#1a1a1a",
        margin: "0 auto",
        maxWidth: 820,
        padding: "48px 56px",
        boxShadow: "0 2px 28px rgba(0,0,0,0.08)",
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        lineHeight: 1.55,
      }}>
        {tab === "nota" && <NotaSheet patient={patient} doctor={doctor} today={today} time={time} soap={SOAP} vitals={VITALS} dx={SUGGESTED_DX} />}
        {tab === "receta" && <RecetaSheet patient={patient} doctor={doctor} today={today} rx={SUGGESTED_RX} />}
        {tab === "resumen" && <ResumenSheet patient={patient} doctor={doctor} today={today} soap={SOAP} dx={SUGGESTED_DX} />}
      </div>
    </div>
  );
};

const SheetHeader = ({ doctor, today, title }) => (
  <div style={{
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "flex-start",
    paddingBottom: 14,
    borderBottom: "2px solid #1a1a1a",
    marginBottom: 18,
  }}>
    <div>
      <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22, fontWeight: 500, lineHeight: 1 }}>
        {doctor.name}
      </div>
      <div style={{ fontSize: 10.5, color: "#555", marginTop: 4, lineHeight: 1.45 }}>
        {doctor.specialty}<br/>
        Céd. Prof. <strong>{doctor.cedula}</strong> · Céd. Esp. <strong>{doctor.cedula_esp}</strong>
      </div>
    </div>
    <div style={{
      fontFamily: "Cormorant Garamond, serif",
      fontSize: 11,
      letterSpacing: "0.3em",
      textTransform: "uppercase",
      textAlign: "center",
      color: "#8b7355",
      paddingTop: 6,
    }}>
      {title}
    </div>
    <div style={{ textAlign: "right", fontSize: 10.5, color: "#555", lineHeight: 1.45 }}>
      {doctor.institution}<br/>
      {doctor.address}<br/>
      Tel. {doctor.phone}
    </div>
  </div>
);

const Row = ({ label, value, cols = 1 }) => (
  <div style={{ gridColumn: `span ${cols}` }}>
    <div style={{
      fontFamily: "JetBrains Mono, monospace", fontSize: 8,
      letterSpacing: "0.2em", textTransform: "uppercase", color: "#888",
    }}>{label}</div>
    <div style={{ fontSize: 11.5, marginTop: 2, borderBottom: "1px solid #ddd", paddingBottom: 3 }}>
      {value || "\u00A0"}
    </div>
  </div>
);

const Section = ({ title, children, style }) => (
  <div style={{ marginTop: 14, ...style }}>
    <div style={{
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 9,
      letterSpacing: "0.24em",
      textTransform: "uppercase",
      color: "#2d3b2d",
      borderBottom: "1px solid #2d3b2d",
      paddingBottom: 3,
      marginBottom: 8,
    }}>{title}</div>
    {children}
  </div>
);

const NotaSheet = ({ patient, doctor, today, time, soap, vitals, dx }) => (
  <>
    <SheetHeader doctor={doctor} today={today} title="Nota Médica · NOM-004-SSA3-2012" />

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px 20px", marginBottom: 14 }}>
      <Row label="Fecha" value={today} />
      <Row label="Hora" value={time} />
      <Row label="Folio" value="MEGI-2026-04-2042" />
      <Row label="Tipo de nota" value="Consulta externa" />
    </div>

    <Section title="Datos del paciente">
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "8px 20px" }}>
        <Row label="Nombre completo" value={patient.name} />
        <Row label="Edad / sexo" value={`${patient.age} años · ${patient.sex === "F" ? "Femenino" : "Masculino"}`} />
        <Row label="Expediente" value={patient.id} />
        <Row label="CURP" value={<span style={{ fontFamily: "JetBrains Mono" }}>{patient.curp}</span>} />
        <Row label="NSS" value={<span style={{ fontFamily: "JetBrains Mono" }}>{patient.nss}</span>} />
        <Row label="Alergias" value={patient.allergies.join(", ") || "Negadas"} />
      </div>
    </Section>

    <Section title="Motivo de la consulta">
      <div style={{ fontSize: 12 }}>{patient.reason}</div>
    </Section>

    <Section title="Interrogatorio (Subjetivo)">
      <div style={{ fontSize: 11.5, textAlign: "justify" }}>{soap.s}</div>
    </Section>

    <Section title="Exploración física y signos vitales (Objetivo)">
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8,
        marginBottom: 10, fontFamily: "JetBrains Mono, monospace", fontSize: 10,
      }}>
        {Object.entries({
          TA: vitals.ta, FC: vitals.fc, FR: vitals.fr,
          "SpO₂": vitals.spo2, Temp: vitals.temp, IMC: vitals.imc,
        }).map(([k, v]) => (
          <div key={k} style={{ border: "1px solid #ddd", padding: "5px 8px" }}>
            <div style={{ fontSize: 7, letterSpacing: "0.2em", color: "#888" }}>{k}</div>
            <div>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, textAlign: "justify" }}>{soap.o}</div>
    </Section>

    <Section title="Diagnósticos · CIE-10">
      {dx.map((d) => (
        <div key={d.code} style={{ display: "grid", gridTemplateColumns: "80px 1fr auto", gap: 10, padding: "6px 0", borderBottom: "1px dashed #ddd", fontSize: 11.5 }}>
          <span style={{ fontFamily: "JetBrains Mono", fontWeight: 600 }}>{d.code}</span>
          <span>{d.label}</span>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 9, color: "#8b7355" }}>
            {d.primary ? "Primario" : "Asociado"}
          </span>
        </div>
      ))}
    </Section>

    <Section title="Análisis clínico">
      <div style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>{soap.a}</div>
    </Section>

    <Section title="Plan terapéutico">
      <div style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>{soap.p}</div>
    </Section>

    <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
      <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 6 }}>
        <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 15 }}>{doctor.name}</div>
        <div style={{ fontSize: 10, color: "#555" }}>
          Céd. Prof. {doctor.cedula} · {doctor.specialty}
        </div>
      </div>
      <div style={{
        border: "1px dashed #888", padding: 10, textAlign: "center",
        fontFamily: "JetBrains Mono, monospace", fontSize: 8.5, color: "#555",
        lineHeight: 1.5,
      }}>
        <div style={{ letterSpacing: "0.2em", textTransform: "uppercase" }}>Firma electrónica · MEGI</div>
        <div>SHA-256 · a7f3e29c1145b...dd02</div>
        <div>Verificable: megi.mx/v/MEGI-2026-04-2042</div>
      </div>
    </div>
  </>
);

const RecetaSheet = ({ patient, doctor, today, rx }) => (
  <>
    <SheetHeader doctor={doctor} today={today} title="Receta Médica" />

    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "10px 20px", marginBottom: 16 }}>
      <Row label="Paciente" value={patient.name} />
      <Row label="Edad" value={`${patient.age} años`} />
      <Row label="Fecha" value={today} />
    </div>

    <div style={{
      fontFamily: "Cormorant Garamond, serif",
      fontSize: 56,
      color: "#8b7355",
      lineHeight: 0.9,
      marginBottom: 4,
    }}>℞</div>

    <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 14 }}>
      {rx.map((r, i) => (
        <div key={i} style={{
          display: "grid",
          gridTemplateColumns: "30px 1fr",
          gap: 12,
          padding: "14px 0",
          borderBottom: "1px dashed #ddd",
        }}>
          <div style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 16, color: "#8b7355",
          }}>{i + 1}.</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {r.drug} <span style={{ color: "#2d3b2d" }}>{r.dose}</span>
            </div>
            <div style={{ fontSize: 11.5, marginTop: 3 }}>
              {r.route} · {r.freq} · {r.duration}
            </div>
            <div style={{ fontSize: 10.5, color: "#666", fontStyle: "italic", marginTop: 3 }}>
              {r.note}
            </div>
            <div style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 8.5, color: "#8b7355", marginTop: 5,
              letterSpacing: "0.05em",
            }}>
              ↳ {r.indication} · {r.cb}
            </div>
          </div>
        </div>
      ))}
    </div>

    <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
      <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 6 }}>
        <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 15 }}>{doctor.name}</div>
        <div style={{ fontSize: 10, color: "#555" }}>
          Céd. Prof. {doctor.cedula}
        </div>
      </div>
      <div style={{
        border: "1px dashed #888", padding: 10, textAlign: "center",
        fontFamily: "JetBrains Mono, monospace", fontSize: 8.5, color: "#555",
      }}>
        <div style={{ letterSpacing: "0.2em", textTransform: "uppercase" }}>QR verificación</div>
        <div style={{
          width: 70, height: 70, margin: "6px auto",
          background: "repeating-linear-gradient(0deg, #1a1a1a 0 4px, #fff 4px 7px), repeating-linear-gradient(90deg, #1a1a1a 0 4px, #fff 4px 7px)",
          backgroundBlendMode: "difference",
        }} />
      </div>
    </div>
  </>
);

const ResumenSheet = ({ patient, doctor, today, soap, dx }) => (
  <>
    <SheetHeader doctor={doctor} today={today} title="Resumen para el paciente" />

    <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 24, fontWeight: 500, marginBottom: 4 }}>
      Hola, {patient.short.split(" ").slice(0, 2).join(" ")}
    </div>
    <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>
      Esta es la información más importante de tu consulta de hoy, en lenguaje sencillo.
    </div>

    <Section title="¿Qué encontramos?">
      <div style={{ fontSize: 12.5 }}>
        Los síntomas que nos describiste (dolor de pecho al esforzarte) probablemente corresponden a una
        <strong> angina estable</strong>, una forma común de enfermedad del corazón. No es urgente pero
        necesitamos confirmarlo con estudios.
      </div>
    </Section>

    <Section title="¿Qué debes hacer esta semana?">
      <ol style={{ fontSize: 12, lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
        <li>Hacerte un <strong>electrocardiograma</strong> hoy mismo (te lo entrego en esta hoja).</li>
        <li>Acudir al laboratorio para los estudios indicados.</li>
        <li>Tomar <strong>aspirina 100 mg</strong> cada mañana, con comida.</li>
        <li>Si te da dolor de pecho, colocar <strong>una tableta de nitroglicerina bajo la lengua</strong> y descansar sentado.</li>
        <li>Continuar tus medicamentos de siempre: losartán y atorvastatina.</li>
      </ol>
    </Section>

    <Section title="Señales de alarma · acude a urgencias">
      <ul style={{ fontSize: 12, lineHeight: 1.6, paddingLeft: 20, margin: 0 }}>
        <li>Dolor de pecho que dura <strong>más de 20 minutos</strong> o no cede con la nitroglicerina.</li>
        <li>Dolor que se va al brazo, cuello o mandíbula.</li>
        <li>Sudoración fría con mareo o desmayo.</li>
        <li>Dificultad grave para respirar.</li>
      </ul>
    </Section>

    <Section title="Tu próxima cita">
      <div style={{ fontSize: 12.5 }}>
        <strong>En 7 días</strong>, trayendo los resultados. Si no tienes los estudios listos, avísanos
        por WhatsApp al {doctor.phone}.
      </div>
    </Section>
  </>
);

window.Imprimir = Imprimir;
