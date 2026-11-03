import { describe, it, expect } from "vitest";
import { classifyCommand, applyProposal, initialContext, parseMed } from "../lib/voice_mock";

const ctx = () => initialContext();

describe("voice_mock classifier (Fase 1 mock)", () => {
  it("exige la palabra de activación MEGI", () => {
    const r = classifyCommand("ir a agenda", ctx());
    expect(r.wake_word_detected).toBe(false);
    expect(r.message).toMatch(/MEGI/);
  });

  it("clasifica navegación como acción directa (baja sensibilidad)", () => {
    const r = classifyCommand("MEGI, ir a agenda", ctx());
    expect(r.wake_word_detected).toBe(true);
    expect(r.intent).toBe("set_view");
    expect(r.risk_level).toBe("low");
    expect(r.requires_confirmation).toBe(false);
    expect(r.proposal).toBeNull();
  });

  it("acepta las variantes del ASR real: whisper v1.5 escribe MEGI como 'Meji'", () => {
    // Variantes frecuentes + matching difuso (≤1 edición de "megi": Mexi, Meyi…).
    for (const wake of ["Meji", "Megui", "Meggi", "megí", "Mexi", "Meyi", "Megi."]) {
      const r = classifyCommand(`${wake}, ir a pacientes.`, ctx());
      expect(r.wake_word_detected).toBe(true);
      expect(r.intent).toBe("set_view");
      expect(r.entities.view).toBe("pacientes");
    }
    // Transcript real completo de un comando de grabación (con punto final):
    const stop = classifyCommand("Meji, finaliza la consulta.", ctx());
    expect(stop.action).toBe("stop_recording");
    expect(stop.requires_confirmation).toBe(true);
  });

  it("push-to-command: sin wake word se procesa con requireWake=false y el punto del ASR no ensucia el código CIE", () => {
    // El ASR a veces se come "MEGI" al inicio; con Dictar la activación es el botón.
    const r = classifyCommand("finaliza la consulta.", ctx(), { requireWake: false });
    expect(r.action).toBe("stop_recording");
    // El punto final de oración no debe quedar dentro del código.
    const dx = classifyCommand("MEGI, cambiar diagnóstico principal a I10.", ctx());
    expect(dx.entities.code).toBe("i10");
    const dx2 = classifyCommand("MEGI, agrega diagnóstico E78.5.", ctx());
    expect(dx2.entities.code).toBe("e78.5");
  });

  it("cambiar diagnóstico principal es sensible y genera propuesta con valor actual y propuesto", () => {
    const r = classifyCommand("MEGI, cambiar diagnóstico principal a I10", ctx());
    expect(r.intent).toBe("change_primary_diagnosis");
    expect(r.risk_level).toBe("clinical_sensitive");
    expect(r.requires_confirmation).toBe(true);
    expect(r.proposal.current_value).toMatch(/I20\.9/);
    expect(r.proposal.proposed_value).toMatch(/I10/);
  });

  it("aplicar la propuesta (simulado) cambia el contexto de ejemplo", () => {
    const c0 = ctx();
    const r = classifyCommand("MEGI, cambiar diagnóstico principal a I10", c0);
    const c1 = applyProposal(c0, r.proposal);
    expect(c1.primaryDx).toMatch(/I10/);
    expect(c0.primaryDx).toMatch(/I20\.9/); // el original no se muta
  });

  it("agregar medicamento propone la receta con el fármaco nuevo", () => {
    const r = classifyCommand("MEGI, agrega losartán 50 mg cada 24 horas", ctx());
    expect(r.intent).toBe("add_medication");
    expect(r.requires_confirmation).toBe(true);
    expect(r.proposal.proposed_value.toLowerCase()).toMatch(/losart/);  // preserva acento: "losartán"
  });

  it("agrega a plan propone anexar texto a la sección correcta", () => {
    const c0 = ctx();
    const r = classifyCommand("MEGI, agrega a plan: seguimiento en siete días", c0);
    expect(r.intent).toBe("soap_add");
    expect(r.entities.section).toBe("plan");
    const c1 = applyProposal(c0, r.proposal);
    expect(c1.soap.plan).toMatch(/seguimiento en siete/i);
  });

  it("preserva acentos y mayúsculas del texto dictado (nota clínica)", () => {
    const r = classifyCommand("MEGI, agrega a plan: valoración por Cardiología en 7 días", ctx());
    // Se conserva "Cardiología" y los acentos ("días", "valoración"); la 1ª letra se capitaliza.
    expect(r.proposal.proposed_value).toMatch(/Valoración por Cardiología en 7 días/);
  });

  it("parseMed separa fármaco, dosis y frecuencia (con acentos)", () => {
    expect(parseMed("Losartán 50 mg cada 24 horas")).toEqual({ drug: "Losartán", dose: "50 mg", freq: "cada 24 horas" });
    const p = parseMed("Paracetamol 500 mg");
    expect(p.drug).toBe("Paracetamol");
    expect(p.dose).toBe("500 mg");
  });

  it("agrega medicamento preserva acentos del fármaco dictado", () => {
    const r = classifyCommand("MEGI, agrega Losartán 50 mg cada 24 horas", ctx());
    expect(r.intent).toBe("add_medication");
    expect(r.entities.med).toMatch(/Losartán/);
  });

  it("comando desconocido con MEGI queda ambiguo", () => {
    const r = classifyCommand("MEGI, haz algo raro", ctx());
    expect(r.wake_word_detected).toBe(true);
    expect(r.risk_level).toBe("ambiguous");
  });

  // --- Fase 9A: entidades y patrones menos ambiguos ---
  it("diagnóstico por NOMBRE entrega query (con acentos) en vez de código", () => {
    const r = classifyCommand("MEGI, cambiar diagnóstico principal a hipertensión", ctx());
    expect(r.action).toBe("change_primary_dx");
    expect(r.entities.code).toBeUndefined();
    expect(r.entities.query).toBe("hipertensión");

    const r2 = classifyCommand("MEGI, agrega diagnóstico hiperlipidemia mixta.", ctx());
    expect(r2.action).toBe("add_dx");
    expect(r2.entities.query).toBe("hiperlipidemia mixta");
  });

  it("quitar diagnóstico acepta nombre además de código", () => {
    const r = classifyCommand("MEGI, quita el diagnóstico de angina", ctx());
    expect(r.action).toBe("remove_dx");
    expect(r.entities.query).toBe("angina");
  });

  it("mencionar 'pacientes' sin verbo de navegación no dispara set_view", () => {
    const r = classifyCommand("MEGI, cuántos pacientes tengo hoy", ctx());
    expect(r.action).not.toBe("set_view");
    expect(r.intent).toBe("unknown");
  });
});
