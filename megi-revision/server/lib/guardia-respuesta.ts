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
 *
 * Y la cara complementaria del mismo problema: un turno que acaba PROMETIENDO
 * el cambio —«voy a añadir el control de tensión»— sin haberlo hecho. No miente
 * sobre el pasado, así que la primera regla no lo ve, pero para el médico el
 * efecto es el mismo: pidió algo, le contestaron que sí, y el tablero está
 * igual. Medido con un modelo real: pasaba en 1 de cada 10 turnos. Cuando el
 * médico pidió un cambio y el turno termina sin ninguna escritura, sin haberle
 * preguntado nada y sin decir qué falló, la guarda devuelve el turno con una
 * instrucción: hazlo ahora. El framework vuelve al bucle con las herramientas
 * puestas, así que la continuación es real y no una petición más de prompt.
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

export type ResultadoDeHerramienta = { name: string; isError?: boolean };

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

/**
 * Anuncia el cambio como algo pendiente de hacer. Enumeradas, no por raíz:
 * «añadido» es pasado y lo ve `AFIRMA`; «añadiré» es una promesa.
 */
const PROMETE = new RegExp(
  [
    `${LIM_I}(voy|vamos) a${LIM_F}`,
    `${LIM_I}(proced[oe]|proceder[ée]|proceder[ée]mos)${LIM_F}`,
    `${LIM_I}(a[ñn]adir[ée]|agregar[ée]|actualizar[ée]|guardar[ée]|preparar[ée]|propondr[ée]|reajustar[ée]|har[ée])${LIM_F}`,
    `${LIM_I}lo (a[ñn]ado|agrego|hago|actualizo|preparo|guardo)${LIM_F}`,
    // El presente con valor de futuro, que es como lo escribió el modelo de
    // verdad: «Llamo a agregar-linea dos veces con versionEsperada=4» era el
    // final de tres turnos de diez, y el plan se quedaba igual.
    `${LIM_I}(llamo|llamar[ée]|invoco|invocar[ée]) a${LIM_F}`,
    `${LIM_I}(en seguida|enseguida|ahora mismo|a continuaci[óo]n)${LIM_F}`,
    `${LIM_I}(d[ée]jame|dame un momento|permíteme)${LIM_F}`,
  ].join("|"),
  "iu",
);
export const prometeUnCambio = (texto: string) => PROMETE.test(texto) && !NIEGA.test(texto);
/**
 * El anuncio a secas, aunque venga envuelto en una negación.
 *
 * «No se guardó nada: … Llamo a agregar-linea ahora» niega Y promete, y la
 * negación le daba el indulto: medido con Grok, tres pasadas de diez acabaron
 * así, sin haber intentado ni una escritura, y la guarda se callaba. Negar es
 * la conducta correcta cuando hay un fallo real que contar; anunciar lo que no
 * se hizo, no.
 */
export const anunciaUnCambio = (texto: string) => PROMETE.test(texto);

/** ¿Se intentó siquiera una escritura del plan, aunque saliera rechazada? */
export const intentoDeEscritura = (resultados: readonly ResultadoDeHerramienta[] = []) =>
  resultados.some((r) => ESCRITURAS_DEL_PLAN.has(r.name));

/**
 * ¿Lo que pidió el médico era un cambio en el plan?
 *
 * Sin esto la regla se dispararía con una pregunta clínica —«¿qué tiene este
 * paciente?»—, donde terminar sin escribir es exactamente lo correcto. Se mira
 * la petición del médico, no la respuesta del modelo.
 */
const PIDE_CAMBIO = new RegExp(
  [
    `${LIM_I}(a[ñn]ade|a[ñn]adir|a[ñn][áa]dele|agrega|agregar|ag[ré]galo)${LIM_F}`,
    `${LIM_I}(quita|quitar|elimina|eliminar|borra|borrar)${LIM_F}`,
    `${LIM_I}(cambia|cambiar|ajusta|ajustar|actualiza|actualizar|corrige|corregir)${LIM_F}`,
    `${LIM_I}(sustituye|sustituir|reemplaza|reemplazar|cambi[áa]selo)${LIM_F}`,
    `${LIM_I}(pon|poner|p[óo]nle|sube|subir|baja|bajar)${LIM_F}`,
    `${LIM_I}(prepara|preparar|propon|prop[óo]n|proponer|crea|crear|reajusta|reajustar|guarda|guardar|aplica|aplicar|apl[íi]calo|h[áa]zlo)${LIM_F}`,
    `${LIM_I}necesito que${LIM_F}`,
  ].join("|"),
  "iu",
);
export const pidioUnCambio = (peticion: string | undefined) => PIDE_CAMBIO.test(peticion ?? "");

/** Si el agente le preguntó algo al médico, acabar sin escribir es correcto. */
const PREGUNTAS = new Set(["ask-question"]);
export const huboPregunta = (resultados: readonly ResultadoDeHerramienta[] = []) =>
  resultados.some((r) => PREGUNTAS.has(r.name) && r.isError !== true);

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
  /** Lo que pidió el médico en este turno; decide si faltaba un cambio. */
  peticion?: string | undefined;
  resultados?: readonly ResultadoDeHerramienta[];
  recibos?: readonly { tool?: string }[];
}): Correccion | null {
  const texto = (ctx.texto ?? "").trim();
  if (!texto) return null; // sin texto no hay nada que corregir
  if (huboEscritura(ctx.resultados, ctx.recibos)) return null;
  if (!afirmaUnCambio(texto)) return trabajoSinHacer(ctx, texto);
  const rechazos = (ctx.resultados ?? [])
    .filter((r) => ESCRITURAS_DEL_PLAN.has(r.name) && r.isError === true)
    .map((r) => r.name);
  return {
    retryMessage:
      "SUSTITUYE tu respuesta entera; no la continúes ni conserves ninguna frase anterior. " +
      "Medido con un modelo real: una respuesta corregida que se añadía detrás dejaba al médico " +
      "leyendo primero la frase falsa. " +
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

/**
 * Segunda regla: el turno acaba sin el cambio que el médico pidió.
 *
 * Calla cuando callar es lo correcto: si el agente le preguntó algo al médico
 * —esperar la respuesta es lo que toca—, si el médico no pidió ningún cambio, o
 * si hubo una escritura rechazada y el borrador cuenta ese fallo sin prometer
 * nada: ahí el agente está informando, no escurriéndose.
 *
 * Y se dispara en el caso que esa última excepción dejaba pasar: **negar sin
 * haber intentado nada**. Medido con Grok, tres pasadas de diez leyeron el plan,
 * no llamaron a ninguna escritura y cerraron con «No se guardó nada… Llamo a
 * agregar-linea ahora». Decir «no se guardó» es verdad, pero no es un informe
 * de nada: no hubo fallo que contar, hubo un turno sin hacer el trabajo.
 */
function trabajoSinHacer(
  ctx: { peticion?: string | undefined; resultados?: readonly ResultadoDeHerramienta[] },
  texto: string,
): Correccion | null {
  if (huboPregunta(ctx.resultados)) return null;
  const promete = anunciaUnCambio(texto);
  const seIntento = intentoDeEscritura(ctx.resultados);
  // Contar un fallo real es la conducta que se quiere. Pero solo es un informe
  // si de verdad se intentó algo: negar sin intentar nada es el turno sin hacer.
  if (NIEGA.test(texto) && !promete && seIntento) return null;
  if (!promete && !pidioUnCambio(ctx.peticion)) return null;
  const rechazadas = [
    ...new Set(
      (ctx.resultados ?? [])
        .filter((r) => ESCRITURAS_DEL_PLAN.has(r.name) && r.isError === true)
        .map((r) => r.name),
    ),
  ];
  return {
    retryMessage:
      "En este turno NO entró ninguna escritura en el plan y el médico pedía un cambio. " +
      (promete
        ? "Tu borrador anuncia que lo vas a hacer; para el médico eso es un sí, y el tablero está igual. "
        : "Tu borrador no lo hace ni dice qué lo impidió. ") +
      (rechazadas.length
        ? `Ya lo intentaste y ${rechazadas.join(", ")} fue rechazada: relee el plan con obtener-plan, toma \`plan.version\` y vuelve a llamar con esa versionEsperada. `
        : seIntento
          ? "Hazlo AHORA, en este mismo turno, con el planId y la versionEsperada vigente. "
          : "No has llamado a ninguna escritura en este turno: ya leíste el plan, así que tienes el planId y la versión. Hazlo AHORA con esa versionEsperada, llamando a la acción que corresponda. Si hay varias líneas, mándalas juntas en UNA llamada. ") +
      "No describas lo que vas a hacer: hazlo y responde con las cifras del recibo. " +
      "Si de verdad no puedes, di exactamente qué lo impide, con el código que devolvió la herramienta copiado literal.",
    fallbackMessage:
      "No he hecho el cambio que me pediste: este turno terminó sin ninguna escritura en el plan, " +
      "así que el tablero sigue como estaba. Vuelve a pedírmelo y lo aplico.",
    maxRetries: 1,
  };
}
