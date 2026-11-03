import React from "react";

// ============ MEGI VOZ — PREFERENCIAS (Fase 5) ============
// "Modo experto": desactiva la palabra de activación "MEGI". Por defecto OFF
// (seguro). Persistente y reactivo entre componentes (barra global + editor de
// Revisión) vía un evento propio.

const KEY = "megi.voice.expert";
const EVT = "megi:voice-expert";

export function isExpertMode() {
  try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
}

export function setExpertMode(on) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* noop */ }
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: !!on })); } catch (e) { /* noop */ }
}

// Hook reactivo: [expert, setExpert]. Se sincroniza entre pestañas y componentes.
export function useExpertMode() {
  const [on, setOn] = React.useState(isExpertMode);
  React.useEffect(() => {
    const h = () => setOn(isExpertMode());
    window.addEventListener(EVT, h);
    window.addEventListener("storage", h);
    return () => { window.removeEventListener(EVT, h); window.removeEventListener("storage", h); };
  }, []);
  return [on, setExpertMode];
}

// ============ MANOS LIBRES GLOBAL (Fase 8.1) ============
// Micrófono siempre activo escuchando "MEGI, ...". ENCENDIDO por defecto
// (decisión de producto); persistente y con interruptor visible en el 🎙.
const HF_KEY = "megi.voice.handsfree";
const HF_EVT = "megi:voice-handsfree";

export function isHandsFreeOn() {
  try { return localStorage.getItem(HF_KEY) !== "0"; } catch (e) { return true; }
}

export function setHandsFreeOn(on) {
  try { localStorage.setItem(HF_KEY, on ? "1" : "0"); } catch (e) { /* noop */ }
  try { window.dispatchEvent(new CustomEvent(HF_EVT, { detail: !!on })); } catch (e) { /* noop */ }
}

export function useHandsFreePref() {
  const [on, setOn] = React.useState(isHandsFreeOn);
  React.useEffect(() => {
    // El CustomEvent lleva el valor: no depende de releer storage (que puede
    // no estar disponible); el evento "storage" entre pestañas sí relee.
    const h = (e) => setOn(e && e.detail !== undefined ? !!e.detail : isHandsFreeOn());
    window.addEventListener(HF_EVT, h);
    window.addEventListener("storage", h);
    return () => { window.removeEventListener(HF_EVT, h); window.removeEventListener("storage", h); };
  }, []);
  return [on, setHandsFreeOn];
}
