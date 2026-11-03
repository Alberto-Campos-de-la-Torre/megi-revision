import React from "react";
import { Eyebrow } from "./shared";
import { api } from "../api/client";

/**
 * Autocompletado de indicaciones de rehabilitación.
 *
 * El médico no escribe los 5–8 pasos con su dosimetría: los recibe del catálogo
 * y corrige lo que haga falta. Esa corrección es el dato que hace mejor a la
 * siguiente sugerencia, así que se registra al insertar.
 *
 * Tres reglas de la interacción:
 *   - Nada entra al Plan sin que el médico pulse. Se propone, no se aplica.
 *   - La LATERALIDAD hay que elegirla: los pasos traen DERECHO/IZQUIERDO sin
 *     resolver y el botón de insertar queda bloqueado hasta que se decide. El
 *     sistema no elige lado.
 *   - Las reglas de adaptación que dispara la exploración se muestran ARRIBA,
 *     y las restricciones primero: un paso que sobra puede hacer daño.
 */

const LADOS = [
  { v: "derecho", f: "DERECHO", fa: "DERECHA" },
  { v: "izquierdo", f: "IZQUIERDO", fa: "IZQUIERDA" },
];

const resolverLado = (texto, lado) => {
  if (!lado) return texto;
  const l = LADOS.find((x) => x.v === lado);
  return texto
    .replace(/\*\*DERECHO\/IZQUIERDO\*\*/g, l.f)
    .replace(/\*\*DERECHA\/IZQUIERDA\*\*/g, l.fa);
};

// El catálogo marca la dosis con `acentos graves`; en el plan va en texto plano.
const limpiar = (t) => t.replace(/`/g, "").replace(/\*\*/g, "");

const TIPO_ESTILO = {
  restringe: { etiqueta: "No hacer", color: "var(--danger)" },
  condiciona: { etiqueta: "Solo si", color: "var(--warn)" },
  agrega: { etiqueta: "Agregar", color: "var(--sage-2)" },
};

const RehabSugerencia = ({ consultationId, soap, setSoap }) => {
  const [datos, setDatos] = React.useState(null);
  const [elegido, setElegido] = React.useState(0);
  const [lado, setLado] = React.useState("");
  const [fuera, setFuera] = React.useState(() => new Set());  // pasos descartados
  const [insertado, setInsertado] = React.useState(false);
  const [abierto, setAbierto] = React.useState(true);
  const yaRegistrado = React.useRef(new Set());   // no contar dos veces la misma

  React.useEffect(() => {
    if (!consultationId) return;
    let vivo = true;
    // Esto es apoyo: si la sugerencia falla —red, backend viejo, catálogo
    // ausente— la pantalla de revisión tiene que seguir funcionando igual.
    // El try envuelve también la llamada: un `api` sin este método lanzaría
    // de forma síncrona y el .catch() no lo vería.
    try {
      Promise.resolve(api.rehabConsulta?.(consultationId))
        // Si ya se agregó desde la consulta en vivo, el Plan ya lo tiene: no se repropone.
        .then((r) => { if (vivo && r?.es_rehabilitacion && r.protocolos?.length && !r.ya_insertado) setDatos(r); })
        .catch(() => {});
    } catch (e) { /* sin sugerencia */ }
    return () => { vivo = false; };
  }, [consultationId]);

  // Se registra que la sugerencia SE ENSEÑÓ, no solo si se usa. Un protocolo
  // mostrado que nunca se aplica es un rechazo, y ese dato no se puede
  // reconstruir después: o se graba aquí, o se pierde.
  //
  // Va ANTES del `return null`: un hook después de un return condicional
  // cambia el número de hooks entre renders, y React revienta en cuanto
  // `datos` pasa de null a tener valor. Lo cazó el linter (rules-of-hooks).
  const protocoloActual = datos && !insertado ? datos.protocolos[elegido] : null;
  React.useEffect(() => {
    if (!datos || !protocoloActual || yaRegistrado.current.has(protocoloActual.id)) return;
    yaRegistrado.current.add(protocoloActual.id);
    try {
      Promise.resolve(api.rehabMostrada?.({
        consultationId, protocoloId: protocoloActual.id,
        alternativas: datos.protocolos.map((p, i) => ({
          id: p.id, nombre: p.nombre, score: p.score, orden: i,
        })),
      })).catch(() => {});
    } catch (e) { /* el registro no estorba la consulta */ }
  }, [datos, protocoloActual, consultationId]);

  if (!datos || insertado) return null;
  const protocolo = protocoloActual;
  // Un paso que el consultorio no puede hacer entra desmarcado, pero SE VE: que
  // el médico sepa qué queda fuera es parte de la indicación.
  const sinEquipo = new Set(
    protocolo.pasos.map((p, i) => (p.equipo_estado === "sin_equipo" ? i : -1)).filter((i) => i >= 0));
  const faltaLado = protocolo.requiere_lateralidad && !lado;

  const pasosFinales = protocolo.pasos
    .filter((_, i) => !fuera.has(i) && !sinEquipo.has(i))
    .map((p) => limpiar(resolverLado(p.texto, lado)));

  const alternar = (i) => setFuera((prev) => {
    const s = new Set(prev);
    s.has(i) ? s.delete(i) : s.add(i);
    return s;
  });

  const insertar = async () => {
    const bloque = pasosFinales.map((t, i) => `${i + 1}. ${t}`).join("\n");
    const previo = (soap.P || "").trim();
    setSoap({ ...soap, P: previo ? `${previo}\n${bloque}` : bloque });
    setInsertado(true);
    // La corrección se registra aquí: propuesta contra lo que el médico se llevó.
    try {
      await api.rehabAplicar?.({
        consultationId,
        protocoloId: protocolo.id,
        pasosPropuestos: protocolo.pasos.map((p) => limpiar(resolverLado(p.texto, lado))),
        pasosAceptados: pasosFinales,
        lateralidad: lado || null,
        reglasMostradas: datos.reglas || [],
        elegidoOrden: elegido,      // 0 = se quedó con el primero; >0 = el ranking falló
      });
    } catch (e) { /* el registro no debe estorbar la consulta */ }
  };

  return (
    <div className="card" style={{ borderLeft: "2px solid var(--sage)", marginBottom: 12 }}>
      <div className="row between center" style={{ marginBottom: abierto ? 10 : 0 }}>
        <div>
          <Eyebrow>Indicaciones sugeridas · {protocolo.region}</Eyebrow>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{protocolo.nombre}</div>
        </div>
        <button type="button" className="btn sm" onClick={() => setAbierto(!abierto)}>
          {abierto ? "Ocultar" : "Ver"}
        </button>
      </div>

      {abierto && (
        <>
          {protocolo.advertencias?.map((a, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--danger)", background: "var(--cream-2)",
                                  padding: "7px 9px", borderRadius: 8, marginBottom: 8 }}>
              ⚠ {a}
            </div>
          ))}

          {!!datos.reglas?.length && (
            <div style={{ marginBottom: 10 }}>
              <div className="mono" style={{ fontSize: 9, letterSpacing: "0.1em",
                   textTransform: "uppercase", color: "var(--ink-2)", marginBottom: 5 }}>
                Por la exploración de hoy
              </div>
              {datos.reglas.map((r, i) => {
                const e = TIPO_ESTILO[r.tipo] || TIPO_ESTILO.agrega;
                return (
                  <div key={i} style={{ fontSize: 11.5, lineHeight: 1.45, marginBottom: 3 }}>
                    <span style={{ color: e.color, fontWeight: 600 }}>{e.etiqueta}:</span>{" "}
                    {limpiar(r.accion)}
                    <span style={{ color: "var(--ink-2)" }}> · {r.hallazgo}</span>
                  </div>
                );
              })}
            </div>
          )}

          {protocolo.requiere_lateralidad && (
            <div className="row g-8 center" style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: faltaLado ? "var(--danger)" : "var(--ink-2)" }}>
                Lado{faltaLado ? " — elígelo para continuar" : ""}:
              </span>
              {LADOS.map((l) => (
                <button key={l.v} type="button" className={"btn sm" + (lado === l.v ? " primary" : "")}
                        onClick={() => setLado(l.v)}>{l.f}</button>
              ))}
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            {protocolo.pasos.map((p, i) => {
              const dentro = !fuera.has(i);
              const falta = p.equipo_estado === "sin_equipo";
              const cambiado = p.equipo_estado === "sustituido";
              const activo = dentro && !falta;
              return (
                <div key={i} className="row g-8" style={{ alignItems: "flex-start", marginBottom: 4 }}>
                  <input type="checkbox" checked={activo} disabled={falta}
                         onChange={() => alternar(i)}
                         aria-label={`Incluir paso ${i + 1}`} style={{ marginTop: 3 }} />
                  <span style={{ fontSize: 12, lineHeight: 1.45,
                                 color: activo ? "var(--ink)" : "var(--ink-2)",
                                 textDecoration: activo ? "none" : "line-through" }}>
                    {limpiar(resolverLado(p.texto, lado))}
                    {falta && (
                      <em style={{ color: "var(--warn)", fontStyle: "normal", fontSize: 11 }}>
                        {" "}· no tienes {(p.falta || []).join(", ")}
                      </em>
                    )}
                    {cambiado && (
                      <em style={{ color: "var(--sage-2)", fontStyle: "normal", fontSize: 11 }}>
                        {" "}· alternativa documentada
                      </em>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="row between center wrap g-8">
            <span style={{ fontSize: 10.5, color: "var(--ink-2)" }}>
              {protocolo.fuentes?.join(" · ")}
              {protocolo.base_plantilla ? " · plantilla base" : ""}
            </span>
            <div className="row g-8">
              {datos.protocolos.length > 1 && (
                <select className="input" value={elegido} style={{ fontSize: 11, width: 190 }}
                        aria-label="Otro protocolo"
                        onChange={(e) => { setElegido(+e.target.value); setFuera(new Set()); }}>
                  {datos.protocolos.map((p, i) => (
                    <option key={p.id} value={i}>{p.nombre.slice(0, 40)}</option>
                  ))}
                </select>
              )}
              <button type="button" className="btn primary sm" onClick={insertar}
                      disabled={faltaLado || !pasosFinales.length}>
                Insertar en el plan ({pasosFinales.length})
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default RehabSugerencia;
