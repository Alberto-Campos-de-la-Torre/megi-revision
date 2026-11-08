/**
 * Hasta dónde llega el agente de la mesa de revisión.
 *
 * El problema, medido y no deducido
 * ---------------------------------
 * El producto declara ocho herramientas iniciales, pero el catálogo que de
 * verdad viaja al modelo trae veinte: las del framework se añaden solas, y
 * `tool-search` alcanza además el resto del registro —incluidas las noventa y
 * una acciones de la plantilla con la que se andamió la aplicación—. Medido
 * sobre la petición real en `pruebas-hackathon/fase2/interfaz-y-modelo.mts`,
 * entre esas veinte había `web-request` y `web-search`.
 *
 * Eso es una salida a internet en una mesa con el expediente delante. Nadie
 * tiene que usarla mal para que importe: basta con que exista para que la
 * pregunta «¿puede este agente mandar el expediente a cualquier URL?» tenga
 * como respuesta «sí, si se le ocurre».
 *
 * La línea que se traza
 * --------------------
 * Lista de permitidos, no de prohibidos: lo que no esté aquí no llega al
 * modelo, y una herramienta nueva del framework tendrá que pasar por esta
 * decisión antes de entrar. La línea es **nada que salga de la mesa**:
 *
 *   · las acciones de la mesa que el agente usa (leer la consulta, el plan y
 *     su historial, proponer, reajustar, añadir y actualizar líneas, sugerir
 *     reemplazos y leer la pantalla);
 *   · las ayudas del framework que solo leen o preguntan: la documentación de
 *     la habilidad, la pantalla, la pregunta al médico, las sugerencias de
 *     continuación y la búsqueda de herramientas, que al filtrar queda
 *     buscando solo dentro de esta misma lista.
 *
 * Fuera quedan, por este orden de importancia: la salida a internet
 * (`web-request`, `web-search`), la llamada a otros agentes y a otras
 * aplicaciones del espacio (`call-agent`, `describe-workspace-apps`), las
 * conexiones a almacenamiento y a Builder (`connect-file-storage`,
 * `connect-builder`), la lectura de adjuntos (`read-attachment`), las acciones
 * de la plantilla, `navigate` —el propio prompt ya le pide que no navegue— y
 * las acciones que son del médico (`aprobar-plan`, `conciliar-medicacion`,
 * `definir-alcance`, `resolver-sugerencia` y las de la interfaz), que el
 * framework ya excluye por `agentTool: false` y que aquí quedan con dos
 * cerraduras en vez de una.
 *
 * Lo que esto NO arregla: el agente sigue viendo expedientes, porque su
 * trabajo es eso. Lo que cambia es que ya no tiene por dónde sacarlos.
 */

/** Las acciones de la mesa que el agente necesita para trabajar. */
export const ACCIONES_DE_LA_MESA = [
  "listar-consultas",
  "ver-contexto-consulta",
  "obtener-plan",
  "historial-plan",
  "metricas-revision",
  "proponer-plan",
  "reajustar-plan",
  "agregar-linea",
  "actualizar-linea",
  "sugerir-reemplazo",
  "view-screen",
] as const;

/**
 * Las ayudas del framework que se dejan pasar: todas leen, preguntan o
 * sugieren, y ninguna saca nada de la mesa. Son las que el registro ofrece de
 * verdad en 0.222.2, medidas en la petición al proveedor; una versión que
 * añada otra tendrá que pasar por aquí, que es el objetivo.
 */
export const AYUDAS_DEL_FRAMEWORK = [
  "docs-search",
  "ask-question",
  "suggest-follow-ups",
  "tool-search",
  "resources",
  "framework-search",
  "get-framework-context",
] as const;

/**
 * Las que quedan fuera a propósito y por qué. No hace falta para filtrar —la
 * lista de permitidos ya las excluye—, pero sirve para que una prueba pueda
 * afirmar que siguen fuera y para que el informe diga qué se cerró.
 */
export const FUERA_DE_LA_MESA: Record<string, string> = {
  "web-request": "salida a internet desde una mesa con expedientes",
  "web-search": "salida a internet desde una mesa con expedientes",
  "call-agent": "amplía el trabajo a otros agentes que el médico no ve",
  "describe-workspace-apps": "mira otras aplicaciones del espacio",
  "connect-file-storage": "conecta almacenamiento externo",
  "connect-builder": "conecta la cuenta de Builder",
  "read-attachment": "lee adjuntos ajenos a la consulta",
  navigate: "el prompt ya le pide que no navegue ni abra otras pantallas",
  "aprobar-plan": "la aprobación es del médico",
  "conciliar-medicacion": "la conciliación la confirma el médico",
  "definir-alcance": "el alcance lo fija el médico",
  "resolver-sugerencia": "la sugerencia la resuelve el médico",
};

export type Alcance = {
  /** Lo que llega al modelo: los permitidos que además existen. */
  permitidas: string[];
  /** Permitidos que el registro no ofrece: un nombre viejo o mal escrito. */
  ausentes: string[];
  /** Cuántas quedaron fuera, y las que estaban en la lista de cerradas. */
  denegadas: number;
  cerradasAproposito: string[];
};

/**
 * Cruza la lista de permitidos con lo que el registro ofrece de verdad.
 *
 * El cruce no es cosmético: el framework **lanza** si se le devuelve un nombre
 * que no existe, así que un renombrado en el producto tiraría el chat entero.
 * Con el cruce, ese nombre aparece en `ausentes` y el turno sigue.
 */
export function alcanceDelAgente(disponibles: readonly string[]): Alcance {
  const hay = new Set(disponibles);
  const queremos = [...ACCIONES_DE_LA_MESA, ...AYUDAS_DEL_FRAMEWORK];
  const permitidas = queremos.filter((n) => hay.has(n));
  const ausentes = queremos.filter((n) => !hay.has(n));
  const dejadas = new Set<string>(permitidas);
  return {
    permitidas,
    ausentes,
    denegadas: disponibles.filter((n) => !dejadas.has(n)).length,
    cerradasAproposito: Object.keys(FUERA_DE_LA_MESA).filter((n) => hay.has(n)),
  };
}
