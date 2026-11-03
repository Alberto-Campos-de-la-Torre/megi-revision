import React from "react";
import { api } from "../api/client";
import { MegiLogo } from "./logo";

// ============ CAMBIO DE CONTRASEÑA (P2) ============
// Se muestra forzado cuando la sesión trae must_change_password=true (usuarios
// creados por un admin), y bloquea el uso de la app hasta cambiarla.
const ChangePassword = ({ forced = false, onDone, onCancel }) => {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (next.length < 6) { setErr("La nueva contraseña debe tener al menos 6 caracteres."); return; }
    if (next !== confirm) { setErr("Las contraseñas no coinciden."); return; }
    if (next === current) { setErr("La nueva contraseña debe ser distinta de la actual."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await api.changePassword({ current_password: current, new_password: next });
      onDone(res.token); // token nuevo -> refresca sesión sin el flag
    } catch (e) {
      setErr(e.message || "No se pudo cambiar la contraseña.");
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "grid", placeItems: "center", padding: 24,
      backgroundImage: "url('/fondo-login.jpg')",
      backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat",
    }}>
      <form onSubmit={submit} className="framed" style={{ width: "100%", maxWidth: 400, padding: 36, background: "var(--surface)" }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ height: 56, marginBottom: 6 }}>
            <MegiLogo size={40} loop={true} maxLoops={1} />
          </div>
          <div className="eyebrow">Médico · Cambiar contraseña</div>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 20, textAlign: "center" }}>
          {forced
            ? <>Por seguridad, <strong style={{ color: "var(--ink)" }}>cambia la contraseña</strong> que te asignaron antes de continuar.</>
            : "Actualiza tu contraseña de acceso."}
        </p>

        <label className="field-label" htmlFor="cp-cur">Contraseña actual</label>
        <input id="cp-cur" className="input" type="password" value={current} autoFocus autoComplete="current-password"
          onChange={(e) => setCurrent(e.target.value)} style={{ marginBottom: 16 }} />

        <label className="field-label" htmlFor="cp-new">Nueva contraseña</label>
        <input id="cp-new" className="input" type="password" value={next} autoComplete="new-password"
          onChange={(e) => setNext(e.target.value)} style={{ marginBottom: 16 }} />

        <label className="field-label" htmlFor="cp-conf">Repite la nueva contraseña</label>
        <input id="cp-conf" className="input" type="password" value={confirm} autoComplete="new-password"
          onChange={(e) => setConfirm(e.target.value)} style={{ marginBottom: 20 }} />

        {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 16 }}>{err}</div>}

        <button type="submit" className="btn primary lg"
          disabled={busy || !current || !next || !confirm}
          style={{ width: "100%", justifyContent: "center" }}>
          {busy ? "GUARDANDO…" : "CAMBIAR CONTRASEÑA"}
        </button>
        {!forced && onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}
            style={{ width: "100%", justifyContent: "center", marginTop: 10 }}>
            Cancelar
          </button>
        )}
      </form>
    </div>
  );
};

export default ChangePassword;
