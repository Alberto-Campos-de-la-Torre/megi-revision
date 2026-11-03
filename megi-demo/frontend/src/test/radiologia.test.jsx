import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Radiologia from "../components/radiologia";
import { api } from "../api/client";

const PACIENTES = [{ id: "P-1", name: "Ana Ruiz" }];
const BORRADOR = {
  id: "IR-abc", patient_id: "P-1", modalidad: "radiografia", modalidad_label: "Radiografía",
  region: "tórax", indicacion: "tos y fiebre", fecha_estudio: "2026-09-09",
  tecnica: "Proyecciones convencionales.", comparacion: "", hallazgos: "", impresion: "",
  recomendaciones: "", transcript: "", status: "borrador",
};

describe("informe radiológico", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "radiologiaModalidades").mockResolvedValue([
      { id: "radiografia", label: "Radiografía", tecnica: "Proyecciones convencionales." },
      { id: "tomografia", label: "Tomografía computarizada", tecnica: "Cortes axiales." },
    ]);
    vi.spyOn(api, "radiologiaInformes").mockResolvedValue([]);
  });

  it("no deja crear un informe sin paciente", async () => {
    render(<Radiologia patients={PACIENTES} />);
    await waitFor(() => expect(api.radiologiaModalidades).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Crear" })).toBeDisabled();
  });

  it("crea el informe y propone la técnica de la modalidad", async () => {
    const spy = vi.spyOn(api, "radiologiaCrear").mockResolvedValue(BORRADOR);
    render(<Radiologia patients={PACIENTES} />);
    await waitFor(() => expect(api.radiologiaModalidades).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Paciente"), { target: { value: "P-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ patient_id: "P-1", modalidad: "radiografia" });
    expect(await screen.findByDisplayValue("Proyecciones convencionales.")).toBeInTheDocument();
  });

  it("no se puede firmar sin hallazgos ni impresión", async () => {
    vi.spyOn(api, "radiologiaCrear").mockResolvedValue(BORRADOR);
    render(<Radiologia patients={PACIENTES} />);
    await waitFor(() => expect(api.radiologiaModalidades).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Paciente"), { target: { value: "P-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    const firmar = await screen.findByRole("button", { name: "Firmar" });
    expect(firmar).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Hallazgos"), { target: { value: "opacidad basal" } });
    fireEvent.change(screen.getByLabelText("Impresión diagnóstica"), { target: { value: "neumonía" } });
    expect(screen.getByRole("button", { name: "Firmar" })).not.toBeDisabled();
  });

  it("un informe firmado se muestra sellado y ya no se edita", async () => {
    vi.spyOn(api, "radiologiaInformes").mockResolvedValue([{
      ...BORRADOR, hallazgos: "opacidad basal", impresion: "neumonía",
      status: "firmado", content_hash: "sha256:abc123", signed_at: "2026-09-09T10:00:00Z",
      created_by: "radiologa",
    }]);
    render(<Radiologia patients={PACIENTES} />);

    fireEvent.click(await screen.findByText(/Ana Ruiz · Radiografía de tórax/));
    expect(await screen.findByText("sha256:abc123")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Firmar" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hallazgos")).not.toBeInTheDocument();  // ya no es editable
    expect(screen.getByText("neumonía")).toBeInTheDocument();
  });

  it("avisa cuando el dictado no trajo secciones reconocibles", async () => {
    vi.spyOn(api, "radiologiaInformes").mockResolvedValue([BORRADOR]);
    render(<Radiologia patients={PACIENTES} />);
    fireEvent.click(await screen.findByText(/Ana Ruiz · Radiografía de tórax/));
    expect(await screen.findByLabelText("Hallazgos")).toBeInTheDocument();
  });

  // ---------------------------------------------------- imágenes + lectura asistida
  const IMG = { id: "IMG-1", informe_id: "IR-abc", nombre_original: "pa.png", formato: "png",
                sha256: "a".repeat(64), ancho: 1280, alto: 1038, dicom_meta: null };
  const LECTURA = { tecnica: "PA, buena inspiración", hallazgos: "sin consolidaciones",
                    impresion: "probablemente sin alteraciones", limitaciones: "no se valora la lateral" };

  const abrirBorrador = async (extra = {}) => {
    vi.spyOn(api, "radiologiaInformes").mockResolvedValue([{ ...BORRADOR, ...extra }]);
    vi.spyOn(api, "radiologiaVistaUrl").mockResolvedValue("blob:vista");
    render(<Radiologia patients={PACIENTES} />);
    fireEvent.click(await screen.findByText(/Ana Ruiz · Radiografía de tórax/));
    await waitFor(() => expect(api.radiologiaImagenes).toHaveBeenCalledWith("IR-abc"));
  };

  it("sin imágenes no se puede analizar; al subir una, sí", async () => {
    vi.spyOn(api, "radiologiaImagenes").mockResolvedValue([]);
    const subir = vi.spyOn(api, "radiologiaSubirImagen").mockResolvedValue(IMG);
    await abrirBorrador();

    const analizar = await screen.findByRole("button", { name: "Analizar con MEGI" });
    expect(analizar).toBeDisabled();

    const file = new File([new Uint8Array([137, 80, 78, 71])], "pa.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Subir imagen del estudio"), { target: { files: [file] } });
    await waitFor(() => expect(subir).toHaveBeenCalledWith({ id: "IR-abc", file }));

    expect(await screen.findByAltText("pa.png")).toHaveAttribute("src", "blob:vista");
    expect(screen.getByText(/PNG · 1280×1038/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analizar con MEGI" })).not.toBeDisabled();
  });

  it("la lectura aparece aparte, con aviso, y solo entra al informe al pedirlo", async () => {
    vi.spyOn(api, "radiologiaImagenes").mockResolvedValue([IMG]);
    const analizar = vi.spyOn(api, "radiologiaAnalizar").mockResolvedValue({
      lectura: LECTURA, n_imagenes: 1, at: "2026-09-21T18:00:00Z", model: "x/gemma-4", latency_ms: 12000,
    });
    await abrirBorrador();

    fireEvent.click(await screen.findByRole("button", { name: "Analizar con MEGI" }));
    await waitFor(() => expect(analizar).toHaveBeenCalledWith("IR-abc"));

    const panel = await screen.findByRole("region", { name: "Análisis asistido" });
    expect(panel).toHaveTextContent("no es un diagnóstico");
    expect(panel).toHaveTextContent("sin consolidaciones");
    // Nada entró al informe todavía.
    expect(screen.getByLabelText("Hallazgos")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Usar como borrador" }));
    expect(screen.getByLabelText("Hallazgos")).toHaveValue("sin consolidaciones");
    expect(screen.getByLabelText("Impresión diagnóstica")).toHaveValue("probablemente sin alteraciones");
    expect(screen.getByLabelText("Recomendaciones")).toHaveValue("Limitaciones del estudio: no se valora la lateral");
    // La técnica ya tenía texto: se añade debajo, no se pisa.
    expect(screen.getByLabelText("Técnica")).toHaveValue("Proyecciones convencionales.\n\nPA, buena inspiración");
  });

  it("en un informe firmado las imágenes se ven pero no se tocan", async () => {
    vi.spyOn(api, "radiologiaImagenes").mockResolvedValue([IMG]);
    await abrirBorrador({ hallazgos: "x", impresion: "y", status: "firmado", content_hash: "sha256:z",
                          signed_at: "2026-09-21", created_by: "r", analisis_ia: { lectura: LECTURA, n_imagenes: 1 } });
    expect(await screen.findByAltText("pa.png")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analizar con MEGI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usar como borrador" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Quitar/ })).not.toBeInTheDocument();
  });

  it("el dictado original se puede consultar siempre", async () => {
    vi.spyOn(api, "radiologiaInformes").mockResolvedValue([
      { ...BORRADOR, transcript: "se observa una opacidad en la base derecha" },
    ]);
    render(<Radiologia patients={PACIENTES} />);
    fireEvent.click(await screen.findByText(/Ana Ruiz · Radiografía de tórax/));
    fireEvent.click(await screen.findByRole("button", { name: "Ver dictado original" }));
    expect(screen.getByText("se observa una opacidad en la base derecha")).toBeInTheDocument();
  });
});
