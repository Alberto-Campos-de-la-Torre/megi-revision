import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";
import EstudiosPaciente from "./estudios_paciente";

// ============ RADIOLOGÍA MEGI ============
// Sustituye al apartado de informes dictados. Arriba, los modelos de
// radiodiagnóstico: tórax, columna, abdomen y ecografía; resonancia en desarrollo. Abajo, el paciente y la misma zona de subida que
// la pantalla previa al SOAP: cada estudio se identifica solo (Megi_tipo_estudio)
// y se manda al modelo que le corresponde; la lectura y el chat aparecen debajo.
// Los estudios cuelgan de la «carpeta» de radiología del paciente (una consulta
// de status 'radiologia' que no aparece en su historial clínico).

const ESTADO = {
  disponible: { label: "conectado", variant: "sage" },
  sin_servicio: { label: "servicio de modelos apagado", variant: "danger" },
  en_camino: { label: "en camino", variant: "gold" },
};

export const TarjetaModelo = ({ m }) => {
  const clave = m.estado === "en_camino" ? "en_camino" : (m.conectado ? "disponible" : "sin_servicio");
  const e = ESTADO[clave];
  return (
    <div className="card" style={{ padding: 12, opacity: clave === "en_camino" ? 0.85 : 1, borderStyle: clave === "en_camino" ? "dashed" : "solid" }}
         role="listitem" aria-label={m.nombre}>
      <div className="row between center" style={{ gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{m.nombre}</div>
        <Pill variant={e.variant}>{e.label}</Pill>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>{m.estudios}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 6 }}>{m.que_hace}</div>
      <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-2)", marginTop: 6 }}>{m.modelo}</div>
    </div>
  );
};

const RadiologiaMegi = ({ patients = [] }) => {
  const [catalogo, setCatalogo] = React.useState(null);
  const [query, setQuery] = React.useState("");
  const [paciente, setPaciente] = React.useState(null);
  const [carpeta, setCarpeta] = React.useState(null);     // consulta 'radiologia' del paciente
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    api.getModelosRadiologia().then((c) => { if (alive) setCatalogo(c); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, []);

  React.useEffect(() => {
    let alive = true;
    setCarpeta(null);
    if (!paciente) return undefined;
    api.carpetaRadiologia(paciente.id).then((c) => { if (alive) setCarpeta(c); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [paciente]);

  // Sin escribir nada ya se ven pacientes (hasta 12): un clic y a subir. Con
  // texto, se filtra por nombre o CURP.
  const q = query.trim().toLowerCase();
  const coincidencias = (q ? patients.filter((p) => p.name.toLowerCase().includes(q) || (p.curp || "").toLowerCase().includes(q)) : patients).slice(0, 12);

  return (
    <div className="page" style={{ paddingTop: 12 }}>
      <div style={{ marginBottom: 18 }}>
        <Eyebrow style={{ fontSize: 12, fontWeight: 600 }}>Radiología MEGI</Eyebrow>
        <h2 className="h-section" style={{ fontSize: 24, margin: "2px 0 4px" }}>Modelos de radiodiagnóstico</h2>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
          Todos los modelos son experimentales, para investigación sin uso comercial; requieren revisión del médico.
          Sube los estudios del paciente; MEGI identifica los tipos conocidos. En Megi Eco, selecciona mama o tiroides y marca el nódulo.
          {catalogo && <> Clasificador: <span className="mono">{catalogo.clasificador}</span>.</>}
        </div>
      </div>

      {err && <div className="card" style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      <div role="list" aria-label="Modelos de radiodiagnóstico"
           style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginBottom: 20 }}>
        {(catalogo?.modelos || []).map((m) => <TarjetaModelo key={m.clave} m={m} />)}
        {!catalogo && !err && <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Cargando modelos…</div>}
      </div>

      {/* paciente */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row between center" style={{ gap: 8, flexWrap: "wrap" }}>
          <Eyebrow>Paciente</Eyebrow>
          {!paciente && <span style={{ fontSize: 12, color: "var(--ink-2)" }}>1 · Elige al paciente &nbsp;→&nbsp; 2 · Sube sus estudios abajo</span>}
        </div>
        {!paciente ? (
          <div style={{ marginTop: 8, position: "relative" }}>
            <input className="input" placeholder="Buscar paciente por nombre o CURP…" value={query} onChange={(e) => setQuery(e.target.value)}
                   aria-label="Buscar paciente" style={{ width: "100%" }} />
            {coincidencias.length > 0 && (
              <div className="col" style={{ marginTop: 6, border: "1px solid var(--hair)", borderRadius: 10, overflow: "hidden" }}>
                {coincidencias.map((p) => (
                  <button key={p.id} onClick={() => { setPaciente(p); setQuery(""); }} className="row between center"
                          style={{ textAlign: "left", background: "transparent", border: 0, borderBottom: "1px solid var(--hair)", padding: "8px 12px", cursor: "pointer" }}>
                    <span style={{ fontSize: 13.5 }}>{p.name}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)" }}>{p.id} · {p.age} años · {p.sex === "F" ? "F" : "M"}</span>
                  </button>
                ))}
              </div>
            )}
            {coincidencias.length === 0 && <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontStyle: "italic", marginTop: 8 }}>{q ? "Sin coincidencias." : "No hay pacientes registrados: da de alta uno en Pacientes."}</div>}
          </div>
        ) : (
          <div className="row between center" style={{ marginTop: 8, gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{paciente.name}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>{paciente.id} · {paciente.age} años · {paciente.sex === "F" ? "Femenino" : "Masculino"}</div>
            </div>
            <button className="btn sm" onClick={() => setPaciente(null)} aria-label="Cambiar de paciente">Cambiar de paciente</button>
          </div>
        )}
      </div>

      {paciente && carpeta && (
        <EstudiosPaciente radiologia patient={paciente} consultationId={carpeta.id}
                          ensureConsultation={() => Promise.resolve(carpeta.id)} onContinue={() => {}} onBack={() => {}} />
      )}
      {paciente && !carpeta && !err && <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Abriendo la carpeta de radiología…</div>}
      {!paciente && (
        <div aria-label="Zona de subida (elige paciente)"
             style={{ border: "2px dashed var(--hair)", borderRadius: 12, padding: "30px 16px", textAlign: "center", color: "var(--ink-2)", background: "var(--surface)" }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Aquí subirás los estudios: arrastrar archivos, elegirlos o fotografiarlos con el teléfono por QR</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Primero elige al paciente arriba. Cada estudio se identifica solo y va al modelo que le corresponde.</div>
        </div>
      )}
    </div>
  );
};

export default RadiologiaMegi;
