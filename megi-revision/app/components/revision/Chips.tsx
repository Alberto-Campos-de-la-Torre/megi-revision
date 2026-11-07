import { IconAlertTriangle, IconCircleCheck, IconLock, IconShieldX } from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Verificacion = "pendiente" | "ok" | "advertencia" | "bloqueado";
export type EstadoLinea = "propuesta" | "editada" | "bloqueada" | "rechazada";

export function ChipVerificacion({ v, className }: { v: Verificacion; className?: string }) {
  if (v === "ok") {
    return (
      <Badge variant="outline" className={cn("gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400", className)}>
        <IconCircleCheck className="size-3.5" /> Sin alertas detectadas
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

/**
 * «Ninguna conocida», «Sin alergias conocidas» o «Niega alergias» es un
 * REGISTRO de ausencia: se confirmó con el paciente y no hay alergia. No es una
 * alerta y no va en rojo. Distinto de «sin registro» (nadie preguntó), que la
 * ficha muestra en ámbar, y de una alergia registrada, que sí va en rojo.
 */
export const RE_SIN_ALERGIAS = /^(?:alergias?:\s*)?(?:ninguna(?:\s+conocida)?|sin\s+alergias?(?:\s+conocidas?)?|niega\s+alergias?|no\s+conocidas?|negadas?|no\s+refiere)\.?$/i;

export function Alergia({ texto }: { texto: string }) {
  if (RE_SIN_ALERGIAS.test(texto.trim())) {
    return (
      <Badge
        variant="outline"
        className="max-w-full gap-1 whitespace-normal border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
        title="Registrado en el expediente: el paciente no tiene alergias conocidas"
      >
        <IconCircleCheck className="size-3.5" /> Sin alergias conocidas (registrado)
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="max-w-full gap-1 whitespace-normal border-red-500/40 text-red-700 dark:text-red-400" title="Alergia registrada en el expediente">
      <IconAlertTriangle className="size-3.5" /> {texto}
    </Badge>
  );
}
