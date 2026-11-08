import { useEffect, useRef, useState } from "react";
import { focusAgentChat } from "@agent-native/toolkit/app/chat";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useEstadoAgente } from "./EstadoAgente";

/**
 * Estado del trabajo del agente sobre este plan. Además del progreso, detecta
 * el caso en que el médico pidió la propuesta y el turno terminó sin que
 * proponer-plan guardara nada (el modelo respondió solo en texto): entonces
 * ofrece volver a pedirla con una instrucción explícita.
 */
export function TrabajoAgente({ version, esperandoPropuesta = false, onReintentar }: { version: number; esperandoPropuesta?: boolean; onReintentar?: () => void }) {
  const { runningThreadIds, paso } = useEstadoAgente();
  const enCurso = runningThreadIds.size > 0;
  const [inicioVersion, setInicioVersion] = useState(version);
  const [terminoSinPlan, setTerminoSinPlan] = useState(false);
  const [turnoSinCambios, setTurnoSinCambios] = useState<number | null>(null);
  const trabajando = useRef(false);
  const guardoPlan = useRef(false);
  const escribio = useRef(false);
  // ask-question termina el turno a propósito: el agente espera la respuesta
  // del médico. No es un turno fallido ni «sin cambios».
  const pregunto = useRef(false);
  useEffect(() => {
    const fin = (event: Event) => {
      const d = (event as CustomEvent).detail ?? {};
      if (d.isError) return;
      if (d.tool === "ask-question") pregunto.current = true;
      if (d.tool === "proponer-plan") guardoPlan.current = true;
      if (["proponer-plan", "reajustar-plan", "actualizar-linea", "agregar-linea", "sugerir-reemplazo"].includes(String(d.tool))) escribio.current = true;
    };
    window.addEventListener("agent-native:tool-done", fin);
    return () => window.removeEventListener("agent-native:tool-done", fin);
  }, []);
  useEffect(() => {
    if (enCurso && !trabajando.current) { setInicioVersion(version); guardoPlan.current = false; escribio.current = false; pregunto.current = false; setTerminoSinPlan(false); setTurnoSinCambios(null); }
    if (!enCurso && trabajando.current && !pregunto.current) {
      if (esperandoPropuesta && !guardoPlan.current) setTerminoSinPlan(true);
      // El modelo puede describir cambios que el servidor rechazó (p. ej. un
      // reajuste atómico que tocaba una línea fijada). Se deja constancia de
      // que este turno no escribió nada: lo guardado es lo que muestra el tablero.
      else if (version > 0 && !escribio.current && version === inicioVersion) setTurnoSinCambios(version);
    }
    trabajando.current = enCurso;
  }, [enCurso, version, esperandoPropuesta, inicioVersion]);
  useEffect(() => { if (!esperandoPropuesta) setTerminoSinPlan(false); }, [esperandoPropuesta]);
  useEffect(() => { if (turnoSinCambios !== null && version !== turnoSinCambios) setTurnoSinCambios(null); }, [version, turnoSinCambios]);

  if (enCurso) {
    return <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm"><span>{version > inicioVersion ? "El plan cambió; revisa la comparación de versiones." : paso}</span><Button variant="outline" size="sm" onClick={() => focusAgentChat()}>Ver agente y control de detener</Button></div>;
  }
  if (terminoSinPlan && onReintentar) {
    return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
      <span className="inline-flex items-center gap-2"><IconAlertTriangle className="size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />El agente terminó sin guardar un plan en el tablero. Lo que haya escrito en el chat no está verificado ni guardado.</span>
      <span className="flex gap-2"><Button size="sm" onClick={() => { setTerminoSinPlan(false); onReintentar(); }}>Volver a pedir la propuesta</Button><Button size="sm" variant="ghost" onClick={() => focusAgentChat()}>Ver respuesta</Button></span>
    </div>;
  }
  if (turnoSinCambios !== null) {
    return <div role="note" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
      <span>El último turno del agente no cambió el plan (sigue en la versión {turnoSinCambios}). Lo que diga el chat no está guardado hasta que lo veas aquí.</span>
      <span className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => focusAgentChat()}>Ver respuesta</Button><Button size="sm" variant="ghost" aria-label="Ocultar aviso" onClick={() => setTurnoSinCambios(null)}>Entendido</Button></span>
    </div>;
  }
  return null;
}
