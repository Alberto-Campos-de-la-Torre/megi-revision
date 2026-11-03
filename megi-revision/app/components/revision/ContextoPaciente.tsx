import { IconChevronDown } from "@tabler/icons-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { Alergia } from "./Chips";

export type Contexto = {
  consulta: {
    id: string;
    fecha: string;
    motivo: string;
    soap: { s: string; o: string; a: string; p: string };
    diagnosticos: { cie10?: string | undefined; texto: string }[];
    medicamentosPropuestos: string[];
    pendientes: string[];
  };
  paciente: {
    id: string;
    nombre: string;
    edad: number;
    sexo: string;
    alergias: string[];
    alergiasRegistradas: boolean;
    cronicos: string[];
    medicacionActiva: { nombre: string; dosis: string; frecuencia: string; duracion?: string | undefined }[];
  };
};

export function ContextoPaciente({ ctx }: { ctx: Contexto }) {
  const [abierta, setAbierta] = useState(false);
  const { consulta, paciente } = ctx;
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{paciente.nombre}</h1>
        <span className="text-sm text-muted-foreground">
          {paciente.edad} años · {paciente.sexo} · {consulta.id}
        </span>
      </div>
      <p className="mt-1 text-sm">{consulta.motivo}</p>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Alergias</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {paciente.alergiasRegistradas ? (
              paciente.alergias.map((a) => <Alergia key={a} texto={a} />)
            ) : (
              <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">Sin registro: confirmar con el paciente</Badge>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Crónicos</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {paciente.cronicos.length ? paciente.cronicos.map((c) => <Badge key={c} variant="secondary">{c}</Badge>) : <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Medicación activa</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {paciente.medicacionActiva.length ? (
              paciente.medicacionActiva.map((m) => (
                <Badge key={m.nombre} variant="outline">{m.nombre} {m.dosis} {m.frecuencia}</Badge>
              ))
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Diagnósticos</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {consulta.diagnosticos.map((d) => (
              <Badge key={`${d.cie10}-${d.texto}`} variant="secondary">{d.cie10 ? `${d.cie10} · ` : ""}{d.texto}</Badge>
            ))}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="mt-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <IconChevronDown className={cn("size-4 transition-transform", abierta && "rotate-180")} />
        Nota SOAP consolidada
      </button>
      {abierta ? (
        <dl className="mt-2 grid gap-2 rounded-lg border border-border bg-background p-3 text-sm">
          {(["s", "o", "a", "p"] as const).map((k) => (
            <div key={k} className="grid grid-cols-[1.5rem_1fr] gap-2">
              <dt className="font-semibold uppercase">{k}</dt>
              <dd>{consulta.soap[k]}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
