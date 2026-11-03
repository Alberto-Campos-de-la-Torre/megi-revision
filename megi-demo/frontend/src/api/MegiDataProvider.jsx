// ============ MEGI DATA PROVIDER (v0.0.1) ============
// Carga config + pacientes + doctor desde el backend al montar y los expone vía
// contexto. Bloquea el render de los hijos hasta la carga inicial. El antiguo
// "bundle clínico" enlatado (SOAP/Dx/Rx/FLAGS del seed) se eliminó: la nota
// clínica ahora sale de la consulta real (api.getSoap(consultationId)).

import React, { createContext, useContext, useEffect, useState } from "react";
import { api, MODE } from "./client";

const MegiContext = createContext(null);

export function MegiDataProvider({ children }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const reloadPatients = React.useCallback(async () => {
    try {
      const patients = await api.getPatients();
      setState((s) => (s.data ? { ...s, data: { ...s.data, patients } } : s));
      return patients;
    } catch (e) {
      console.warn("[megi] recargar pacientes", e);
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [config, patients] = await Promise.all([
          api.getConfig(),
          api.getPatients(),
        ]);
        const doctor = config?.doctor || null;
        if (alive) setState({ loading: false, error: null, data: { config, patients, doctor, reloadPatients } });
      } catch (error) {
        if (alive) setState({ loading: false, error, data: null });
      }
    })();
    return () => { alive = false; };
  }, [reloadPatients]);

  if (state.loading) {
    return (
      <div style={{
        position: "fixed", inset: 0, display: "grid", placeItems: "center",
        background: "var(--cream, #fff)", color: "var(--ink-2, #888)",
        fontFamily: "var(--font-mono, monospace)", fontSize: 11, letterSpacing: "0.2em",
        textTransform: "uppercase",
      }}>
        Cargando MEGI · {MODE}…
      </div>
    );
  }

  if (state.error) {
    return (
      <div style={{
        position: "fixed", inset: 0, display: "grid", placeItems: "center",
        padding: 40, textAlign: "center", color: "#8b3a3a",
        fontFamily: "var(--font-mono, monospace)", fontSize: 12,
      }}>
        No se pudo cargar MEGI ({MODE}): {String(state.error.message || state.error)}
      </div>
    );
  }

  return <MegiContext.Provider value={state.data}>{children}</MegiContext.Provider>;
}

function useMegiContext() {
  const ctx = useContext(MegiContext);
  if (!ctx) throw new Error("useMegi* debe usarse dentro de <MegiDataProvider>");
  return ctx;
}

export function usePatients() {
  return useMegiContext().patients;
}

export function useReloadPatients() {
  return useMegiContext().reloadPatients;
}

export function useDoctor() {
  return useMegiContext().doctor;
}

export function useMegiConfig() {
  return useMegiContext().config;
}
