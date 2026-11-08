/**
 * Pruebas de la guarda de la respuesta final.
 *
 * Los casos no son inventados: son las respuestas que dio un modelo real en
 * tres tandas de diez repeticiones, con sus llamadas de aquel turno. Las que
 * mintieron deben corregirse; las que dijeron la verdad, no.
 */
import { describe, expect, it } from "vitest";

import { afirmaUnCambio, huboEscritura, revisaRespuestaFinal } from "./guardia-respuesta.js";

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

  it("el mensaje de reserva no promete nada que no se pueda comprobar", () => {
    const r = revisaRespuestaFinal({ texto: "Plan guardado: 5 líneas.", resultados: soloLecturas })!;
    expect(r.fallbackMessage).not.toMatch(/\d+\s+(líneas|bloqueos|advertencias)/);
    expect(afirmaUnCambio(r.fallbackMessage)).toBe(false);
  });
});
