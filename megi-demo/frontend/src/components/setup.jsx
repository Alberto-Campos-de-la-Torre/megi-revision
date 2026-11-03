import React from "react";
import { api } from "../api/client";
import { MegiLogo } from "./logo";

// ============ PRIMER ARRANQUE (P2) ============
// Se muestra en lugar del login cuando el backend reporta needs_setup=true
// (no existe ningún administrador). Crea el primer admin y entra con sesión.
const Setup = ({ onReady }) => {
  const [username, setUsername] = React.useState("");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (!username || !password) return;
    if (password.length < 6) { setErr("La contraseña debe tener al menos 6 caracteres."); return; }
    if (password !== confirm) { setErr("Las contraseñas no coinciden."); return; }
    setBusy(true); setErr(null);
    try {
      const user = await api.setup({ username, name: name || username, password });
      onReady(user); // trae token -> sesión iniciada
    } catch (e) {
      setErr(e.message || "No se pudo crear el administrador.");
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
          <div className="eyebrow">Médico · Configuración inicial</div>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 20, textAlign: "center" }}>
          Crea tu cuenta de <strong style={{ color: "var(--ink)" }}>administrador</strong>.
          Serás el dueño de esta instalación.
        </p>

        <label className="field-label" htmlFor="s-user">Usuario</label>
        <input id="s-user" className="input" value={username} autoFocus autoComplete="username"
          onChange={(e) => setUsername(e.target.value)} style={{ marginBottom: 16 }} />

        <label className="field-label" htmlFor="s-name">Nombre para mostrar</label>
        <input id="s-name" className="input" value={name} autoComplete="name"
          placeholder="(opcional)"
          onChange={(e) => setName(e.target.value)} style={{ marginBottom: 16 }} />

        <label className="field-label" htmlFor="s-pass">Contraseña</label>
        <input id="s-pass" className="input" type="password" value={password} autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)} style={{ marginBottom: 16 }} />

        <label className="field-label" htmlFor="s-conf">Repite la contraseña</label>
        <input id="s-conf" className="input" type="password" value={confirm} autoComplete="new-password"
          onChange={(e) => setConfirm(e.target.value)} style={{ marginBottom: 20 }} />

        {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 16 }}>{err}</div>}

        <button type="submit" className="btn primary lg"
          disabled={busy || !username || !password || !confirm}
          style={{ width: "100%", justifyContent: "center" }}>
          {busy ? "CREANDO…" : "CREAR Y ENTRAR"}
        </button>
      </form>
    </div>
  );
};

export default Setup;
