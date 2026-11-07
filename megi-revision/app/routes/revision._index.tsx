import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconChevronRight, IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router";

import { DemoAutonoma } from "@/components/revision/DemoAutonoma";
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
  const [estado, setEstadoBase] = useState<"pendientes" | "exportadas">("pendientes");
  // MEGI pagina en servidor: la primera página basta para empezar a revisar;
  // «Ver más» amplía la página en vez de acumular listas (sin duplicados).
  const PAGINA = 20;
  const [limite, setLimite] = useState(PAGINA);
  const setEstado = (e: "pendientes" | "exportadas") => { setEstadoBase(e); setLimite(PAGINA); };
  const { data, isPending, isFetching, error } = useActionQuery("listar-consultas", { estado, limite, desde: 0 }, { resources: ["consultas"], refetchOnWindowFocus: true });

  return (
    <div data-pagina className="@container mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <BannerDemo />
      {data?.megi.modo === "mock" && <DemoAutonoma />}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{estado === "pendientes" ? "Consultas pendientes de revisión" : "Consultas exportadas"}</h1>
        {data ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {data.megi.disponible ? <IconPlugConnected className="size-4" /> : <IconPlugConnectedX className="size-4 text-red-600" />}
            MEGI {data.megi.disponible ? `conectado (${data.megi.modo})` : "sin conexión"}
          </span>
        ) : null}
      </div>

      <div className="flex gap-2" aria-label="Estado de las consultas">{(["pendientes", "exportadas"] as const).map(e => <Button key={e} variant={estado === e ? "default" : "outline"} onClick={() => setEstado(e)}>{e === "pendientes" ? "Pendientes" : "Exportadas"}</Button>)}</div>
      {isPending ? (
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-400" data-error-code={(error as any)?.code ?? (error as any)?.errorCode ?? ""}>
          {((error as any)?.code ?? (error as any)?.errorCode) === "sin_rol_clinico"
            ? "Tu cuenta no tiene acceso a MEGI. Conecta tu propia cuenta de MEGI en Ajustes (usuario y contraseña de MEGI) o pide al administrador que autorice tu correo."
            : ((error as any)?.code ?? (error as any)?.errorCode) === "credenciales_no_disponibles"
              ? "No se pudo leer tu conexión con MEGI en este momento. Vuelve a intentarlo."
              : "No se pudo leer MEGI. Revisa que el backend esté arrancado y vuelve a intentar."}
        </p>
      ) : !data?.consultas.length ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {estado === "pendientes"
            ? "No hay consultas consolidadas pendientes de revisión."
            : "Todavía no hay consultas exportadas. Cuando apruebes y exportes un plan aparecerá aquí, en el archivo local."}
        </p>
      ) : (
        <>
        {/* Dos columnas según el ancho del contenido (no de la ventana): con el
            inspector abierto o texto ampliado, la lista vuelve a una columna. */}
        <ul className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
          {data.consultas.map((c) => (
            <li key={c.id} className="flex min-w-0">
              <Link
                to={`/revision/${encodeURIComponent(c.id)}`}
                className="tarjeta-consulta group flex min-h-44 w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.paciente.nombre}</div>
                    <div className="text-xs text-muted-foreground">
                      {estado === "pendientes" ? `${c.paciente.edad} años · ${c.paciente.sexo} · ` : "Archivo local · "}
                      {fecha(c.fecha)}
                    </div>
                  </div>
                  {c.planEstado === "exportado" ? (
                    <Badge className="shrink-0">Exportado</Badge>
                  ) : c.planId ? (
                    <Badge variant="secondary" className="shrink-0">Plan en revisión</Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0">Sin plan</Badge>
                  )}
                </div>
                <p className="text-sm leading-snug">{c.motivo}</p>
                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  {estado === "exportadas" ? null : c.paciente.alergias.length ? (
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
                <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                  Abrir revisión <IconChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" aria-live="polite">
          <span>Mostrando {data.consultas.length} de {data.total} {estado === "pendientes" ? "pendientes" : "exportadas"}</span>
          {data.siguiente !== null ? (
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => setLimite((l) => Math.min(200, l + PAGINA))}>
              {isFetching ? "Cargando…" : `Ver ${Math.min(PAGINA, data.total - data.consultas.length)} más`}
            </Button>
          ) : null}
        </div>
        </>
      )}
    </div>
  );
}
