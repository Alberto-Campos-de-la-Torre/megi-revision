export type SnapshotLine = { id: string; texto: string; dosis: string; frecuencia: string; duracion: string; estado: string; verificacion: string; origen: string; justificacion: string | null };
export type Snapshot = { lineas: SnapshotLine[]; estado: string };
export function compararLineas(antes: SnapshotLine[], despues: SnapshotLine[]) {
  const previas = new Map(antes.map(l => [l.id, l]));
  const nuevas = new Map(despues.map(l => [l.id, l]));
  const campos = ["texto", "dosis", "frecuencia", "duracion", "estado", "verificacion"] as const;
  return [...despues, ...antes.filter(l => !nuevas.has(l.id))].map(actual => {
    const anterior = previas.get(actual.id);
    const cambios = anterior ? campos.filter(k => anterior[k] !== actual[k]).map(campo => ({ campo, antes: anterior[campo], despues: actual[campo] })) : [];
    const tipo = !nuevas.has(actual.id) || (actual.estado === "rechazada" && anterior?.estado !== "rechazada") ? "retirada" : !anterior ? "agregada" : cambios.some(c => c.campo !== "verificacion") ? "modificada" : "conservada";
    return { actual, anterior, cambios, tipo };
  });
}
