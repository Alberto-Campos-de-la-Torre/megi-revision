// Narrow generic chat completion events using ids observed on the official runtime.
// No clinical text is retained; unknown events keep the framework's safe fallback.
type Query = { queryKey: readonly unknown[]; meta?: Record<string, unknown> | undefined };
const hints = new Map<string, Set<string>>();
export function anotarRecurso(tool: string, input: unknown) {
  if (!input || typeof input !== "object") return;
  const d = input as Record<string, any>;
  const planId = d.planId ?? d.plan?.id ?? d.linea?.planId;
  const consultaId = d.consultaId ?? d.plan?.consultaId;
  // Some runtime completion payloads contain only the rendered receipt. Keep
  // this call's input scope instead of replacing it with just the list tag.
  if (typeof planId !== "string" && typeof consultaId !== "string" && tool !== "restaurar-demo") return;
  // A tool name can be reused for another plan in a later call. Do not let
  // targets from previous calls turn directed invalidation into a growing union.
  const tipos = new Set<string>();
  if (typeof planId === "string") tipos.add(`plan:${planId}`);
  if (typeof consultaId === "string") tipos.add(`consulta:${consultaId}`);
  if (["proponer-plan", "aprobar-plan", "restaurar-demo"].includes(tool)) tipos.add("consultas");
  while (tipos.size > 200) tipos.delete(tipos.values().next().value!);
  if (tipos.size) hints.set(tool, tipos);
  if (hints.size > 100) hints.delete(hints.keys().next().value!);
}
export function invalidarRevision(query: Query, events: readonly Record<string, unknown>[]) {
  const recursos = query.meta?.actionResources;
  if (!Array.isArray(recursos) || !recursos.length) return true;
  return events.some(e => {
    if (typeof e.resourceType === "string") return recursos.includes(e.resourceType);
    const tipos = hints.get(String(e.key));
    return !tipos || recursos.some(r => tipos.has(r));
  });
}
const escrituras = new Set(["proponer-plan", "reajustar-plan", "actualizar-linea", "agregar-linea", "sugerir-reemplazo"]);
export function invalidarHerramientaRevision(query: Query, tool: string) {
  const recursos = query.meta?.actionResources;
  const tipos = hints.get(tool);
  return query.queryKey[0] === "action" && Array.isArray(recursos) && Boolean(tipos) && recursos.some(r => tipos!.has(r));
}
export function observarRecursosRevision(alCompletarEscritura?: (tool: string) => void) {
  const entrada = (event: Event) => {
    const d = (event as CustomEvent).detail ?? {};
    // A child-id-only call may not reveal its plan until its result arrives.
    // Its predecessor's hint must not be used in that interval.
    if (d.phase === "start" || d.input !== undefined) hints.delete(d.tool);
    let input = d.input;
    if (!input && d.argsText) { try { input = JSON.parse(d.argsText); } catch { return; } }
    anotarRecurso(d.tool, input);
  };
  const salida = (event: Event) => {
    const d = (event as CustomEvent).detail ?? {};
    let result = d.result;
    if (typeof result === "string") { try { result = JSON.parse(result); } catch { result = undefined; } }
    anotarRecurso(d.tool, result);
    // These known transactional writes only report success after commit. Own
    // their scoped refresh for both marked and unmarked paused-turn events;
    // a successful receipt must not wait for the 60 s transport fallback.
    if (!d.isError && escrituras.has(d.tool)) alCompletarEscritura?.(d.tool);
  };
  window.addEventListener("agent-native:tool-input", entrada);
  window.addEventListener("agent-native:tool-start", entrada);
  // Capture phase records the hint before the framework consumes completion.
  window.addEventListener("agent-native:tool-done", salida, true);
  return () => { window.removeEventListener("agent-native:tool-input", entrada); window.removeEventListener("agent-native:tool-start", entrada); window.removeEventListener("agent-native:tool-done", salida, true); hints.clear(); };
}
