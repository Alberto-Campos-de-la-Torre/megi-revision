// ============ NAVEGACIÓN: la vista de MEGI vive en el historial ============
// La app no usa router: la pantalla activa es estado de React (`view` en App.jsx)
// con persistencia en localStorage. Sin esto, la flecha de regreso del navegador
// abandonaba MEGI en vez de volver a la pantalla anterior.
//
// Lo que se registra en el historial es el estado COMPLETO de navegación, no
// solo la vista: volver de "Revisión" a "Consulta" sin el paciente deja una
// pantalla rota. Por eso viajan juntos vista + paciente + overlay.
//
// Salir de una consulta con la grabación en curso pide confirmación, la misma
// que el botón "← Agenda": ambos consultan la guardia de `leave_guard.js`.

import { useEffect, useRef } from "react";
import { confirmLeave } from "./leave_guard";

const MARK = "megi";

const claveDe = (s) => `${s.overlay || ""}|${s.view || ""}|${s.patientId || ""}`;

const marcar = (s) => ({
  [MARK]: { view: s.view || null, patientId: s.patientId || null, overlay: s.overlay || null },
});

/**
 * Sincroniza el estado de navegación con el historial del navegador.
 *
 * @param {object}   estado          {view, patientId, overlay} — lo que se ve ahora.
 * @param {function} onPop           recibe el estado al que hay que volver.
 */
export function useBrowserHistory(estado, onPop) {
  const clave = claveDe(estado);
  const ultima = useRef(null);
  const destinoPop = useRef(null);
  const estadoRef = useRef(estado);
  const onPopRef = useRef(onPop);
  estadoRef.current = estado;
  onPopRef.current = onPop;

  // Sella la entrada actual: al abrir MEGI no se crea una entrada nueva, se
  // marca la que ya existe. Así el primer "atrás" sale del sitio, como debe.
  useEffect(() => {
    ultima.current = claveDe(estadoRef.current);
    window.history.replaceState(marcar(estadoRef.current), "");
  }, []);

  // Cada cambio de pantalla añade una entrada... salvo que el cambio VENGA del
  // historial, en cuyo caso el navegador ya está en el punto correcto.
  useEffect(() => {
    if (ultima.current === null) return;      // aún no se ha sellado el arranque
    if (ultima.current === clave) return;     // nada cambió
    const veniaDelPop = destinoPop.current === clave;
    destinoPop.current = null;
    ultima.current = clave;
    if (veniaDelPop) return;
    window.history.pushState(marcar(estadoRef.current), "");
  }, [clave]);

  useEffect(() => {
    const alVolver = (e) => {
      const st = e.state && e.state[MARK];
      // Entrada ajena (lo que hubiera antes de MEGI): el navegador se encarga.
      if (!st) return;
      if (!confirmLeave()) {
        // El médico decide quedarse, pero el navegador ya retrocedió: hay que
        // reponer la entrada que se acababa de abandonar, o el siguiente
        // "atrás" saltaría dos pantallas.
        window.history.pushState(marcar(estadoRef.current), "");
        return;
      }
      destinoPop.current = claveDe(st);
      onPopRef.current(st);
    };
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, []);
}

export default useBrowserHistory;
