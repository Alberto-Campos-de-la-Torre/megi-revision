import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import PendientesPanel from "../components/pendientes_panel";

const datos = (over = {}) => ({
  pendientes: [
    { categoria: "alarma", texto: "Tos de más de 2 semanas: descartar tuberculosis", prioridad: "alta" },
    { categoria: "interrogatorio", texto: "Tabaquismo y humo de leña", prioridad: "media" },
  ],
  n_pendientes: 2, n_ocultas: 0, n_cubiertas: 2, n_seguidas: 4, ...over,
});

describe("panel de «falta preguntar»", () => {
  it("no aparece si no hay nada pendiente", () => {
    const { container } = render(<PendientesPanel datos={datos({ pendientes: [] })} />);
    expect(container.textContent).toBe("");
  });

  it("no revienta antes de la primera respuesta", () => {
    const { container } = render(<PendientesPanel datos={null} />);
    expect(container.textContent).toBe("");
  });

  it("lista lo pendiente y marca la alarma", () => {
    render(<PendientesPanel datos={datos()} />);
    expect(screen.getByText(/tuberculosis/)).toBeInTheDocument();
    expect(screen.getByText(/Tabaquismo/)).toBeInTheDocument();
    expect(screen.getByText("Alarma")).toBeInTheDocument();
    expect(screen.getByText("Preguntar")).toBeInTheDocument();
  });

  it("muestra cuánto se lleva cubierto", () => {
    render(<PendientesPanel datos={datos()} />);
    expect(screen.getByText("2/4 cubierto")).toBeInTheDocument();
  });

  it("avisa de lo que no cabe en la lista", () => {
    render(<PendientesPanel datos={datos({ n_ocultas: 5 })} />);
    expect(screen.getByText("y 5 más")).toBeInTheDocument();
  });
});
