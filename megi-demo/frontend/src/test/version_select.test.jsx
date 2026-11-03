import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import VersionSelect from "../components/version_select";
import { APP_VERSION_IDS } from "../lib/app_versions";

const user = { username: "king", name: "King", role: "admin" };

describe("VersionSelect", () => {
  it("muestra las versiones disponibles antes de iniciar la app", () => {
    render(<VersionSelect user={user} onSelect={() => {}} onLogout={() => {}} />);

    expect(screen.getByText("Consulta automática")).toBeInTheDocument();
    expect(screen.getByText("Consulta asistida por voz")).toBeInTheDocument();
    expect(screen.getByText(/Hola, King/)).toBeInTheDocument();
  });

  it("selecciona la versión asistida por voz y confirma", () => {
    const onSelect = vi.fn();
    render(<VersionSelect user={user} onSelect={onSelect} onLogout={() => {}} />);

    const card = screen.getByRole("radio", { name: /Consulta asistida por voz/i });
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /INICIAR MEGI VOZ/i }));

    expect(onSelect).toHaveBeenCalledWith(APP_VERSION_IDS.VOICE);
  });

  it("inicia directo con doble clic sobre una tarjeta", () => {
    const onSelect = vi.fn();
    render(<VersionSelect user={user} onSelect={onSelect} onLogout={() => {}} />);

    fireEvent.doubleClick(screen.getByRole("radio", { name: /Consulta asistida por voz/i }));
    expect(onSelect).toHaveBeenCalledWith(APP_VERSION_IDS.VOICE);
  });

  it("permite salir desde el selector", () => {
    const onLogout = vi.fn();
    render(<VersionSelect user={user} onSelect={() => {}} onLogout={onLogout} />);

    fireEvent.click(screen.getByRole("button", { name: /salir/i }));
    expect(onLogout).toHaveBeenCalled();
  });
});
