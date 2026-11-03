import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Administracion from "../components/administracion";
import { api } from "../api/client";

// Usuarios visibles solo para un administrador: la lista ya viene filtrada del
// backend; aquí se prueba el control de ocultar/mostrar y la casilla del alta.
const KING = { username: "king", role: "admin" };
const USERS = [
  { username: "king", name: "King", role: "admin", visible_para: null },
  { username: "megi_admin", name: "David", role: "admin", visible_para: null },
  { username: "sofia_girbau", name: "Sofía", role: "medico", visible_para: "king" },
  { username: "otro_medico", name: "Otro", role: "medico", visible_para: null },
];

describe("administración · usuarios ocultos", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getUsers").mockResolvedValue(USERS);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("marca al oculto con «solo tú» y ofrece ocultar/mostrar solo a médicos", async () => {
    render(<Administracion user={KING} />);
    await screen.findByText("Sofía");
    expect(screen.getByText("solo tú")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostrar sofia_girbau" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ocultar otro_medico" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Ocultar|Mostrar) megi_admin/ })).toBeNull();  // no se ocultan admins
  });

  it("ocultar llama al backend y recarga", async () => {
    const spy = vi.spyOn(api, "setUserVisibility").mockResolvedValue({});
    render(<Administracion user={KING} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ocultar otro_medico" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("otro_medico", true));
    expect(api.getUsers).toHaveBeenCalledTimes(2);
  });

  it("al crear un médico se puede marcar «solo visible para mí»", async () => {
    const spy = vi.spyOn(api, "createUser").mockResolvedValue({});
    render(<Administracion user={KING} />);
    await screen.findByText("Sofía");
    fireEvent.change(screen.getByLabelText(/Usuario/), { target: { value: "nueva" } });
    fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: "clave12345" } });
    fireEvent.click(screen.getByLabelText(/Solo visible para mí/));
    fireEvent.click(screen.getByRole("button", { name: "CREAR USUARIO" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ username: "nueva", solo_visible_para_mi: true });
  });
});
