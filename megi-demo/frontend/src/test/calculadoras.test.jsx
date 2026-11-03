import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Calculadoras from "../components/calculadoras";
import { api } from "../api/client";

const teclear = (etiqueta, valor) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });

describe("calculadoras clínicas", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("no deja calcular sin los tres valores obligatorios", () => {
    render(<Calculadoras />);
    expect(screen.getByRole("button", { name: "Interpretar" })).toBeDisabled();
    teclear("pH", "7.1");
    expect(screen.getByRole("button", { name: "Interpretar" })).toBeDisabled();
    teclear("PCO₂", "25");
    teclear("HCO₃⁻", "8");
    expect(screen.getByRole("button", { name: "Interpretar" })).not.toBeDisabled();
  });

  it("manda solo los campos con valor, no vacíos", async () => {
    const spy = vi.spyOn(api, "calcularGasometria").mockResolvedValue({
      trastorno_primario: "acidosis metabólica", motivo: "acidemia con HCO₃⁻ bajo",
      certeza: "clara", hallazgos: [], aviso: "aviso",
    });
    render(<Calculadoras />);
    teclear("pH", "7.1"); teclear("PCO₂", "25"); teclear("HCO₃⁻", "8");
    fireEvent.click(screen.getByRole("button", { name: "Interpretar" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    // Los campos opcionales vacíos NO viajan: el backend los trataría como dato.
    expect(spy.mock.calls[0][0]).toEqual({ ph: 7.1, pco2: 25, hco3: 8 });
  });

  it("muestra la interpretación con su fórmula", async () => {
    vi.spyOn(api, "calcularGasometria").mockResolvedValue({
      trastorno_primario: "acidosis metabólica", motivo: "acidemia con HCO₃⁻ bajo",
      certeza: "clara",
      compensacion: { parametro: "PCO₂", min: 18, max: 22, medido: 25,
        lectura: "compensación insuficiente o trastorno añadido: acidosis respiratoria concomitante",
        formula: "PCO₂ esperada = 1.5 × HCO₃⁻ + 8 ± 2 (Winter)" },
      hallazgos: ["anión gap elevado (32.0 mEq/L)"], aviso: "Cálculo determinista de apoyo.",
    });
    render(<Calculadoras />);
    teclear("pH", "7.1"); teclear("PCO₂", "25"); teclear("HCO₃⁻", "8");
    fireEvent.click(screen.getByRole("button", { name: "Interpretar" }));
    expect(await screen.findByText("acidosis metabólica")).toBeInTheDocument();
    expect(screen.getByText(/PCO₂ esperada = 1.5/)).toBeInTheDocument();  // la fórmula, no el subtítulo
    expect(screen.getByText(/anión gap elevado/)).toBeInTheDocument();
  });

  it("un dato mal capturado se muestra como error, no como resultado", async () => {
    vi.spyOn(api, "calcularGasometria").mockRejectedValue(
      new Error("ph = 14.0 está fuera de lo plausible (6.5–8.0); revisa la captura"));
    render(<Calculadoras />);
    teclear("pH", "14"); teclear("PCO₂", "40"); teclear("HCO₃⁻", "24");
    fireEvent.click(screen.getByRole("button", { name: "Interpretar" }));
    expect(await screen.findByText(/fuera de lo plausible/)).toBeInTheDocument();
    expect(screen.queryByText(/Compensación/)).not.toBeInTheDocument();
  });

  it("la serie pide la tendencia a partir de la segunda gasometría", async () => {
    const spy = vi.spyOn(api, "calcularTendencia").mockResolvedValue({
      suficiente: true, n: 2, resumen: "mejora: ph",
      parametros: { ph: { inicial: 7.1, actual: 7.3, direccion: "mejora" } },
    });
    render(<Calculadoras />);
    teclear("pH", "7.1"); teclear("PCO₂", "25"); teclear("HCO₃⁻", "8");
    fireEvent.click(screen.getByRole("button", { name: "+ Añadir a la serie" }));
    expect(spy).not.toHaveBeenCalled();          // con una sola no hay tendencia
    expect(await screen.findByText(/Añade una segunda gasometría/)).toBeInTheDocument();

    teclear("pH", "7.3");
    fireEvent.click(screen.getByRole("button", { name: "+ Añadir a la serie" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toHaveLength(2);
    expect(await screen.findByText("mejora: ph")).toBeInTheDocument();
  });
});
