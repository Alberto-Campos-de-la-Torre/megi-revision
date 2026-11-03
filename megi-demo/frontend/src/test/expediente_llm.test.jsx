import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ExpedienteLLM from "../components/expediente_llm";
import { api } from "../api/client";

// El panel pinta lo que el backend devuelve y etiqueta la fuente: "simulado"
// en local_mock, Megi-LLM con el servicio real. Cambiar de paciente vacía la
// conversación: lo preguntado de uno no se queda a la vista con otro.

const RESUMEN = {
  paciente: { id: "P-1", name: "Ana" },
  conteos: { consultas: 2, estudios: 1, envios: 1, documentos: 2, citas: 0 },
  resumen: "Ana, mujer de 40 años; sin alergias conocidas.\n\nTiene 2 consultas registradas.",
  secciones: [
    { clave: "paciente", titulo: "Paciente y antecedentes", texto: "Ana, mujer de 40 años.", items: ["Alergias: sin alergias conocidas"] },
    { clave: "consultas", titulo: "Historial de consultas", texto: "Tiene 2 consultas registradas.", items: ["Diagnósticos en el expediente: J02.9 Faringitis aguda"] },
    { clave: "envios", titulo: "Envíos y documentos", texto: "", items: [] },
  ],
  fuente: "mock", generado_en: "2026-10-11T18:00:00Z",
  aviso: "Resumen generado automáticamente a partir del expediente; verifica en la fuente antes de decidir.",
};

describe("lectura del expediente por el modelo", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("pide el resumen al seleccionar al paciente y marca la fuente simulada", async () => {
    const spy = vi.spyOn(api, "getExpedienteResumen").mockResolvedValue(RESUMEN);
    render(<ExpedienteLLM patient={{ id: "P-1", name: "Ana" }} />);
    expect(await screen.findByText(/Tiene 2 consultas registradas/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("P-1");
    // secciones separadas por tema; la vacía no se pinta
    expect(screen.getByLabelText("Paciente y antecedentes")).toBeInTheDocument();
    expect(screen.getByText("Diagnósticos en el expediente: J02.9 Faringitis aguda")).toBeInTheDocument();
    expect(screen.queryByLabelText("Envíos y documentos")).not.toBeInTheDocument();
    expect(screen.getByText("simulado · sin modelo")).toBeInTheDocument();
    expect(screen.getByText("2 consultas")).toBeInTheDocument();
    expect(screen.getByText("1 envíos")).toBeInTheDocument();
  });

  it("con el servicio real etiqueta Megi-LLM", async () => {
    vi.spyOn(api, "getExpedienteResumen").mockResolvedValue({ ...RESUMEN, fuente: "llm", resumen: "Redacción del modelo [C1]." });
    render(<ExpedienteLLM patient={{ id: "P-1" }} />);
    expect(await screen.findByText("Megi-LLM")).toBeInTheDocument();
    // con modelo: su redacción arriba y las secciones debajo
    expect(screen.getByText("Redacción del modelo [C1].")).toBeInTheDocument();
    expect(screen.getByLabelText("Historial de consultas")).toBeInTheDocument();
  });

  it("envía la pregunta con el historial y muestra la respuesta", async () => {
    vi.spyOn(api, "getExpedienteResumen").mockResolvedValue(RESUMEN);
    const ask = vi.spyOn(api, "preguntarExpediente")
      .mockResolvedValueOnce({ respuesta: "Paracetamol 500 mg [C1]", fuente: "mock" })
      .mockResolvedValueOnce({ respuesta: "No encuentro nada sobre eso.", fuente: "mock" });
    render(<ExpedienteLLM patient={{ id: "P-1" }} />);
    await screen.findByText(/Tiene 2 consultas/);

    const input = screen.getByLabelText("Pregunta sobre el paciente");
    fireEvent.change(input, { target: { value: "¿qué le recetaron?" } });
    fireEvent.submit(input.closest("form"));
    expect(await screen.findByText("Paracetamol 500 mg [C1]")).toBeInTheDocument();
    expect(ask).toHaveBeenCalledWith("P-1", { pregunta: "¿qué le recetaron?", historial: [] });

    fireEvent.change(input, { target: { value: "¿y estudios?" } });
    fireEvent.submit(input.closest("form"));
    await screen.findByText("No encuentro nada sobre eso.");
    expect(ask.mock.calls[1][1].historial).toEqual([
      { rol: "medico", texto: "¿qué le recetaron?" },
      { rol: "megi", texto: "Paracetamol 500 mg [C1]" },
    ]);
  });

  it("al cambiar de paciente vacía la conversación y vuelve a pedir el resumen", async () => {
    const spy = vi.spyOn(api, "getExpedienteResumen").mockResolvedValue(RESUMEN);
    vi.spyOn(api, "preguntarExpediente").mockResolvedValue({ respuesta: "Sí, J02.9 [C1]", fuente: "mock" });
    const { rerender } = render(<ExpedienteLLM patient={{ id: "P-1" }} />);
    await screen.findByText(/Tiene 2 consultas/);
    const input = screen.getByLabelText("Pregunta sobre el paciente");
    fireEvent.change(input, { target: { value: "¿tiene faringitis?" } });
    fireEvent.submit(input.closest("form"));
    await screen.findByText("Sí, J02.9 [C1]");

    rerender(<ExpedienteLLM patient={{ id: "P-2" }} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("P-2"));
    expect(screen.queryByText("Sí, J02.9 [C1]")).not.toBeInTheDocument();
  });

  it("si el resumen falla lo dice sin romper el panel", async () => {
    vi.spyOn(api, "getExpedienteResumen").mockRejectedValue(new Error("servidor caído"));
    render(<ExpedienteLLM patient={{ id: "P-1" }} />);
    expect(await screen.findByText(/No se pudo generar el resumen: servidor caído/)).toBeInTheDocument();
    expect(screen.getByLabelText("Pregunta sobre el paciente")).toBeInTheDocument();
  });
});
