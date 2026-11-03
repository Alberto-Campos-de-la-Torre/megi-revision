import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";

// ============ ESTADÍSTICAS (v0.0.1) ============
const STATUS_LABEL = {
  draft: "Borrador", in_review: "En revisión", approved: "Aprobada", exported: "Exportada",
};

const Estadisticas = () => {
  const [stats, setStats] = React.useState(null);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    api.getStats().then((s) => { if (alive) setStats(s); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, []);

  const cards = stats ? [
    { k: "Pacientes registrados", v: stats.patients_total },
    { k: "En espera", v: stats.patients_waiting, color: "var(--gold)" },
    { k: "Consultas totales", v: stats.consultations_total, color: "var(--accent)" },
    { k: "Notas finalizadas", v: stats.consultations_finalized, color: "var(--sage-2)" },
    { k: "Aprobadas / exportadas", v: stats.consultations_approved, color: "var(--forest)" },
  ] : [];

  return (
    <div className="page">
      <div style={{ marginBottom: 24 }}>
        <Eyebrow style={{ fontSize: 12, fontWeight: 600 }}>Resumen</Eyebrow>
        <h1 className="h-page" style={{ marginTop: 8 }}>Estadísticas</h1>
        <p style={{ marginTop: 8, color: "var(--ink-2)", fontSize: 14 }}>
          Actividad de la práctica, derivada del expediente local.
        </p>
      </div>

      {err && (
        <div className="card" style={{ borderLeft: "3px solid var(--danger)" }}>
          <Eyebrow>No se pudieron cargar las estadísticas</Eyebrow>
          <div style={{ fontSize: 13, marginTop: 6, color: "var(--ink-2)" }}>{err}</div>
        </div>
      )}

      {!err && !stats && <div style={{ color: "var(--ink-2)", fontSize: 13 }}>Cargando…</div>}

      {stats && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
            {cards.map((c, i) => (
              <div key={i} className="card">
                <Eyebrow>{c.k}</Eyebrow>
                <div className="mono" style={{ fontSize: 40, lineHeight: 1, color: c.color || "var(--ink)", fontWeight: 300, marginTop: 10 }}>
                  {String(c.v).padStart(2, "0")}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <Eyebrow>Consultas por estado</Eyebrow>
            <div className="col g-8" style={{ marginTop: 12 }}>
              {Object.keys(stats.by_status || {}).length === 0 && (
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic" }}>Aún no hay consultas.</div>
              )}
              {Object.entries(stats.by_status || {}).map(([status, n]) => (
                <div key={status} className="row between center" style={{ paddingBottom: 8, borderBottom: "1px dashed var(--hair)" }}>
                  <span style={{ fontSize: 13 }}>{STATUS_LABEL[status] || status}</span>
                  <Pill>{n}</Pill>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Estadisticas;
