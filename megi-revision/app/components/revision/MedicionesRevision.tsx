import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEstadoAgente } from "./EstadoAgente";
const MedicionTurnoAgente = lazy(() => import("./MedicionTurnoAgente"));
const promedio = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const segundos = (ms: number | null) => ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`;
export function MedicionesRevision({ consultaId, planId, planVisible }: { consultaId: string; planId: string | null; planVisible: boolean }) {
  const metricas = useActionQuery("metricas-revision", { consultaId }, { resources: [`mediciones:${consultaId}`, `consulta:${consultaId}`, `plan:${planId}`] });
  const [mostrar, setMostrar] = useState(false);
  const { runningThreadIds } = useEstadoAgente();
  const enCurso = runningThreadIds.size > 0;
  const [modalidad, setModalidad] = useState<"manual" | "agente">("agente");
  const medir = useActionMutation("medir-revision", { resources: [`mediciones:${consultaId}`], onError: e => toast.error(e.message) });
  const abierta = metricas.data?.mediciones.find(m => !m.fin);
  const enviada = useRef<string | null>(null);
  const { mutate } = medir;
  const abiertaId = abierta?.id;
  const visibleMs = abierta?.planVisibleMs;
  useEffect(() => {
    if (planVisible && abiertaId && visibleMs === null && enviada.current !== abiertaId) {
      enviada.current = abiertaId;
      mutate({ consultaId, operacion: "visible", modalidad: "agente" }, { onError: () => { enviada.current = null; } });
    }
  }, [planVisible, abiertaId, visibleMs, consultaId, mutate]);
  return <details className="rounded-xl border border-border bg-card p-4" onToggle={e => setMostrar(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium">Mediciones exploratorias{abierta ? " · cronómetro en curso" : ""}</summary>
    <p className="my-3 text-xs text-muted-foreground">Inicia antes de trabajar y termina al completar el caso. “Plan visible” mide hasta la señal enviada por esta pantalla; incluye red. Compara el mismo caso y condiciones. Estas mediciones no demuestran eficacia clínica.</p>
    <div className="flex flex-wrap gap-2">{!abierta && <select aria-label="Modalidad de medición" className="rounded-md border border-input bg-background p-2 text-sm" value={modalidad} onChange={e => setModalidad(e.target.value as "manual" | "agente")}><option value="agente">Con agente</option><option value="manual">Manual</option></select>}<Button size="sm" variant="outline" disabled={medir.isPending} onClick={() => medir.mutate({ consultaId, operacion: abierta ? "terminar" : "iniciar", modalidad })}>{abierta ? "Terminar medición" : "Iniciar medición"}</Button>{abierta && <Button size="sm" variant="ghost" disabled={medir.isPending} onClick={() => medir.mutate({ consultaId, operacion: "interrumpir", modalidad })}>Descartar intento de la comparación</Button>}</div>
    {metricas.error && <p role="alert" className="text-sm text-destructive">No se pudieron cargar las mediciones.</p>}
    <p className="mt-3 text-sm font-medium">Manual vs agente · exploratorio, n pequeño</p>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">{(["manual", "agente"] as const).map(tipo => { const xs = metricas.data?.mediciones.filter(m => m.modalidad === tipo && m.resultado === "finalizada" && m.totalMs !== null) ?? []; return <p key={tipo} className="rounded-md border border-border p-3 text-sm">{tipo === "manual" ? "Manual" : "Con agente"}: n={xs.length} · total medio {segundos(promedio(xs.map(m => m.totalMs!)))}</p>; })}</div>
    <p className="mt-2 text-xs text-muted-foreground">Operaciones del servidor: media {segundos(promedio(metricas.data?.servidorMs ?? []))}, n={metricas.data?.servidorMs.length ?? 0}. El cronómetro total incluye interacción, modelo, red y servidor; no permite aislar la generación.</p>
    {!metricas.data?.ultimoRunAgenteId && <p className="text-xs text-muted-foreground">API del modelo: sin traza vinculada a este caso. No se estima a partir del tiempo total.</p>}
    {mostrar && metricas.data?.ultimoRunAgenteId && (enCurso ? <p className="text-xs text-muted-foreground">La medición del turno aparecerá al terminar el agente.</p> : <Suspense fallback={<p className="text-xs text-muted-foreground">Cargando medición del turno…</p>}><MedicionTurnoAgente runId={metricas.data.ultimoRunAgenteId} /></Suspense>)}
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="py-2 text-left text-muted-foreground">Últimas 30 mediciones de este caso</caption><thead><tr><th className="p-2">Modalidad</th><th className="p-2">Inicio</th><th className="p-2">Plan visible</th><th className="p-2">Total</th></tr></thead><tbody>{metricas.data?.mediciones.map(m => <tr key={m.id} className="border-t border-border"><td className="p-2">{m.modalidad}</td><td className="p-2">{new Date(m.inicio).toLocaleString("es-MX")}</td><td className="p-2">{segundos(m.planVisibleMs)}</td><td className="p-2">{m.resultado === "interrumpida" ? "Interrumpida" : m.fin ? segundos(m.totalMs) : "En curso"}</td></tr>)}</tbody></table></div>
  </details>;
}
