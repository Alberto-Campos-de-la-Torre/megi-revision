/**
 * Pruebas de la guarda de la respuesta final.
 *
 * Los casos no son inventados: son las respuestas que dio un modelo real en
 * tres tandas de diez repeticiones, con sus llamadas de aquel turno. Las que
 * mintieron deben corregirse; las que dijeron la verdad, no.
 */
import { describe, expect, it } from "vitest";

import {
  afirmaUnCambio,
  huboEscritura,
  pidioUnCambio,
  anunciaUnCambio,
  prometeUnCambio,
  revisaRespuestaFinal,
} from "./guardia-respuesta.js";

const escrituraBuena = [{ name: "agregar-linea", isError: false }];
const escrituraRechazada = [{ name: "agregar-linea", isError: true }];
const soloLecturas = [{ name: "obtener-plan", isError: false }, { name: "ver-contexto-consulta", isError: false }];

describe("huboEscritura", () => {
  it("un recibo basta", () => {
    expect(huboEscritura([], [{ tool: "agregar-linea" }])).toBe(true);
  });
  it("una escritura que entró, también", () => {
    expect(huboEscritura(escrituraBuena)).toBe(true);
  });
  it("una escritura rechazada no cuenta", () => {
    expect(huboEscritura(escrituraRechazada)).toBe(false);
  });
  it("las lecturas no cuentan", () => {
    expect(huboEscritura(soloLecturas)).toBe(false);
  });
});

describe("afirmaUnCambio", () => {
  it("reconoce las frases que dio el modelo", () => {
    for (const dijo of [
      "Plan guardado: 5 líneas, 0 bloqueos y 0 advertencias. Revisa y aprueba.",
      "Agregados 2 pendientes; plan con 5 líneas, 0 bloqueos ni advertencias.",
      "Se añadieron los dos pendientes sin tocar líneas existentes.",
      "Plan actualizado con 2 pendientes añadidos.",
      "Añadí dos pendientes nuevos sin tocar líneas existentes.",
    ]) {
      expect(afirmaUnCambio(dijo), dijo).toBe(true);
    }
  });

  it("y no castiga a quien dice la verdad", () => {
    for (const dijo of [
      "No se guardó nada: agregar-linea devolvió version_desactualizada. Releo el plan y reintento.",
      "No pude añadir los pendientes: la línea está bloqueada por el médico.",
      "La llamada falló; no hay nada guardado en el tablero.",
    ]) {
      expect(afirmaUnCambio(dijo), dijo).toBe(false);
    }
  });

  it("un recuento del plan ya es una afirmación, aunque no diga «guardado»", () => {
    expect(afirmaUnCambio("El plan tiene 5 líneas y 0 bloqueos.")).toBe(true);
  });
});

describe("revisaRespuestaFinal", () => {
  it("deja pasar la respuesta de un turno que sí escribió", () => {
    expect(revisaRespuestaFinal({
      texto: "Plan guardado: 5 líneas, 0 bloqueos y 0 advertencias.",
      resultados: escrituraBuena,
    })).toBeNull();
  });

  it("corrige la que afirma sin haber escrito nada", () => {
    const r = revisaRespuestaFinal({
      texto: "Plan guardado: 5 líneas, 0 bloqueos y 0 advertencias. Revisa y aprueba.",
      resultados: soloLecturas,
    });
    expect(r).not.toBeNull();
    expect(r!.retryMessage).toMatch(/NO entró ninguna escritura/);
    expect(r!.fallbackMessage).toMatch(/No se guardó nada/);
    expect(r!.maxRetries).toBe(1);
  });

  it("y nombra la acción rechazada, para que la corrección diga la causa", () => {
    const r = revisaRespuestaFinal({
      texto: "Agregados 2 pendientes; plan con 5 líneas.",
      resultados: [...soloLecturas, ...escrituraRechazada],
    });
    expect(r!.retryMessage).toContain("agregar-linea");
  });

  it("no toca la que ya dice la verdad", () => {
    expect(revisaRespuestaFinal({
      texto: "No se guardó nada: agregar-linea devolvió version_desactualizada.",
      resultados: escrituraRechazada,
    })).toBeNull();
  });

  it("ni un turno sin texto", () => {
    expect(revisaRespuestaFinal({ texto: "   ", resultados: soloLecturas })).toBeNull();
  });

  it("pide sustituir la respuesta, no añadir la corrección detrás", () => {
    // Medido: el modelo corrigió añadiendo, y el médico leía primero la frase
    // falsa: «Plan guardado: 5 líneas… No se guardó nada: …».
    const r = revisaRespuestaFinal({ texto: "Plan guardado: 5 líneas.", resultados: soloLecturas })!;
    expect(r.retryMessage).toMatch(/SUSTITUYE tu respuesta entera/);
  });

  it("el mensaje de reserva no promete nada que no se pueda comprobar", () => {
    const r = revisaRespuestaFinal({ texto: "Plan guardado: 5 líneas.", resultados: soloLecturas })!;
    expect(r.fallbackMessage).not.toMatch(/\d+\s+(líneas|bloqueos|advertencias)/);
    expect(afirmaUnCambio(r.fallbackMessage)).toBe(false);
  });
});

/**
 * El turno que acaba sin hacer el trabajo (propuesta 6).
 *
 * No miente sobre el pasado —la primera regla no lo ve—, pero el médico pidió
 * algo, le dijeron que sí y el tablero está igual. Las frases son las que dio un
 * modelo real.
 */
describe("prometeUnCambio", () => {
  it("reconoce la promesa en futuro y en perífrasis", () => {
    for (const t of [
      "Voy a añadir el control de tensión arterial en 7 días.",
      "Procedo a actualizar la línea de paracetamol.",
      "Añadiré el pendiente de radiografía.",
      "Lo hago ahora y te confirmo.",
      "Enseguida lo preparo.",
    ]) expect(prometeUnCambio(t)).toBe(true);
  });
  it("no confunde el pasado con la promesa", () => {
    expect(prometeUnCambio("Añadido el control de tensión arterial.")).toBe(false);
  });
  it("una promesa que ya avisa del fallo no es una promesa incumplida", () => {
    expect(prometeUnCambio("Voy a intentarlo otra vez: falló con version_desactualizada.")).toBe(false);
  });
});

describe("anunciaUnCambio", () => {
  it("reconoce el presente con valor de futuro", () => {
    for (const x of [
      "Llamo a agregar-linea dos veces con versionEsperada=4.",
      "Lo añado y te confirmo.",
      "Voy a reajustar el plan.",
    ]) expect(anunciaUnCambio(x), x).toBe(true);
  });
  it("no toma por anuncio el trabajo ya hecho", () => {
    expect(anunciaUnCambio("Plan guardado: 5 líneas, 0 bloqueos y 0 advertencias.")).toBe(false);
  });
  it("ve el anuncio aunque venga envuelto en una negación", () => {
    const x = "No se guardó nada. Llamo a agregar-linea ahora.";
    expect(prometeUnCambio(x)).toBe(false);
    expect(anunciaUnCambio(x)).toBe(true);
  });
});

describe("pidioUnCambio", () => {
  it("reconoce la petición de cambio del médico", () => {
    for (const t of [
      "Añade un control de tensión arterial en 7 días.",
      "Quita el naproxeno.",
      "Prepara la receta y los pendientes de la consulta demo-c2.",
      "Necesito que ajustes la dosis.",
      "Ponle paracetamol cada 8 horas.",
    ]) expect(pidioUnCambio(t)).toBe(true);
  });
  it("una pregunta clínica no es una petición de cambio", () => {
    for (const t of [
      "¿Qué alergias tiene este paciente?",
      "¿Por qué propusiste el ibuprofeno?",
      "Resúmeme la nota de la consulta.",
      undefined,
    ]) expect(pidioUnCambio(t)).toBe(false);
  });
});

describe("revisaRespuestaFinal · el trabajo sin hacer", () => {
  const peticion = "Añade un control de tensión arterial en 7 días.";

  it("devuelve el turno cuando promete el cambio y no lo hace", () => {
    const c = revisaRespuestaFinal({
      texto: "Voy a añadir el control de tensión arterial en 7 días.",
      peticion,
      resultados: soloLecturas,
    });
    expect(c?.retryMessage).toMatch(/Hazlo AHORA/);
    expect(c?.fallbackMessage).toMatch(/No he hecho el cambio/);
  });

  it("y también cuando ni lo intenta ni dice nada", () => {
    const c = revisaRespuestaFinal({ texto: "De acuerdo, entendido.", peticion, resultados: [] });
    expect(c).not.toBeNull();
  });

  it("tras un rechazo, el mensaje enseña el remedio en vez de repetir", () => {
    const c = revisaRespuestaFinal({
      texto: "Voy a intentarlo de nuevo.",
      peticion,
      resultados: [{ name: "agregar-linea", isError: true }],
    });
    expect(c?.retryMessage).toMatch(/relee el plan con obtener-plan/);
  });

  it("devuelve el turno cuando niega Y promete sin haber intentado nada", () => {
    // El caso que la excepción por negación dejaba pasar: medido con Grok, tres
    // pasadas de diez acabaron así, con el plan intacto.
    const c = revisaRespuestaFinal({
      texto: "No se guardó nada: obtener-plan devolvió éxito pero no añadí pendientes. Llamo a agregar-linea ahora.",
      peticion,
      resultados: soloLecturas,
    });
    expect(c?.retryMessage).toMatch(/No has llamado a ninguna escritura/);
  });

  it("devuelve el turno cuando se excusa sin haber intentado nada", () => {
    const c = revisaRespuestaFinal({
      texto: "No se guardó nada: no añado nada sin versionEsperada.",
      peticion,
      resultados: soloLecturas,
    });
    expect(c).not.toBeNull();
  });

  it("calla si el agente le preguntó algo al médico", () => {
    // Esperar respuesta es lo correcto; insistir aquí sería empujar al agente a
    // escribir sin la respuesta que acaba de pedir.
    expect(
      revisaRespuestaFinal({
        texto: "¿Confirmas que no es alérgica a penicilina antes de añadirlo?",
        peticion,
        resultados: [{ name: "ask-question" }],
      }),
    ).toBeNull();
  });

  it("calla si la respuesta ya dice qué falló", () => {
    expect(
      revisaRespuestaFinal({
        texto: "No se guardó nada: agregar-linea devolvió version_desactualizada. Releo el plan.",
        peticion,
        resultados: [{ name: "agregar-linea", isError: true }],
      }),
    ).toBeNull();
  });

  it("calla si el médico solo preguntó", () => {
    expect(
      revisaRespuestaFinal({
        texto: "Tiene hipertensión arterial y toma losartán 50 mg.",
        peticion: "¿Qué toma este paciente?",
        resultados: soloLecturas,
      }),
    ).toBeNull();
  });

  it("calla si la escritura sí entró", () => {
    expect(
      revisaRespuestaFinal({
        texto: "Voy a dejarlo así salvo que me digas otra cosa.",
        peticion,
        resultados: escrituraBuena,
      }),
    ).toBeNull();
  });

  it("la mentira sobre el pasado sigue teniendo prioridad", () => {
    // Afirma y promete a la vez: lo grave es lo que el médico puede comprobar
    // en el tablero, así que gana la primera regla.
    const c = revisaRespuestaFinal({
      texto: "Plan guardado: 5 líneas. Voy a añadir el control después.",
      peticion,
      resultados: soloLecturas,
    });
    expect(c?.retryMessage).toMatch(/SUSTITUYE tu respuesta entera/);
  });
});
