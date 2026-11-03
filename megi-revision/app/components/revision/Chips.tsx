import { IconAlertTriangle, IconCircleCheck, IconLock, IconShieldX } from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Verificacion = "pendiente" | "ok" | "advertencia" | "bloqueado";
export type EstadoLinea = "propuesta" | "editada" | "bloqueada" | "rechazada";

export function ChipVerificacion({ v, className }: { v: Verificacion; className?: string }) {
  if (v === "ok") {
    return (
      <Badge variant="outline" className={cn("gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400", className)}>
        <IconCircleCheck className="size-3.5" /> Verificado
      </Badge>
    );
  }
  if (v === "advertencia") {
    return (
      <Badge variant="outline" className={cn("gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400", className)}>
        <IconAlertTriangle className="size-3.5" /> Advertencia
      </Badge>
    );
  }
  if (v === "bloqueado") {
    return (
      <Badge variant="outline" className={cn("gap-1 border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400", className)}>
        <IconShieldX className="size-3.5" /> Bloqueo de seguridad
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn("text-muted-foreground", className)}>
      Sin verificar
    </Badge>
  );
}

export function ChipEstado({ estado, origen }: { estado: EstadoLinea; origen: "agente" | "medico" }) {
  if (estado === "bloqueada") {
    return (
      <Badge className="gap-1 bg-foreground text-background">
        <IconLock className="size-3.5" /> Bloqueada por el médico
      </Badge>
    );
  }
  if (estado === "rechazada") return <Badge variant="secondary">Rechazada</Badge>;
  if (estado === "editada") return <Badge variant="secondary">Editada por el {origen === "medico" ? "médico" : "agente"}</Badge>;
  return <Badge variant="secondary">Propuesta por el {origen === "medico" ? "médico" : "agente"}</Badge>;
}

export function Alergia({ texto }: { texto: string }) {
  return (
    <Badge variant="outline" className="border-red-500/40 text-red-700 dark:text-red-400">
      {texto}
    </Badge>
  );
}
