import React from "react";
import { api, apiBlobUrl } from "../api/client";

export const cajaValida = (caja, ancho, alto) => caja?.length === 4 && caja.every(Number.isFinite)
  && 0 <= caja[0] && caja[0] < caja[2] && caja[2] <= ancho
  && 0 <= caja[1] && caja[1] < caja[3] && caja[3] <= alto;

// Siempre se muestra la vista completa: las coordenadas se convierten al tamaño natural.
export default function EcoEstudio({ cid, estudio, onAnalizado }) {
  const [abierto, setAbierto] = React.useState(false);
  const [url, setUrl] = React.useState(null);
  const [overlay, setOverlay] = React.useState(null);
  const [tam, setTam] = React.useState([0, 0]);
  const [organo, setOrgano] = React.useState("");
  const [caja, setCaja] = React.useState(null);
  const [escala, setEscala] = React.useState("");
  const [clasificar, setClasificar] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState("");
  const inicio = React.useRef(null);
  const terminado = (estudio.analisis || []).find((a) => a.analizador === "megi_eco" && a.status === "done")?.id;

  React.useEffect(() => {
    if (!abierto) return undefined;
    let alive = true; let original; let segmentada;
    apiBlobUrl(api.estudioVistaPath(cid, estudio.id)).then((u) => {
      original = u; if (alive) setUrl(u); else URL.revokeObjectURL(u);
    }).catch((e) => { if (alive) setError(e.message); });
    setOverlay(null);
    if (terminado) apiBlobUrl(api.ecografiaVistaPath(cid, estudio.id)).then((u) => {
      segmentada = u; if (alive) setOverlay(u); else URL.revokeObjectURL(u);
    }).catch(() => {});
    return () => { alive = false; if (original) URL.revokeObjectURL(original); if (segmentada) URL.revokeObjectURL(segmentada); };
  }, [abierto, cid, estudio.id, terminado]);

  const punto = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(tam[0], (e.clientX - r.left) * tam[0] / r.width)),
      Math.max(0, Math.min(tam[1], (e.clientY - r.top) * tam[1] / r.height))].map(Math.round);
  };
  const mover = (e) => {
    if (!inicio.current) return;
    const [x, y] = punto(e); const [a, b] = inicio.current;
    setCaja([Math.min(x, a), Math.min(y, b), Math.max(x, a), Math.max(y, b)]);
  };
  const analizar = async () => {
    setEnviando(true); setError("");
    try {
      await api.analizarEcografia(cid, estudio.id, { organo, caja_xyxy: caja,
        mm_por_pixel: escala === "" ? null : Number(escala), clasificar_tiroides: organo === "tiroides" && clasificar });
      setOverlay(null);
      await onAnalizado();
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };
  const valido = organo && cajaValida(caja, ...tam) && (escala === "" || (Number.isFinite(Number(escala)) && Number(escala) > 0));
  return <div style={{ marginTop: 8 }}>
    <button className="btn sm" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>Megi Eco · mama / tiroides</button>
    {abierto && <div style={{ marginTop: 8, fontSize: 12 }}>
      <p>EXPERIMENTAL · Investigación, sin uso comercial. Selecciona el órgano y arrastra una caja alrededor del nódulo en la imagen completa.</p>
      <label>Órgano <select aria-label="Órgano ecográfico" value={organo} onChange={(e) => setOrgano(e.target.value)}>
        <option value="">Seleccionar…</option><option value="mama">Mama · consenso y clasificación</option>
        <option value="tiroides">Tiroides · segmentación multimáscara</option>
      </select></label>
      {url && <div style={{ position: "relative", maxWidth: 680, margin: "8px 0" }}>
        <img src={url} alt="Ecografía completa para marcar el nódulo" draggable={false}
          onLoad={(e) => setTam([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} style={{ display: "block", width: "100%" }} />
        <svg role="img" aria-label="Marcar caja del nódulo" viewBox={`0 0 ${tam[0] || 1} ${tam[1] || 1}`}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "crosshair", touchAction: "none" }}
          onPointerDown={(e) => { inicio.current = punto(e); setCaja(null); e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={mover} onPointerUp={(e) => { mover(e); inicio.current = null; }} onPointerCancel={() => { inicio.current = null; }}>
          {caja && <rect x={caja[0]} y={caja[1]} width={caja[2] - caja[0]} height={caja[3] - caja[1]} fill="#00dcb433" stroke="#ffd200" strokeWidth="2" />}
        </svg>
      </div>}
      <div className="row g-6" style={{ flexWrap: "wrap", margin: "8px 0" }}>
        {["X inicial", "Y inicial", "X final", "Y final"].map((label, i) => <label key={label}>{label}
          <input aria-label={label} type="number" min="0" value={caja?.[i] ?? ""} style={{ width: 70 }}
            onChange={(e) => { const c = [...(caja || [0, 0, 0, 0])]; c[i] = Number(e.target.value); setCaja(c); }} /></label>)}
      </div>
      <label>Escala del estudio (mm/píxel, opcional) <input aria-label="Escala mm por píxel" type="number" min="0" step="any" value={escala} onChange={(e) => setEscala(e.target.value)} /></label>
      <p>Sin escala, las medidas se expresan en píxeles. No calcula BI-RADS ni TI-RADS.</p>
      {organo === "tiroides" && <label><input type="checkbox" checked={clasificar} onChange={(e) => setClasificar(e.target.checked)} /> Activar clasificación tiroidea experimental (entrenamiento sin identificadores de paciente)</label>}
      <div style={{ marginTop: 8 }}><button className="btn primary sm" disabled={!valido || enviando || estudio.analisis_estado === "analizando"} onClick={analizar}>
        {enviando || estudio.analisis_estado === "analizando" ? "Analizando…" : "Analizar con Megi Eco"}</button></div>
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {overlay && <figure style={{ margin: "12px 0" }}><img src={overlay} alt="Segmentación experimental MEGI Eco" style={{ maxWidth: "100%", maxHeight: 560 }} />
        <figcaption>Máscara del modelo en verde y caja manual en amarillo. Revisa la delimitación.</figcaption></figure>}
    </div>}
  </div>;
}
