import React from "react";
import { api, BUILD } from "../api/client";

// ============ SALUD DE SERVICIOS (§4 revisión 2026-07-12) ============
// `MEGI_REAL_ASR` es configuración, no salud: si el ASR se cae a media consulta
// varias rutas devuelven transcript MOCK con la misma forma que el real. Sin un
// indicador, se puede firmar una nota clínica escrita sobre texto inventado.
// Aquí se muestra el estado real y, si la transcripción no es de fiar, un aviso
// que no se puede pasar por alto.

const POLL_MS = 20000;

const DOTS = [
  { key: "asr", label: "ASR", ok: (s) => s.asr?.reachable && s.asr?.models_ok },
  { key: "llm", label: "LLM", ok: (s) => s.llm?.loaded },
  { key: "rag", label: "RAG", ok: (s) => s.rag?.index_present },
];

// El LLM y el RAG cargan de forma perezosa: "aún no cargado" es normal al
// arrancar y no es un fallo, por eso se distingue de "caído".
function dotState(h, d) {
  if (!h) return "unknown";
  if (d.ok(h.services || {})) return "ok";
  if (d.key === "asr") return h.services?.asr?.configured ? "down" : "off";
  return h.services?.asr?.reachable ? "idle" : "down";
}

const TITLES = {
  ok: "operativo",
  down: "no responde",
  off: "desactivado por configuración",
  idle: "disponible, aún sin cargar (carga al primer uso)",
  unknown: "sin datos",
};

export const ServiceHealth = ({ health }) => (
  <div className="health-dots" title="Estado de los servicios de modelo">
    {DOTS.map((d) => {
      const st = dotState(health, d);
      return (
        <span key={d.key} className={`hd hd-${st}`} title={`${d.label}: ${TITLES[st]}`}>
          <i className="hd-dot" />
          {d.label}
        </span>
      );
    })}
  </div>
);

// Banda de aviso: solo aparece cuando documentar sería inseguro.
export const TranscriptionWarning = ({ health }) => {
  if (!health || health.safe_to_document || !health.warning) return null;
  return (
    <div className="asr-warning no-print" role="alert">
      <strong>⚠ {health.transcription_mode === "mock" ? "MODO SIMULADO" : "ASR NO DISPONIBLE"}</strong>
      <span>{health.warning}</span>
    </div>
  );
};

// Aviso de desfase: la app cargada en el navegador y el backend en marcha no son
// la misma versión. Pasó de verdad (27-jul): el dev server recargó el frontend
// nuevo mientras el backend seguía con código de dos días antes, y el streaming
// quedó roto sin señal ninguna. En desarrollo no aplica (`dev`/`unknown`).
export const VersionWarning = ({ health }) => {
  const backend = health?.build;
  const stale = backend && BUILD && BUILD !== "dev" && backend !== "unknown" && backend !== BUILD;
  if (!stale) return null;
  return (
    <div className="asr-warning no-print" role="alert">
      <strong>⚠ VERSIONES DESALINEADAS</strong>
      <span>
        La app ({BUILD}) y el servidor ({backend}) no son la misma versión.
        Ejecuta <code>megi update</code> y recarga la página.
      </span>
    </div>
  );
};

// Hook compartido: una sola consulta en vuelo para toda la app.
export function useServiceHealth(enabled = true) {
  const [health, setHealth] = React.useState(null);
  React.useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const tick = async () => {
      const h = await api.servicesHealth();
      if (alive) setHealth(h);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [enabled]);
  return health;
}

export default ServiceHealth;
