import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconChevronRight, IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";
import { Link } from "react-router";

import { BannerDemo } from "@/components/revision/BannerDemo";
import { Alergia } from "@/components/revision/Chips";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function fecha(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export default function RevisionIndexRoute() {
  const { data, isPending, error } = useActionQuery("listar-consultas", {});

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <BannerDemo />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Consultas pendientes de revisión</h1>
        {data ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {data.megi.disponible ? <IconPlugConnected className="size-4" /> : <IconPlugConnectedX className="size-4 text-red-600" />}
            MEGI {data.megi.disponible ? `conectado (${data.megi.modo})` : "sin conexión"}
          </span>
        ) : null}
      </div>

      {isPending ? (
        <div className="grid gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-400">
          No se pudo leer MEGI. Revisa que el backend esté arrancado y vuelve a intentar.
        </p>
      ) : !data?.consultas.length ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No hay consultas consolidadas pendientes de revisión.
        </p>
      ) : (
        <ul className="grid gap-3">
          {data.consultas.map((c) => (
            <li key={c.id}>
              <Link
                to={`/revision/${encodeURIComponent(c.id)}`}
                className="group flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.paciente.nombre}</span>
                    <span className="text-sm text-muted-foreground">
                      {c.paciente.edad} años · {c.paciente.sexo}
                    </span>
                    <span className="text-xs text-muted-foreground">{fecha(c.fecha)}</span>
                  </div>
                  <p className="text-sm">{c.motivo}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.paciente.alergias.length ? (
                      c.paciente.alergias.map((a) => <Alergia key={a} texto={`Alergia: ${a}`} />)
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">Sin registro de alergias</Badge>
                    )}
                    {c.paciente.cronicos.map((x) => (
                      <Badge key={x} variant="secondary">{x}</Badge>
                    ))}
                    {c.paciente.medicacionActiva.map((m) => (
                      <Badge key={m} variant="outline">Toma: {m}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-center">
                  {c.planEstado === "exportado" ? (
                    <Badge>Exportado</Badge>
                  ) : c.planId ? (
                    <Badge variant="secondary">Plan en revisión</Badge>
                  ) : (
                    <Badge variant="outline">Sin plan</Badge>
                  )}
                  <IconChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
