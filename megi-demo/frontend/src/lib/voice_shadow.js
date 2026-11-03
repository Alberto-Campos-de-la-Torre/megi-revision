// ============ MEGI VOZ — SHADOW MODE DEL PARSER LLM (Fase 9B) ============
// Cuando el clasificador de reglas NO entiende un comando (con wake word o
// dictado), el texto se manda al parser LLM SOLO para registrar qué habría
// propuesto. NO ejecuta nada ni cambia la UX: es evidencia para decidir cuándo
// (y en qué dominios) darle autoridad real al parser.
import { api } from "../api/client";

export function shadowParse(text, result, source) {
  try {
    api.parseCommandShadow({
      text,
      regex_intent: (result && result.intent) || "unknown",
      source,
    })
      .then((r) => {
        if (r && r.parse) console.debug(`[MEGI voz · shadow · ${source}]`, text, "→", r.parse);
      })
      .catch(() => { /* shadow jamás molesta al usuario */ });
  } catch (e) { /* noop */ }
}
