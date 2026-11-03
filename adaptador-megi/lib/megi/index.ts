/**
 * Punto único de entrada: la app importa `megi` de aquí y nunca sabe qué
 * implementación hay detrás. `MEGI_MODE=mock` (Frente A) o `http` (Frente B).
 *
 * El mock lo escribe el Frente A en `./megi-mock.ts` exportando
 * `crearMegiMock(): MegiAdapter`. Hasta que exista, `mock` lanza un error claro.
 */
import type { MegiAdapter } from "./types.ts";
import { crearMegiHttp } from "./megi-http.ts";

export * from "./types.ts";
export { aLogico, aReal } from "./megi-http.ts";

let instancia: MegiAdapter | null = null;

export async function megi(): Promise<MegiAdapter> {
  if (instancia) return instancia;
  const modo = ((globalThis as any).process?.env?.MEGI_MODE ?? "mock").toLowerCase();
  if (modo === "http") {
    instancia = crearMegiHttp();
  } else if (modo === "mock") {
    const mod: any = await import("./megi-mock.ts").catch(() => null);
    if (!mod?.crearMegiMock) {
      throw new Error("MEGI_MODE=mock pero falta lib/megi/megi-mock.ts (Frente A)");
    }
    instancia = mod.crearMegiMock();
  } else {
    throw new Error(`MEGI_MODE desconocido: ${modo} (usa mock | http)`);
  }
  return instancia!;
}
