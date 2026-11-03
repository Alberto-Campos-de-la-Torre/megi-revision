import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBrowserHistory } from "../lib/nav_history";
import { setLeaveGuard, clearLeaveGuard, confirmLeave } from "../lib/leave_guard";

// Componente mínimo que se comporta como App: la vista es estado y el hook la
// enlaza al historial.
const App = ({ inicial = { view: "dashboard", patientId: null, overlay: null } }) => {
  const [st, setSt] = React.useState(inicial);
  useBrowserHistory(st, (destino) => setSt({
    view: destino.view, patientId: destino.patientId, overlay: destino.overlay,
  }));
  App.ir = (nuevo) => act(() => setSt((v) => ({ ...v, ...nuevo })));
  return <div data-testid="vista">{st.overlay || st.view}:{st.patientId || "-"}</div>;
};

// jsdom no dispara popstate al hacer history.back(): se simula leyendo la
// entrada anterior y emitiendo el evento, que es lo que hace el navegador.
const atras = (state) => act(() => {
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
});

describe("navegación con el historial del navegador", () => {
  beforeEach(() => { window.history.replaceState(null, ""); clearLeaveGuard(); });

  it("sella la entrada de arranque sin crear una nueva", () => {
    render(<App />);
    expect(window.history.state.megi).toEqual({ view: "dashboard", patientId: null, overlay: null });
  });

  it("cada pantalla nueva queda registrada en el historial", () => {
    render(<App />);
    App.ir({ view: "consulta", patientId: "P-1" });
    expect(window.history.state.megi).toEqual({ view: "consulta", patientId: "P-1", overlay: null });
  });

  it("volver atrás restaura vista Y paciente", () => {
    const { getByTestId } = render(<App />);
    App.ir({ view: "consulta", patientId: "P-1" });
    App.ir({ view: "revision", patientId: "P-1" });
    expect(getByTestId("vista").textContent).toBe("revision:P-1");

    atras({ megi: { view: "consulta", patientId: "P-1", overlay: null } });
    expect(getByTestId("vista").textContent).toBe("consulta:P-1");
  });

  it("volver atrás NO añade una entrada nueva (o el atrás no avanzaría)", () => {
    // Es la prueba que protege el fallo clásico: si el hook empujara al
    // atender el popstate, el historial crecería y el usuario quedaría
    // atrapado pulsando atrás sin avanzar nunca.
    // (En jsdom el popstate simulado no mueve el puntero, así que `history.state`
    // no cambia solo: lo observable es que no crece y que la vista sí vuelve.)
    const { getByTestId } = render(<App />);
    App.ir({ view: "consulta", patientId: "P-1" });
    const antes = window.history.length;
    atras({ megi: { view: "dashboard", patientId: null, overlay: null } });
    expect(window.history.length).toBe(antes);
    expect(getByTestId("vista").textContent).toBe("dashboard:-");
  });

  it("tras volver atrás, navegar de nuevo sí registra", () => {
    render(<App />);
    App.ir({ view: "consulta", patientId: "P-1" });
    atras({ megi: { view: "dashboard", patientId: null, overlay: null } });
    App.ir({ view: "pacientes", patientId: null });
    expect(window.history.state.megi.view).toBe("pacientes");
  });

  it("el overlay de perfil también se cierra con el atrás", () => {
    const { getByTestId } = render(<App />);
    App.ir({ overlay: "perfil" });
    expect(getByTestId("vista").textContent).toBe("perfil:-");
    atras({ megi: { view: "dashboard", patientId: null, overlay: null } });
    expect(getByTestId("vista").textContent).toBe("dashboard:-");
  });

  it("ignora entradas del historial ajenas a MEGI", () => {
    const { getByTestId } = render(<App />);
    App.ir({ view: "guias" });
    atras(null);                      // lo que hubiera antes de abrir MEGI
    expect(getByTestId("vista").textContent).toBe("guias:-");
  });
});

describe("guardia de salida (grabación en curso)", () => {
  beforeEach(() => { window.history.replaceState(null, ""); clearLeaveGuard(); });

  it("sin guardia no pregunta nada", () => {
    window.confirm = vi.fn(() => false);
    expect(confirmLeave()).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("el mismo aviso sirve al botón y al navegador", () => {
    window.confirm = vi.fn(() => true);
    setLeaveGuard(() => "¿Salir?");
    expect(confirmLeave()).toBe(true);
    expect(window.confirm).toHaveBeenCalledWith("¿Salir?");
  });

  it("retirar la guardia deja salir sin preguntar", () => {
    window.confirm = vi.fn(() => false);
    const quitar = setLeaveGuard(() => "¿Salir?");
    quitar();
    expect(confirmLeave()).toBe(true);
  });

  it("cancelar el atrás del navegador deja la pantalla donde estaba", () => {
    window.confirm = vi.fn(() => false);
    const { getByTestId } = render(<App />);
    App.ir({ view: "consulta", patientId: "P-1" });
    setLeaveGuard(() => "Hay una grabación en curso.");

    atras({ megi: { view: "dashboard", patientId: null, overlay: null } });

    expect(window.confirm).toHaveBeenCalled();
    expect(getByTestId("vista").textContent).toBe("consulta:P-1");
    // Y la entrada abandonada se repone: sin esto el siguiente "atrás"
    // saltaría dos pantallas de golpe.
    expect(window.history.state.megi).toEqual({ view: "consulta", patientId: "P-1", overlay: null });
  });

  it("confirmar el atrás sí sale", () => {
    window.confirm = vi.fn(() => true);
    const { getByTestId } = render(<App />);
    App.ir({ view: "consulta", patientId: "P-1" });
    setLeaveGuard(() => "Hay una grabación en curso.");

    atras({ megi: { view: "dashboard", patientId: null, overlay: null } });

    expect(getByTestId("vista").textContent).toBe("dashboard:-");
  });
});
