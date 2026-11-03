import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useScrollMemoria } from "../lib/scroll_memoria";

// Pantalla nueva: arriba. Regreso: donde estaba. La posición se recuerda por
// pantalla y se toma del scroll real (no de la salida, cuando ya se recortó).

const setScrollY = (y) => { Object.defineProperty(window, "scrollY", { value: y, configurable: true }); window.dispatchEvent(new Event("scroll")); };

describe("memoria de desplazamiento", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = (cb) => { cb(); return 1; };
    window.cancelAnimationFrame = () => {};
    setScrollY(0);
  });

  it("una pantalla nueva empieza arriba y al volver se restaura la posición", () => {
    const regresoRef = { current: false };
    const { rerender } = renderHook(({ clave }) => useScrollMemoria(clave, regresoRef), { initialProps: { clave: "pacientes" } });
    act(() => { setScrollY(900); });                           // el médico baja hasta el fondo del expediente
    rerender({ clave: "revision" });                             // «Revisar nota»: pantalla nueva
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
    act(() => { setScrollY(300); });
    regresoRef.current = true;                                   // «← Expediente»
    rerender({ clave: "pacientes" });
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 900);
    act(() => { vi.advanceTimersByTime(500); });                 // reintentos cuando el contenido llega tarde
    expect(window.scrollTo.mock.calls.filter((c) => c[1] === 900).length).toBeGreaterThanOrEqual(3);
    expect(regresoRef.current).toBe(false);                      // la marca se consume
  });

  it("sin marca de regreso, volver a una pantalla ya visitada también empieza arriba", () => {
    const regresoRef = { current: false };
    const { rerender } = renderHook(({ clave }) => useScrollMemoria(clave, regresoRef), { initialProps: { clave: "dashboard" } });
    act(() => { setScrollY(400); });
    rerender({ clave: "consulta" });
    rerender({ clave: "dashboard" });                            // abierta de nuevo desde el menú, no «atrás»
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
  });
});
