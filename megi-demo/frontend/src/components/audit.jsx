import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";
import AudioPlayer from "./audio_player";

// ============ AUDITORÍA DE CONSULTA (ventana dedicada) ============
const SECTIONS = [
  { k: "S", name: "Subjetivo" }, { k: "O", name: "Objetivo" },
  { k: "A", name: "Análisis" }, { k: "P", name: "Plan" },
];

const fmt = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch (e) { return iso; }
};

const Block = ({ title, children }) => (
  <section className="card" style={{ marginBottom: 16 }}>
    <Eyebrow>{title}</Eyebrow>
    <div style={{ marginTop: 10 }}>{children}</div>
  </section>
);

const Audit = ({ consultationId }) => {
  const [a, setA] = React.useState(null);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    api.getAudit(consultationId).then(setA).catch((e) => setErr(e.message));
  }, [consultationId]);

  if (err) return <div style={{ padding: 40, color: "var(--danger)", fontFamily: "var(--font-ui)" }}>No se pudo cargar la auditoría: {err}</div>;
  if (!a) return <div style={{ padding: 40, color: "var(--ink-2)", fontFamily: "var(--font-ui)" }}>Cargando auditoría…</div>;

  const note = a.note || {};
  const doctor = note.doctor;        // nota aprobada por el médico (puede ser null)
  const ai = note.ai || {};
  const changed = new Set(note.changed_sections || []);

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 24px 60px", fontFamily: "var(--font-ui)", color: "var(--ink)" }}>
      {/* encabezado */}
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <Pill variant="sage">Auditoría · solo lectura</Pill>
        <div className="row g-8">
          <button className="btn ghost sm" onClick={() => window.close()}>Cerrar</button>
          <button className="btn primary sm" onClick={() => window.print()}>⎙ Imprimir</button>
        </div>
      </div>

      <h1 className="h-page" style={{ fontSize: 30 }}>Auditoría de consulta</h1>
      <div className="mono" style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 6 }}>{a.consultation.id}</div>
      <p style={{ color: "var(--ink-2)", fontSize: 14, marginTop: 8, marginBottom: 22 }}>
        {a.patient.name} · {a.patient.age} años · {a.patient.sex === "F" ? "Femenino" : "Masculino"} · {a.patient.id}
      </p>

      {/* FIRMA / RESPONSABLE */}
      <Block title="Aprobación y firma">
        <div className="kv">
          <dt>Estado</dt><dd>{a.consultation.status}</dd>
          <dt>Aprobó / firmó</dt><dd>{a.signer.by || <span style={{ color: "var(--ink-2)" }}>— (sin aprobación registrada)</span>}</dd>
          <dt>Fecha y hora</dt><dd className="mono" style={{ fontSize: 12 }}>{fmt(a.signer.at)}</dd>
          <dt>Sello (hash)</dt><dd className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{a.signer.seal_hash || "—"}</dd>
          <dt>Tipo de firma</dt><dd>{a.signer.signature || "—"} <span style={{ color: "var(--ink-2)", fontSize: 11 }}>(no legal en esta versión)</span></dd>
        </div>
      </Block>

      {/* ¿EDITÓ EL MÉDICO? */}
      <Block title="¿El médico editó la nota?">
        {note.edited === null ? (
          <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
            No se registró una nota aprobada por el médico para esta consulta (se muestra la nota generada por IA).
          </div>
        ) : note.edited ? (
          <div className="row center g-10">
            <Pill variant="gold">Sí, editó</Pill>
            <span style={{ fontSize: 13 }}>Secciones modificadas: <strong>{(note.changed_sections || []).join(", ")}</strong></span>
          </div>
        ) : (
          <div className="row center g-10">
            <Pill variant="accent">Sin cambios</Pill>
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>El médico aprobó la nota de IA sin editarla.</span>
          </div>
        )}
      </Block>

      {/* NOTA: médico vs IA */}
      <Block title="Nota médica (aprobada vs generada por IA)">
        {SECTIONS.map((s) => {
          const dv = doctor ? (doctor[s.k] || "") : "";
          const av = ai[s.k] || "";
          const isChanged = changed.has(s.k);
          return (
            <div key={s.k} style={{ padding: "12px 0", borderBottom: "1px dashed var(--hair)" }}>
              <div className="row center g-8" style={{ marginBottom: 4 }}>
                <span style={{ fontFamily: "var(--font-logo)", fontWeight: 700, color: "var(--forest)" }}>{s.k}</span>
                <Eyebrow>{s.name}</Eyebrow>
                {isChanged && <Pill variant="gold">editado</Pill>}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                {doctor ? (dv || "—") : (av || "—")}
              </div>
              {isChanged && (
                <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: "2px solid var(--hair)" }}>
                  <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Versión IA original</div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--ink-2)", marginTop: 2 }}>{av || "—"}</div>
                </div>
              )}
            </div>
          );
        })}
      </Block>

      {/* RECETA */}
      <Block title="Receta">
        {a.prescription.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-2)" }}>Sin medicamentos registrados.</div>
        ) : (
          <div className="col g-8">
            {a.prescription.map((r, i) => (
              <div key={i} style={{ fontSize: 13 }}>
                <strong>{r.drug}</strong> {r.dose} {r.freq ? `· ${r.freq}` : ""} {r.indication ? `· ${r.indication}` : ""}
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 6 }}>
              Avalada por <strong>{a.signer.by || "—"}</strong> el {fmt(a.signer.at)}.
            </div>
          </div>
        )}
      </Block>

      {/* SEGURIDAD DE LA RECETA */}
      {a.safety && (a.safety.alerts.length > 0 || a.safety.ack != null) && (
        <Block title="Verificación de seguridad de la receta">
          {a.safety.alerts.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--ink-2)" }}>Sin alertas al momento de aprobar.</div>
          ) : (
            <div className="col g-6">
              {a.safety.alerts.map((s, i) => (
                <div key={i} style={{ fontSize: 12.5, lineHeight: 1.45, paddingLeft: 10, borderLeft: `3px solid ${s.severity === "blocker" ? "var(--danger)" : "var(--warn)"}` }}>
                  {s.message}
                </div>
              ))}
            </div>
          )}
          {a.safety.ack === true && (
            <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>
              El médico <strong>confirmó y asumió la responsabilidad</strong> de prescribir a pesar de la alerta de alergia.
            </div>
          )}
        </Block>
      )}

      {/* DX */}
      {a.dx.length > 0 && (
        <Block title="Diagnósticos (CIE-10)">
          <div className="col g-6">
            {a.dx.map((d, i) => (
              <div key={i} style={{ fontSize: 13 }}><span className="mono" style={{ color: "var(--forest)" }}>{d.code || "—"}</span> · {d.label || "—"}</div>
            ))}
          </div>
        </Block>
      )}

      {/* VALIDACIÓN */}
      <Block title="Alertas de seguridad (validación)">
        {(() => {
          const flags = (a.validation && a.validation.flags) || [];
          const warns = (a.validation && a.validation.warnings) || [];
          const all = [...flags.map((f) => f.message || String(f)), ...warns.map((w) => typeof w === "string" ? w : w.message)];
          if (all.length === 0) return <div style={{ fontSize: 13, color: "var(--ink-2)" }}>Sin alertas registradas.</div>;
          return <div className="col g-6">{all.map((t, i) => <div key={i} style={{ fontSize: 12.5, borderLeft: "3px solid var(--warn)", paddingLeft: 10 }}>{t}</div>)}</div>;
        })()}
      </Block>

      {/* FUENTES */}
      {a.sources.length > 0 && (
        <Block title="Fuentes clínicas citadas (GPC)">
          <div className="col g-4">
            {a.sources.map((s, i) => (
              <div key={i} className="mono" style={{ fontSize: 10.5, color: "var(--gold)" }}>↳ {s.citation}</div>
            ))}
          </div>
        </Block>
      )}

      {/* DOCUMENTOS GENERADOS */}
      {a.documents && a.documents.length > 0 && (
        <Block title="Documentos generados">
          <div className="col g-8">
            {a.documents.map((d, i) => {
              const label = { referencia: "Referencia / interconsulta", orden_estudios: "Orden de estudios", incapacidad: "Incapacidad / certificado" }[d.kind] || d.kind;
              return (
                <div key={i} style={{ fontSize: 12.5 }}>
                  <strong>{label}</strong> · firmó: {d.created_by || "—"} · <span className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>{fmt(d.created_at)}</span>
                  <div className="mono" style={{ fontSize: 10, color: "var(--gold)", wordBreak: "break-all" }}>{d.content_hash}</div>
                </div>
              );
            })}
          </div>
        </Block>
      )}

      {/* LÍNEA DE TIEMPO */}
      <Block title="Línea de tiempo (metadatos)">
        <div className="col g-6">
          <div style={{ fontSize: 12.5 }}>Inicio: <span className="mono">{fmt(a.consultation.started_at)}</span></div>
          <div style={{ fontSize: 12.5 }}>Nota finalizada (IA): <span className="mono">{fmt(a.consultation.finalized_at)}</span></div>
          {a.timeline.map((e, i) => (
            <div key={i} className="row g-10" style={{ fontSize: 12 }}>
              <span className="mono" style={{ color: "var(--ink-2)", minWidth: 150 }}>{fmt(e.at)}</span>
              <span>{e.kind}{e.actor ? ` · ${e.actor}` : ""}{e.hash ? ` · ${e.hash.slice(0, 22)}…` : ""}</span>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 6 }}>
            {a.counts.soap_patches} actualizaciones incrementales · {a.counts.audio_segments} segmentos de audio
          </div>
        </div>
      </Block>

      {/* AUDIO */}
      <Block title="Audio de la consulta">
        {a.has_audio ? (
          <div className="no-print"><AudioPlayer path={`/consultations/${a.consultation.id}/audio.wav`} /></div>
        ) : <div style={{ fontSize: 13, color: "var(--ink-2)" }}>Sin audio.</div>}
      </Block>

      {/* TRANSCRIPCIÓN */}
      <Block title="Transcripción original">
        <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 360, overflowY: "auto" }}>
          {a.transcript || "—"}
        </div>
      </Block>
    </div>
  );
};

export default Audit;
