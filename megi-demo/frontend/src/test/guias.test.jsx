import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Guias from "../components/guias";
import { api } from "../api/client";

// Lector de guías: vista «Texto» (fragmentos) y «Documento original» (PDF).
const DOCS = [
  { doc_id: "000GRR", title: "Cardiopatía isquémica", source: "IMSS", doc_type: "GRR", chunk_count: 2, pdf_available: true },
  { doc_id: "SINPDF", title: "Guía sin PDF", source: "IMSS", doc_type: "GRR", chunk_count: 1, pdf_available: false },
];
const LECTURA = (id) => ({
  doc: { ...DOCS.find((d) => d.doc_id === id), page_start: 1, page_end: 9 },
  chunks: [
    { chunk_id: `${id}_p1`, page_start: 1, page_end: 1, text: "Definición de la enfermedad." },
    { chunk_id: `${id}_p5`, page_start: 5, page_end: 6, text: "Algoritmo de tratamiento." },
  ],
});

describe("guías · documento original", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getGuidelines").mockResolvedValue({ total: 2, count: 2, docs: DOCS });
    vi.spyOn(api, "getGuideline").mockImplementation(async (id) => LECTURA(id));
    vi.spyOn(api, "guidelinePdfUrl").mockResolvedValue("blob:guia");
  });

  it("abre en texto, ofrece el PDF y salta a la página del fragmento", async () => {
    render(<Guias />);
    fireEvent.click(await screen.findByText("Cardiopatía isquémica"));
    expect(await screen.findByText("Definición de la enfermedad.")).toBeInTheDocument();
    await waitFor(() => expect(api.guidelinePdfUrl).toHaveBeenCalledWith("000GRR"));

    const pdfTab = screen.getByRole("tab", { name: "Documento original" });
    expect(pdfTab).not.toBeDisabled();

    // «ver en el PDF» del fragmento de la pág. 5 abre el visor en esa página.
    fireEvent.click(screen.getByRole("button", { name: "Ver pág. 5 en el documento original" }));
    const marco = await screen.findByTitle("PDF · Cardiopatía isquémica");
    expect(marco).toHaveAttribute("src", expect.stringContaining("blob:guia#page=5"));
    expect(screen.queryByText("Definición de la enfermedad.")).not.toBeInTheDocument();

    // Volver a texto conserva los fragmentos.
    fireEvent.click(screen.getByRole("tab", { name: "Texto" }));
    expect(screen.getByText("Algoritmo de tratamiento.")).toBeInTheDocument();
  });

  it("sin PDF en el servidor, la pestaña queda deshabilitada y no se pide el archivo", async () => {
    render(<Guias />);
    fireEvent.click(await screen.findByText("Guía sin PDF"));
    await screen.findByText("Definición de la enfermedad.");
    expect(screen.getByRole("tab", { name: "Documento original" })).toBeDisabled();
    expect(api.guidelinePdfUrl).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /en el documento original/ })).not.toBeInTheDocument();
  });

  it("un resultado de búsqueda puede abrirse directo en el PDF, en su página", async () => {
    vi.spyOn(api, "searchGuidelines").mockResolvedValue({ query: "algoritmo", count: 1, matches: [
      { doc_id: "000GRR", title: "Cardiopatía isquémica", citation: "Cardiopatía, pág. 5", chunk_id: "x",
        page_start: 5, snippet: "…algoritmo de tratamiento…" },
    ] });
    render(<Guias />);
    await screen.findByText("Cardiopatía isquémica");
    fireEvent.change(screen.getByLabelText("Buscar guía"), { target: { value: "algoritmo" } });
    fireEvent.click(screen.getByRole("button", { name: "EN TEXTO" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ver pág. 5 en el documento original" }));
    const marco = await screen.findByTitle("PDF · Cardiopatía isquémica");
    expect(marco).toHaveAttribute("src", expect.stringContaining("#page=5"));
  });
});
