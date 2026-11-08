import { AsyncLocalStorage } from "node:async_hooks";
const peticion = new AsyncLocalStorage<Map<string, unknown>>();
/** Se comparte solo dentro de una acción; nunca reutiliza un expediente entre peticiones. */
export function enPeticionMegi<T>(run: () => Promise<T>): Promise<T> {
  return peticion.getStore() ? run() : peticion.run(new Map(), run);
}
export function enCacheDePeticion<T>(key: string, run: () => Promise<T>): Promise<T> {
  const cache = peticion.getStore();
  if (!cache) return run();
  const cacheKey = `async:${key}`;
  if (!cache.has(cacheKey)) cache.set(cacheKey, run());
  return cache.get(cacheKey) as Promise<T>;
}
/** Lecturas puras reutilizadas por los helpers de una misma acción. */
export function enCacheSincronaDePeticion<T>(key: string, run: () => T): T {
  const cache = peticion.getStore();
  if (!cache) return run();
  const cacheKey = `sync:${key}`;
  if (!cache.has(cacheKey)) cache.set(cacheKey, run());
  return cache.get(cacheKey) as T;
}
