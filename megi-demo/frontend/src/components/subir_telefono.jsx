import React from "react";
import { api } from "../api/client";

// ============ PÁGINA DEL TELÉFONO: /subir/<código> ============
// Se abre al escanear el QR de la pantalla de estudios. Sin sesión: el código
// es la única credencial, vale 15 minutos y solo para esa consulta. Aquí no se
// ve nada del expediente, solo el nombre corto del paciente para confirmar
// que se está subiendo a la persona correcta.
//
// `capture="environment"` abre la cámara trasera directamente en iPhone y
// Android; el segundo botón deja elegir de la galería o de Archivos (PDF).

const MobileBtn = ({ children, ...rest }) => (
  <label className="btn primary" style={{ display: "block", textAlign: "center", padding: "16px 12px", fontSize: 15, cursor: "pointer" }} {...rest}>
    {children}
  </label>
);

const SubirTelefono = ({ token }) => {
  const [info, setInfo] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [restante, setRestante] = React.useState(null);
  const [subidas, setSubidas] = React.useState([]);   // {nombre, estado: subiendo|ok|error, detalle}
  const [enVuelo, setEnVuelo] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    api.subidaInfo(token)
      .then((d) => { if (alive) { setInfo(d); setRestante(d.expira_en_s); } })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [token]);

  React.useEffect(() => {
    if (restante === null) return undefined;
    const t = setInterval(() => setRestante((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [restante === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const subir = async (files) => {
    const lista = Array.from(files || []);
    if (!lista.length) return;
    for (const f of lista) {
      const nombre = f.name || "foto.jpg";
      setSubidas((s) => [...s, { nombre, estado: "subiendo" }]);
      setEnVuelo((n) => n + 1);
      try {
        await api.subidaArchivo(token, f);
        setSubidas((s) => s.map((x) => (x.nombre === nombre && x.estado === "subiendo" ? { ...x, estado: "ok" } : x)));
      } catch (e) {
        setSubidas((s) => s.map((x) => (x.nombre === nombre && x.estado === "subiendo" ? { ...x, estado: "error", detalle: e.message } : x)));
      } finally {
        setEnVuelo((n) => n - 1);
      }
    }
  };

  const caducado = restante === 0;
  const ok = subidas.filter((s) => s.estado === "ok").length;

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "20px 16px", fontFamily: "var(--font-body)" }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".12em", color: "var(--ink-2)", textTransform: "uppercase" }}>MEGI · estudios del paciente</div>
      {err && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Este código no sirve</div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6 }}>{err}. Pide al médico que genere otro QR y vuelve a escanearlo.</div>
        </div>
      )}
      {!err && !info && <div style={{ marginTop: 14, fontSize: 13, color: "var(--ink-2)" }}>Comprobando el código…</div>}
      {info && (
        <>
          <h1 style={{ fontSize: 22, margin: "10px 0 2px" }}>Subir estudios de {info.paciente}</h1>
          <div className="mono" style={{ fontSize: 11.5, color: caducado ? "var(--danger)" : "var(--ink-2)" }}>
            {caducado ? "El código caducó: pide otro QR." : `El código caduca en ${Math.floor(restante / 60)}:${String(restante % 60).padStart(2, "0")}`}
          </div>

          <div className="col g-10" style={{ marginTop: 18 }}>
            <MobileBtn aria-label="Tomar foto">
              📷 Tomar foto del estudio
              <input type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }}
                     disabled={caducado} onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
            </MobileBtn>
            <label className="btn" style={{ display: "block", textAlign: "center", padding: "14px 12px", fontSize: 14, cursor: "pointer" }} aria-label="Elegir de la galería o archivos">
              Elegir de la galería o archivos (foto, PDF, DICOM, ECG, CSV)
              <input type="file" accept="image/*,.heic,.heif,application/pdf,.pdf,.dcm,.dicom,.hea,.dat,.atr,.csv" multiple style={{ display: "none" }}
                     disabled={caducado} onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
            </label>
          </div>

          {subidas.length > 0 && (
            <div className="card" style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginBottom: 6 }}>
                {ok} de {subidas.length} subido{subidas.length !== 1 ? "s" : ""}{enVuelo ? " · subiendo…" : ""}
              </div>
              {subidas.map((s, i) => (
                <div key={i} className="row between center" style={{ padding: "6px 0", borderTop: i ? "1px solid var(--hair)" : 0, fontSize: 13 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{s.nombre}</span>
                  <span style={{ color: s.estado === "ok" ? "var(--forest)" : s.estado === "error" ? "var(--danger)" : "var(--ink-2)", marginLeft: 8, whiteSpace: "nowrap" }}>
                    {s.estado === "ok" ? "✓ listo" : s.estado === "error" ? `✗ ${s.detalle}` : "…"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 18, lineHeight: 1.45 }}>
            Las fotos van directo a la consulta de hoy en el equipo del médico. Hasta {info.max} archivos de {info.max_mb} MB. Esta página no muestra nada del expediente.
          </div>
        </>
      )}
    </div>
  );
};

export default SubirTelefono;
