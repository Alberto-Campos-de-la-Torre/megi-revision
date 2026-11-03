import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";
import CatalogoMedicamentos from "./catalogo_medicamentos";
import CatalogoInteracciones from "./catalogo_interacciones";

// ============ ADMINISTRACIÓN · USUARIOS + CATÁLOGO (v0.0.1, solo admin) ============
// Usuarios protegidos: el backend rechaza su borrado (403); aquí además ocultamos
// la acción para dar feedback claro. Debe coincidir con _PROTECTED_USERS del backend.
const PROTECTED_USERS = new Set(["king"]);

const Administracion = ({ user }) => {
  const [users, setUsers] = React.useState(null);
  const [err, setErr] = React.useState(null);

  const load = React.useCallback(async () => {
    try { setUsers(await api.getUsers()); }
    catch (e) { setErr(e.message); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  // alta
  const [form, setForm] = React.useState({ username: "", name: "", role: "medico", password: "", solo_yo: false });
  const [busy, setBusy] = React.useState(false);
  const [formErr, setFormErr] = React.useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.username.trim() && form.password.trim();

  const create = async (e) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setFormErr(null);
    try {
      await api.createUser({
        username: form.username.trim().toLowerCase(),
        name: form.name.trim(),
        role: form.role,
        password: form.password,
        solo_visible_para_mi: form.role === "medico" && form.solo_yo,
      });
      setForm({ username: "", name: "", role: "medico", password: "", solo_yo: false });
      await load();
    } catch (e2) {
      setFormErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  // Ocultar un usuario al resto de administradores (queda visible solo para
  // mí) o volver a mostrarlo. Los demás admins no lo ven en ningún sitio.
  const visibilidad = async (u, soloYo) => {
    const msg = soloYo
      ? `Ocultar a "${u.username}" al resto de administradores: solo tú lo verás y administrarás. ¿Continuar?`
      : `Volver a mostrar a "${u.username}" a todos los administradores. ¿Continuar?`;
    if (!window.confirm(msg)) return;
    try { await api.setUserVisibility(u.username, soloYo); await load(); }
    catch (e) { window.alert(e.message); }
  };

  // Acceso a la sección Anestesio (modelos restringidos): lo da y lo quita el admin.
  const anestesio = async (u, acceso) => {
    const msg = acceso
      ? `Autorizar a "${u.username}" el acceso a los modelos restringidos de Anestesio. ¿Continuar?`
      : `Retirar a "${u.username}" el acceso a Anestesio. ¿Continuar?`;
    if (!window.confirm(msg)) return;
    try { await api.patchUserAnestesio(u.username, acceso); await load(); }
    catch (e) { window.alert(e.message); }
  };

  const remove = async (u) => {
    if (u.username === user?.username) return;
    if (PROTECTED_USERS.has(u.username)) return;
    if (!window.confirm(`¿Eliminar al usuario "${u.username}"?`)) return;
    try { await api.deleteUser(u.username); await load(); }
    catch (e) { window.alert(e.message); }
  };

  return (
    <div className="page">
      <div style={{ marginBottom: 24 }}>
        <Eyebrow style={{ fontSize: 12, fontWeight: 600 }}>Administración</Eyebrow>
        <h1 className="h-page" style={{ marginTop: 8 }}>Usuarios</h1>
        <p style={{ marginTop: 8, color: "var(--ink-2)", fontSize: 14 }}>
          Da de alta médicos y administra el acceso a MEGI.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 24 }} className="pacientes-grid">
        {/* LISTA */}
        <section className="card">
          <Eyebrow>Usuarios registrados</Eyebrow>
          {err && <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 10 }}>{err}</div>}
          <div className="col g-8" style={{ marginTop: 12 }}>
            {!users && !err && <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Cargando…</div>}
            {users && users.map((u) => (
              <div key={u.username} className="row between center" style={{ border: "1px solid var(--hair)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row center g-8">
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{u.name || u.username}</span>
                    <Pill variant={u.role === "admin" ? "accent" : "sage"}>{u.role === "admin" ? "administrador" : "médico"}</Pill>
                    {u.username === user?.username && <Pill>tú</Pill>}
                    {PROTECTED_USERS.has(u.username) && <Pill>protegido</Pill>}
                    {u.visible_para && <Pill variant="gold" title="Solo tú ves y administras este usuario">solo tú</Pill>}
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 3 }}>@{u.username}</div>
                </div>
                <div className="row g-6 center">
                {u.role !== "admin" && (
                  <button className="btn ghost sm" onClick={() => anestesio(u, !u.acceso_anestesio)}
                          style={u.acceso_anestesio ? { color: "var(--danger)" } : undefined}
                          title={u.acceso_anestesio ? "Retirar el acceso a los modelos restringidos de Anestesio" : "Autorizar el acceso a los modelos restringidos de Anestesio"}
                          aria-label={`${u.acceso_anestesio ? "Retirar Anestesio a" : "Autorizar Anestesio a"} ${u.username}`}>
                    {u.acceso_anestesio ? "ANESTESIO ✓" : "ANESTESIO"}
                  </button>
                )}
                {u.role !== "admin" && !PROTECTED_USERS.has(u.username) && u.username !== user?.username && (
                  <button className="btn ghost sm" onClick={() => visibilidad(u, !u.visible_para)}
                          title={u.visible_para ? "Volver a mostrarlo a todos los administradores" : "Ocultarlo al resto de administradores"}
                          aria-label={`${u.visible_para ? "Mostrar" : "Ocultar"} ${u.username}`}>
                    {u.visible_para ? "MOSTRAR" : "OCULTAR"}
                  </button>
                )}
                <button
                  className="btn ghost sm"
                  onClick={() => remove(u)}
                  disabled={u.username === user?.username || PROTECTED_USERS.has(u.username)}
                  title={
                    u.username === user?.username ? "No puedes eliminarte a ti mismo"
                    : PROTECTED_USERS.has(u.username) ? "Usuario protegido: no puede eliminarse"
                    : "Eliminar usuario"
                  }
                  aria-label={`Eliminar ${u.username}`}
                >ELIMINAR</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ALTA */}
        <aside>
          <form className="card" onSubmit={create}>
            <Eyebrow>Nuevo usuario</Eyebrow>
            <div className="col g-12" style={{ marginTop: 12 }}>
              <div>
                <label className="field-label" htmlFor="u-username">Usuario *</label>
                <input id="u-username" className="input mono" value={form.username} onChange={(e) => set("username", e.target.value.toLowerCase())} style={{ fontSize: 12 }} autoComplete="off" />
              </div>
              <div>
                <label className="field-label" htmlFor="u-name">Nombre para mostrar</label>
                <input id="u-name" className="input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="p. ej. Dra. López" />
              </div>
              <div>
                <label className="field-label" htmlFor="u-role">Rol</label>
                <select id="u-role" className="input" value={form.role} onChange={(e) => set("role", e.target.value)}>
                  <option value="medico">Médico</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              {form.role === "medico" && (
                <label className="row g-8 center" style={{ fontSize: 12.5, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.solo_yo} onChange={(e) => set("solo_yo", e.target.checked)} />
                  <span>Solo visible para mí <span style={{ color: "var(--ink-2)" }}>(los demás administradores no lo verán)</span></span>
                </label>
              )}
              <div>
                <label className="field-label" htmlFor="u-pass">Contraseña *</label>
                <input id="u-pass" className="input" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
              </div>
              {formErr && <div style={{ color: "var(--danger)", fontSize: 12 }}>{formErr}</div>}
              <button type="submit" className="btn primary" disabled={!valid || busy}>
                {busy ? "CREANDO…" : "CREAR USUARIO"}
              </button>
            </div>
          </form>
        </aside>
      </div>

      {/* Catálogo de medicamentos (Etapa 2): minado de la práctica real, el
          médico aprueba entrada por entrada. */}
      <div style={{ marginTop: 24 }}>
        <CatalogoMedicamentos />
      </div>
      <div style={{ marginTop: 24 }}>
        <CatalogoInteracciones />
      </div>
    </div>
  );
};

export default Administracion;
