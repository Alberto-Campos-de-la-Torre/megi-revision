import { IconLock, IconLockOpen, IconPencil, IconTrash, IconArrowBackUp, IconMessage } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { ChipEstado, ChipVerificacion, type EstadoLinea, type Verificacion } from "./Chips";

export type Linea = {
  id: string;
  tipo: "farmaco" | "pendiente";
  texto: string;
  dosis: string;
  frecuencia: string;
  duracion: string;
  estado: EstadoLinea;
  verificacion: Verificacion;
  motivoVerificacion: string | null;
  alternativas: string[];
  origen: "agente" | "medico";
  justificacion: string | null;
  fuentes?: { tipo: string; referencia: string; fecha: string; fragmento: string }[];
};

export type EdicionLinea = { texto: string; dosis: string; frecuencia: string; duracion: string };

export function LineaPlan({
  linea,
  cerrado,
  ocupada,
  onEditar,
  seleccionada = false,
  onSeleccionar,
  onBloquear,
  onDesbloquear,
  onRechazar,
  onReactivar,
  onPedirReemplazo,
}: {
  linea: Linea;
  cerrado: boolean;
  ocupada: boolean;
  onEditar: (cambios: EdicionLinea) => void;
  seleccionada?: boolean;
  onSeleccionar?: () => void;
  onBloquear: () => void;
  onDesbloquear: () => void;
  onRechazar: () => void;
  onReactivar: () => void;
  onPedirReemplazo: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<EdicionLinea>({ texto: linea.texto, dosis: linea.dosis, frecuencia: linea.frecuencia, duracion: linea.duracion });
  const bloqueada = linea.estado === "bloqueada";
  const rechazada = linea.estado === "rechazada";
  const esFarmaco = linea.tipo === "farmaco";
  const hayDetalle = Boolean(
    (esFarmaco && linea.motivoVerificacion && !rechazada) ||
    linea.justificacion ||
    linea.fuentes ||
    (esFarmaco && linea.verificacion === "bloqueado" && linea.alternativas.length && !rechazada),
  );

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.texto.trim()) return;
    onEditar({ texto: form.texto.trim(), dosis: form.dosis.trim(), frecuencia: form.frecuencia.trim(), duracion: form.duracion.trim() });
    setEditando(false);
  }

  return (
    <li
      data-linea-id={linea.id}
      className={cn(
        "rounded-xl border bg-card p-3 transition-colors",
        bloqueada ? "border-foreground/60" : "border-border",
        rechazada && "opacity-60",
        linea.verificacion === "bloqueado" && !rechazada && "border-red-500/50",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="w-full min-w-0 flex-1 space-y-1.5 sm:w-auto">
          <div className="flex flex-wrap items-center gap-2">
            {!cerrado && !rechazada && onSeleccionar && <input type="checkbox" aria-label={`Seleccionar ${linea.texto}`} checked={seleccionada} onChange={onSeleccionar} className="size-4 accent-current" />}
            <span className={cn("font-medium", rechazada && "line-through")}>{linea.texto}</span>
            {esFarmaco && (linea.dosis || linea.frecuencia || linea.duracion) ? (
              <span className={cn("text-sm text-muted-foreground", rechazada && "line-through")}>
                {[linea.dosis, linea.frecuencia, linea.duracion].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {esFarmaco && !rechazada ? <ChipVerificacion v={linea.verificacion} /> : null}
            <ChipEstado estado={linea.estado} origen={linea.origen} />
          </div>
        </div>

        {!cerrado ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {rechazada ? (
              <Button type="button" variant="ghost" size="sm" disabled={ocupada} onClick={onReactivar}>
                <IconArrowBackUp className="size-4" /> Reactivar
              </Button>
            ) : bloqueada ? (
              <Button type="button" variant="outline" size="sm" disabled={ocupada} onClick={onDesbloquear}>
                <IconLockOpen className="size-4" /> Desbloquear
              </Button>
            ) : (
              <>
                {esFarmaco && linea.verificacion === "bloqueado" ? (
                  <Button type="button" variant="outline" size="sm" disabled={ocupada} onClick={onPedirReemplazo}>
                    <IconMessage className="size-4" /> Pedir reemplazo al agente
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="sm" disabled={ocupada} onClick={() => setEditando((v) => !v)} aria-label="Editar">
                  <IconPencil className="size-4" /> Editar
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={ocupada} onClick={onBloquear} aria-label="Bloquear">
                  <IconLock className="size-4" /> Bloquear
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={ocupada} onClick={onRechazar} aria-label="Rechazar" className="text-red-700 dark:text-red-400">
                  <IconTrash className="size-4" /> Rechazar
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* Los textos largos van a todo el ancho, debajo de la cabecera y los
          botones. En la columna izquierda, el motivo de un bloqueo —tres
          frases en la línea del ibuprofeno— se partía en una columna estrecha
          y dejaba a su derecha un hueco vacío tan alto como la línea. */}
      {hayDetalle ? (
        <div className="mt-2 space-y-1.5">
            {esFarmaco && linea.motivoVerificacion && !rechazada ? (
              <p className={cn("text-xs", linea.verificacion === "bloqueado" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400")}>
                {linea.motivoVerificacion}
              </p>
            ) : null}
            {linea.justificacion ? (
              <p className="text-xs text-muted-foreground">
                {rechazada ? "Motivo: " : ""}{linea.justificacion}
              </p>
            ) : null}
            {linea.fuentes && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Fuentes y alcance de la verificación</summary><div className="mt-2 space-y-2 rounded-md border border-border p-2">{linea.fuentes.map((f, i) => <div key={i}><p className="font-medium">{f.tipo === "nota" ? "Mención literal en la nota" : f.tipo === "medicacion" ? "Medicación histórica" : "Requiere confirmación"}{f.referencia ? ` · ${f.referencia}` : ""}{f.fecha ? ` · ${new Date(f.fecha).toLocaleDateString("es-MX")}` : ""}</p><p className="mt-1">{f.fragmento}</p></div>)}<p className="text-muted-foreground">La justificación es una explicación del autor. La verificación contrasta las reglas y datos disponibles; no valida por sí sola la indicación ni la dosis.</p></div></details>}
            {esFarmaco && linea.verificacion === "bloqueado" && linea.alternativas.length && !rechazada ? (
              <p className="text-xs text-muted-foreground">
                Alternativas sugeridas: {linea.alternativas.join(" · ")}
              </p>
            ) : null}
        </div>
      ) : null}

      {editando && !cerrado && !bloqueada && !rechazada ? (
        <form onSubmit={guardar} className="mt-3 grid gap-2 rounded-lg border border-border bg-background p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor={`texto-${linea.id}`}>{esFarmaco ? "Fármaco" : "Pendiente"}</Label>
            <Input id={`texto-${linea.id}`} value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} required />
          </div>
          {esFarmaco ? (
            <>
              <div className="space-y-1">
                <Label htmlFor={`dosis-${linea.id}`}>Dosis</Label>
                <Input id={`dosis-${linea.id}`} value={form.dosis} onChange={(e) => setForm({ ...form, dosis: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`frec-${linea.id}`}>Frecuencia</Label>
                <Input id={`frec-${linea.id}`} value={form.frecuencia} onChange={(e) => setForm({ ...form, frecuencia: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`dur-${linea.id}`}>Duración</Label>
                <Input id={`dur-${linea.id}`} value={form.duracion} onChange={(e) => setForm({ ...form, duracion: e.target.value })} />
              </div>
            </>
          ) : (
            <div className="sm:col-span-3" />
          )}
          <div className="flex gap-1">
            <Button type="submit" size="sm" disabled={ocupada}>Guardar</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(false)}>Cancelar</Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
