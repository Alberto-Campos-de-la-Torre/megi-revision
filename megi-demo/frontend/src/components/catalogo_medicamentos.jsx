import React from "react";
import { Eyebrow, Pill } from "./shared";
import { api } from "../api/client";

// ============ CATÁLOGO DE MEDICAMENTOS (Etapa 2) ============
// Sembrado desde la práctica real (notas IMSS minadas). El médico revisa cada
// entrada, puede pedir una sugerencia con respaldo de GPC (dosis máx /
// precauciones, con fuentes) y APRUEBA. Solo lo aprobado alimentará el
// rx-check y las pick-lists de prescripción. Editar algo aprobado lo regresa
// a borrador (re-aprobación obligatoria).

const FIELDS = [
  ["clase", "Clase"], ["via", "Vía"], ["dosis_habitual", "Dosis habitual"],
  ["frecuencia_habitual", "Frecuencia habitual"], ["dosis_max_dia", "Dosis máx/día"],
  ["precauciones", "Precauciones"],
];

const CatalogoMedicamentos = () => {
  const [meds, setMeds] = React.useState(null);
  const [open, setOpen] = React.useState(null);     // id expandido
  const [draft, setDraft] = React.useState({});     // edición del expandido
  const [sug, setSug] = React.useState(null);       // sugerencia GPC {id, ...}
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const load = React.useCallback(async () => {
    try { setMeds(await api.getMedications()); setErr(null); }
    catch (e) { setErr("No se pudo cargar el catálogo."); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const expand = (m) => {
    setOpen(m.id === open ? null : m.id);
    setSug(null);
    setDraft(Object.fromEntries(FIELDS.map(([k]) => [k, m[k] || ""])));
  };

  const save = async (id) => {
    setBusy(true);
    try { await api.patchMedication(id, draft); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const approve = async (id) => {
    setBusy(true);
    try { await api.patchMedication(id, draft); await api.approveMedication(id); await load(); setOpen(null); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    setBusy(true);
    try { await api.deleteMedication(id); await load(); setOpen(null); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const suggest = async (id) => {
    setBusy(true); setSug({ id, loading: true });
    try { setSug({ id, ...(await api.gpcSuggestMedication(id)) }); }
    catch (e) { setSug({ id, error: e.message }); }
    finally { setBusy(false); }
  };

  if (!meds) return <section className="card"><Eyebrow>Catálogo de medicamentos</Eyebrow><p style={{ fontSize: 12, color: "var(--ink-2)" }}>Cargando…</p></section>;

  const aprobados = meds.filter((m) => m.estado === "aprobado").length;

  return (
    <section className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Eyebrow>Catálogo de medicamentos</Eyebrow>
        <Pill variant={aprobados ? "sage" : ""}>{aprobados}/{meds.length} aprobados</Pill>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink-2)", margin: "0 0 10px" }}>
        Minado de tus notas reales (ordenado por frecuencia de uso). Revisa, completa la dosis
        máxima (puedes pedir sugerencia con respaldo de GPC) y aprueba: solo lo aprobado
        alimentará las alertas de seguridad y la prescripción asistida.
      </p>
      {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: "grid", gap: 4, maxHeight: 460, overflowY: "auto" }}>
        {meds.map((m) => (
          <div key={m.id} style={{ border: "1px solid var(--hair)", borderRadius: 8 }}>
            <button type="button" onClick={() => expand(m)} className="med-row" style={{
              display: "grid", gridTemplateColumns: "44px 1fr 130px 90px", gap: 8, width: "100%",
              alignItems: "center", padding: "8px 10px", background: "transparent", border: 0,
              cursor: "pointer", textAlign: "left", font: "inherit", color: "var(--ink)",
            }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>{m.n_recetas}x</span>
              <span style={{ fontSize: 13 }}>{m.generico}<span style={{ color: "var(--ink-2)", fontSize: 11 }}>{m.clase ? ` · ${m.clase}` : ""}</span></span>
              <span style={{ fontSize: 11, color: "var(--ink-2)" }}>{m.dosis_habitual || "—"}</span>
              <Pill variant={m.estado === "aprobado" ? "sage" : "gold"}>{m.estado}</Pill>
            </button>

            {open === m.id && (
              <div style={{ padding: "4px 12px 12px", borderTop: "1px dashed var(--hair)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px", marginTop: 8 }}>
                  {FIELDS.map(([k, label]) => (
                    <label key={k} style={{ fontSize: 11, color: "var(--ink-2)" }}>
                      {label}
                      <input className="input" value={draft[k] || ""} style={{ fontSize: 12, marginTop: 2 }}
                        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
                    </label>
                  ))}
                </div>
                {m.sinonimos?.length > 0 && (
                  <div style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 6 }}>
                    Como aparece en tus notas: {m.sinonimos.join(" · ")}
                  </div>
                )}

                {sug?.id === m.id && (
                  <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "var(--sage-soft)", border: "1px solid var(--sage)", fontSize: 11.5 }}>
                    {sug.loading ? "Consultando GPC y ficha FDA…" : sug.error ? <span style={{ color: "var(--danger)" }}>{sug.error}</span> : (
                      <>
                        {/* Ficha FDA traducida: dosis máx + precauciones aplicables */}
                        {(sug.fda?.dosis_max_dia || sug.fda?.precauciones) && (
                          <div style={{ marginBottom: 8 }}>
                            <div className="mono" style={{ fontSize: 9, letterSpacing: ".1em", color: "var(--sage-2)" }}>FICHA FDA (EE.UU., traducida)</div>
                            {sug.fda.dosis_max_dia && <div>Dosis máx/día: <strong>{sug.fda.dosis_max_dia}</strong></div>}
                            {sug.fda.precauciones && <div style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{sug.fda.precauciones}</div>}
                            <button type="button" className="btn primary sm" style={{ fontSize: 10, marginTop: 4 }}
                              onClick={() => setDraft((d) => ({
                                ...d,
                                dosis_max_dia: sug.fda.dosis_max_dia || d.dosis_max_dia,
                                precauciones: sug.fda.precauciones || d.precauciones,
                              }))}>
                              ↧ Usar estos datos
                            </button>
                          </div>
                        )}
                        {/* GPC IMSS: contexto clínico MX */}
                        {sug.gpc?.sugerencia && (
                          <div>
                            <div className="mono" style={{ fontSize: 9, letterSpacing: ".1em", color: "var(--gold)" }}>GPC IMSS</div>
                            <div style={{ whiteSpace: "pre-wrap" }}>{sug.gpc.sugerencia}</div>
                            {(sug.gpc.fuentes || []).map((s, i) => (
                              <div key={i} className="mono" style={{ fontSize: 10, color: "var(--gold)", marginTop: 2 }}>↳ {s.citation}</div>
                            ))}
                          </div>
                        )}
                        {!sug.fda?.dosis_max_dia && !sug.fda?.precauciones && !sug.gpc?.sugerencia && (
                          <div style={{ color: "var(--ink-2)" }}>Ni la GPC ni la ficha FDA indexada traen datos para este fármaco.</div>
                        )}
                        <div style={{ fontSize: 10, color: "var(--ink-2)", marginTop: 6 }}>{sug.nota}</div>
                      </>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button className="btn primary sm" onClick={() => approve(m.id)} disabled={busy}>✓ APROBAR</button>
                  <button className="btn ghost sm" onClick={() => save(m.id)} disabled={busy}>Guardar cambios</button>
                  <button className="btn ghost sm" onClick={() => suggest(m.id)} disabled={busy} title="Dosis máx y precauciones desde la GPC IMSS + la ficha FDA traducida">
                    Sugerir (GPC + FDA)
                  </button>
                  {m.estado !== "aprobado" && (
                    <button className="btn danger sm" onClick={() => remove(m.id)} disabled={busy} style={{ marginLeft: "auto" }}>Eliminar</button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

export default CatalogoMedicamentos;
