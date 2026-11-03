import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Pacientes from "../components/pacientes";
import { api } from "../api/client";

// Salir de Pacientes («Revisar nota», atrás del navegador) vuelve a montar la
// pantalla: el paciente, la búsqueda y la consulta desplegada tienen que seguir ahí.

const PACIENTES = [
  { id: "P-1", name: "Ana López", age: 40, sex: "F", reason: "tos", allergies: [], chronic: [] },
  { id: "P-2", name: "Beto Ruiz", age: 52, sex: "M", reason: "control", allergies: [], chronic: [] },
];
vi.mock("../api/MegiDataProvider", () => ({ usePatients: () => PACIENTES }));
vi.mock("../components/preconsulta_panel", () => ({ default: () => null }));
vi.mock("../components/expediente_llm", () => ({ default: () => null }));

describe("memoria de la pantalla de pacientes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    vi.spyOn(api, "getPatientConsultations").mockResolvedValue([{ id: "C-9", status: "approved", started_at: "2026-10-06T22:44:00Z", finalized: true, soap: { S: "", O: "", A: "", P: "" } }]);
    vi.spyOn(api, "getPatientAppointments").mockResolvedValue([]);
    vi.spyOn(api, "getPatientVitals").mockResolvedValue([]);
    vi.spyOn(api, "getSoap").mockResolvedValue({ soap: { S: "s", O: "o", A: "a", P: "p" } });
  });

  it("al volver a montar, sigue el mismo paciente con su consulta desplegada", async () => {
    const { unmount } = render(<Pacientes onStart={() => {}} user={{ role: "medico" }} onReview={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: "ana" } });
    fireEvent.click(screen.getByText("Ana López"));
    await waitFor(() => expect(api.getPatientConsultations).toHaveBeenCalledWith("P-1"));
    fireEvent.click(await screen.findByText(/06 oct 2026/i));   // despliega la consulta
    await screen.findByText("nota lista");
    unmount();                                                    // «Revisar nota» → otra pantalla → atrás

    render(<Pacientes onStart={() => {}} user={{ role: "medico" }} onReview={() => {}} />);
    expect(screen.getByPlaceholderText(/buscar/i)).toHaveValue("ana");
    expect(await screen.findByText("P-1 · 40 años · Femenino")).toBeInTheDocument();
    await waitFor(() => expect(api.getSoap).toHaveBeenCalledTimes(2));  // la consulta volvió a abrirse
  });

  it("cambiar de paciente cierra la consulta desplegada", async () => {
    render(<Pacientes onStart={() => {}} user={{ role: "medico" }} onReview={() => {}} />);
    fireEvent.click(screen.getByText("Ana López"));
    fireEvent.click(await screen.findByText(/06 oct 2026/i));
    await screen.findByText("nota lista");
    fireEvent.click(screen.getByText("Beto Ruiz"));
    await waitFor(() => expect(api.getPatientConsultations).toHaveBeenCalledWith("P-2"));
    expect(JSON.parse(sessionStorage.getItem("megi.pacientes")).openConsult).toBeNull();
  });
});
