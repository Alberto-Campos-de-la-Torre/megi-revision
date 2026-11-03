import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import AlertasFda from "../components/alertas_fda";

// Verificador FDA (FDA_movil): cada alerta lleva cita obligatoria y su origen; el
// médico ve la severidad, puede desplegar la cita y se le avisa si la fuente es
// la etiqueta en inglés sin validar.

const seguridad = {
  resumen: { absoluta: 1, moderada: 1 },
  alertas: [
    { tipo_alerta: "farmaco_condicion", farmaco: "warfarin", condicion: "embarazo", objeto: "embarazo",
      seccion: "CONTRAINDICATIONS", severidad: "absoluta", evidencias: 3,
      cita: "COUMADIN is contraindicated in women who are pregnant", fuente: "en_sin_validar" },
    { tipo_alerta: "farmaco_farmaco", farmaco: "ibuprofen", con_farmaco: "warfarin", objeto: "warfarina",
      seccion: "DRUG INTERACTIONS", severidad: "moderada", evidencias: 2,
      cita: "los AINE pueden potenciar el efecto anticoagulante", fuente: "es" },
  ],
};

describe("AlertasFda", () => {
  it("no pinta nada sin alertas", () => {
    const { container } = render(<AlertasFda seguridad={{ alertas: [] }} />);
    expect(container).toBeEmptyDOMElement();
    expect(render(<AlertasFda seguridad={null} />).container).toBeEmptyDOMElement();
  });

  it("muestra severidad, con qué choca, cita desplegable y aviso de inglés", () => {
    render(<AlertasFda seguridad={seguridad} />);
    expect(screen.getByText(/1 de severidad absoluta\/mayor · 2 en total/)).toBeInTheDocument();
    expect(screen.getByText("[absoluta]")).toBeInTheDocument();
    expect(screen.getByText("warfarin")).toBeInTheDocument();
    expect(screen.getByText(/fármaco · condición/)).toBeInTheDocument();
    expect(screen.getByText(/traducción no validada/)).toBeInTheDocument();
    // la cita no se muestra hasta pedirla
    expect(screen.queryByText(/COUMADIN is contraindicated/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /ver cita/i })[0]);
    expect(screen.getByText(/COUMADIN is contraindicated/)).toBeInTheDocument();
    expect(screen.getByText(/CONTRAINDICATIONS · 3 evidencia/)).toBeInTheDocument();
  });

  it("avisa cuando el verificador no está disponible", () => {
    render(<AlertasFda seguridad={{ alertas: [], error: "contra_db_not_available" }} />);
    expect(screen.getByText(/Verificador FDA no disponible/)).toBeInTheDocument();
  });
});

describe("AlertasFda · fusión y clase", () => {
  it("muestra la clase del cruce y las citas fusionadas al desplegar", () => {
    render(<AlertasFda seguridad={{ resumen: { mayor: 1 }, alertas: [{
      tipo_alerta: "farmaco_farmaco", farmaco: "tramadol", con_farmaco: "carisoprodol", clase: "relajante muscular",
      seccion: "DRUG INTERACTIONS", severidad: "mayor", evidencias: 4, cita: "uso concomitante con relajantes musculares", fuente: "es",
      otras_citas: [{ seccion: "BOXED WARNING", severidad: "mayor", cita: "otros depresores del SNC", fuente: "en_sin_validar", objeto: "depresores" }],
    }] }} />);
    expect(screen.getByText(/por clase: relajante muscular/)).toBeInTheDocument();
    expect(screen.getByText(/2 citas/)).toBeInTheDocument();
    expect(screen.queryByText(/otros depresores del SNC/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ver cita/i }));
    expect(screen.getByText(/uso concomitante con relajantes musculares/)).toBeInTheDocument();
    expect(screen.getByText(/otros depresores del SNC/)).toBeInTheDocument();
    expect(screen.getByText(/BOXED WARNING · mayor · inglés sin validar/)).toBeInTheDocument();
  });
});
