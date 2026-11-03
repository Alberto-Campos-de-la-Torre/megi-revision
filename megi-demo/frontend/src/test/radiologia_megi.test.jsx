import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RadiologiaMegi from "../components/radiologia_megi";
import { api } from "../api/client";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QR") } }));

const PACIENTES = [{ id: "P-1", name: "Ana López", age: 40, sex: "F" }, { id: "P-2", name: "Beto Ruiz", age: 52, sex: "M" }];
const CATALOGO = {
  clasificador: "Megi_tipo_estudio",
  servicio_modelos: { url: true, disponible: true },
  modelos: [
    { clave: "torax", nombre: "Megi Tórax", modelo: "Megi_torax_one", estudios: "Radiografía de tórax", estado: "disponible", conectado: true, que_hace: "Hallazgos calibrados." },
    { clave: "columna", nombre: "Megi Columna", modelo: "Megi_columna", estudios: "Columna", estado: "disponible", conectado: true, que_hace: "Puntos." },
    { clave: "abdomen", nombre: "Megi Abdomen", modelo: "Megi_abdomen", estudios: "KUB", estado: "disponible", conectado: false, que_hace: "Cálculos." },
    { clave: "ecografia", nombre: "Megi Eco", modelo: "Megi_eco_mama_consenso / Megi_eco_tiroides_multimascara", estudios: "Mama y tiroides", estado: "disponible", conectado: true, que_hace: "Órgano y caja manuales." },
    { clave: "resonancia", nombre: "Megi Resonancia", modelo: "en desarrollo", estudios: "RM", estado: "en_camino", conectado: false, que_hace: "Pronto." },
  ],
};

describe("Radiología MEGI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getModelosRadiologia").mockResolvedValue(CATALOGO);
    vi.spyOn(api, "carpetaRadiologia").mockResolvedValue({ id: "C-RAD", patient_id: "P-1", nueva: true });
    vi.spyOn(api, "getEstudiosAnalisis").mockResolvedValue({ estado: null, estudios: [], prediagnostico: null, servicio_modelos: { url: true, disponible: true } });
    vi.spyOn(api, "revocarEnlaceSubida").mockResolvedValue({ ok: true });
  });

  it("muestra cuatro modelos disponibles y resonancia en camino", async () => {
    render(<RadiologiaMegi patients={PACIENTES} />);
    const lista = await screen.findByLabelText("Modelos de radiodiagnóstico");
    expect(lista.querySelectorAll("[role=listitem]").length).toBe(5);
    expect(screen.getAllByText("conectado").length).toBe(3);
    expect(screen.getAllByText("en camino").length).toBe(1);
    expect(screen.getByText("servicio de modelos apagado")).toBeInTheDocument();
  });

  it("al elegir paciente abre su carpeta y la zona de subida con la lectura radiológica", async () => {
    const subir = vi.spyOn(api, "subirEstudio").mockResolvedValue({ id: "EA-1", nombre: "rx.png", formato: "png", tiene_vista: false, origen: "escritorio", analisis: [] });
    render(<RadiologiaMegi patients={PACIENTES} />);
    fireEvent.change(await screen.findByLabelText("Buscar paciente"), { target: { value: "ana" } });
    fireEvent.click(screen.getByText("Ana López"));
    await waitFor(() => expect(api.carpetaRadiologia).toHaveBeenCalledWith("P-1"));
    expect(await screen.findByText("Estudios radiológicos de Ana López")).toBeInTheDocument();
    expect(screen.queryByText("Continuar sin estudios")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Generar código QR")).toBeInTheDocument();
    fireEvent.drop(screen.getByLabelText("Zona para soltar archivos"), { dataTransfer: { files: [new File(["x"], "rx.png", { type: "image/png" })] } });
    await waitFor(() => expect(subir).toHaveBeenCalledWith("C-RAD", expect.any(File)));
    expect(await screen.findByLabelText("Lectura radiológica MEGI")).toBeInTheDocument();
  });
});
