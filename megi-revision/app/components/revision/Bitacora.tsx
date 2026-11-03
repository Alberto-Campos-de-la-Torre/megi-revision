import { IconRobot, IconUser } from "@tabler/icons-react";

export type Evento = {
  id: string;
  lineaId: string | null;
  actor: "agente" | "medico";
  accion: string;
  detalle: string;
  createdAt: string;
};

const ETIQUETAS: Record<string, string> = {
  proponer: "Propuso el plan",
  reajustar: "Reajustó el plan",
  agregar: "Añadió",
  reemplazar: "Reemplazó",
  quitar: "Quitó",
  editar: "Editó",
  bloquear: "Bloqueó",
  desbloquear: "Desbloqueó",
  rechazar: "Rechazó",
  reactivar: "Reactivó",
  aprobar: "Aprobó y exportó",
};

function hora(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
}

export function Bitacora({ eventos }: { eventos: Evento[] }) {
  if (!eventos.length) {
    return <p className="p-4 text-sm text-muted-foreground">Todavía no hay cambios registrados.</p>;
  }
  return (
    <ol className="divide-y divide-border">
      {[...eventos].reverse().map((e) => {
        const Icono = e.actor === "medico" ? IconUser : IconRobot;
        return (
          <li key={e.id} className="flex gap-3 px-1 py-2.5 text-sm">
            <Icono className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p>
                <span className="font-medium">{e.actor === "medico" ? "Médico" : "Agente"}</span>{" "}
                <span className="text-muted-foreground">{ETIQUETAS[e.accion] ?? e.accion}</span>
              </p>
              {e.detalle ? <p className="text-xs text-muted-foreground">{e.detalle}</p> : null}
            </div>
            <time className="shrink-0 text-xs text-muted-foreground" dateTime={e.createdAt}>{hora(e.createdAt)}</time>
          </li>
        );
      })}
    </ol>
  );
}
