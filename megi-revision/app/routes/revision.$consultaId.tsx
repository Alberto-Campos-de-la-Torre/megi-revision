import { setClientAppState, actionErrorMessage, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconArrowLeft, IconCheck, IconDownload, IconMessage, IconPlus } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
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
import { pedirAlternativaAutomatica, pedirSeleccion, pedirPropuesta, pedirReajuste, pedirReemplazo } from "@/components/revision/agente";
import { navigationStateForPath } from "@/hooks/use-navigation-state";
import { TAB_ID } from "@/lib/tab-id";
import { ComparacionPlan } from "@/components/revision/ComparacionPlan";
import { ConciliacionMedicacion } from "@/components/revision/ConciliacionMedicacion";
import { MedicionesRevision } from "@/components/revision/MedicionesRevision";
import { TrabajoAgente } from "@/components/revision/TrabajoAgente";
import { BannerDemo } from "@/components/revision/BannerDemo";
import { Bitacora } from "@/components/revision/Bitacora";
import { ContextoPaciente } from "@/components/revision/ContextoPaciente";
import { LineaPlan, type EdicionLinea, type Linea } from "@/components/revision/LineaPlan";

function mensajeError(error: unknown, fallback: string) {
  return actionErrorMessage(error) ?? fallback;
}

export default function RevisionConsultaRoute() {
  const { consultaId = "" } = useParams();
  const contexto = useActionQuery("ver-contexto-consulta", { consultaId }, { resources: [`consulta:${consultaId}`], refetchOnWindowFocus: true, refetchInterval: 60000 });
  const planId = contexto.data?.planId ?? null;
  const plan = useActionQuery("obtener-plan", { consultaId }, { enabled: Boolean(planId), resources: [`plan:${planId}`, `consulta:${consultaId}`], refetchOnWindowFocus: true, refetchInterval: 60000 });
  useEffect(() => {
    void setClientAppState(`navigation:${TAB_ID}`, { ...navigationStateForPath(`/revision/${encodeURIComponent(consultaId)}`), planId, version: plan.data?.plan.version, alcanceAgente: plan.data?.plan.alcanceAgente, alcanceSugerencias: plan.data?.plan.alcanceSugerencias });
  }, [consultaId, planId, plan.data?.plan.version, plan.data?.plan.alcanceAgente, plan.data?.plan.alcanceSugerencias]);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [versionAprobacion, setVersionAprobacion] = useState<number | null>(null);
  useEffect(() => { setSeleccion([]); }, [consultaId]);
  useEffect(() => {
    void setClientAppState(`revision-selection:${TAB_ID}`, { consultaId, lineas: seleccion });
    return () => { void setClientAppState(`revision-selection:${TAB_ID}`, null); };
  }, [consultaId, seleccion]);
  const idsVigentes = plan.data?.lineas.filter(l => l.estado !== "rechazada").map(l => l.id).join(",") ?? "";
  useEffect(() => {
    if (!plan.data) return;
    const ids = new Set(idsVigentes.split(","));
    setSeleccion(prev => prev.some(id => !ids.has(id)) ? prev.filter(id => ids.has(id)) : prev);
  }, [idsVigentes]);
  const alcance = useActionMutation("definir-alcance", { resources: [`plan:${planId}`, `consulta:${consultaId}`], onError: e => toast.error(mensajeError(e, "No se pudo delimitar la edición")) });

  const [rechazando, setRechazando] = useState<Linea | null>(null);
  const [propuestaSolicitada, setPropuestaSolicitada] = useState(false);
  const [rechazoAbierto, setRechazoAbierto] = useState(false);
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [aprobando, setAprobando] = useState(false);
  const [confirmaAlertas, setConfirmaAlertas] = useState(false);
  const [nueva, setNueva] = useState({ tipo: "farmaco" as "farmaco" | "pendiente", texto: "", dosis: "", frecuencia: "", duracion: "" });

  const onError = (fallback: string) => (error: unknown) => toast.error(mensajeError(error, fallback));

  const crearVacio = useActionMutation("proponer-plan", { resources: [`plan:${planId}`, `consulta:${consultaId}`, "consultas"],
    onSuccess: () => toast.success("Plan en blanco creado"),
    onError: onError("No se pudo crear el plan"),
  });
  const actualizar = useActionMutation("actualizar-linea", { resources: [`plan:${planId}`, `consulta:${consultaId}`],
    onError: onError("No se pudo cambiar la línea"),
  });
  const agregar = useActionMutation("agregar-linea", { resources: [`plan:${planId}`, `consulta:${consultaId}`],
    onSuccess: () => {
      setNueva({ tipo: "farmaco", texto: "", dosis: "", frecuencia: "", duracion: "" });
      toast.success("Línea añadida");
    },
    onError: onError("No se pudo añadir la línea"),
  });
  const preparar = useActionMutation("preparar-aprobacion", { resources: [`plan:${planId}`, `consulta:${consultaId}`],
    onSuccess: async r => { const fresca = await plan.refetch(); if (fresca.error || fresca.data?.plan.version !== r.version) { toast.error("El plan cambió. Revisa la versión actual antes de aprobar."); return; } setConfirmaAlertas(false); setVersionAprobacion(r.version); setAprobando(true); },
    onError: onError("No se pudo actualizar la verificación"),
  });
  const aprobar = useActionMutation("aprobar-plan", { resources: [`plan:${planId}`, `consulta:${consultaId}`, "consultas"],
    onSuccess: (r) => {
      setAprobando(false);
      toast.success(r.message);
    },
    onError: (error) => {
      setAprobando(false);
      toast.error(mensajeError(error, "No se pudo aprobar el plan"));
    },
  });

  const resolver = useActionMutation("resolver-sugerencia", { resources: [`plan:${planId}`], onError: onError("No se pudo resolver la sugerencia") });
  const ocupada = resolver.isPending || actualizar.isPending || agregar.isPending || aprobar.isPending || crearVacio.isPending || alcance.isPending || preparar.isPending;
  const lineas = plan.data?.lineas ?? [];
  const farmacos = useMemo(() => lineas.filter((l) => l.tipo === "farmaco"), [lineas]);
  const pendientes = useMemo(() => lineas.filter((l) => l.tipo === "pendiente"), [lineas]);
  const cerrado = plan.data?.plan.estado === "exportado";
  const bloqueos = lineas.filter((l) => l.estado !== "rechazada" && l.tipo === "farmaco" && l.verificacion === "bloqueado");
  const advertencias = lineas.filter((l) => l.estado !== "rechazada" && l.tipo === "farmaco" && l.verificacion === "advertencia");

  if (contexto.isPending) {
    return (
      <div data-pagina className="@container mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    );
  }
  if (contexto.error || !contexto.data) {
    return (
      <div data-pagina className="mx-auto w-full max-w-5xl p-6">
        <p className="text-sm text-red-700 dark:text-red-400">{mensajeError(contexto.error, "No se pudo leer la consulta en MEGI.")}</p>
        <Link to="/revision" className="mt-3 inline-block text-sm underline">Volver a la lista</Link>
      </div>
    );
  }

  const ctx = contexto.data;
  const nombre = ctx.paciente.nombre;

  function cambiar(linea: Linea, input: Partial<EdicionLinea> & { estado?: Linea["estado"]; motivo?: string }) {
    actualizar.mutate({ versionEsperada: plan.data?.plan.version, lineaId: linea.id, origen: "medico", motivo: input.motivo ?? "", ...input }, { onSuccess: r => {
      if (planId && linea.tipo === "farmaco" && linea.verificacion === "bloqueado" && (input.estado === "bloqueada" || input.estado === "rechazada")) {
        alcance.mutate({ planId, versionEsperada: r.version, lineas: [linea.id], modo: "sugerencias" }, { onSuccess: a => pedirAlternativaAutomatica(planId, consultaId, linea.id, a.version, linea.texto, linea.motivoVerificacion ?? "") });
      }
    } });
  }

  function enviarNueva(e: React.FormEvent) {
    e.preventDefault();
    if (!planId || !nueva.texto.trim()) return;
    // Una sola línea también va en `lineas`: la acción pide el array siempre,
    // porque dejarlo opcional le costó al agente dos turnos sin contenido.
    agregar.mutate({
      versionEsperada: plan.data?.plan.version,
      planId,
      origen: "medico",
      lineas: [{ ...nueva, texto: nueva.texto.trim(), justificacion: "Añadida por el médico" }],
    });
  }

  return (
    <div data-pagina className="@container mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Link to="/revision" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <IconArrowLeft className="size-4" /> Consultas
        </Link>
        {plan.data ? (
          cerrado ? <Badge>Aprobado y exportado</Badge> : <Badge variant="secondary">Plan en revisión · v{plan.data.plan.version}</Badge>
        ) : (
          <Badge variant="outline">Sin plan</Badge>
        )}
      </div>
      <BannerDemo />
      <ContextoPaciente ctx={ctx} />
      <TrabajoAgente version={plan.data?.plan.version ?? 0} esperandoPropuesta={propuestaSolicitada && !planId} onReintentar={() => pedirPropuesta(consultaId, nombre, true)} />

      {!planId ? (
        <section className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            La nota de esta consulta ya está consolidada. Pide al agente que prepare la receta y los pendientes, o empieza un plan en blanco.
          </p>
          <ol className="my-4 grid gap-3 text-sm sm:grid-cols-3"><li>1. El agente propone</li><li>2. Tú fijas y ajustas</li><li>3. Apruebas y exportas</li></ol>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" onClick={() => { setPropuestaSolicitada(true); pedirPropuesta(consultaId, nombre); }}>
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
            <details key={plan.data.plan.version} open={plan.data.ultimoActor === "agente"} className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Motivo del último cambio</summary>
              <p className="mt-2">{plan.data.plan.explicacion}</p>
            </details>
          ) : null}

          <ConciliacionMedicacion key={`${planId}-${plan.data.plan.version}`} planId={planId} version={plan.data.plan.version} medicacion={plan.data.conciliacion} confirmada={plan.data.conciliacionConfirmada} cerrado={cerrado} />
          {plan.data.sugerencias.filter(s => s.estado === "pendiente").map(s => <section key={s.id} className="space-y-2 rounded-xl border border-amber-500/50 bg-amber-500/5 p-4 text-sm" aria-label="Alternativa propuesta">
            <h2 className="font-medium">Alternativa del agente · pendiente de tu revisión</h2><p>{[s.texto, s.dosis, s.frecuencia, s.duracion].join(" · ")}</p><p>{s.motivo}</p><p>{s.motivoVerificacion ?? "Sin alertas detectadas por las reglas disponibles."}</p>
            {plan.data.lineas.find(l => l.id === s.lineaId)?.estado === "bloqueada" && <p>Desbloquea la línea original para aceptar su reemplazo.</p>}
            <Button size="sm" disabled={cerrado || ocupada || plan.data.lineas.find(l => l.id === s.lineaId)?.estado === "bloqueada"} onClick={() => resolver.mutate({ planId, sugerenciaId: s.id, versionEsperada: plan.data!.plan.version, decision: "aceptar" })}>Aceptar alternativa</Button>{" "}<Button size="sm" variant="outline" disabled={cerrado || ocupada} onClick={() => resolver.mutate({ planId, sugerenciaId: s.id, versionEsperada: plan.data!.plan.version, decision: "descartar" })}>Descartar alternativa</Button>
          </section>)}
          <Tabs defaultValue="plan">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList className="h-auto max-w-full flex-wrap">
                <TabsTrigger value="plan">Plan</TabsTrigger>
                <TabsTrigger value="comparacion">Comparar versiones</TabsTrigger>
                <TabsTrigger value="cambios">Cambios ({plan.data.eventos.length})</TabsTrigger>
                {cerrado ? <TabsTrigger value="exportacion">Exportación</TabsTrigger> : null}
              </TabsList>
              {!cerrado ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => pedirReajuste(planId, consultaId)}>
                    <IconMessage className="size-4" /> Pedir reajuste al agente
                  </Button>
                  <Button type="button" disabled={ocupada || !lineas.some((l) => l.estado !== "rechazada")} onClick={() => preparar.mutate({ planId, versionEsperada: plan.data!.plan.version })}>
                    <IconCheck className="size-4" /> Aprobar y exportar
                  </Button>
                </div>
              ) : null}
            </div>

            <TabsContent value="plan" className="mt-3 space-y-5">
              {!cerrado && <section className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><p>{plan.data.plan.alcanceAgente === null ? "El agente puede reajustar las líneas no fijadas." : `Edición del agente limitada a ${plan.data.plan.alcanceAgente.length} línea(s).`}</p>{plan.data.plan.alcanceAgente !== null && <Button size="sm" variant="outline" disabled={ocupada} onClick={() => alcance.mutate({ planId, versionEsperada: plan.data!.plan.version, lineas: null })}>Liberar alcance</Button>}</div>
                {seleccion.length > 0 && <div className="flex flex-wrap items-center gap-2"><span>El agente solo podrá editar estas {seleccion.length} líneas al pedir el reajuste.</span><Button size="sm" variant="outline" disabled={ocupada} onClick={() => alcance.mutate({ planId, versionEsperada: plan.data!.plan.version, lineas: seleccion }, { onSuccess: r => pedirSeleccion(planId, consultaId, seleccion, r.version, true) })}>Reajustar solo selección</Button><Button size="sm" variant="ghost" onClick={() => pedirSeleccion(planId, consultaId, seleccion, plan.data!.plan.version, false)}>Explicar selección</Button><Button size="sm" variant="ghost" onClick={() => setSeleccion([])}>Limpiar selección</Button></div>}
              </section>}
              <section>
                <h2 className="mb-2 text-sm font-medium text-muted-foreground">Receta</h2>
                {farmacos.length ? (
                  <ul className="space-y-2">
                    {farmacos.map((l) => (
                      <LineaPlan
                        key={l.id}
                        linea={l}
                        seleccionada={seleccion.includes(l.id)}
                        onSeleccionar={() => setSeleccion(prev => prev.includes(l.id) ? prev.filter(id => id !== l.id) : [...prev, l.id])}
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
                        seleccionada={seleccion.includes(l.id)}
                        onSeleccionar={() => setSeleccion(prev => prev.includes(l.id) ? prev.filter(id => id !== l.id) : [...prev, l.id])}
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
                <form onSubmit={enviarNueva} className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-3 @3xl:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] @3xl:items-end">
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
                    <div className="@3xl:col-span-3" />
                  )}
                  <Button type="submit" variant="outline" disabled={ocupada || !nueva.texto.trim()}>
                    <IconPlus className="size-4" /> Añadir
                  </Button>
                </form>
              ) : null}
            </TabsContent>

            <TabsContent value="comparacion" className="mt-3"><ComparacionPlan planId={planId} /></TabsContent>
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

      <MedicionesRevision consultaId={consultaId} planId={planId} planVisible={Boolean(plan.data)} />
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
              Se aprueba la versión {versionAprobacion} y se genera la nota FHIR sellada. La aprobación queda a tu nombre.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 space-y-1 overflow-auto rounded-lg border border-border p-3 text-sm" aria-label="Receta final">
            {farmacos.filter(l => l.estado !== "rechazada").map(l => <li key={l.id}>{[l.texto, l.dosis, l.frecuencia, l.duracion].filter(Boolean).join(" · ")}</li>)}
            <li className="text-xs text-muted-foreground">{pendientes.filter(l => l.estado !== "rechazada").length} pendiente(s) vigentes</li>
          </ul>
          {versionAprobacion !== plan.data?.plan.version && <p role="alert" className="text-sm text-destructive">El plan cambió. Cierra y revisa la nueva versión antes de aprobar.</p>}
          {plan.data?.conciliacion.some(m => m.estado === "sin_confirmar") && <p role="alert" className="text-sm text-destructive">Confirma la medicación histórica en la sección de conciliación antes de aprobar.</p>}
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
          {advertencias.length ? (
            <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-400">
                {advertencias.length} advertencia(s) que se exportan con el plan:
              </p>
              <ul className="list-disc pl-5 text-xs">
                {advertencias.map((a) => (
                  <li key={a.id}>{a.texto}: {a.motivoVerificacion}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={aprobar.isPending || versionAprobacion !== plan.data?.plan.version || plan.data?.conciliacion.some(m => m.estado === "sin_confirmar") || (bloqueos.length > 0 && !confirmaAlertas)}
              onClick={(e) => {
                e.preventDefault();
                if (planId) aprobar.mutate({ versionEsperada: versionAprobacion ?? undefined, planId, confirmaAlertas, origen: "medico", notas: "" });
              }}
            >
              {aprobar.isPending ? "Exportando…" : "Aprobar y exportar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
