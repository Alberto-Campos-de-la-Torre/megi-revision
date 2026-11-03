import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";

// ============ PRECONSULTA: qué preguntar según edad e historial ============
// Motor de edad determinista (reglas MX + USPSTF) + Gemma que redacta un resumen
// y prioriza. Se muestra en el expediente y como preámbulo al iniciar consulta.
// MEGI sugiere; el médico decide qué preguntar.
//
// El MOTIVO de la visita (escrito o dictado) es lo que hace que las sugerencias
// sean de HOY: sin él, quien viene por dolor de rodilla recibía exactamente las
// mismas preguntas que quien viene por tos.
//
// Desde el 21-sep el modelo también PROPONE preguntas sobre el motivo escrito
// (`preguntas_motivo`), aunque no coincida con ninguna de las 17 guías. Van en
// su propio bloque, arriba y marcadas como propuesta del modelo; las banderas
// rojas de las guías y lo de edad siguen debajo, intactas. `onPreguntasMotivo`
// las entrega al padre para que el seguimiento en vivo las vigile también.

const CAT = {
  alarma: { label: "Alarma", color: "var(--danger)" },
  interrogatorio: { label: "Preguntar", color: "var(--forest)" },
  tamizaje: { label: "Tamizaje", color: "var(--accent)" },
  vacuna: { label: "Vacuna", color: "var(--sage-2)" },
  exploracion: { label: "Explorar", color: "var(--gold)" },
};

const PreconsultaPanel = ({ patientId, compact = false, motivo = "", onPreguntasMotivo }) => {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    if (!patientId) return undefined;
    setData(null); setErr(null);
    api.getPreconsulta(patientId, { motivo })
      .then((d) => {
        if (!alive) return;
        setData(d);
        if (onPreguntasMotivo) onPreguntasMotivo(d.preguntas_motivo || []);
      })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, motivo]);

  if (err) return null; // pre-consulta es apoyo; si falla, no estorba
  if (!data) {
    return (
      <div style={{ padding: compact ? 10 : 14, border: "1px solid var(--hair)", borderRadius: 10, background: "var(--surface)" }}>
        <Eyebrow>Antes de empezar</Eyebrow>
        <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 6 }}>Analizando edad e historial…</div>
      </div>
    );
  }

  const alta = data.sugerencias.filter((s) => s.prioridad === "alta");
  const resto = data.sugerencias.filter((s) => s.prioridad !== "alta");
  const delMotivo = data.preguntas_motivo || [];
  const motivoTxt = data.motivo_de_hoy || data.motivo || "";
  const edad = data.edad || {};
  const edadTxt = edad.exacta
    ? (edad.age_years >= 2 ? `${edad.age_years} años` : edad.age_months >= 1 ? `${edad.age_months} meses` : `${edad.age_days} días`)
    : `${edad.age_years} años`;

  const Item = ({ s }) => {
    const c = CAT[s.categoria] || CAT.interrogatorio;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "78px 1fr", gap: 8, alignItems: "start", padding: "5px 0" }}>
        <span className="mono" style={{ fontSize: 8.5, letterSpacing: ".08em", textTransform: "uppercase",
          color: c.color, border: `1px solid ${c.color}`, borderRadius: 999, padding: "2px 6px", textAlign: "center" }}>
          {c.label}
        </span>
        <div>
          <span style={{ fontSize: 12.5, lineHeight: 1.4 }}>{s.texto}</span>
          <span style={{ fontSize: 10, color: "var(--ink-2)" }} className="mono"> · {s.fuente}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: compact ? 12 : 16, border: "1px solid var(--sage)", borderRadius: 12, background: "var(--sage-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <Eyebrow>Antes de empezar</Eyebrow>
        {/* El motivo es lo primero que se lee; el grupo de edad, contexto. */}
        {motivoTxt && <Pill variant="accent">Motivo: {motivoTxt}</Pill>}
        {(data.motivo_reconocido || []).map((m) => <Pill key={m}>{m}</Pill>)}
        <span style={{ fontSize: 11, color: "var(--ink-2)" }}>
          {data.grupo_label} · {edadTxt}{edad.prematuro ? " · prematuro" : ""}
        </span>
      </div>

      {motivoTxt && (data.motivo_reconocido || []).length === 0 && delMotivo.length === 0 && (
        <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginBottom: 8 }}>
          El motivo no coincide con ninguna guía cargada y el modelo no propuso preguntas:
          abajo siguen las sugerencias por edad e historial.
        </div>
      )}

      {data.resumen && (
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink)", marginBottom: 10, whiteSpace: "pre-wrap" }}>
          {data.resumen}
        </div>
      )}

      {delMotivo.length > 0 && (
        <div role="region" aria-label="Sobre el motivo"
             style={{ background: "var(--surface)", borderRadius: 8, padding: "6px 10px", marginBottom: 8,
                      borderLeft: "3px solid var(--accent)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", margin: "2px 0 2px" }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--accent)" }}>
              Sobre el motivo
            </span>
            <span style={{ fontSize: 10, color: "var(--ink-2)" }}>propuesta del modelo · revísala, no es una guía</span>
          </div>
          {delMotivo.map((s, i) => <Item key={`m${i}`} s={s} />)}
        </div>
      )}

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: "6px 10px" }}>
        {alta.length > 0 && <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--danger)", margin: "2px 0 2px" }}>Prioritario</div>}
        {alta.map((s, i) => <Item key={`a${i}`} s={s} />)}
        {resto.length > 0 && (
          <>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-2)", margin: "8px 0 2px" }}>También conviene</div>
            {resto.map((s, i) => <Item key={`r${i}`} s={s} />)}
          </>
        )}
      </div>

      <div style={{ fontSize: 10, color: "var(--ink-2)", marginTop: 8 }}>{data.nota}</div>
    </div>
  );
};

export default PreconsultaPanel;
