import React from "react";
import { api } from "../api/client";
import { MegiLogo } from "./logo";

// ============ LOGIN (v0.0.1) ============
// Acceso local por usuario/contraseña. La sesión se guarda en localStorage
// (App). No es seguridad de grado producción; controla el acceso local.
const Login = ({ onLogin }) => {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const submit = async (e) => {
    e?.preventDefault();
    if (!username || !password || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const user = await api.login({ username, password });
      onLogin(user);
    } catch (e) {
      setErr("Usuario o contraseña incorrectos.");
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "grid", placeItems: "center", padding: 24,
      backgroundImage: "url('/fondo-login.jpg')",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    }}>
      <form onSubmit={submit} className="framed" style={{ width: "100%", maxWidth: 380, padding: 36, background: "var(--surface)" }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div style={{ height: 56, marginBottom: 6 }}>
            <MegiLogo size={40} loop={true} maxLoops={1} />
          </div>
          <div className="eyebrow">Médico · Acceso · v0.0.1</div>
        </div>

        <label className="field-label" htmlFor="login-user">Usuario</label>
        <input
          id="login-user"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          style={{ marginBottom: 18 }}
        />

        <label className="field-label" htmlFor="login-pass">Contraseña</label>
        <input
          id="login-pass"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          style={{ marginBottom: 22 }}
        />

        {err && (
          <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 16 }}>{err}</div>
        )}

        <button
          type="submit"
          className="btn primary lg"
          disabled={busy || !username || !password}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {busy ? "ENTRANDO…" : "ENTRAR"}
        </button>
      </form>
    </div>
  );
};

export default Login;
