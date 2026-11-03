// ============ PANEL TÉCNICO: transcripción confirmada, hablantes y eventos ============
// Antes vivía en la columna derecha de la consulta en vivo. Es información
// para nosotros (¿qué oyó el ASR?, ¿qué chunk falló?), no para el médico, así
// que ahora se muestra dentro del panel técnico colapsado de la consulta.
import { Eyebrow } from "./shared";

const TechTranscript = ({ transcript, turns, events }) => (
  <div className="tech-transcript" data-testid="tech-transcript">
    <Eyebrow>Transcripción confirmada</Eyebrow>
    <div style={{ fontSize: 12, lineHeight: 1.55, marginTop: 6, maxHeight: 220, overflowY: "auto", color: transcript ? "var(--ink)" : "var(--ink-2)", fontStyle: transcript ? "normal" : "italic" }}>
      {transcript || "Inicia la consulta y habla; el texto confirmado por el ASR aparece aquí…"}
    </div>
    {/* Fase 10B: transcript por hablante (huella vocal del médico). */}
    {turns?.length > 0 && (
      <>
        <Eyebrow style={{ marginTop: 12 }}>Por hablante</Eyebrow>
        <div className="col g-4" style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
          {turns.slice(-12).map((s, i) => (
            <div key={`${s.start}-${i}`} style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 8, fontSize: 11.5, alignItems: "start" }}>
              <span className="mono" style={{
                fontSize: 9, letterSpacing: ".06em", padding: "2px 6px", borderRadius: 999,
                textAlign: "center", alignSelf: "start",
                color: s.speaker === "medico" ? "var(--sage-2)" : s.speaker === "otro" ? "var(--gold)" : "var(--ink-2)",
                background: s.speaker === "medico" ? "var(--sage-soft)" : s.speaker === "otro" ? "rgba(143,118,89,.12)" : "var(--cream-2)",
              }} title={s.score != null ? `similitud con la huella del médico: ${s.score}` : "segmento corto: sin clasificar"}>
                {s.speaker === "medico" ? "MÉDICO" : s.speaker === "otro" ? "PACIENTE" : "—"}
              </span>
              <span style={{ lineHeight: 1.45 }}>{s.text}</span>
            </div>
          ))}
        </div>
      </>
    )}

    <Eyebrow style={{ marginTop: 12 }}>Eventos</Eyebrow>
    <div className="col g-4" style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
      {!events?.length && (
        <div style={{ fontSize: 11, color: "var(--ink-2)", fontStyle: "italic" }}>Sin eventos todavía.</div>
      )}
      {(events || []).slice(-12).map((e, i) => (
        <div key={i} className="row g-8" style={{ fontSize: 10.5, fontFamily: "var(--font-mono)" }}>
          <span style={{ color: "var(--ink-2)" }}>{e.ts}</span>
          <span style={{ color: e.label.startsWith("error") ? "var(--danger)" : "var(--ink)" }}>{e.label}</span>
        </div>
      ))}
    </div>
  </div>
);

export default TechTranscript;
