import React from "react";

/**
 * Sugerencias de interrogatorio durante la consulta.
 *
 * Es APOYO, no una alerta: nada de esto bloquea, suena ni pide respuesta. Las
 * alertas de verdad (receta × alergia) siguen donde estaban, en el gate de
 * aprobación. Por eso aquí no se usa rojo ni el estilo de peligro: si esto
 * gritara igual que una alerta real, la que importa dejaría de distinguirse.
 *
 * Reglas de "ignorable con la vista":
 *   - esquina inferior derecha, fuera del SOAP y de los controles de grabación;
 *   - una a la vez y con pausa entre avisos, aunque el backend mande varias;
 *   - atenuada en reposo, nítida solo si el médico la mira (hover/focus);
 *   - aparece y se va con un fundido lento — sin rebote, sin sonido, sin foco;
 *   - `pointer-events` solo en la tarjeta: nunca intercepta un clic de la app;
 *   - `aria-live="polite"`: un lector de pantalla la dice al terminar la frase
 *     en curso, no la interrumpe;
 *   - respeta `prefers-reduced-motion`.
 */

const VISIBLE_MS = 13000;   // cuánto se queda antes de irse sola
const ENTRE_AVISOS_MS = 7000;  // pausa mínima entre uno y el siguiente
const FUNDIDO_MS = 600;

const ConsultaHints = ({ gaps }) => {
  const [actual, setActual] = React.useState(null);
  const [visible, setVisible] = React.useState(false);
  const pendientes = React.useRef([]);
  const atendidos = React.useRef(new Set());   // mostrados o descartados: no vuelven
  const libreEn = React.useRef(0);
  const timers = React.useRef([]);

  const limpiarTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // Encola lo que llega, sin repetir lo ya visto.
  React.useEffect(() => {
    if (!Array.isArray(gaps) || !gaps.length) return;
    const nuevos = gaps.filter(
      (g) => g?.id && !atendidos.current.has(g.id) &&
             !pendientes.current.some((p) => p.id === g.id),
    );
    if (nuevos.length) pendientes.current.push(...nuevos);
  }, [gaps]);

  // Un hueco que el backend deja de reportar es un hueco que el médico ya cubrió:
  // se retira de la cola aunque nunca se llegara a enseñar.
  React.useEffect(() => {
    if (!Array.isArray(gaps)) return;
    const vigentes = new Set(gaps.map((g) => g?.id));
    pendientes.current = pendientes.current.filter((p) => vigentes.has(p.id));
  }, [gaps]);

  // Saca el siguiente cuando toca; no hay nada que hacer si la cola está vacía.
  React.useEffect(() => {
    const tick = setInterval(() => {
      if (actual || !pendientes.current.length || Date.now() < libreEn.current) return;
      const siguiente = pendientes.current.shift();
      atendidos.current.add(siguiente.id);
      setActual(siguiente);
      setVisible(false);
      timers.current.push(setTimeout(() => setVisible(true), 30));
      timers.current.push(setTimeout(() => setVisible(false), VISIBLE_MS));
      timers.current.push(setTimeout(() => {
        setActual(null);
        libreEn.current = Date.now() + ENTRE_AVISOS_MS;
      }, VISIBLE_MS + FUNDIDO_MS));
    }, 500);
    return () => clearInterval(tick);
  }, [actual]);

  React.useEffect(() => limpiarTimers, []);

  const descartar = () => {
    limpiarTimers();
    setVisible(false);
    timers.current.push(setTimeout(() => {
      setActual(null);
      libreEn.current = Date.now() + ENTRE_AVISOS_MS;
    }, FUNDIDO_MS));
  };

  if (!actual) return null;

  return (
    <div className="hint-wrap no-print" aria-live="polite">
      <div className={"hint-card" + (visible ? " on" : "")}>
        <div className="hint-eyebrow">Sugerencia · puede ignorarse</div>
        <div className="hint-texto">{actual.texto}</div>
        {actual.razon && <div className="hint-razon">{actual.razon}</div>}
        <button type="button" className="hint-x" onClick={descartar}
                aria-label="Descartar sugerencia">×</button>
      </div>
    </div>
  );
};

export default ConsultaHints;
