import { useAgentChatRunningThreads } from "@agent-native/toolkit/app/chat/agentkit-chat/rail";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
type EstadoActual = ReturnType<typeof useAgentChatRunningThreads> & { paso: string };
const Estado = createContext<EstadoActual | null>(null);
/** Los eventos de esta ventana usan tabId de chat (no browserTabId).
 * Un solo observador del runtime; no se descartan por comparar ids distintos. */
export function EstadoAgenteProvider({ children }: { children: ReactNode }) {
  const estado = useAgentChatRunningThreads();
  const [paso, setPaso] = useState("Preparando propuesta");
  useEffect(() => {
    const entrada = (event: Event) => {
      const d = (event as CustomEvent).detail ?? {};
      const tool = String(d.tool ?? "");
      if (["ver-contexto-consulta", "view-screen", "obtener-plan"].includes(tool)) setPaso("Leyendo contexto clínico");
      else if (tool === "ask-question") setPaso("Esperando tu respuesta sobre los datos clínicos");
      else if (tool === "proponer-plan") {
        let n: number | undefined;
        try { n = JSON.parse(d.argsText ?? "{}").lineas?.filter((l: { tipo: string }) => l.tipo === "farmaco").length; } catch { /* argumentos aún incompletos */ }
        setPaso(n === undefined ? "Preparando las líneas del plan" : `Verificando ${n} fármacos y guardando el plan`);
      } else if (["reajustar-plan", "actualizar-linea", "agregar-linea"].includes(tool)) setPaso("Aplicando cambios y verificando el conjunto");
      else if (tool === "sugerir-reemplazo") setPaso("Verificando una alternativa para tu revisión");
    };
    const fin = (event: Event) => {
      const d = (event as CustomEvent).detail ?? {};
      if (["proponer-plan", "reajustar-plan", "sugerir-reemplazo"].includes(d.tool)) setPaso(d.isError ? "La operación falló; preparando explicación" : d.tool === "proponer-plan" ? "Plan guardado para revisión médica" : "Resultado guardado; preparando explicación");
    };
    window.addEventListener("agent-native:tool-input", entrada);
    window.addEventListener("agent-native:tool-done", fin);
    return () => { window.removeEventListener("agent-native:tool-input", entrada); window.removeEventListener("agent-native:tool-done", fin); };
  }, []);
  const enCurso = estado.runningThreadIds.size > 0;
  useEffect(() => { if (!enCurso) setPaso("Preparando propuesta"); }, [enCurso]);
  return <Estado.Provider value={{ ...estado, paso }}>{children}</Estado.Provider>;
}
export function useEstadoAgente() {
  const estado = useContext(Estado);
  if (!estado) throw new Error("Falta EstadoAgenteProvider en el shell");
  return estado;
}
