import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../api/client", () => ({
  api: {
    searchCie10: vi.fn(),
    checkRx: vi.fn(),
    logReviewEvent: vi.fn(),
  },
}));

import { api } from "../api/client";
import ClinicalVoiceEditor from "../components/clinical_voice";

const SOAP = { S: "s", O: "o", A: "a", P: "plan inicial." };

function renderEditor(overrides = {}) {
  const props = {
    consultationId: "C-1",
    soap: SOAP,
    setSoap: vi.fn(),
    dxList: [],
    setDxList: vi.fn(),
    rxList: [],
    setRxList: vi.fn(),
    allergies: [],
    chronic: [],
    // permissionsForRole es fail-closed: sin rol conocido no hay escritura clínica.
    user: { username: "dra", role: "medico" },
    ...overrides,
  };
  render(<ClinicalVoiceEditor {...props} />);
  return props;
}

async function propose(command) {
  fireEvent.change(screen.getByPlaceholderText(/MEGI, cambiar/i), { target: { value: command } });
  fireEvent.click(screen.getByRole("button", { name: /proponer/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.setItem("megi.voice.expert", "0"); } catch (e) { /* noop */ }
  api.searchCie10.mockResolvedValue({ results: [] });
  api.checkRx.mockResolvedValue({ alerts: [] });
  api.logReviewEvent.mockResolvedValue({ ok: true });
});

describe("ClinicalVoiceEditor", () => {
  it("bloquea agregar medicamento por voz si no se pudo verificar seguridad", async () => {
    api.checkRx.mockRejectedValueOnce(new Error("rx-check down"));
    const props = renderEditor({ allergies: ["Penicilina"] });

    await propose("MEGI, agrega amoxicilina 500 mg cada 8 horas");

    expect(await screen.findByText(/No se pudo verificar la seguridad de la receta/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirmar y aplicar/i })).toBeDisabled();
    expect(props.setRxList).not.toHaveBeenCalled();
  });

  it("no aplica cambios clínicos si falla la auditoría persistente", async () => {
    api.logReviewEvent.mockRejectedValueOnce(new Error("audit down"));
    const props = renderEditor();

    await propose("MEGI, agrega a plan: control en 7 días");
    fireEvent.click(await screen.findByRole("button", { name: /confirmar y aplicar/i }));

    expect(await screen.findByText(/No se pudo registrar auditoría/i)).toBeInTheDocument();
    expect(props.setSoap).not.toHaveBeenCalled();
  });

  it("dx por NOMBRE con un solo resultado CIE-10 propone directo con el código resuelto", async () => {
    api.searchCie10.mockResolvedValueOnce({ results: [{ code: "I10", label: "Hipertensión esencial (primaria)" }] });
    const props = renderEditor();

    await propose("MEGI, agrega diagnóstico hipertensión");
    expect(await screen.findByText(/I10 Hipertensión esencial/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirmar y aplicar/i }));
    await waitFor(() => expect(props.setDxList).toHaveBeenCalled());
    const next = props.setDxList.mock.calls.at(-1)[0];
    expect(next.map((d) => d.code)).toContain("I10");
  });

  it("dx por NOMBRE con varias coincidencias muestra pick-list y solo aplica la elegida", async () => {
    api.searchCie10.mockResolvedValueOnce({ results: [
      { code: "E78.5", label: "Hiperlipidemia, no especificada" },
      { code: "E78.0", label: "Hipercolesterolemia pura" },
    ] });
    const props = renderEditor();

    await propose("MEGI, agrega diagnóstico hiperlipidemia");
    // Pick-list visible; nada aplicado aún.
    const option = await screen.findByRole("button", { name: /E78\.5/ });
    expect(props.setDxList).not.toHaveBeenCalled();

    fireEvent.click(option);
    fireEvent.click(await screen.findByRole("button", { name: /confirmar y aplicar/i }));
    await waitFor(() => expect(props.setDxList).toHaveBeenCalled());
    const next = props.setDxList.mock.calls.at(-1)[0];
    expect(next.map((d) => d.code)).toEqual(["E78.5"]);
  });

  it("cambiar diagnóstico principal a uno existente no duplica el CIE-10", async () => {
    api.searchCie10.mockResolvedValueOnce({ results: [{ code: "E78.5", label: "Hiperlipidemia, no especificada" }] });
    const props = renderEditor({
      dxList: [
        { code: "I10", label: "Hipertensión esencial", primary: true },
        { code: "E78.5", label: "Hiperlipidemia, no especificada", primary: false },
      ],
    });

    await propose("MEGI, cambiar diagnóstico principal a E78.5");
    fireEvent.click(await screen.findByRole("button", { name: /confirmar y aplicar/i }));

    await waitFor(() => expect(props.setDxList).toHaveBeenCalled());
    const next = props.setDxList.mock.calls.at(-1)[0];
    expect(next.map((d) => d.code)).toEqual(["E78.5", "I10"]);
    expect(next[0].primary).toBe(true);
    expect(next[1].primary).toBe(false);
  });
});
