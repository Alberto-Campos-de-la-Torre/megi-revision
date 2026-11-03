import { useEffect, useRef } from "react";

/**
 * Memoria de desplazamiento por pantalla.
 *
 * Abrir una pantalla nueva (un botón, una sección, «Revisar nota»…) empieza
 * arriba; VOLVER a una pantalla (atrás del navegador, «← Agenda», «← Expediente»)
 * la deja donde el médico la dejó. Antes, «Revisar nota» abría la nota al
 * fondo porque la pantalla anterior estaba desplazada hasta abajo.
 *
 * La posición se guarda en cada scroll (no al salir: al cambiar de pantalla el
 * documento ya se acortó y el navegador la habría recortado). El contenido de
 * la pantalla a la que se vuelve llega asíncrono, así que la restauración se
 * reintenta un par de veces hasta que la página mide lo suficiente.
 *
 * @param {string} clave      identificador de la pantalla visible
 * @param {{current: boolean}} regresoRef  `true` cuando el cambio es un regreso
 */
export function useScrollMemoria(clave, regresoRef) {
  const posiciones = useRef({});
  const claveRef = useRef(clave);
  claveRef.current = clave;

  useEffect(() => {
    let raf = 0;
    const alScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        posiciones.current[claveRef.current] = window.scrollY || 0;
      });
    };
    window.addEventListener("scroll", alScroll, { passive: true });
    return () => { window.removeEventListener("scroll", alScroll); if (raf) window.cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    const esRegreso = !!(regresoRef && regresoRef.current);
    if (regresoRef) regresoRef.current = false;
    const guardada = posiciones.current[clave];
    const destino = esRegreso && guardada > 0 ? guardada : 0;
    const ir = () => { try { window.scrollTo(0, destino); } catch (e) { /* entorno sin scroll */ } };
    ir();
    if (destino === 0) return undefined;
    const t1 = setTimeout(ir, 120);
    const t2 = setTimeout(ir, 400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [clave]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default useScrollMemoria;
