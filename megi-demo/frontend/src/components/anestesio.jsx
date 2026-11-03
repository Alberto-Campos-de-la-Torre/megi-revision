import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";

// ============ MEGI ANESTESIOLOGÍA (restringido) ============
// Dos viñetas: «Modelos» (catálogo de los 26 modelos del proyecto electros con
// su estado real: experimental, alpha, reglas, cerrado) y «Mesa del
// anestesiólogo», la mesa de electros embebida en esta misma página. El backend
// solo entrega el catálogo a administradores y a médicos autorizados; a los demás
// les responde 403 con el aviso, y aquí se muestra ese aviso y cómo pedir acceso.
// Aquí no corre ningún modelo: la mesa la sirve el backend por /mesa.

const ESTADO = {
  experimental: { label: "experimental", variant: "gold" },
  alpha: { label: "alpha · investigación", variant: "gold" },
  prototipo: { label: "prototipo", variant: "gold" },
  reglas: { label: "reglas y cálculos", variant: "sage" },
  cerrado: { label: "estudio cerrado", variant: "danger" },
};

export const AvisoRestringido = ({ texto, bloqueado = false }) => (
  <div role="alert" style={{ border: "1px solid var(--danger)", borderLeft: "6px solid var(--danger)", background: "rgba(160, 80, 80, 0.08)",
                             borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
    <div className="row center g-8" style={{ marginBottom: 4 }}>
      <span aria-hidden="true" style={{ color: "var(--danger)", fontSize: 16 }}>⚠</span>
      <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--danger)", fontWeight: 700 }}>
        Modelos restringidos · acceso limitado
      </span>
    </div>
    <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink)" }}>{texto}</div>
    {bloqueado && (
      <div style={{ fontSize: 12.5, marginTop: 8, color: "var(--ink)" }}>
        <strong>Tu usuario no tiene acceso.</strong> Lo autoriza un administrador desde Administración, usuario por usuario.
      </div>
    )}
  </div>
);

export const TarjetaAnestesio = ({ m }) => {
  const e = ESTADO[m.estado] || ESTADO.experimental;
  return (
    <div className="card" style={{ padding: 12 }} role="listitem" aria-label={m.nombre}>
      <div className="row between center" style={{ gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{m.nombre}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{m.area}</div>
        </div>
        <Pill variant={e.variant}>{e.label}</Pill>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 8 }}>{m.que_hace}</div>
      {m.variantes && m.variantes.length > 0 && (
        <div className="row g-6" style={{ flexWrap: "wrap", marginTop: 6 }}>
          {m.variantes.map((v) => <Pill key={v}>{v}</Pill>)}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.45 }}>
        <div><strong>Datos:</strong> {m.datos}</div>
        <div><strong>Límites:</strong> {m.limites}</div>
      </div>
    </div>
  );
};

// Ingreso a la mesa: se vuelve a teclear la contraseña (segundo factor). MEGI
// emite un pase de un solo uso (90 s) y la mesa se monta aquí mismo con él; la
// mesa valida el pase contra MEGI y abre su sesión (8 h). Sin pase, no abre.
const IngresoMesa = ({ onAbierta }) => {
  const [pw, setPw] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState(null);
  const entrar = async (e) => {
    e.preventDefault();
    if (!pw || enviando) return;
    setEnviando(true); setError(null);
    try { onAbierta(await api.ingresarAnestesio(pw)); }
    catch (e2) { setError(e2.message); }
    finally { setEnviando(false); setPw(""); }
  };
  return (
    <form className="col g-10" onSubmit={entrar} aria-label="Ingreso a la mesa"
          style={{ maxWidth: 420, padding: 18, border: "1px solid var(--hair)", borderRadius: 12, background: "var(--surface)" }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Mesa del anestesiólogo</div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
        Vuelve a escribir tu contraseña para abrir la mesa aquí mismo. Es la misma de MEGI.
      </div>
      <div className="row center g-8" style={{ flexWrap: "wrap" }}>
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus
               placeholder="Tu contraseña" aria-label="Contraseña" disabled={enviando} style={{ minWidth: 220, flex: 1 }} />
        <button type="submit" className="btn primary sm" disabled={enviando || !pw}>{enviando ? "…" : "Entrar"}</button>
      </div>
      {error && <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>}
    </form>
  );
};

const Anestesio = () => {
  const [cat, setCat] = React.useState(null);
  const [bloqueo, setBloqueo] = React.useState(null);   // texto del 403
  const [err, setErr] = React.useState(null);
  // Viñeta activa. La mesa sigue montada aunque se cambie a «Modelos», para no
  // perder lo que el médico tenga abierto en ella.
  const [vista, setVista] = React.useState(() => sessionStorage.getItem("megi.anestesio.vista") || "modelos");
  const [mesaUrl, setMesaUrl] = React.useState(null);   // /mesa/?pase=… tras ingresar

  const cambiar = (v) => { setVista(v); sessionStorage.setItem("megi.anestesio.vista", v); };

  React.useEffect(() => {
    let alive = true;
    api.getModelosAnestesio()
      .then((c) => { if (alive) setCat(c); })
      .catch((e) => {
        if (!alive) return;
        const msg = e.message || "";
        if (/restringid/i.test(msg)) setBloqueo(msg); else setErr(msg);
      });
    return () => { alive = false; };
  }, []);

  const aprendidos = (cat?.modelos || []).filter((m) => m.tipo === "aprendido");
  const reglas = (cat?.modelos || []).filter((m) => m.tipo === "reglas");
  const enMesa = vista === "mesa";

  return (
    <div className="page" style={{ paddingTop: 12 }}>
      <div style={{ marginBottom: 14 }}>
        <Eyebrow style={{ fontSize: 12, fontWeight: 600 }}>MEGI Anestesiología</Eyebrow>
        <h2 className="h-section" style={{ fontSize: 24, margin: "2px 0 4px" }}>Mesa del anestesiólogo · modelos</h2>
        {cat && !enMesa && (
          <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
            {cat.total_modelos} modelos en {cat.familias} familias: ventilación, gasometría, electrolitos, TIVA, ECG perioperatorio, línea arterial, hipotensión, BIS, extubación y lactato.
            Registro: <span className="mono">{cat.registro}</span>.
          </div>
        )}
        {!bloqueo && (
          <div className="seg" style={{ marginTop: 12 }} role="tablist" aria-label="Secciones de Anestesio">
            <button type="button" role="tab" aria-selected={!enMesa} className={!enMesa ? "on" : ""} onClick={() => cambiar("modelos")}>Modelos</button>
            <button type="button" role="tab" aria-selected={enMesa} className={enMesa ? "on" : ""} onClick={() => cambiar("mesa")}>Mesa del anestesiólogo</button>
          </div>
        )}
      </div>

      {(bloqueo || !enMesa) && (
        <AvisoRestringido
          texto={bloqueo || cat?.aviso || "Estos modelos trabajan sobre señales de quirófano y decisiones críticas; usados fuera de contexto pueden inducir decisiones peligrosas. Solo un número reducido de médicos tiene acceso."}
          bloqueado={!!bloqueo} />
      )}

      {err && <div className="card" style={{ color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
      {!cat && !bloqueo && !err && !enMesa && <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Cargando catálogo…</div>}

      {cat && !enMesa && (
        <>
          <div style={{ margin: "6px 0 8px" }}><Eyebrow>Modelos aprendidos ({aprendidos.length})</Eyebrow></div>
          <div role="list" aria-label="Modelos aprendidos" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, marginBottom: 18 }}>
            {aprendidos.map((m) => <TarjetaAnestesio key={m.clave} m={m} />)}
          </div>
          <div style={{ margin: "6px 0 8px" }}><Eyebrow>Módulos de reglas y cálculos ({reglas.length})</Eyebrow></div>
          <div role="list" aria-label="Módulos de reglas y cálculos" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
            {reglas.map((m) => <TarjetaAnestesio key={m.clave} m={m} />)}
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-2)", marginTop: 14, lineHeight: 1.5 }}>
            Convención del proyecto: los módulos de reglas calculan y MEGI IA explica, nunca al revés. Ningún modelo opera en lazo cerrado ni acredita validación clínica por su nombre.
          </div>
        </>
      )}

      {!bloqueo && enMesa && !mesaUrl && <IngresoMesa onAbierta={(r) => setMesaUrl(r.url)} />}
      {!bloqueo && mesaUrl && (
        <div hidden={!enMesa}>
          <div className="row between center" style={{ marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--ink-2)" }} role="status">
              Mesa abierta con un pase de un solo uso. Si la mesa pide volver a entrar, pulsa «Volver a ingresar».
            </span>
            <button type="button" className="btn ghost sm" onClick={() => setMesaUrl(null)}>Volver a ingresar</button>
          </div>
          <iframe title="Mesa del anestesiólogo" src={mesaUrl}
                  style={{ width: "100%", height: "calc(100vh - 230px)", minHeight: 640, border: "1px solid var(--hair)", borderRadius: 12, background: "#fff" }} />
        </div>
      )}
    </div>
  );
};

export default Anestesio;
