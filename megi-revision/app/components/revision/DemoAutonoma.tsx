import { useActionMutation } from "@agent-native/core/client/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
export function DemoAutonoma() {
  const [abierto, setAbierto] = useState(false);
  const restaurar = useActionMutation("restaurar-demo", { onSuccess: () => { setAbierto(false); toast.success("Tus cuatro casos de demo están listos"); }, onError: e => toast.error(e.message) });
  return <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
    <div className="text-sm"><p className="font-medium">Prueba con cuatro pacientes sintéticos</p><p className="mt-1 text-xs text-muted-foreground">Alba: alergia · Mateo: interacción y alergias sin registro · Rosa: anticoagulación · Luis: flujo sin alertas. El backend es simulado; las propuestas las genera el agente configurado.</p></div>
    <Button size="sm" variant="outline" onClick={() => setAbierto(true)}>Restaurar mis casos</Button>
    <AlertDialog open={abierto} onOpenChange={setAbierto}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Restaurar tus casos sintéticos</AlertDialogTitle><AlertDialogDescription>Se eliminan tus planes, versiones y exportaciones de estos cuatro casos de demo. Las mediciones se conservan para comparar intentos. No afecta a otros usuarios ni al backend MEGI.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Conservar</AlertDialogCancel><AlertDialogAction disabled={restaurar.isPending} onClick={e => { e.preventDefault(); restaurar.mutate({ confirmar: true }); }}>{restaurar.isPending ? "Restaurando…" : "Restaurar casos"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
