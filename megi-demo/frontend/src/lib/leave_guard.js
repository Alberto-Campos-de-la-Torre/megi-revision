// ============ GUARDIA DE SALIDA ============
// Un solo sitio decide si se puede abandonar la pantalla actual, para que el
// botón "← Agenda" y la flecha de regreso del navegador digan EXACTAMENTE lo
// mismo. Antes ninguno de los dos avisaba: salir con la grabación en curso se
// llevaba por delante el audio sin preguntar.
//
// La pantalla que tiene algo que perder registra su guardia; la función devuelve
// el aviso a mostrar, o null si no hay nada que advertir.

let guardia = null;

/** Registra la guardia y devuelve la función para retirarla (útil en cleanup). */
export function setLeaveGuard(fn) {
  guardia = fn;
  return () => { if (guardia === fn) guardia = null; };
}

export function clearLeaveGuard() {
  guardia = null;
}

/**
 * ¿Se puede salir? Síncrono a propósito: cuando nos enteramos de un `popstate`
 * el navegador YA retrocedió, así que hay que decidir en el acto si se repone
 * la entrada. Un modal propio (asíncrono) obligaría a rehacer la navegación.
 */
export function confirmLeave() {
  const aviso = guardia ? guardia() : null;
  if (!aviso) return true;
  return window.confirm(aviso);
}

export default confirmLeave;
