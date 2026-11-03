import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "../components/error_boundary";

function Boom() {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  it("muestra un fallback en vez de propagar el crash (no deja la app en blanco)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {}); // silencia el error esperado
    render(
      <ErrorBoundary onReset={() => {}}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Algo salió mal/)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
    spy.mockRestore();
  });
});
