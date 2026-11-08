import { useActionQuery } from "@agent-native/core/client/hooks";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { compararLineas, type Snapshot } from "@/lib/revision-diff";

type Version = { version: number; actor: string; accion: string; motivo: string; snapshot: string; operacionMs: number; createdAt: string };
const etiqueta = (s: string) => ({ verificacion: "Verificación", texto: "Texto", dosis: "Dosis", frecuencia: "Frecuencia", duracion: "Duración", estado: "Estado", ok: "Sin alertas detectadas", bloqueado: "Bloqueo de seguridad", advertencia: "Advertencia" })[s as "verificacion"] ?? s;
export function ComparacionPlan({ planId }: { planId: string }) {
  const [antes, setAntes] = useState<number>();
  const [base, setBase] = useState<number>();
  const historial = useActionQuery("historial-plan", { planId, antes }, { resources: [`plan:${planId}`] });
  const rows = historial.data?.versiones ?? [];
  const actual: Version | undefined = rows[0];
  const anterior = rows.find(v => v.version === base && v.version < (actual?.version ?? 0)) ?? rows[1];
  const cambios = actual ? compararLineas(anterior ? (JSON.parse(anterior.snapshot) as Snapshot).lineas : [], (JSON.parse(actual.snapshot) as Snapshot).lineas) : [];
  return <section className="space-y-3 rounded-xl border border-border bg-card p-4">
    {historial.error ? <p role="alert" className="text-sm text-destructive">No se pudo cargar el historial.</p> : !actual ? <p className="text-sm text-muted-foreground">{historial.isPending ? "Cargando versiones…" : "El próximo cambio guardará la primera versión; no se reconstruye un historial que no existe."}</p> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">Versión {actual.version} · {actual.actor === "medico" ? "Médico" : "Agente"} · {new Date(actual.createdAt).toLocaleString("es-MX")}</p>
        {rows.length > 1 && <label className="flex items-center gap-2 text-sm">Comparar con<select aria-label="Versión de referencia" className="rounded-md border border-input bg-background p-2" value={anterior?.version} onChange={e => setBase(Number(e.target.value))}>{rows.slice(1).map(v => <option key={v.version} value={v.version}>Versión {v.version}</option>)}</select></label>}
      </div>
      <p className="text-sm">{actual.motivo}</p>
      <p className="text-xs text-muted-foreground">Operación del servidor: {actual.operacionMs} ms. Excluye el tiempo de generación del modelo.</p>
      {!anterior && <p className="text-xs text-muted-foreground">Primera instantánea conservada.</p>}
      <ul className="divide-y divide-border">{cambios.map(({ actual: l, anterior: previo, cambios: campos, tipo }) => <li key={l.id} className={`my-2 rounded-md border-l-4 p-3 text-sm ${tipo === "retirada" ? "border-red-500 bg-red-500/10" : tipo === "agregada" ? "border-emerald-500 bg-emerald-500/10" : tipo === "modificada" ? "border-amber-500 bg-amber-500/10" : "border-border"}`}>
        <div className="flex flex-wrap items-center gap-2"><span className={`font-medium ${tipo === "retirada" ? "text-red-700 line-through dark:text-red-400" : tipo === "agregada" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{l.texto}</span><span className={tipo === "retirada" ? "text-red-700 dark:text-red-400" : tipo === "agregada" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{tipo === "conservada" && l.estado === "bloqueada" ? "Conservada · fijada por el médico" : tipo}</span></div>
        {campos.map(c => <p key={c.campo} className="mt-1 text-xs"><span className="text-muted-foreground">{etiqueta(c.campo)}: </span><del className="text-red-700 dark:text-red-400">{etiqueta(c.antes) || "—"}</del> → <span className="font-medium text-emerald-700 dark:text-emerald-400">{etiqueta(c.despues) || "—"}</span></p>)}
        {!previo && <p className="mt-1 text-xs">{[l.dosis, l.frecuencia, l.duracion].filter(Boolean).join(" · ")}</p>}
        {tipo !== "conservada" && l.justificacion && <p className="mt-1 text-xs text-muted-foreground">{l.justificacion}</p>}
      </li>)}</ul>
    </>}
    <div className="flex gap-2">{antes !== undefined && <Button variant="outline" size="sm" onClick={() => { setAntes(undefined); setBase(undefined); }}>Más recientes</Button>}{historial.data?.siguiente && <Button variant="outline" size="sm" onClick={() => { setAntes(historial.data!.siguiente!); setBase(undefined); }}>Versiones anteriores</Button>}</div>
  </section>;
}
