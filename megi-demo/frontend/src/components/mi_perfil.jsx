import React from "react";
import { api } from "../api/client";

// ============ MI PERFIL PROFESIONAL ============
// Lo que se imprime en recetas, referencias, órdenes e incapacidades sale de
// aquí: nombre, especialidad y CÉDULA PROFESIONAL. Son documentos legales y la
// cédula identifica a quien responde por ellos, así que cada médico tiene el
// suyo — antes había uno solo para toda la instalación.
const CAMPOS = [
  { k: "name", label: "Nombre completo", req: true, ph: "Dra. Ana Ruiz Salas" },
  { k: "cedula", label: "Cédula profesional", req: true, ph: "1234567" },
  { k: "specialty", label: "Especialidad", ph: "Medicina Interna" },
  { k: "cedula_esp", label: "Cédula de especialidad", ph: "7654321" },
  { k: "institution", label: "Institución / consultorio", ph: "Centro Médico…" },
  { k: "address", label: "Dirección", ph: "Av. … , CDMX" },
  { k: "phone", label: "Teléfono", ph: "55 0000 0000" },
];

// Equipo del consultorio. En consulta privada cada médico tiene lo suyo, y de
// esto depende qué indicaciones se le pueden sugerir: el catálogo cubre 39
// protocolos con CHC y solo 8 con láser. Sin perfil no se filtra nada — no
// saber qué hay no es lo mismo que saber que no hay.
const EQUIPO = [
  "CHC", "US", "C.I.", "TENS", "Láser", "Parafina",
  "Fluidoterapia", "Corrientes rusas", "Exponenciales", "Compresa fría",
];

const MiPerfil = ({ onDone, onCancel }) => {
  const [form, setForm] = React.useState(null);
  const [equipo, setEquipo] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [ok, setOk] = React.useState(false);

  React.useEffect(() => {
    api.getMe()
      .then((d) => {
        setForm(Object.fromEntries(CAMPOS.map((c) => [c.k, d[c.k] || ""])));
        setEquipo(Array.isArray(d.equipo) ? d.equipo : []);
      })
      .catch(() => setErr("No se pudo cargar tu perfil."));
  }, []);

  const submit = async (e) => {
    e?.preventDefault();
    if (busy || !form) return;
    if (!form.name.trim() || !form.cedula.trim()) {
      setErr("Nombre y cédula profesional son obligatorios: se imprimen en la receta.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      await api.updateMe({ ...form, equipo });
      setOk(true);
      setTimeout(() => onDone?.(), 700);
    } catch (e2) {
      setErr(e2.message || "No se pudo guardar.");
      setBusy(false);
    }
  };

  if (!form) return <div className="card" style={{ margin: 40, padding: 24 }}>Cargando perfil…</div>;

  return (
    <div className="card" style={{ maxWidth: 640, margin: "40px auto", padding: 28 }}>
      <h2 className="h-section">Mi perfil profesional</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 13, lineHeight: 1.5 }}>
        Estos datos se imprimen en <strong>recetas, referencias, órdenes de estudios
        e incapacidades</strong>. La cédula profesional identifica a quien responde
        por el documento, así que tiene que ser la tuya.
      </p>

      <form onSubmit={submit}>
        {CAMPOS.map((c) => (
          <label key={c.k} style={{ display: "block", marginTop: 14 }}>
            <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
              {c.label}{c.req && <strong style={{ color: "var(--danger)" }}> *</strong>}
            </span>
            <input
              className="input"
              style={{ width: "100%", marginTop: 4 }}
              value={form[c.k]}
              placeholder={c.ph}
              onChange={(ev) => setForm({ ...form, [c.k]: ev.target.value })}
            />
          </label>
        ))}

        <fieldset style={{ marginTop: 22, border: "1px solid var(--hair)",
                           borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
          <legend style={{ fontSize: 12, color: "var(--ink-2)", padding: "0 6px" }}>
            Equipo de tu consultorio
          </legend>
          <p style={{ fontSize: 11.5, color: "var(--ink-2)", margin: "0 0 10px" }}>
            Las indicaciones de rehabilitación se ajustan a lo que marques: si falta
            un aparato se aplica la alternativa documentada, y si no la hay, el paso
            se señala en vez de desaparecer. Sin marcar nada, se propone todo.
          </p>
          <div className="row g-8 wrap">
            {EQUIPO.map((m) => {
              const tiene = equipo.includes(m);
              return (
                <button key={m} type="button"
                  className={"btn sm" + (tiene ? " primary" : "")}
                  aria-pressed={tiene}
                  onClick={() => setEquipo((l) => tiene ? l.filter((x) => x !== m) : [...l, m])}>
                  {tiene ? "✓ " : ""}{m}
                </button>
              );
            })}
          </div>
        </fieldset>

        {err && <div className="asr-warning" role="alert" style={{ marginTop: 16 }}><span>{err}</span></div>}
        {ok && <div style={{ marginTop: 16, color: "var(--sage-2)" }}>Perfil guardado.</div>}

        <div className="row g-10" style={{ marginTop: 22 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
          {onCancel && <button className="btn" type="button" onClick={onCancel}>Cancelar</button>}
        </div>
      </form>
    </div>
  );
};

export default MiPerfil;
