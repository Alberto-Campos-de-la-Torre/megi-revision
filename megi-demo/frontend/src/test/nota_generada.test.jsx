import { describe, it, expect } from "vitest";
import { notaGenerada } from "../components/live_soap";

// «La nota final no se generó (ready)»: el ASR devolvía el veredicto clínico
// como `status` y la pantalla solo aceptaba "done". Ahora el backend manda
// "done" y aquí, por si el backend fuera anterior, los veredictos también
// cuentan como nota generada.
describe("notaGenerada", () => {
  it("acepta done y los tres veredictos clínicos", () => {
    for (const status of ["done", "ready", "requires_review", "draft_only"]) {
      expect(notaGenerada({ status, soap: { S: "x" } })).toBe(true);
    }
  });
  it("rechaza error, not_configured, invalid_json y nada", () => {
    for (const status of ["error", "not_configured", "invalid_json", undefined]) {
      expect(notaGenerada({ status })).toBe(false);
    }
    expect(notaGenerada(null)).toBe(false);
  });
});
