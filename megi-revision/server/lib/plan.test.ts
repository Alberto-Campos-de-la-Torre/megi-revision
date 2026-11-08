/**
 * Pruebas de las reglas compartidas de la mesa.
 *
 * Son las invariantes de las que depende todo lo demás: quién puede decir que
 * es el médico, qué cuenta como identidad clínica, cómo se compara el nombre de
 * un fármaco, qué entra a la base.
 */
import { describe, expect, it } from "vitest";

import {
  exigirMedico,
  lineaInputSchema,
  lineasAAgregarSchema,
  lineasAAgregar,
  limpiaControles,
  MAX_LINEAS,
  normalizaNombre,
  origenAutorizado,
} from "./plan.js";

const ctx = (caller?: string, userEmail = "prueba@local.test") =>
  ({ caller, userEmail, orgId: null }) as never;

/**
 * Corren en modo mock (`MEGI_MODE` sin definir), donde sin lista de correos
 * autorizados cualquier cuenta tiene rol clínico. Aquí no se prueba esa lista:
 * haría falta escribir la variable de entorno `MEGI_MEDICOS`, y la guarda
 * `no-env-credentials` de `agent-native doctor` lo prohíbe en el código de la
 * app. Esa parte la cubre la auditoría del proyecto (los casos `http-vivo-*` y
 * los de `sin_rol_clinico`), que levanta el entorno de verdad.
 */

describe("origenAutorizado", () => {
  it("solo la interfaz autenticada puede actuar como médico", async () => {
    expect(await origenAutorizado("medico", ctx("frontend"))).toBe("medico");
  });

  it("nadie más puede hacerse pasar por el médico", async () => {
    for (const quién of ["tool", "mcp", "http", "a2a", "cli", undefined]) {
      await expect(
        origenAutorizado("medico", ctx(quién)),
        String(quién),
      ).rejects.toThrow(/interfaz autenticada/i);
    }
  });

  it("una llamada del agente queda registrada como agente", async () => {
    expect(await origenAutorizado("agente", ctx("tool"))).toBe("agente");
    expect(await origenAutorizado("agente", ctx("mcp"))).toBe("agente");
  });

  it("y desde la interfaz, aunque pida origen agente, es el médico quien actúa", async () => {
    expect(await origenAutorizado("agente", ctx("frontend"))).toBe("medico");
  });
});

describe("exigirMedico", () => {
  it("deja pasar a la interfaz", async () => {
    await expect(exigirMedico(ctx("frontend"))).resolves.toBeUndefined();
  });

  it("y a nadie más", async () => {
    for (const quién of ["tool", "mcp", "http", undefined]) {
      await expect(exigirMedico(ctx(quién)), String(quién)).rejects.toThrow(
        /aprobación final/i,
      );
    }
  });
});

describe("normalizaNombre", () => {
  it("iguala mayúsculas, acentos y espacios", () => {
    expect(normalizaNombre("Paracetamol")).toBe(normalizaNombre("paracetamol"));
    expect(normalizaNombre("  Ibuprofeno  ")).toBe(normalizaNombre("ibuprofeno"));
    expect(normalizaNombre("Ácido fólico")).toBe(normalizaNombre("acido folico"));
  });

  it("no confunde dos fármacos distintos", () => {
    expect(normalizaNombre("Amoxicilina")).not.toBe(
      normalizaNombre("Amoxicilina/Clavulánico"),
    );
  });
});

describe("limpiaControles", () => {
  it("quita el byte nulo que la base no admite", () => {
    expect(limpiaControles("Paracetamol\u0000 oculto")).toBe(
      "Paracetamol oculto",
    );
  });

  it("entra en los objetos y las listas de los argumentos", () => {
    const args = {
      explicacion: "a\u0001b",
      lineas: [{ tipo: "farmaco", texto: "Ibu\u0000profeno", dosis: "400 mg" }],
      cambios: [{ motivo: "x\u001Fy" }],
    };
    limpiaControles(args);
    expect(args.explicacion).toBe("ab");
    expect(args.lineas[0]?.texto).toBe("Ibuprofeno");
    expect(args.cambios[0]?.motivo).toBe("xy");
  });

  it("deja en paz los saltos de línea, los acentos y los emoji", () => {
    expect(limpiaControles("dos\nlíneas 💊")).toBe("dos\nlíneas 💊");
  });
});

describe("el contenido obligatorio de agregar-linea", () => {
  // Esto es lo que midieron dos tandas con un modelo real: con el array
  // opcional, 20 de 24 escrituras llegaron sin ninguna línea. El esquema es la
  // única señal que el modelo respetó.
  it("no admite una llamada sin líneas", () => {
    expect(lineasAAgregarSchema.safeParse(undefined).success).toBe(false);
    expect(lineasAAgregarSchema.safeParse([]).success).toBe(false);
  });

  it("no admite líneas a medias", () => {
    expect(lineasAAgregarSchema.safeParse([{ tipo: "pendiente" }]).success).toBe(false);
    expect(lineasAAgregarSchema.safeParse([{ texto: "Control" }]).success).toBe(false);
  });

  it("admite una sola línea, como array de un elemento", () => {
    const r = lineasAAgregarSchema.parse([{ tipo: "pendiente", texto: "Control en 72 h" }]);
    expect(r).toHaveLength(1);
    expect(r[0]?.dosis).toBe("");
  });

  it("corta de raíz una tanda desmedida", () => {
    const muchas = Array.from({ length: 21 }, (_, i) => ({ tipo: "pendiente", texto: `P${i}` }));
    expect(lineasAAgregarSchema.safeParse(muchas).success).toBe(false);
  });
});

describe("el esquema de una línea", () => {
  it("exige un texto con contenido", () => {
    expect(lineaInputSchema.safeParse({ tipo: "pendiente", texto: "" }).success).toBe(
      false,
    );
    expect(lineaInputSchema.safeParse({ tipo: "pendiente", texto: "   " }).success).toBe(
      false,
    );
  });

  it("solo admite los dos tipos de línea", () => {
    expect(
      lineaInputSchema.safeParse({ tipo: "receta", texto: "algo" }).success,
    ).toBe(false);
  });

  it("rellena los campos opcionales de un fármaco", () => {
    const r = lineaInputSchema.parse({ tipo: "farmaco", texto: "Paracetamol" });
    expect(r).toMatchObject({ dosis: "", frecuencia: "", duracion: "", justificacion: "" });
  });
});

describe("el techo de líneas por plan", () => {
  it("está declarado y es holgado pero finito", () => {
    expect(MAX_LINEAS).toBe(400);
  });
});

/**
 * Varias líneas en una llamada (propuesta 4).
 *
 * El caso que lo motivó, medido con un modelo real: el médico pedía dos
 * pendientes, el agente llamaba una vez por línea, gastaba la versión en la
 * primera y la segunda salía rechazada. La forma natural de la herramienta
 * tiene que hacer lo correcto.
 */
describe("lineasAAgregar", () => {
  const farmaco = { tipo: "farmaco" as const, texto: "Paracetamol", dosis: "1 g", frecuencia: "cada 8 h", duracion: "5 días", justificacion: "Dolor." };

  it("una sola línea vale en el array", () => {
    const r = lineasAAgregar({ lineas: [farmaco] });
    expect(r).toHaveLength(1);
    expect(r![0]!.texto).toBe("Paracetamol");
  });

  it("y también en los campos sueltos, que es como llaman la auditoría del proyecto y la interfaz", () => {
    expect(lineasAAgregar(farmaco)?.map((l) => l.texto)).toEqual(["Paracetamol"]);
  });

  it("`lineas` manda sobre los campos sueltos, sin mezclar", () => {
    const r = lineasAAgregar({ ...farmaco, lineas: [{ tipo: "pendiente", texto: "Solo esta" } as never] });
    expect(r?.map((l) => l.texto)).toEqual(["Solo esta"]);
  });

  it("varias líneas llegan en orden y completas", () => {
    const r = lineasAAgregar({
      lineas: [farmaco, { tipo: "pendiente", texto: "Control de TA en 7 días", dosis: "", frecuencia: "", duracion: "", justificacion: "" }],
    });
    expect(r?.map((l) => l.texto)).toEqual(["Paracetamol", "Control de TA en 7 días"]);
  });

  it("los campos opcionales de una línea se rellenan vacíos, no undefined", () => {
    // La inserción hace `.trim()` sobre dosis, frecuencia y duración: si llegan
    // sin definir, la escritura revienta con un error del motor en vez de un
    // código del producto.
    const r = lineasAAgregar({ lineas: [{ tipo: "pendiente", texto: "Radiografía" } as never] });
    expect(r![0]).toMatchObject({ dosis: "", frecuencia: "", duracion: "", justificacion: "" });
  });

  it("una línea sin texto invalida la llamada entera", () => {
    // Nada a medias: o entran todas o responde `invalid_input`. Un plan con la
    // mitad de lo pedido y un recibo que dice otra cosa es peor que un fallo.
    expect(lineasAAgregar({ lineas: [farmaco, { tipo: "pendiente", texto: "   " } as never] })).toBeNull();
  });

  it("sin líneas no hay nada que añadir", () => {
    // Medido con un modelo real: llamó dos veces con solo planId, versión y
    // origen, y se comió el turno. La acción responde `invalid_input` con el
    // JSON que tenía que mandar, en vez de insertar una línea vacía.
    expect(lineasAAgregar({})).toBeNull();
    expect(lineasAAgregar({ lineas: [] })).toBeNull();
    expect(lineasAAgregar({ tipo: "farmaco" })).toBeNull();
  });
});
