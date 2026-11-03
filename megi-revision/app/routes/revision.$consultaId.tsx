import { actionErrorMessage, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconArrowLeft, IconCheck, IconDownload, IconMessage, IconPlus } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { pedirPropuesta, pedirReajuste, pedirReemplazo } from "@/components/revision/agente";
import { BannerDemo } from "@/components/revision/BannerDemo";
import { Bitacora } from "@/components/revision/Bitacora";
import { ContextoPaciente } from "@/components/revision/ContextoPaciente";
import { LineaPlan, type EdicionLinea, type Linea } from "@/components/revision/LineaPlan";

function mensajeError(error: unknown, fallback: string) {
  return actionErrorMessage(error) ?? fallback;
}

export default function RevisionConsultaRoute() {
  const { consultaId = "" } = useParams();
  // El agente escribe desde la barra lateral; además de la invalidación del
  // chat, el tablero se refresca solo mientras está abierto (sin plan o en
  // borrador) para que el médico vea la propuesta sin recargar.
  const [planIdVisto, setPlanIdVisto] = useState<string | null>(null);
  const contexto = useActionQuery("ver-contexto-consulta", { consultaId }, { refetchInterval: planIdVisto ? false : 4000 });
  const planId = contexto.data?.planId ?? null;
  if (planId !== planIdVisto) setPlanIdVisto(planId);
  const plan = useActionQuery("obtener-plan", { consultaId }, {
    enabled: Boolean(planId),
    refetchInterval: (q) => (q.state.data?.plan.estado === "borrador" ? 5000 : false),
  });

  const [rechazando, setRechazando] = useState<Linea | null>(null);
  const [rechazoAbierto, setRechazoAbierto] = useState(false);
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [aprobando, setAprobando] = useState(false);
  const [confirmaAlertas, setConfirmaAlertas] = useState(false);
  const [nueva, setNueva] = useState({ tipo: "farmaco" as "farmaco" | "pendiente", texto: "", dosis: "", frecuencia: "", duracion: "" });

  const onError = (fallback: string) => (error: unknown) => toast.error(mensajeError(error, fallback));

  const crearVacio = useActionMutation("proponer-plan", {
    onSuccess: () => toast.success("Plan en blanco creado"),
    onError: onError("No se pudo crear el plan"),
  });
  const actualizar = useActionMutation("actualizar-linea", {
    onError: onError("No se pudo cambiar la línea"),
  });
  const agregar = useActionMutation("agregar-linea", {
    onSuccess: () => {
      setNueva({ tipo: "farmaco", texto: "", dosis: "", frecuencia: "", duracion: "" });
      toast.success("Línea añadida");
    },
    onError: onError("No se pudo añadir la línea"),
  });
  const aprobar = useActionMutation("aprobar-plan", {
    onSuccess: (r) => {
      setAprobando(false);
      toast.success(r.message);
    },
    onError: (error) => {
      setAprobando(false);
      toast.error(mensajeError(error, "No se pudo aprobar el plan"));
    },
  });

  const ocupada = actualizar.isPending || agregar.isPending || aprobar.isPending || crearVacio.isPending;
  const lineas = plan.data?.lineas ?? [];
  const farmacos = useMemo(() => lineas.filter((l) => l.tipo === "farmaco"), [lineas]);
  const pendientes = useMemo(() => lineas.filter((l) => l.tipo === "pendiente"), [lineas]);
  const cerrado = plan.data?.plan.estado === "exportado";
  const bloqueos = lineas.filter((l) => l.estado !== "rechazada" && l.tipo === "farmaco" && l.verificacion === "bloqueado");

  if (contexto.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </main>
    );
  }
  if (contexto.error || !contexto.data) {
    return (
      <main className="mx-auto w-full max-w-5xl p-6">
        <p className="text-sm text-red-700 dark:text-red-400">{mensajeError(contexto.error, "No se pudo leer la consulta en MEGI.")}</p>
        <Link to="/revision" className="mt-3 inline-block text-sm underline">Volver a la lista</Link>
      </main>
    );
  }

  const ctx = contexto.data;
  const nombre = ctx.paciente.nombre;

  function cambiar(linea: Linea, input: Partial<EdicionLinea> & { estado?: Linea["estado"]; motivo?: string }) {
    actualizar.mutate({ lineaId: linea.id, origen: "medico", motivo: input.motivo ?? "", ...input });
  }

  function enviarNueva(e: React.FormEvent) {
    e.preventDefault();
    if (!planId || !nueva.texto.trim()) return;
    agregar.mutate({ planId, origen: "medico", justificacion: "Añadida por el médico", ...nueva, texto: nueva.texto.trim() });
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Link to="/revision" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <IconArrowLeft className="size-4" /> Consultas
        </Link>
        {plan.data ? (
          cerrado ? <Badge>Aprobado y exportado</Badge> : <Badge variant="secondary">Plan en revisión</Badge>
        ) : (
          <Badge variant="outline">Sin plan</Badge>
        )}
      </div>
      <BannerDemo />
      <ContextoPaciente ctx={ctx} />

      {!planId ? (
        <section className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            La nota de esta consulta ya está consolidada. Pide al agente que prepare la receta y los pendientes, o empieza un plan en blanco.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" onClick={() => pedirPropuesta(consultaId, nombre)}>
              <IconMessage className="size-4" /> Pedir propuesta al agente
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={crearVacio.isPending}
              onClick={() => crearVacio.mutate({ consultaId, lineas: [], explicacion: "Plan iniciado en blanco por el médico", origen: "medico" })}
            >
              Plan en blanco
            </Button>
          </div>
        </section>
      ) : plan.isPending || !plan.data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <>
          {plan.data.plan.explicacion ? (
            <section className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <span className="font-medium">Explicación del agente: </span>
              {plan.data.plan.explicacion}
            </section>
          ) : null}

          <Tabs defaultValue="plan">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="plan">Plan</TabsTrigger>
                <TabsTrigger value="cambios">Cambios ({plan.data.eventos.length})</TabsTrigger>
                {cerrado ? <TabsTrigger value="exportacion">Exportación</TabsTrigger> : null}
              </TabsList>
              {!cerrado ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => pedirReajuste(planId, consultaId)}>
                    <IconMessage className="size-4" /> Pedir reajuste al agente
                  </Button>
                  <Button type="button" disabled={ocupada || !lineas.some((l) => l.estado !== "rechazada")} onClick={() => { setConfirmaAlertas(false); setAprobando(true); }}>
                    <IconCheck className="size-4" /> Aprobar y exportar
                  </Button>
                </div>
              ) : null}
            </div>

            <TabsContent value="plan" className="mt-3 space-y-5">
              <section>
                <h2 className="mb-2 text-sm font-medium text-muted-foreground">Receta</h2>
                {farmacos.length ? (
                  <ul className="space-y-2">
                    {farmacos.map((l) => (
                      <LineaPlan
                        key={l.id}
                        linea={l}
                        cerrado={Boolean(cerrado)}
                        ocupada={ocupada}
                        onEditar={(c) => cambiar(l, c)}
                        onBloquear={() => cambiar(l, { estado: "bloqueada" })}
                        onDesbloquear={() => cambiar(l, { estado: "editada" })}
                        onRechazar={() => { setMotivoRechazo(""); setRechazando(l); setRechazoAbierto(true); }}
                        onReactivar={() => cambiar(l, { estado: "propuesta" })}
                        onPedirReemplazo={() => pedirReemplazo(planId, consultaId, `${l.texto} ${l.dosis}`.trim(), l.motivoVerificacion ?? "")}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Sin fármacos en el plan.</p>
                )}
              </section>

              <section>
                <h2 className="mb-2 text-sm font-medium text-muted-foreground">Pendientes e indicaciones</h2>
                {pendientes.length ? (
                  <ul className="space-y-2">
                    {pendientes.map((l) => (
                      <LineaPlan
                        key={l.id}
                        linea={l}
                        cerrado={Boolean(cerrado)}
                        ocupada={ocupada}
                        onEditar={(c) => cambiar(l, c)}
                        onBloquear={() => cambiar(l, { estado: "bloqueada" })}
                        onDesbloquear={() => cambiar(l, { estado: "editada" })}
                        onRechazar={() => { setMotivoRechazo(""); setRechazando(l); setRechazoAbierto(true); }}
                        onReactivar={() => cambiar(l, { estado: "propuesta" })}
                        onPedirReemplazo={() => undefined}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Sin pendientes en el plan.</p>
                )}
              </section>

              {!cerrado ? (
                <form onSubmit={enviarNueva} className="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-[auto_2fr_1fr_1fr_1fr_auto] sm:items-end">
                  <div className="space-y-1">
                    <Label htmlFor="nueva-tipo">Tipo</Label>
                    <select
                      id="nueva-tipo"
                      value={nueva.tipo}
                      onChange={(e) => setNueva({ ...nueva, tipo: e.target.value as "farmaco" | "pendiente" })}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="farmaco">Fármaco</option>
                      <option value="pendiente">Pendiente</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="nueva-texto">{nueva.tipo === "farmaco" ? "Fármaco" : "Pendiente"}</Label>
                    <Input id="nueva-texto" value={nueva.texto} onChange={(e) => setNueva({ ...nueva, texto: e.target.value })} placeholder={nueva.tipo === "farmaco" ? "Paracetamol" : "Control en 2 semanas"} />
                  </div>
                  {nueva.tipo === "farmaco" ? (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor="nueva-dosis">Dosis</Label>
                        <Input id="nueva-dosis" value={nueva.dosis} onChange={(e) => setNueva({ ...nueva, dosis: e.target.value })} placeholder="500 mg" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="nueva-frec">Frecuencia</Label>
                        <Input id="nueva-frec" value={nueva.frecuencia} onChange={(e) => setNueva({ ...nueva, frecuencia: e.target.value })} placeholder="cada 8 h" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="nueva-dur">Duración</Label>
                        <Input id="nueva-dur" value={nueva.duracion} onChange={(e) => setNueva({ ...nueva, duracion: e.target.value })} placeholder="5 días" />
                      </div>
                    </>
                  ) : (
                    <div className="sm:col-span-3" />
                  )}
                  <Button type="submit" variant="outline" disabled={ocupada || !nueva.texto.trim()}>
                    <IconPlus className="size-4" /> Añadir
                  </Button>
                </form>
              ) : null}
            </TabsContent>

            <TabsContent value="cambios" className="mt-3 rounded-xl border border-border bg-card px-3">
              <Bitacora eventos={plan.data.eventos} />
            </TabsContent>

            {cerrado ? (
              <TabsContent value="exportacion" className="mt-3 space-y-3">
                <div className="rounded-xl border border-border bg-card p-4 text-sm">
                  <p><span className="font-medium">Aprobado por:</span> {plan.data.plan.aprobadoPor ?? "—"}</p>
                  <p className="break-all"><span className="font-medium">Sello:</span> {plan.data.plan.sello ?? "—"}</p>
                  {plan.data.exportacion ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3"
                      onClick={() => {
                        const blob = new Blob([plan.data!.exportacion!], { type: "application/fhir+json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${consultaId}-nota.fhir.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <IconDownload className="size-4" /> Descargar FHIR
                    </Button>
                  ) : null}
                </div>
                {plan.data.exportacion ? (
                  <pre className="max-h-96 overflow-auto rounded-xl border border-border bg-muted/30 p-3 text-xs">{plan.data.exportacion}</pre>
                ) : null}
              </TabsContent>
            ) : null}
          </Tabs>
        </>
      )}

      <AlertDialog open={rechazoAbierto} onOpenChange={setRechazoAbierto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rechazar «{rechazando?.texto}»</AlertDialogTitle>
            <AlertDialogDescription>La línea sale del plan y queda registrada con su motivo. Puedes reactivarla después.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="motivo-rechazo">Motivo</Label>
            <Textarea id="motivo-rechazo" value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)} placeholder="Paciente alérgica; prefiero otro antibiótico" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Conservar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!motivoRechazo.trim() || actualizar.isPending}
              onClick={() => {
                if (rechazando) cambiar(rechazando, { estado: "rechazada", motivo: motivoRechazo.trim() });
                setRechazoAbierto(false);
              }}
            >
              Rechazar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={aprobando} onOpenChange={setAprobando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprobar y exportar a MEGI</AlertDialogTitle>
            <AlertDialogDescription>
              Se aprueba la consulta en MEGI con esta receta y se genera la nota FHIR sellada. La aprobación queda a tu nombre.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {bloqueos.length ? (
            <div className="space-y-2 rounded-lg border border-red-500/50 bg-red-500/5 p-3 text-sm">
              <p className="font-medium text-red-700 dark:text-red-400">
                {bloqueos.length} fármaco(s) con bloqueo de seguridad:
              </p>
              <ul className="list-disc pl-5 text-xs">
                {bloqueos.map((b) => (
                  <li key={b.id}>{b.texto}: {b.motivoVerificacion}</li>
                ))}
              </ul>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={confirmaAlertas} onChange={(e) => setConfirmaAlertas(e.target.checked)} />
                Confirmo que revisé estas alertas y asumo la decisión clínica.
              </label>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={aprobar.isPending || (bloqueos.length > 0 && !confirmaAlertas)}
              onClick={(e) => {
                e.preventDefault();
                if (planId) aprobar.mutate({ planId, confirmaAlertas, origen: "medico", notas: "" });
              }}
            >
              {aprobar.isPending ? "Exportando…" : "Aprobar y exportar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
