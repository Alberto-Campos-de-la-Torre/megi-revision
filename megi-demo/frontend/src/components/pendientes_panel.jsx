import React from "react";
import { Eyebrow } from "./shared";

// ============ FALTA PREGUNTAR (sugerencias en vivo) ============
// Lo que aún no se ha escuchado en la consulta, cruzando las sugerencias del
// motivo contra el transcript confirmado. El cálculo es determinista y vive en
// el backend (`services/cobertura.py`); aquí solo se pinta.
//
// Las alarmas se distinguen en rojo y llegan siempre arriba: son lo que no se
// puede pasar por alto mientras se habla con el paciente.

const PendientesPanel = ({ datos }) => {
  const lista = datos?.pendientes || [];
  if (!lista.length) return null;

  return (
    <div style={{ marginBottom: 14, padding: "8px 10px", borderRadius: 8,
                  background: "var(--sage-soft)", border: "1px solid var(--sage)" }}>
      <div className="row between center" style={{ marginBottom: 4 }}>
        <Eyebrow>Falta preguntar</Eyebrow>
        <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)" }}>
          {datos.n_cubiertas}/{datos.n_seguidas} cubierto
        </span>
      </div>
      <div className="col g-4">
        {lista.map((p, i) => {
          const esAlarma = p.categoria === "alarma";
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "58px 1fr", gap: 8, alignItems: "start" }}>
              <span className="mono" style={{
                fontSize: 8.5, letterSpacing: ".07em", textTransform: "uppercase", textAlign: "center",
                padding: "2px 5px", borderRadius: 999,
                color: esAlarma ? "var(--danger)" : "var(--ink-2)",
                border: `1px solid ${esAlarma ? "var(--danger)" : "var(--hair)"}`,
              }}>
                {esAlarma ? "Alarma" : "Preguntar"}
              </span>
              <span style={{ fontSize: 11.5, lineHeight: 1.4 }}>{p.texto}</span>
            </div>
          );
        })}
      </div>
      {datos.n_ocultas > 0 && (
        <div style={{ fontSize: 10, color: "var(--ink-2)", marginTop: 6 }}>
          y {datos.n_ocultas} más
        </div>
      )}
    </div>
  );
};

export default PendientesPanel;
