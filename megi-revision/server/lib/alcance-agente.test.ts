/**
 * Pruebas del alcance del agente.
 *
 * El catálogo de este caso no es inventado: son las veinte herramientas que
 * viajaron de verdad al proveedor, medidas en la petición real con el motor
 * falso de `pruebas-hackathon/fase2/`, más una muestra de las acciones de la
 * plantilla y de las que son del médico.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCIONES_DE_LA_MESA,
  AYUDAS_DEL_FRAMEWORK,
  FUERA_DE_LA_MESA,
  alcanceDelAgente,
} from "./alcance-agente.js";

/** El catálogo medido el 8-nov en la petición al proveedor. */
const CATALOGO_MEDIDO = [
  "suggest-follow-ups", "obtener-plan", "proponer-plan", "reajustar-plan", "sugerir-reemplazo",
  "ver-contexto-consulta", "view-screen", "resources", "framework-search", "docs-search",
  "get-framework-context", "ask-question", "call-agent", "describe-workspace-apps",
  "web-request", "web-search", "read-attachment", "connect-file-storage", "connect-builder",
  "tool-search",
];
/** Y lo que `tool-search` alcanzaba además, en muestra. */
const MAS_DEL_REGISTRO = [
  "listar-consultas", "historial-plan", "metricas-revision", "agregar-linea", "actualizar-linea",
  "aprobar-plan", "conciliar-medicacion", "definir-alcance", "resolver-sugerencia",
  "medir-revision", "preparar-aprobacion", "restaurar-demo", "navigate", "run",
  // plantilla
  "create-todo", "list-todos", "send-email", "create-chart", "upload-file",
];
const DISPONIBLES = [...CATALOGO_MEDIDO, ...MAS_DEL_REGISTRO];

describe("alcanceDelAgente", () => {
  const alcance = alcanceDelAgente(DISPONIBLES);

  it("la salida a internet se cierra", () => {
    expect(alcance.permitidas).not.toContain("web-request");
    expect(alcance.permitidas).not.toContain("web-search");
  });

  it("todo lo que sale de la mesa se cierra, con su motivo escrito", () => {
    for (const nombre of Object.keys(FUERA_DE_LA_MESA)) {
      expect(alcance.permitidas).not.toContain(nombre);
      expect(FUERA_DE_LA_MESA[nombre]!.length).toBeGreaterThan(10);
    }
  });

  it("las acciones de la plantilla no llegan al modelo", () => {
    for (const nombre of ["create-todo", "send-email", "create-chart", "upload-file"]) {
      expect(alcance.permitidas).not.toContain(nombre);
    }
  });

  it("el trabajo de la mesa sigue siendo posible", () => {
    for (const nombre of ACCIONES_DE_LA_MESA) expect(alcance.permitidas).toContain(nombre);
  });

  it("las ayudas que solo leen o preguntan siguen pasando", () => {
    for (const nombre of ["docs-search", "ask-question", "view-screen", "tool-search"]) {
      expect(alcance.permitidas).toContain(nombre);
    }
  });

  it("`tool-search` pasa, y al filtrar busca solo dentro de lo permitido", () => {
    // El framework reconstruye la entrada de `tool-search` sobre el mapa ya
    // filtrado, así que dejarla no devuelve el resto del registro.
    expect(alcance.permitidas).toContain("tool-search");
    expect(alcance.permitidas.length).toBeLessThan(DISPONIBLES.length);
  });

  it("un permitido que el registro no ofrece no tira el chat", () => {
    // El framework LANZA si se le devuelve un nombre que no existe. Un
    // renombrado en el producto debe salir por `ausentes`, no por una
    // excepción que deje la mesa sin chat.
    const sinUna = alcanceDelAgente(DISPONIBLES.filter((n) => n !== "historial-plan"));
    expect(sinUna.ausentes).toEqual(["historial-plan"]);
    expect(sinUna.permitidas).not.toContain("historial-plan");
  });

  it("con el catálogo medido, se cierran las siete de fuera", () => {
    const soloElCatalogo = alcanceDelAgente(CATALOGO_MEDIDO);
    expect(soloElCatalogo.cerradasAproposito.sort()).toEqual([
      "call-agent", "connect-builder", "connect-file-storage", "describe-workspace-apps",
      "read-attachment", "web-request", "web-search",
    ]);
  });

  it("toda acción del producto está clasificada: o es de la mesa, o está fuera con motivo", () => {
    // Si alguien añade una acción y no decide nada, esta prueba falla. Es el
    // punto de la lista de permitidos: lo nuevo no entra por descuido.
    const sinClasificar = readdirSync(join(import.meta.dirname, "../../actions"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .filter((n) => n !== "run") // el guion de `agent-native script`, no una acción
      .filter((n) => !ACCIONES_DE_LA_MESA.includes(n as (typeof ACCIONES_DE_LA_MESA)[number]))
      .filter((n) => !(n in FUERA_DE_LA_MESA))
      // Las de la interfaz ya salen por `agentTool: false`; se nombran aquí
      // para que la lista de arriba no tenga que repetirlas.
      .filter((n) => !["medir-revision", "preparar-aprobacion", "restaurar-demo"].includes(n));
    expect(sinClasificar).toEqual([]);
  });

  it("ninguna ayuda del framework se cuela dos veces", () => {
    const todas = [...ACCIONES_DE_LA_MESA, ...AYUDAS_DEL_FRAMEWORK];
    expect(new Set(todas).size).toBe(todas.length);
  });
});
