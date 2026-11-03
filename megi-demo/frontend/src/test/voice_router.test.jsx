import { describe, it, expect, vi } from "vitest";
import { classifyCommand } from "../lib/voice_mock";
import { routeCommand, resolvePatients } from "../lib/voice_router";

const PATIENTS = [
  { id: "p1", name: "Jorge Delgado", age: 54, reason: "control HTA" },
  { id: "p2", name: "Jorge Delgadillo", age: 40, reason: "dolor lumbar" },
  { id: "p3", name: "María Hernández", age: 33, reason: "cefalea" },
];

const mkActions = () => ({
  setView: vi.fn(),
  openExpediente: vi.fn(),
  startConsulta: vi.fn(),
  goBack: vi.fn(),
  hasActiveConsult: vi.fn(() => false),
  goRevision: vi.fn(),
});

const route = (text, actions, patients = PATIENTS) =>
  routeCommand(classifyCommand(text, {}), { actions, patients });

describe("voice_router (Fase 2 — ejecución real de baja sensibilidad)", () => {
  it("navega a una sección real", () => {
    const a = mkActions();
    const r = route("MEGI, ir a pacientes", a);
    expect(r.status).toBe("executed");
    expect(a.setView).toHaveBeenCalledWith("pacientes");
  });

  it("rechaza comandos sin la palabra MEGI (no ejecuta nada)", () => {
    const a = mkActions();
    const r = route("ir a pacientes", a);
    expect(r.status).toBe("rejected");
    expect(a.setView).not.toHaveBeenCalled();
  });

  it("abre el expediente de un paciente único por nombre", () => {
    const a = mkActions();
    const r = route("MEGI, abrir paciente María", a);
    expect(r.status).toBe("executed");
    expect(a.openExpediente).toHaveBeenCalledWith(PATIENTS[2]);
  });

  it("iniciar consulta de X arranca la consulta (no abre expediente)", () => {
    const a = mkActions();
    const r = route("MEGI, iniciar consulta de María", a);
    expect(r.status).toBe("executed");
    expect(a.startConsulta).toHaveBeenCalledWith(PATIENTS[2]);
    expect(a.openExpediente).not.toHaveBeenCalled();
  });

  it("acepta artículo y cola de intención: 'abre el paciente X para iniciar consulta'", () => {
    const a = mkActions();
    const r = route("MEGI, abre el paciente María Hernández para iniciar consulta", a);
    expect(r.status).toBe("executed");
    expect(a.startConsulta).toHaveBeenCalledWith(PATIENTS[2]);   // detecta que quiere consulta
    expect(a.openExpediente).not.toHaveBeenCalled();
  });

  it("'abre el paciente X' (sin mención de consulta) abre expediente", () => {
    const a = mkActions();
    const r = route("MEGI, abre el paciente María Hernández", a);
    expect(r.status).toBe("executed");
    expect(a.openExpediente).toHaveBeenCalledWith(PATIENTS[2]);
    expect(a.startConsulta).not.toHaveBeenCalled();
  });

  it("pide desambiguación cuando hay varios que coinciden (con pickAction)", () => {
    const a = mkActions();
    const r = route("MEGI, abrir paciente Jorge", a);
    expect(r.status).toBe("ambiguous");
    expect(r.candidates).toHaveLength(2);
    expect(r.pickAction).toBe("openExpediente");
    expect(a.openExpediente).not.toHaveBeenCalled();
  });

  it("informa cuando el paciente no existe", () => {
    const a = mkActions();
    const r = route("MEGI, abrir paciente Pedro Páramo", a);
    expect(r.status).toBe("not_found");
    expect(a.openExpediente).not.toHaveBeenCalled();
  });

  it("NO ejecuta acciones sensibles; devuelve propuesta", () => {
    const a = mkActions();
    const r = route("MEGI, cambiar diagnóstico principal a I10", a);
    expect(r.status).toBe("needs_confirmation");
    expect(r.proposal.proposed_value).toMatch(/I10/);
    expect(a.setView).not.toHaveBeenCalled();
  });

  it("revisión requiere consulta activa", () => {
    const a = mkActions();
    const r = route("MEGI, ir a revisión", a);
    expect(r.status).toBe("info");
    expect(a.goRevision).not.toHaveBeenCalled();

    const a2 = mkActions(); a2.hasActiveConsult = vi.fn(() => true);
    const r2 = route("MEGI, ir a revisión", a2);
    expect(r2.status).toBe("executed");
    expect(a2.goRevision).toHaveBeenCalled();
  });

  it("resolvePatients hace match por tokens", () => {
    expect(resolvePatients("hernandez", PATIENTS).map((p) => p.id)).toEqual(["p3"]);
    expect(resolvePatients("jorge", PATIENTS)).toHaveLength(2);
  });

  // --- Fase 5: modo experto ---
  it("por defecto exige 'MEGI' (rejected)", () => {
    expect(classifyCommand("ir a pacientes", {}).rejected).toBe(true);
  });

  it("modo experto procesa y ejecuta comandos SIN 'MEGI'", () => {
    const a = mkActions();
    const result = classifyCommand("ir a pacientes", {}, { requireWake: false });
    expect(result.rejected).toBe(false);
    expect(result.wake_word_detected).toBe(false);
    const r = routeCommand(result, { actions: a, patients: PATIENTS });
    expect(r.status).toBe("executed");
    expect(a.setView).toHaveBeenCalledWith("pacientes");
  });

  it("modo experto NO cambia el comportamiento de acciones sensibles (siguen propuesta)", () => {
    const a = mkActions();
    const result = classifyCommand("cambiar diagnóstico principal a I10", {}, { requireWake: false });
    const r = routeCommand(result, { actions: a, patients: PATIENTS });
    expect(r.status).toBe("needs_confirmation");
  });

  // --- Fase 9A: resolutores de entidades y patrones menos ambiguos ---
  it("resuelve nombres con errores del ASR por similitud (JORGIE -> Jorge)", () => {
    // "JORGIE DELGADO" es como el whisper v1.5 escribió "Jorge Delgado" (medido).
    const m = resolvePatients("Jorgie Delgado", PATIENTS);
    expect(m.map((p) => p.id)).toContain("p1");
    expect(m.map((p) => p.id)).not.toContain("p3");
  });

  it("el pase difuso no abre el match a nombres realmente distintos", () => {
    expect(resolvePatients("Ramírez", PATIENTS)).toHaveLength(0);
  });

  it("mencionar 'pacientes' sin verbo de navegación ya NO navega (manos libres)", () => {
    const a = mkActions();
    const r = route("MEGI, cuántos pacientes tengo hoy", a);
    expect(a.setView).not.toHaveBeenCalled();
    expect(r.status).toBe("info");
  });

  it("'MEGI, pacientes' (comando corto) sí navega", () => {
    const a = mkActions();
    const r = route("MEGI, pacientes", a);
    expect(r.status).toBe("executed");
    expect(a.setView).toHaveBeenCalledWith("pacientes");
  });

  it("sinónimo nuevo: 'muéstrame el expediente de' abre el paciente", () => {
    const a = mkActions();
    const r = route("MEGI, muéstrame el expediente de María", a);
    expect(r.status).toBe("executed");
    expect(a.openExpediente).toHaveBeenCalled();
  });
});
