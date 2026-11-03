import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock del cliente API (Revisión llama getSoap, checkRx, etc.).
vi.mock("../api/client", () => ({
  api: {
    getSoap: vi.fn(),
    checkRx: vi.fn().mockResolvedValue({ alerts: [] }),
    searchCie10: vi.fn().mockResolvedValue({ results: [] }),
    createAppointment: vi.fn().mockResolvedValue({}),
    reviewApprove: vi.fn().mockResolvedValue({ ok: true }),
    updatePatientProfile: vi.fn().mockResolvedValue({}),
    rehabConsulta: vi.fn().mockResolvedValue({ es_rehabilitacion: false, protocolos: [] }),
    rehabAplicar: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { api } from "../api/client";
import Revision from "../components/revision";

const patient = {
  id: "P1", name: "Test Paciente", age: 40, sex: "M", reason: "prueba",
  curp: "", nss: "", allergies: [], chronic: [],
};

const renderRevision = (cid = "C-1") =>
  render(
    <Revision
      patient={patient}
      consultationId={cid}
      user={{ username: "king", role: "admin" }}
      onBack={() => {}}
      onApprove={() => {}}
    />
  );

beforeEach(() => { vi.clearAllMocks(); });

describe("Revisión", () => {
  it("NO truena con alergias como objeto y muestra el nombre (regresión del crash)", async () => {
    api.getSoap.mockResolvedValue({
      final_soap: { S: "s", O: "o", A: "análisis", P: "plan" },
      soap: { S: "s", O: "o", A: "análisis", P: "plan" },
      clinical_facts: {
        // el LLM devolvió alergias como OBJETOS -> esto crasheaba el render
        alergias: [{ alergeno: "Penicilina", reaccion: "ronchas" }],
        antecedentes_cronicos: ["DM2"],
        medicamentos: [{ nombre: "Paracetamol", dosis: "500 mg", frecuencia: "c/8h" }],
        signos_vitales: { ta: "120/80 mmHg", temp: "37 C" },
        sintomas_presentes: [], sintomas_negados: [], datos_alarma_condicionales: [],
      },
      validation: null,
    });
    renderRevision("C-1");
    // Si no coacciona a string, el render lanza y este findByText nunca resuelve.
    expect(await screen.findByText(/Penicilina/)).toBeInTheDocument();
  });

  it("prellena la receta con los medicamentos escuchados", async () => {
    api.getSoap.mockResolvedValue({
      final_soap: { S: "", O: "", A: "", P: "" },
      soap: {},
      clinical_facts: {
        medicamentos: [{ nombre: "Paracetamol", dosis: "500 mg" }],
        alergias: [], antecedentes_cronicos: [], signos_vitales: {},
        sintomas_presentes: [], sintomas_negados: [], datos_alarma_condicionales: [],
      },
      validation: null,
    });
    renderRevision("C-2");
    expect(await screen.findByText(/Paracetamol/)).toBeInTheDocument();
  });
});
