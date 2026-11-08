import { useTraceDetail } from "@agent-native/toolkit/app/observability";

const segundos = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The shared hook enforces the signed-in owner's trace access. No raw payloads
 * or prompts are rendered, and only one case-linked run is fetched on demand. */
export default function MedicionTurnoAgente({ runId }: { runId: string }) {
  const traza = useTraceDetail(runId);
  if (traza.isPending) return <p className="text-xs text-muted-foreground">Leyendo la duración del último turno…</p>;
  if (traza.error || !traza.data) return <p className="text-xs text-muted-foreground">No hay una traza disponible para medir este turno.</p>;
  const llamadas = traza.data.spans.filter(s => s.spanType === "llm_call");
  const herramientas = traza.data.spans.filter(s => s.spanType === "tool_call");
  if (!llamadas.length) return <p className="text-xs text-muted-foreground">No se conservaron duraciones de la API del modelo para este turno.</p>;
  return <div className="mt-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
    <p className="font-medium text-foreground">Último turno del agente que modificó este plan · exploratorio, n=1</p>
    <p>API del modelo: {segundos(llamadas.reduce((n, s) => n + s.durationMs, 0))} en {llamadas.length} llamada(s), incluidos reintentos y red del proveedor.</p>
    <p>Herramientas: {segundos(herramientas.reduce((n, s) => n + s.durationMs, 0))}. Turno en servidor: {segundos(traza.data.summary.totalDurationMs)}.</p>
    <p>Son duraciones registradas por el runtime; no se obtienen restando el tiempo del servidor al cronómetro del caso.</p>
  </div>;
}
