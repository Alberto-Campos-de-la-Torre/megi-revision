import React from "react";
import { Eyebrow } from "./shared";

/**
 * «¿Por qué viene hoy?» — se pregunta ANTES de abrir la consulta.
 *
 * Vive aparte porque hacen falta dos puertas: el expediente del paciente y la
 * agenda. Tenerlo solo en una dejaba la otra entrando con el motivo del alta,
 * que puede tener meses: quien se registró por lumbalgia en marzo puede volver
 * en julio por cefalea.
 *
 * El campo arranca VACÍO a propósito. Prellenarlo con el motivo viejo haría que
 * se aceptara sin leer — y entonces el dato parecería confirmado sin serlo, que
 * es peor que no tenerlo. Para el caso legítimo está el atajo explícito.
 */
const MotivoConsulta = ({ paciente, onConfirm, onCancel, compacto = false }) => {
  const [motivo, setMotivo] = React.useState("");
  const previo = paciente?.reason || "";

  const enviar = (e) => {
    e.preventDefault();
    const v = motivo.trim();
    if (v) onConfirm(v);
  };

  return (
    <div style={{ padding: compacto ? "10px 11px" : "12px 13px",
                  background: "var(--sage-soft)", borderRadius: "var(--radius-sm)" }}>
      <div className="row between center">
        <Eyebrow>¿Por qué viene hoy?</Eyebrow>
        {onCancel && (
          <button type="button" className="btn ghost sm" style={{ fontSize: 10 }}
                  onClick={onCancel}>Cancelar</button>
        )}
      </div>
      {previo && (
        <p style={{ fontSize: 11.5, color: "var(--ink-2)", margin: "4px 0 8px" }}>
          Se registró por «{previo}». Si hoy viene por otra cosa, escríbelo: con esto
          MEGI prepara las sugerencias y encuadra la nota desde el primer minuto.
        </p>
      )}
      <form className="row g-8" onSubmit={enviar}>
        <input className="input" autoFocus style={{ flex: 1, fontSize: 12.5 }}
               value={motivo} onChange={(e) => setMotivo(e.target.value)}
               aria-label="Motivo de la consulta de hoy"
               placeholder="p. ej. cefalea y dolor de cuello" />
        <button className="btn primary sm" type="submit" disabled={!motivo.trim()}>
          Empezar →
        </button>
      </form>
      {previo && (
        <button type="button" className="btn ghost sm" style={{ marginTop: 6, fontSize: 10 }}
                onClick={() => onConfirm(previo)}>
          Viene por lo mismo
        </button>
      )}
    </div>
  );
};

export default MotivoConsulta;
