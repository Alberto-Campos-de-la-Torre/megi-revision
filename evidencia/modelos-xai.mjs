// Read only /models from the same deployment-configured xAI endpoint used by
// the app. Never print, persist or accept a credential on the command line.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { resultado } from "./comun.mjs";
const env = parseEnv(readFileSync(new URL("../megi-revision/.env", import.meta.url), "utf8"));
const endpoint = new URL(env.OPENAI_BASE_URL);
if (endpoint.protocol !== "https:" || endpoint.hostname !== "api.x.ai") throw new Error("El endpoint configurado no es el xAI esperado; no se envía la clave");
if (!env.OPENAI_API_KEY) throw new Error("No hay clave de despliegue para este endpoint");
const response = await fetch(`${endpoint.href.replace(/\/$/, "")}/models`, {
  headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw new Error(`Catálogo xAI no disponible: ${response.status}`);
const body = await response.json();
if (!Array.isArray(body.data)) throw new Error("Formato del catálogo xAI inesperado");
const modelos = body.data.map(x => x.id).filter(x => typeof x === "string");
resultado("modelos-xai", [{ prueba: "catálogo del endpoint xAI configurado consultado sin exponer credenciales", pasa: true }], { modelos });
console.log(JSON.stringify({ modelos }, null, 2));
