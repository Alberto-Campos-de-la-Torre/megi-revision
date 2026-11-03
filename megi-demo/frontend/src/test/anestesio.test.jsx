import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Anestesio from "../components/anestesio";
import { api } from "../api/client";

const CAT = {
  aviso: "Sección restringida. Solo un número reducido de médicos tiene acceso.",
  familias: 21, total_modelos: 26, registro: "registro.json",
  modelos: [
    { clave: "hipotension", nombre: "Megi_Hipotension_anex", tipo: "aprendido", area: "Hemodinamia", estado: "experimental", variantes: ["H5 (5 min)", "H15 (15 min)"], que_hace: "Predice hipotensión.", datos: "VitalDB", limites: "Experimental." },
    { clave: "gasometria", nombre: "Megi_Gasometria_reglas", tipo: "reglas", area: "Gasometría", estado: "reglas", que_hace: "Ácido-base.", datos: "Fórmulas", limites: "Determinista." },
    { clave: "gasto", nombre: "Megi_Gasto_tendencia", tipo: "reglas", area: "Hemodinamia", estado: "cerrado", que_hace: "Gasto.", datos: "VitalDB", limites: "Cerrado." },
  ],
};

describe("Anestesio", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("con acceso muestra el aviso, el conteo y las tarjetas por tipo", async () => {
    vi.spyOn(api, "getModelosAnestesio").mockResolvedValue(CAT);
    render(<Anestesio />);
    expect(await screen.findByText(/26 modelos en 21 familias/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Sección restringida");
    expect(screen.getByLabelText("Modelos aprendidos").querySelectorAll("[role=listitem]").length).toBe(1);
    expect(screen.getByLabelText("Módulos de reglas y cálculos").querySelectorAll("[role=listitem]").length).toBe(2);
    expect(screen.getByText("H15 (15 min)")).toBeInTheDocument();
    expect(screen.getByText("estudio cerrado")).toBeInTheDocument();
    expect(screen.queryByText(/Tu usuario no tiene acceso/)).not.toBeInTheDocument();
  });

  it("sin acceso muestra solo el aviso y cómo pedirlo", async () => {
    vi.spyOn(api, "getModelosAnestesio").mockRejectedValue(new Error("Sección restringida. Estos modelos trabajan sobre señales de quirófano…"));
    render(<Anestesio />);
    expect(await screen.findByText(/Tu usuario no tiene acceso/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Modelos aprendidos")).not.toBeInTheDocument();
  });
});


describe("la mesa, en su propia viñeta", () => {
  beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

  it("pide la contraseña y monta la mesa aquí mismo con el pase", async () => {
    vi.spyOn(api, "getModelosAnestesio").mockResolvedValue(CAT);
    const ingresar = vi.spyOn(api, "ingresarAnestesio")
      .mockRejectedValueOnce(new Error("contraseña incorrecta"))
      .mockResolvedValueOnce({ ok: true, url: "/mesa/?pase=abc", expira_en_s: 90, pase: "abc" });
    const abrir = vi.spyOn(window, "open").mockReturnValue({});
    render(<Anestesio />);
    expect(await screen.findByText(/26 modelos en 21 familias/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();          // en «Modelos» no se pide nada
    fireEvent.click(screen.getByRole("tab", { name: "Mesa del anestesiólogo" }));
    expect(screen.queryByLabelText("Modelos aprendidos")).not.toBeInTheDocument();
    const pw = screen.getByLabelText("Contraseña");
    fireEvent.change(pw, { target: { value: "mala" } });
    fireEvent.submit(pw.closest("form"));
    expect(await screen.findByText("contraseña incorrecta")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "buena" } });
    fireEvent.submit(screen.getByLabelText("Contraseña").closest("form"));
    const marco = await screen.findByTitle("Mesa del anestesiólogo");
    expect(marco).toHaveAttribute("src", "/mesa/?pase=abc");                        // misma página, mismo origen
    expect(abrir).not.toHaveBeenCalled();                                            // ya no hay pestaña aparte
    expect(ingresar).toHaveBeenLastCalledWith("buena");
    expect(sessionStorage.getItem("megi.anestesio.vista")).toBe("mesa");
    // volver a «Modelos» no desmonta la mesa (queda oculta) y «Volver a ingresar» la cierra
    fireEvent.click(screen.getByRole("tab", { name: "Modelos" }));
    expect(screen.getByTitle("Mesa del anestesiólogo")).toBeInTheDocument();
    expect(screen.getByLabelText("Modelos aprendidos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Mesa del anestesiólogo" }));
    fireEvent.click(screen.getByText("Volver a ingresar"));
    expect(screen.queryByTitle("Mesa del anestesiólogo")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
  });

  it("sin acceso no hay viñetas ni mesa", async () => {
    vi.spyOn(api, "getModelosAnestesio").mockRejectedValue(new Error("Sección restringida."));
    render(<Anestesio />);
    expect(await screen.findByText(/Tu usuario no tiene acceso/)).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
  });
});
