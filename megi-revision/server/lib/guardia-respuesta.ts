/**
 * Lo último que ve el médico no puede contradecir lo que hay en el tablero.
 *
 * Medido con un modelo real (Grok, diez repeticiones, tres tandas): en 8 de 10
 * turnos el agente respondía «Plan guardado: 5 líneas, 0 bloqueos y 0
 * advertencias» sin haber guardado nada —en cuatro de ellos sin ni una
 * escritura—, inventando el recuento y el resumen de verificación de una receta
 * que no había cambiado. Dos vueltas de prompt lo bajaron a 5 de 10; el prompt
 * solo no basta, porque es una petición y no una garantía.
 *
 * Esto sí lo es: el framework entrega el borrador de la respuesta al
 * `finalResponseGuard` junto con los resultados de las herramientas del turno y
 * sus recibos de escritura. Si el borrador afirma un cambio que no ocurrió, se
 * devuelve para que lo corrija; si insiste, el framework entrega el
 * `fallbackMessage`, que es cierto por construcción. La decisión no mira lo que
 * el modelo dice que hizo, sino los recibos.
 */

/** Acciones que escriben en el plan y por tanto dejan recibo. */
export const ESCRITURAS_DEL_PLAN = new Set([
  "proponer-plan",
  "reajustar-plan",
  "actualizar-linea",
  "agregar-linea",
  "aprobar-plan",
  "conciliar-medicacion",
  "definir-alcance",
  "resolver-sugerencia",
  "sugerir-reemplazo",
]);

/** Dice que algo quedó hecho, o da un recuento del plan. */
// `\b` de JavaScript no sirve aquí: se apoya en [A-Za-z0-9_], así que «Añadí»
// no tiene frontera tras la «í» y el patrón no casaba. Se usan límites
// conscientes de Unicode (`\p{L}`), que es lo que hace falta en español.
const LIM_I = "(?<![\\p{L}])";
const LIM_F = "(?![\\p{L}])";
const AFIRMA = new RegExp(
  [
    // Formas que dan el cambio por hecho. Enumeradas y no por raíz: «voy a
    // añadir» es una intención, no una afirmación, y no debe marcarse.
    `${LIM_I}(a[ñn]adid[oa]s?|a[ñn]ad[íi]|a[ñn]adi[óo]|a[ñn]adieron)${LIM_F}`,
    `${LIM_I}(agregad[oa]s?|agregu[ée]|agreg[óo]|agregaron)${LIM_F}`,
    `${LIM_I}(guardad[oa]s?|guard[ée]|guard[óo]|guardaron)${LIM_F}`,
    `${LIM_I}(actualizad[oa]s?|actualic[ée]|actualiz[óo]|actualizaron)${LIM_F}`,
    `${LIM_I}(aplicad[oa]s?|apliqu[ée]|aplic[óo]|aplicaron)${LIM_F}`,
    `${LIM_I}plan (guardado|actualizado|creado)${LIM_F}`,
    // Un recuento del plan ya es una afirmación sobre su estado.
    "\\d+\\s+(l[íi]neas?|bloqueos?|advertencias?)",
  ].join("|"),
  "iu",
);

/** Niega el cambio: eso es justo la conducta que se quiere, no una infracción. */
const NIEGA = new RegExp(
  [
    "no se (guard|a[ñn]ad|agreg|aplic|cre)",
    "no (qued[óo]|pude|he podido|llegu[ée] a)",
    "fall[óo]",
    "sin guardar",
    "nada guardado",
    "rechaz",
  ].join("|"),
  "iu",
);

export function afirmaUnCambio(texto: string): boolean {
  return AFIRMA.test(texto) && !NIEGA.test(texto);
}

export type ResultadoDeHerramienta = { name: string; isError?: boolean };

/** ¿Hubo alguna escritura del plan que de verdad entrara en este turno? */
export function huboEscritura(
  resultados: readonly ResultadoDeHerramienta[] = [],
  recibos: readonly { tool?: string }[] = [],
): boolean {
  if (recibos.length > 0) return true;
  return resultados.some((r) => ESCRITURAS_DEL_PLAN.has(r.name) && r.isError !== true);
}

export type Correccion = {
  retryMessage: string;
  fallbackMessage: string;
  maxRetries: number;
};

/**
 * Devuelve `null` si la respuesta es admisible, o la corrección que hay que
 * pedir. No conoce el framework: recibe texto y resultados, para poder probarse.
 */
export function revisaRespuestaFinal(ctx: {
  texto: string;
  resultados?: readonly ResultadoDeHerramienta[];
  recibos?: readonly { tool?: string }[];
}): Correccion | null {
  const texto = (ctx.texto ?? "").trim();
  if (!texto) return null; // sin texto no hay nada que corregir
  if (huboEscritura(ctx.resultados, ctx.recibos)) return null;
  if (!afirmaUnCambio(texto)) return null;
  const rechazos = (ctx.resultados ?? [])
    .filter((r) => ESCRITURAS_DEL_PLAN.has(r.name) && r.isError === true)
    .map((r) => r.name);
  return {
    retryMessage:
      "En este turno NO entró ninguna escritura en el plan: no hay recibo de " +
      (rechazos.length
        ? `ninguna acción (${[...new Set(rechazos)].join(", ")} fue rechazada). `
        : "ninguna acción de escritura. ") +
      "Tu borrador dice que el cambio quedó hecho, o da un recuento de líneas, bloqueos o advertencias. " +
      "Reescríbelo sin afirmar nada de eso y sin cifras del plan: di que no se guardó nada, qué lo impidió " +
      "—con el código que devolvió la herramienta, copiado literal— y qué harás a continuación. " +
      "El médico comprueba el tablero, y el tablero no cambió.",
    fallbackMessage:
      "No se guardó nada en el plan en este turno. Lo que yo haya escrito antes no está en el tablero: " +
      "revisa el plan y vuelve a pedirme el cambio.",
    maxRetries: 1,
  };
}
