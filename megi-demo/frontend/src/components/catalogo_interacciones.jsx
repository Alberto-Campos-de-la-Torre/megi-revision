import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";

// ============ INTERACCIONES FARMACOLÓGICAS (Etapa 3) ============
// Propuestas por el LLM entre pares del catálogo APROBADO; el médico revisa,
// ajusta severidad/recomendación y aprueba. Solo lo aprobado alimentará el
// rx-check. Grave -> bloqueo; moderada/leve -> advertencia.

const SEV_COLOR = { grave: "var(--danger)", moderada: "var(--gold)", leve: "var(--ink-2)" };
const SEVS = ["grave", "moderada", "leve"];

const CatalogoInteracciones = () => {
  const [ix, setIx] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [gen, setGen] = React.useState(null);
  const [err, setErr] = React.useState(null);

  const load = React.useCallback(async () => {
    try { setIx(await api.getDrugInteractions()); setErr(null); }
    catch (e) { setErr("No se pudo cargar."); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true); setGen(null); setErr(null);
    try { const r = await api.generateDrugInteractions(); setGen(r); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const act = async (fn) => { setBusy(true); try { await fn(); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };

  if (!ix) return <section className="card"><Eyebrow>Interacciones farmacológicas</Eyebrow><p style={{ fontSize: 12, color: "var(--ink-2)" }}>Cargando…</p></section>;

  const aprob = ix.filter((i) => i.estado === "aprobado").length;
  const graves = ix.filter((i) => i.severidad === "grave").length;

  return (
    <section className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <Eyebrow>Interacciones farmacológicas</Eyebrow>
        <Pill variant={aprob ? "sage" : ""}>{aprob}/{ix.length} aprobadas</Pill>
        {graves > 0 && <Pill variant="danger">{graves} graves</Pill>}
        <button className="btn ghost sm" style={{ marginLeft: "auto", fontSize: 10.5 }} onClick={generate} disabled={busy}
          title="Propone interacciones entre los medicamentos aprobados del catálogo (LLM)">
          {busy ? "Generando…" : "GENERAR DESDE EL CATÁLOGO"}
        </button>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink-2)", margin: "0 0 10px" }}>
        Entre pares de tu catálogo aprobado. Revisa y aprueba: solo lo aprobado bloquea/alerta
        en la receta. <strong>Grave</strong> bloquea; moderada/leve advierte.
      </p>
      {gen && <div style={{ fontSize: 12, color: "var(--sage-2)", marginBottom: 8 }}>Se propusieron {gen.generadas} interacciones nuevas.</div>}
      {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: "grid", gap: 4, maxHeight: 460, overflowY: "auto" }}>
        {ix.map((i) => (
          <div key={i.id} style={{ border: "1px solid var(--hair)", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13 }}>{i.farmaco_a} <span style={{ color: "var(--ink-2)" }}>+</span> {i.farmaco_b}</span>
              <select className="input" value={i.severidad} style={{ fontSize: 11, padding: "3px 6px", color: SEV_COLOR[i.severidad] }}
                onChange={(e) => act(() => api.patchDrugInteraction(i.id, { severidad: e.target.value }))} disabled={busy}>
                {SEVS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <Pill variant={i.estado === "aprobado" ? "sage" : "gold"}>{i.estado}</Pill>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 4 }}>{i.mecanismo}</div>
            <div style={{ fontSize: 11.5, marginTop: 2 }}>→ {i.recomendacion}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {i.estado !== "aprobado" && <button className="btn primary sm" style={{ fontSize: 10 }} onClick={() => act(() => api.approveDrugInteraction(i.id))} disabled={busy}>✓ APROBAR</button>}
              <button className="btn ghost sm" style={{ fontSize: 10, marginLeft: "auto", color: "var(--danger)" }} onClick={() => act(() => api.deleteDrugInteraction(i.id))} disabled={busy}>Eliminar</button>
            </div>
          </div>
        ))}
        {ix.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-2)" }}>Aún no hay interacciones. Aprueba medicamentos y pulsa “Generar desde el catálogo”.</p>}
      </div>
    </section>
  );
};

export default CatalogoInteracciones;
