/**
 * Punto único de entrada: la app importa `megi` de aquí y nunca sabe qué
 * implementación hay detrás. `MEGI_MODE=mock` (Frente A) o `http` (Frente B).
 *
 * El mock lo escribe el Frente A en `./megi-mock.ts` exportando
 * `crearMegiMock(): MegiAdapter`. Hasta que exista, `mock` lanza un error claro.
 */
import { fail } from "@agent-native/core/action";

import { MegiError, type MegiAdapter } from "./types.js";
import { crearMegiHttp } from "./megi-http.js";

export * from "./types.js";
export { aLogico, aReal, CODIGO_VERIFICADOR_INVALIDO } from "./megi-http.js";

/**
 * Traduce un fallo del adaptador al error que la mesa sabe explicar.
 *
 * Antes solo se mapeaba el 404: cualquier otro fallo de MEGI (backend caído,
 * 500, id rechazado por `idSeguro`) subía como excepción cruda y el framework
 * lo convertía en «Internal server error» con HTTP 500 y sin `errorCode`. El
 * médico no sabía qué pasaba y el agente no tenía código al que reaccionar,
 * aunque el contrato ya declaraba `megi_no_disponible`. Hallazgo de la fase 2
 * (bloques D y E).
 *
 * No toca los MegiError que ya traen código propio —`sin_rol_clinico`,
 * `credenciales_no_disponibles`, `verificador_invalido`—: esos los traduce
 * quien los entiende (`conectarMegi` y la propia acción), y envolverlos aquí
 * los degradaría a un 502 genérico.
 */
export function fallaDeMegi(e: unknown, que = "El recurso"): never {
  if (e instanceof MegiError && !(e.detalle as { codigo?: string } | undefined)?.codigo) {
    if (e.status === 404) {
      fail(`${que} no existe en MEGI.`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    if (e.status === 400) {
      // El 400 lo levanta `idSeguro` antes de salir a la red: no es MEGI quien
      // rechaza, somos nosotros, y el mensaje debe decirlo así.
      fail(`Identificador no válido: ${e.message}`, {
        errorCode: "invalid_input",
        statusCode: 400,
      });
    }
    if (e.status === 401 || e.status === 403) {
      fail(
        "MEGI rechazó las credenciales del adaptador. Revisa las credenciales de la conexión.",
        { errorCode: "megi_no_disponible", statusCode: 502 },
      );
    }
    fail(
      `No se pudo hablar con MEGI (${e.status ?? "sin respuesta"}). No se guardó ningún cambio; vuelve a intentarlo cuando esté disponible.`,
      { errorCode: "megi_no_disponible", statusCode: 502 },
    );
  }
  throw e;
}

let instancia: MegiAdapter | null = null;

const sesionesMock = new Map<string, MegiAdapter>();
/** Una conexión http por médico con credenciales propias; la huella detecta rotación. */
const sesionesHttp = new Map<string, { adapter: MegiAdapter; huella: string }>();
const MAX_SESIONES = 100;

export function modoMegi(): string { return ((globalThis as any).process?.env?.MEGI_MODE ?? "mock").toLowerCase(); }

/**
 * Lista de correos autorizados a usar la CUENTA DE SERVICIO compartida
 * (`MEGI_MEDICOS`, separados por comas). Es la mitigación de H2 para quien
 * todavía no tiene conexión propia; no sustituye la identidad individual.
 */
export function medicosAutorizados(): Set<string> | null {
  const raw = (globalThis as any).process?.env?.MEGI_MEDICOS;
  if (typeof raw !== "string") return null;
  return new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

/** Solo la lista: ¿puede este correo usar la cuenta de servicio compartida? */
export function rolClinico(email?: string | null): { ok: true } | { ok: false; motivo: string } {
  const lista = medicosAutorizados();
  const correo = email?.trim().toLowerCase() ?? "";
  if (lista) {
    return correo && lista.has(correo)
      ? { ok: true }
      : { ok: false, motivo: "Tu cuenta no figura entre los correos con rol clínico autorizados (MEGI_MEDICOS)." };
  }
  if (modoMegi() === "http") {
    return {
      ok: false,
      motivo:
        "Conecta tu propia cuenta de MEGI en Ajustes (MEGI_USUARIO y MEGI_CONTRASENA) o pide que tu correo figure en MEGI_MEDICOS para usar la cuenta de servicio.",
    };
  }
  return { ok: true };
}

// ------------------------------------------------- credenciales por médico
export type CredencialesMegi = { user: string; password: string };
export type ResolucionCredenciales =
  | { credenciales: CredencialesMegi }
  | { credenciales: null; fallo?: boolean };
type Resolver = (email: string) => Promise<ResolucionCredenciales>;

/**
 * Lee la conexión personal del médico desde la superficie de secretos del
 * framework (ámbito `user`, en el contexto de la petición). Solo cuenta una
 * credencial PROPIA del mismo correo: una clave de organización/espacio sería
 * de nuevo una cuenta compartida y se trata como la de servicio.
 */
async function resolverPorSecretos(email: string): Promise<ResolucionCredenciales> {
  const [{ CLAVE_USUARIO_MEGI, CLAVE_CONTRASENA_MEGI }, { resolveSecretDetailed }] = await Promise.all([
    import("./secretos.js"),
    import("@agent-native/core/server"),
  ]);
  const [u, c] = await Promise.all([resolveSecretDetailed(CLAVE_USUARIO_MEGI), resolveSecretDetailed(CLAVE_CONTRASENA_MEGI)]);
  if (u.lookupFailed || c.lookupFailed) return { credenciales: null, fallo: true };
  const propia = (d: typeof u) => d.value && d.source === "user" && (d.scopeId ?? "").toLowerCase() === email.toLowerCase();
  if (!propia(u) || !propia(c)) return { credenciales: null };
  return { credenciales: { user: u.value!, password: c.value! } };
}

let resolver: Resolver = resolverPorSecretos;

/** Pruebas: sustituye (o restaura con null) la lectura de credenciales; nunca en producción. */
export function configurarCredencialesMegi(fn: Resolver | null): void {
  resolver = fn ?? resolverPorSecretos;
  sesionesHttp.clear();
}

export type IdentidadClinica =
  | { ok: true; modo: "propia" | "compartida" | "mock"; credenciales?: CredencialesMegi }
  | { ok: false; motivo: string; codigo: "sin_rol_clinico" | "credenciales_no_disponibles" };

/**
 * Quién es clínicamente este correo para MEGI: conexión propia (identidad
 * individual, preferida), cuenta de servicio compartida (solo si MEGI_MEDICOS
 * lo autoriza) o sandbox mock. Sin correo no hay a quién atribuir nada.
 */
export async function identidadClinica(email?: string | null): Promise<IdentidadClinica> {
  const correo = email?.trim().toLowerCase() ?? "";
  const modo = modoMegi();
  if (modo !== "http") {
    const rol = rolClinico(correo);
    return rol.ok ? { ok: true, modo: "mock" } : { ok: false, motivo: rol.motivo, codigo: "sin_rol_clinico" };
  }
  if (!correo) return { ok: false, motivo: "No hay una sesión con correo a la que atribuir el acceso a MEGI.", codigo: "sin_rol_clinico" };
  const r = await resolver(correo);
  if (r.credenciales) return { ok: true, modo: "propia", credenciales: r.credenciales };
  if (r.fallo) return { ok: false, motivo: "No se pudo leer tu conexión con MEGI en este momento; vuelve a intentarlo.", codigo: "credenciales_no_disponibles" };
  sesionesHttp.delete(correo); // conexión retirada o nunca creada: la sesión propia no sobrevive
  const rol = rolClinico(correo);
  return rol.ok ? { ok: true, modo: "compartida" } : { ok: false, motivo: rol.motivo, codigo: "sin_rol_clinico" };
}

async function huellaDe(c: CredencialesMegi): Promise<string> {
  const bytes = new TextEncoder().encode(`${c.user}\u0000${c.password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function megi(email?: string): Promise<MegiAdapter> {
  const modo = modoMegi();
  if (modo === "http") {
    const correo = email?.trim().toLowerCase() ?? "";
    const id = await identidadClinica(correo);
    if (!id.ok) {
      throw new MegiError(`Acceso a MEGI denegado: ${id.motivo}`, id.codigo === "credenciales_no_disponibles" ? 503 : 403, { codigo: id.codigo });
    }
    if (id.modo === "propia" && id.credenciales) {
      const huella = await huellaDe(id.credenciales);
      const actual = sesionesHttp.get(correo);
      if (actual && actual.huella === huella) return actual.adapter;
      if (sesionesHttp.size >= MAX_SESIONES) sesionesHttp.delete(sesionesHttp.keys().next().value!);
      const adapter = crearMegiHttp({ user: id.credenciales.user, password: id.credenciales.password });
      sesionesHttp.set(correo, { adapter, huella });
      return adapter;
    }
    // Cuenta de servicio compartida (mitigación): instancia única autorizada por lista.
    if (!instancia) instancia = crearMegiHttp();
    return instancia;
  }
  if (email && modo === "mock") {
    if (!sesionesMock.has(email)) {
      const { crearMegiMock } = await import("./megi-mock.js");
      if (sesionesMock.size >= MAX_SESIONES) sesionesMock.delete(sesionesMock.keys().next().value!);
      sesionesMock.set(email, crearMegiMock());
    }
    return sesionesMock.get(email)!;
  }
  if (instancia) return instancia;
  if (modo === "mock") {
    const mod: any = await import("./megi-mock.js").catch(() => null);
    if (!mod?.crearMegiMock) {
      throw new Error("MEGI_MODE=mock pero falta lib/megi/megi-mock.ts (Frente A)");
    }
    instancia = mod.crearMegiMock();
  } else {
    throw new Error(`MEGI_MODE desconocido: ${modo} (usa mock | http)`);
  }
  return instancia!;
}

/** Pruebas: olvida la conexión http propia de un correo (revocación). */
export function olvidarSesionHttp(email: string): void { sesionesHttp.delete(email.trim().toLowerCase()); }

export function restaurarMock(email: string) { sesionesMock.delete(email); }
