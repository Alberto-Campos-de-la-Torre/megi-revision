// ============ ALERTAS DE SEGURIDAD FDA (tabla de contraindicaciones FDA_movil) ============
// Muestra las alertas que devuelve el verificador (`/api/drugs/check` o el bloque
// `alertas_seguridad` del cierre del SOAP): color por severidad, cita textual
// desplegable y aviso cuando la fuente es la etiqueta en inglés sin validar.
// Es APOYO: contenido regulatorio de EE.UU. (puede diferir de COFEPRIS); el médico decide.
import React from "react";
import { Eyebrow } from "./shared";

const SEV = {
  absoluta: { color: "var(--danger)", label: "absoluta" },
  mayor: { color: "var(--danger)", label: "mayor" },
  moderada: { color: "var(--warn)", label: "moderada" },
  menor: { color: "var(--ink-2)", label: "menor" },
};

const TIPO = {
  farmaco_condicion: "fármaco · condición",
  farmaco_farmaco: "fármaco · fármaco",
  alergia: "alergia",
};

const contraQue = (a) => a.alergia || a.condicion || a.con_farmaco || a.objeto || "";

const AlertaFda = ({ alerta }) => {
  const [open, setOpen] = React.useState(false);
  const sev = SEV[alerta.severidad] || SEV.menor;
  const en = alerta.fuente === "en_sin_validar";
  return (
    <div style={{
      fontSize: 11.5, lineHeight: 1.45, padding: "7px 9px",
      borderLeft: `3px solid ${sev.color}`, background: "var(--surface)",
    }}>
      <div className="row between center g-8">
        <span>
          <span className="mono" style={{ color: sev.color, fontSize: 10, letterSpacing: ".04em" }}>
            [{sev.label}]
          </span>{" "}
          <b>{alerta.farmaco}</b> · {contraQue(alerta)}
          <span style={{ color: "var(--ink-2)" }}>
            {" "}· {TIPO[alerta.tipo_alerta] || alerta.seccion}
            {alerta.clase ? ` (por clase: ${alerta.clase})` : ""}
            {alerta.otras_citas?.length ? ` · ${alerta.otras_citas.length + 1} citas` : ""}
          </span>
        </span>
        {alerta.cita && (
          <button type="button" className="btn ghost sm" style={{ fontSize: 10, padding: "2px 6px" }}
            onClick={() => setOpen((o) => !o)} aria-expanded={open}
            aria-label={open ? "Ocultar cita de la etiqueta FDA" : "Ver cita de la etiqueta FDA"}>
            {open ? "ocultar cita" : "ver cita"}
          </button>
        )}
      </div>
      {open && alerta.cita && (
        <div style={{ marginTop: 5, fontSize: 11, color: "var(--ink-2)", fontStyle: "italic" }}>
          «{alerta.cita}»
          <span className="mono" style={{ fontStyle: "normal", fontSize: 10 }}>
            {" "}— {alerta.seccion}{alerta.evidencias ? ` · ${alerta.evidencias} evidencia(s)` : ""}
          </span>
          {/* La misma condición aparece en otras secciones/etiquetas: se fusionan en
              una alerta y sus citas quedan aquí, no como tarjetas repetidas. */}
          {(alerta.otras_citas || []).map((o, i) => (
            <div key={i} style={{ marginTop: 4 }}>
              «{o.cita}»
              <span className="mono" style={{ fontStyle: "normal", fontSize: 10 }}>
                {" "}— {o.seccion} · {o.severidad}{o.fuente === "en_sin_validar" ? " · inglés sin validar" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {en && (
        <div style={{ marginTop: 3, fontSize: 10, color: "var(--gold)" }} title="La etiqueta aún no está traducida ni validada">
          ⚠ texto original en inglés · traducción no validada
        </div>
      )}
    </div>
  );
};

/** `seguridad` = { alertas: [...], resumen: {absoluta, mayor, ...}, error? } */
const AlertasFda = ({ seguridad, title = "Seguridad de la receta (FDA)" }) => {
  const alertas = seguridad?.alertas || [];
  if (!alertas.length && !seguridad?.error) return null;
  const altas = alertas.filter((a) => a.severidad === "absoluta" || a.severidad === "mayor");
  return (
    <div style={{ marginTop: 12 }} data-testid="alertas-fda">
      <Eyebrow>{title}</Eyebrow>
      {seguridad?.error && (
        <div style={{ fontSize: 11, color: "var(--ink-2)", fontStyle: "italic", marginTop: 4 }}>
          Verificador FDA no disponible ({seguridad.error}).
        </div>
      )}
      {alertas.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--ink-2)", margin: "4px 0 6px" }}>
          {altas.length} de severidad absoluta/mayor · {alertas.length} en total. Apoyo con etiquetas FDA
          (EE.UU.; puede diferir de COFEPRIS). El médico decide.
        </div>
      )}
      <div className="col g-6">
        {alertas.map((a, i) => <AlertaFda key={`${a.farmaco}-${a.seccion}-${contraQue(a)}-${i}`} alerta={a} />)}
      </div>
    </div>
  );
};

export default AlertasFda;
