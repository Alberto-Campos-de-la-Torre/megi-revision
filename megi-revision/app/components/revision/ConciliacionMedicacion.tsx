import { useActionMutation } from "@agent-native/core/client/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Conciliado } from "../../../server/lib/revision";

export function ConciliacionMedicacion({ planId, version, medicacion, confirmada, cerrado }: { planId: string; version: number; medicacion: Conciliado[]; confirmada: boolean; cerrado: boolean }) {
  const [estados, setEstados] = useState<Record<string, Conciliado["estado"]>>(Object.fromEntries(medicacion.map(m => [m.id, m.estado])));
  const [adicionales, setAdicionales] = useState<{ nombre: string; dosis: string; frecuencia: string }[]>([]);
  const guardar = useActionMutation("conciliar-medicacion", { resources: [`plan:${planId}`], onSuccess: () => toast.success("Medicación conciliada y plan verificado"), onError: e => toast.error(e.message) });
  return <details className="rounded-xl border border-border bg-card p-4" open={!confirmada && medicacion.some(m => m.estado === "sin_confirmar")}>
    <summary className="cursor-pointer text-sm font-medium">Medicación del paciente · {medicacion.filter(m => m.estado === "sin_confirmar").length ? "requiere confirmación" : confirmada ? "revisada por el médico" : "confirmar antecedentes"}</summary>
    <p className="my-3 text-xs text-muted-foreground">Las recetas históricas pueden haber cambiado. Confirma con el paciente qué sigue tomando; los registros sin confirmar se incluyen preventivamente en la verificación.</p>
    <div className="space-y-3">{medicacion.map(m => <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 text-sm">
      <div><p>{m.nombre} {m.dosis} · {m.frecuencia}</p><p className="text-xs text-muted-foreground">{m.fuente} · {m.fecha ? new Date(m.fecha).toLocaleDateString("es-MX") : "fecha no disponible"}{m.duracion ? ` · ${m.duracion}` : ""}</p></div>
      <select aria-label={`Estado de ${m.nombre} ${m.dosis}`} disabled={cerrado || guardar.isPending} value={estados[m.id]} onChange={e => setEstados(prev => ({ ...prev, [m.id]: e.target.value as Conciliado["estado"] }))} className="rounded-md border border-input bg-background p-2">
        <option value="sin_confirmar">Sin confirmar</option><option value="activo">Lo sigue tomando</option><option value="suspendido">Suspendido</option><option value="finalizado">Tratamiento finalizado</option>
      </select>
    </div>)}</div>
    {!cerrado && <>
      {adicionales.map((m, i) => <div key={i} className="mt-3 grid gap-2 sm:grid-cols-3">{(["nombre", "dosis", "frecuencia"] as const).map(k => <div key={k}><Label htmlFor={`med-${i}-${k}`}>{k === "nombre" ? "Otro medicamento referido" : k}</Label><Input id={`med-${i}-${k}`} value={m[k]} onChange={e => setAdicionales(prev => prev.map((x, j) => i === j ? { ...x, [k]: e.target.value } : x))} /></div>)}<Button size="sm" variant="ghost" onClick={() => setAdicionales(prev => prev.filter((_, j) => i !== j))}>Quitar registro nuevo</Button></div>)}
      <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={guardar.isPending} onClick={() => setAdicionales(prev => [...prev, { nombre: "", dosis: "", frecuencia: "" }])}>Añadir medicación referida</Button><Button size="sm" disabled={guardar.isPending || adicionales.some(m => !m.nombre.trim())} onClick={() => guardar.mutate({ planId, versionEsperada: version, decisiones: medicacion.map(m => ({ id: m.id, estado: estados[m.id]! })), adicionales })}>{guardar.isPending ? "Verificando…" : medicacion.length || adicionales.length ? "Guardar conciliación" : "Confirmar que no refiere medicación"}</Button></div>
    </>}
  </details>;
}
