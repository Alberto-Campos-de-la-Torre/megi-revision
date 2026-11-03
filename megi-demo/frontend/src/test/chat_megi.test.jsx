import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ChatMegi from "../components/chat_megi";

describe("chat con Megi IA", () => {
  it("manda la pregunta con el historial y etiqueta la fuente", async () => {
    const preguntar = vi.fn()
      .mockResolvedValueOnce({ respuesta: "Cardiomegalia 27 % [E1]", fuente: "mock" })
      .mockResolvedValueOnce({ respuesta: "No encuentro eso.", fuente: "llm" });
    render(<ChatMegi titulo="Pregúntale a Megi IA sobre estos estudios" placeholder="Pregunta…" preguntar={preguntar} resetKey="C-1" />);
    const input = screen.getByLabelText("Pregunta…");
    fireEvent.change(input, { target: { value: "¿qué vio?" } });
    fireEvent.submit(input.closest("form"));
    expect(await screen.findByText("Cardiomegalia 27 % [E1]")).toBeInTheDocument();
    expect(screen.getByText(/simulado · sin modelo/)).toBeInTheDocument();
    expect(preguntar).toHaveBeenCalledWith("¿qué vio?", []);
    fireEvent.change(input, { target: { value: "¿y columna?" } });
    fireEvent.submit(input.closest("form"));
    await screen.findByText("No encuentro eso.");
    expect(preguntar.mock.calls[1][1]).toEqual([{ rol: "medico", texto: "¿qué vio?" }, { rol: "megi", texto: "Cardiomegalia 27 % [E1]" }]);
  });

  it("al cambiar de consulta vacía la conversación", async () => {
    const preguntar = vi.fn().mockResolvedValue({ respuesta: "ok", fuente: "mock" });
    const { rerender } = render(<ChatMegi titulo="t" placeholder="p" preguntar={preguntar} resetKey="C-1" />);
    const input = screen.getByLabelText("p");
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.submit(input.closest("form"));
    await screen.findByText("ok");
    rerender(<ChatMegi titulo="t" placeholder="p" preguntar={preguntar} resetKey="C-2" />);
    await waitFor(() => expect(screen.queryByText("ok")).not.toBeInTheDocument());
  });
});
