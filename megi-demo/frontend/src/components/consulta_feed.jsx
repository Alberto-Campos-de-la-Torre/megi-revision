// ============ SUGERENCIAS Y ALERTAS DE LA CONSULTA (en vivo) ============
// Ocupa la columna derecha de la consulta en vivo (donde antes iban la
// transcripción y los eventos técnicos, hoy en el panel técnico). Se llena
// conforme avanza la consulta, con lo que el backend devuelve en cada chunk:
//   - `alertas`: verificador FDA sobre fármacos y condiciones MENCIONADOS +
//     ficha del paciente (cita obligatoria; color por severidad);
//   - `gaps`: huecos de interrogatorio (apoyo, puede ignorarse);
//   - `rehabilitacion`: protocolo sugerido si la consulta va de rehabilitación.
// Es APOYO: nada bloquea ni pide respuesta. El médico decide.
import React from "react";
import { Eyebrow, Pill } from "./shared";
import AlertasFda from "./alertas_fda";

// El catálogo marca la dosis con `acentos graves` y la lateralidad con **…**;
// aquí se muestra en texto plano (la lateralidad se elige al insertar, en revisión).
const limpiar = (t) => String(t || "").replace(/`/g, "").replace(/\*\*/g, "");

const TIPO_REGLA = {
  restringe: { etiqueta: "No hacer", color: "var(--danger)" },
  condiciona: { etiqueta: "Solo si", color: "var(--warn)" },
  agrega: { etiqueta: "Agregar", color: "var(--sage-2)" },
};

/** Protocolo de rehabilitación detectado en vivo. "Agregar a nota SOAP" lo pega
 *  en el Plan en automático (backend: texto literal del catálogo, lado tomado de
 *  la nota si es inequívoco); el médico lo edita al revisar y aprobar.
 *  `insertado` = { lateralidad, lado_pendiente, insertados } tras agregarlo. */
const LADOS = [{ v: "derecho", f: "DERECHO" }, { v: "izquierdo", f: "IZQUIERDO" }];

const RehabEnVivo = ({ rehab, onInsertar, insertado, insertando }) => {
  const [abierto, setAbierto] = React.useState(true);
  const [lado, setLado] = React.useState("");
  const protocolo = rehab?.protocolos?.[0];
  if (!rehab?.es_rehabilitacion || !protocolo) return null;
  const otros = (rehab.protocolos || []).slice(1, 3);
  return (
    <div style={{ marginTop: 10 }} data-testid="rehab-en-vivo">
      <Eyebrow>Terapia sugerida · {protocolo.region}</Eyebrow>
      <div style={{
        fontSize: 11.5, lineHeight: 1.45, padding: "7px 9px", marginTop: 6,
        background: "var(--surface)", borderLeft: "3px solid var(--sage)",
      }}>
        <div className="row between center g-8 wrap">
          <b>{protocolo.nombre}</b>
          <div className="row g-6 center">
            {!insertado && onInsertar && (
              <button type="button" className="btn primary sm" style={{ fontSize: 10, padding: "2px 8px" }}
                disabled={insertando} onClick={() => onInsertar(protocolo.id, lado || null)}
                aria-label="Agregar el protocolo a la nota SOAP">
                {insertando ? "agregando…" : "agregar a nota SOAP"}
              </button>
            )}
            <button type="button" className="btn ghost sm" style={{ fontSize: 10, padding: "2px 6px" }}
              onClick={() => setAbierto((o) => !o)} aria-expanded={abierto}>
              {abierto ? "ocultar pasos" : "ver pasos"}
            </button>
          </div>
        </div>
        {insertado && (
          <div style={{ fontSize: 11, color: "var(--sage-2)", marginTop: 4 }} role="status">
            ✓ Agregado al Plan ({insertado.insertados} pasos)
            {insertado.lado_pendiente
              ? " · lado por definir: edítalo al aprobar la nota"
              : insertado.lateralidad ? ` · lado ${insertado.lateralidad}${insertado.lateralidad_inferida ? " (tomado de la nota)" : ""}` : ""}
            . Puedes editarlo al revisar.
          </div>
        )}
        {!insertado && protocolo.requiere_lateralidad && onInsertar && (
          <div className="row g-6 center" style={{ marginTop: 4, fontSize: 10.5, color: "var(--ink-2)" }}>
            Lado (opcional; si no lo eliges se toma de la nota):
            {LADOS.map((l) => (
              <button key={l.v} type="button" className={"btn sm" + (lado === l.v ? " primary" : "")}
                style={{ fontSize: 10, padding: "1px 6px" }} onClick={() => setLado(lado === l.v ? "" : l.v)}>{l.f}</button>
            ))}
          </div>
        )}
        {abierto && (
          <>
            {!!rehab.reglas?.length && (
              <div style={{ margin: "6px 0 4px" }}>
                {rehab.reglas.map((r, i) => {
                  const e = TIPO_REGLA[r.tipo] || TIPO_REGLA.agrega;
                  return (
                    <div key={i} style={{ fontSize: 11 }}>
                      <span style={{ color: e.color, fontWeight: 600 }}>{e.etiqueta}:</span> {limpiar(r.accion)}
                      {r.hallazgo && <span style={{ color: "var(--ink-2)" }}> · {r.hallazgo}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {(protocolo.pasos || []).map((p, i) => (
                <li key={i} style={{ fontSize: 11.5, marginBottom: 2 }}>{limpiar(p.texto)}</li>
              ))}
            </ol>
            <div style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 6 }}>
              {insertado ? "Ya está en el Plan; ajusta pasos y dosis al revisar." : "Al agregar entra completo al Plan; quitas o editas pasos al revisar."}
              {otros.length > 0 && ` Otras opciones: ${otros.map((o) => o.nombre).join(" · ")}.`}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// `finished`: la nota ya se consolidó; lo que hay se conserva para revisarlo con ella.
const ConsultaFeed = ({ alertas, gaps, rehab, recording, finished, onInsertarRehab, rehabInsertado, rehabInsertando }) => {
  const lista = alertas?.alertas || [];
  const huecos = Array.isArray(gaps) ? gaps : [];
  const altas = lista.filter((a) => a.severidad === "absoluta" || a.severidad === "mayor").length;
  const hayRehab = !!(rehab?.es_rehabilitacion && rehab?.protocolos?.length);
  const vacio = !lista.length && !huecos.length && !hayRehab && !alertas?.error;
  return (
    <div data-testid="consulta-feed">
      <div className="row between center">
        <Eyebrow>Sugerencias y alertas de la consulta</Eyebrow>
        {lista.length > 0 && (
          <Pill variant={altas ? "danger" : "gold"}>{altas ? `${altas} alerta(s) alta(s)` : `${lista.length} aviso(s)`}</Pill>
        )}
      </div>
      {vacio && (
        <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic", marginTop: 8, lineHeight: 1.5 }}>
          {recording
            ? "Escuchando… Las alertas de seguridad (fármacos y condiciones mencionados) y las sugerencias de interrogatorio aparecerán aquí conforme avance la consulta."
            : finished
              ? "La consulta no generó sugerencias ni alertas."
              : "Inicia la consulta: aquí irán apareciendo alertas de seguridad y sugerencias mientras hablas."}
        </div>
      )}

      {huecos.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Eyebrow>Sugerencias de interrogatorio · pueden ignorarse</Eyebrow>
          <div className="col g-6" style={{ marginTop: 6 }}>
            {huecos.map((g, i) => (
              <div key={g.id || i} style={{
                fontSize: 11.5, lineHeight: 1.45, padding: "7px 9px",
                background: "var(--surface)", borderLeft: "3px solid var(--sage-2)",
              }}>
                <div>{g.texto}</div>
                {g.razon && <div style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 2 }}>{g.razon}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <RehabEnVivo rehab={rehab} onInsertar={onInsertarRehab} insertado={rehabInsertado} insertando={rehabInsertando} />

      <AlertasFda seguridad={alertas} title="Alertas de seguridad (FDA) · en vivo" />
    </div>
  );
};

export default ConsultaFeed;
