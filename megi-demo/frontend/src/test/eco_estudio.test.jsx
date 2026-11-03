import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import EcoEstudio, { cajaValida } from "../components/eco_estudio";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: { estudioVistaPath: () => "/vista", ecografiaVistaPath: () => "/eco/vista", analizarEcografia: vi.fn() },
  apiBlobUrl: vi.fn().mockResolvedValue("blob:eco"),
}));

beforeEach(() => { vi.clearAllMocks(); URL.revokeObjectURL = vi.fn(); });

it("exige órgano y caja válida; envía coordenadas naturales sin inventar escala", async () => {
  api.analizarEcografia.mockResolvedValue({ ok: true });
  const cargar = vi.fn().mockResolvedValue();
  render(<EcoEstudio cid="C1" estudio={{ id: "E1", tiene_vista: true }} onAnalizado={cargar} />);
  fireEvent.click(screen.getByText("Megi Eco · mama / tiroides"));
  const imagen = await screen.findByAltText("Ecografía completa para marcar el nódulo");
  Object.defineProperty(imagen, "naturalWidth", { value: 640 });
  Object.defineProperty(imagen, "naturalHeight", { value: 520 });
  fireEvent.load(imagen);
  const boton = screen.getByText("Analizar con Megi Eco");
  expect(boton).toBeDisabled();
  // Una imagen mostrada a la mitad de tamaño conserva coordenadas originales.
  const svg = screen.getByLabelText("Marcar caja del nódulo");
  window.PointerEvent = MouseEvent;
  svg.setPointerCapture = vi.fn();
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 260 });
  fireEvent.pointerDown(svg, { clientX: 100, clientY: 100 });
  fireEvent.pointerUp(svg, { clientX: 20, clientY: 30 });
  expect(screen.getByLabelText("X inicial")).toHaveValue(40);
  expect(screen.getByLabelText("Y inicial")).toHaveValue(60);
  expect(screen.getByLabelText("X final")).toHaveValue(200);
  expect(screen.getByLabelText("Y final")).toHaveValue(200);
  fireEvent.change(screen.getByLabelText("Órgano ecográfico"), { target: { value: "tiroides" } });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  for (const [label, value] of [["X inicial", 10], ["Y inicial", 20], ["X final", 200], ["Y final", 250]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  expect(boton).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Escala mm por píxel"), { target: { value: "-1" } });
  expect(boton).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Escala mm por píxel"), { target: { value: "" } });
  fireEvent.click(boton);
  await waitFor(() => expect(api.analizarEcografia).toHaveBeenCalledWith("C1", "E1", {
    organo: "tiroides", caja_xyxy: [10, 20, 200, 250], mm_por_pixel: null, clasificar_tiroides: false,
  }));
  expect(cargar).toHaveBeenCalled();
});

it("rechaza área nula, valores no finitos y cajas fuera de imagen", () => {
  expect(cajaValida([0, 0, 10, 10], 20, 20)).toBe(true);
  expect(cajaValida([10, 0, 10, 10], 20, 20)).toBe(false);
  expect(cajaValida([0, 0, 21, 10], 20, 20)).toBe(false);
  expect(cajaValida([0, NaN, 10, 10], 20, 20)).toBe(false);
});
