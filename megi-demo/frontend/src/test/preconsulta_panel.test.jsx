import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PreconsultaPanel from "../components/preconsulta_panel";
import { api } from "../api/client";

// El motivo ya NO se escribe aquí: se pregunta antes de abrir la consulta
// (motivo_consulta.jsx) y llega como prop. Este panel solo pinta lo que
// devuelve el backend para ese motivo.

const BASE = {
  paciente: { id: "P-1", name: "Ana" },
  edad: { exacta: true, age_years: 40, age_months: 480, age_days: 14600 },
  grupo_label: "Adulto medio (40–64 años)",
  sugerencias: [{ categoria: "tamizaje", texto: "Tamizaje de diabetes", razon: "Edad", fuente: "USPSTF", prioridad: "media" }],
  motivo: "", motivo_de_hoy: "", motivo_reconocido: [], resumen: null, nota: "nota",
};

const CON_MOTIVO = {
  ...BASE,
  motivo: "tos desde hace tres semanas",
  motivo_de_hoy: "tos desde hace tres semanas",
  motivo_reconocido: ["tos"],
  sugerencias: [
    { categoria: "alarma", texto: "Tos de más de 2 semanas: descartar tuberculosis", razon: "Tos", fuente: "GPC", prioridad: "alta" },
    ...BASE.sugerencias,
  ],
};

describe("panel de pre-consulta", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("sin motivo muestra lo que toca por edad e historial", async () => {
    const spy = vi.spyOn(api, "getPreconsulta").mockResolvedValue(BASE);
    render(<PreconsultaPanel patientId="P-1" />);
    expect(await screen.findByText("Tamizaje de diabetes")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("P-1", { motivo: "" });
  });

  it("con motivo pide las sugerencias de ese motivo y destaca la alarma", async () => {
    const spy = vi.spyOn(api, "getPreconsulta").mockResolvedValue(CON_MOTIVO);
    render(<PreconsultaPanel patientId="P-1" motivo="tos desde hace tres semanas" />);

    expect(await screen.findByText(/tuberculosis/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("P-1", { motivo: "tos desde hace tres semanas" });
    expect(screen.getByText("Alarma")).toBeInTheDocument();   // categoría propia, en rojo
    expect(screen.getByText("tos")).toBeInTheDocument();      // etiqueta reconocida
  });

  it("recarga si cambia el motivo", async () => {
    const spy = vi.spyOn(api, "getPreconsulta").mockResolvedValue(BASE);
    const { rerender } = render(<PreconsultaPanel patientId="P-1" motivo="" />);
    await screen.findByText("Tamizaje de diabetes");

    spy.mockResolvedValue(CON_MOTIVO);
    rerender(<PreconsultaPanel patientId="P-1" motivo="tos desde hace tres semanas" />);
    expect(await screen.findByText(/tuberculosis/)).toBeInTheDocument();
  });

  it("un motivo no reconocido lo dice, en vez de fingir que aplicó", async () => {
    vi.spyOn(api, "getPreconsulta").mockResolvedValue({
      ...BASE, motivo: "dolor de rodilla", motivo_de_hoy: "dolor de rodilla", motivo_reconocido: [],
    });
    render(<PreconsultaPanel patientId="P-1" motivo="dolor de rodilla" />);
    expect(await screen.findByText(/no coincide con ninguna guía/)).toBeInTheDocument();
  });

  it("un motivo fuera de las guías se ve arriba con las preguntas que propone el modelo", async () => {
    const DEL_MODELO = [
      { categoria: "alarma", texto: "Fiebre con rodilla caliente e hinchada", razon: "Sobre el motivo: dolor de rodilla",
        fuente: "MEGI · propuesta del modelo", prioridad: "alta", claves: ["fiebre", "caliente"] },
      { categoria: "interrogatorio", texto: "¿Hubo golpe, torcedura o caída?", razon: "Sobre el motivo: dolor de rodilla",
        fuente: "MEGI · propuesta del modelo", prioridad: "media", claves: ["golpe", "caida"] },
    ];
    vi.spyOn(api, "getPreconsulta").mockResolvedValue({
      ...BASE, motivo: "dolor de rodilla", motivo_de_hoy: "dolor de rodilla", motivo_reconocido: [],
      preguntas_motivo: DEL_MODELO,
    });
    const onPreguntas = vi.fn();
    render(<PreconsultaPanel patientId="P-1" motivo="dolor de rodilla" onPreguntasMotivo={onPreguntas} />);

    const bloque = await screen.findByRole("region", { name: "Sobre el motivo" });
    expect(bloque).toHaveTextContent("¿Hubo golpe, torcedura o caída?");
    expect(bloque).toHaveTextContent("propuesta del modelo");
    expect(screen.getByText("Motivo: dolor de rodilla")).toBeInTheDocument();  // el motivo, primero
    // Ya no dice que el motivo no aplicó: sí aplicó, vía el modelo.
    expect(screen.queryByText(/no coincide con ninguna guía/)).not.toBeInTheDocument();
    // Lo de edad sigue debajo, intacto.
    expect(screen.getByText("Tamizaje de diabetes")).toBeInTheDocument();
    // Y el padre recibe las preguntas para el seguimiento en vivo.
    await waitFor(() => expect(onPreguntas).toHaveBeenCalledWith(DEL_MODELO));
  });

  it("si el motor falla, el panel no estorba", async () => {
    vi.spyOn(api, "getPreconsulta").mockRejectedValue(new Error("500"));
    const { container } = render(<PreconsultaPanel patientId="P-1" />);
    await waitFor(() => expect(container.textContent).not.toMatch(/Analizando/));
    expect(container.textContent).toBe("");
  });
});
