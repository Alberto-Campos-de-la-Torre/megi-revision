/**
 * Pruebas del adaptador http: lo que ya nos mordió una vez.
 *
 * Cada caso de aquí nació de un hallazgo real de las revisiones: el id que se
 * salía de su ruta, la alerta atribuida por coincidencia de cadena, el 200 que
 * no traía JSON, la edad que no era un número. Son las que impiden que vuelvan.
 */
import { describe, expect, it } from "vitest";

import { aLogico, aReal, idSeguro, MegiHttp } from "./megi-http.js";
import { MegiError } from "./types.js";

/** Transporte de mentira: contesta lo que se le diga y apunta las rutas. */
function transporte(
  responde: (path: string, init: RequestInit | undefined) => Response,
) {
  const rutas: string[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/auth/login")) {
      return new Response(
        JSON.stringify({ token: "tok", name: "Dra. Demo Ficticia" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // La lectura por lotes del historial es opcional en MEGI: un 404 «not found»
    // hace que el adaptador caiga al camino por paciente, que es el que se mide
    // aquí. Sin esto, cada prueba tendría que simular la paginación entera.
    if (path.endsWith("/review/medication-history")) {
      return new Response(JSON.stringify({ detail: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    rutas.push(path);
    return responde(path, init);
  }) as unknown as typeof fetch;
  return { rutas, fetchImpl };
}
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json" },
  });
const nuevo = (fetchImpl: typeof fetch, timeoutMs?: number) =>
  new MegiHttp({
    url: "http://megi.invalido",
    user: "usuario",
    password: "secreto-de-prueba",
    fetchImpl,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });

describe("idSeguro", () => {
  it("acepta los ids que usa MEGI", () => {
    expect(idSeguro("C-DEMO1")).toBe("C-DEMO1");
    expect(idSeguro("P-DEMO2")).toBe("P-DEMO2");
    expect(idSeguro("abc.def_ghi-123")).toBe("abc.def_ghi-123");
  });

  it("rechaza lo que intenta salirse de su segmento de ruta", () => {
    for (const malo of [
      "../../export/consultation/C-DEMO1",
      "C-DEMO1/../../patients",
      "a/b",
      "..",
      "",
      "-empieza-con-guion",
      "x".repeat(65),
      "con espacio",
      "null%00",
    ]) {
      expect(() => idSeguro(malo), malo).toThrow(MegiError);
    }
  });

  it("dice qué id rechazó, sin inventarse otro", () => {
    try {
      idSeguro("a/b", "id de consulta");
      throw new Error("debería haber fallado");
    } catch (e) {
      expect(e).toBeInstanceOf(MegiError);
      expect((e as MegiError).status).toBe(400);
      expect((e as MegiError).message).toContain("id de consulta");
      expect((e as MegiError).message).toContain("a/b");
    }
  });
});

describe("ids lógicos y reales", () => {
  it("van y vuelven", () => {
    expect(aReal("demo-c1")).toBe("C-DEMO1");
    expect(aLogico("C-DEMO1")).toBe("demo-c1");
    expect(aLogico(aReal("demo-p3"))).toBe("demo-p3");
  });
});

describe("el transporte no se cree lo que le llega", () => {
  it("un 200 que no es JSON no pasa por éxito", async () => {
    const { fetchImpl } = transporte(
      () =>
        new Response("<html>502 Bad Gateway</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(nuevo(fetchImpl).verConsulta("demo-c1")).rejects.toThrow(
      MegiError,
    );
  });

  it("un 200 con el cuerpo vacío tampoco", async () => {
    const { fetchImpl } = transporte(() => new Response("", { status: 200 }));
    await expect(nuevo(fetchImpl).verConsulta("demo-c1")).rejects.toThrow(
      MegiError,
    );
  });

  it("un 500 llega como MegiError con su código", async () => {
    const { fetchImpl } = transporte(() => json({ detail: "boom" }, 500));
    await expect(nuevo(fetchImpl).verConsulta("demo-c1")).rejects.toMatchObject(
      { name: "MegiError", status: 500 },
    );
  });

  it("si MEGI no contesta, corta por tiempo y lo explica", async () => {
    const colgado = (async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/auth/login"))
        return json({ token: "t", name: "Dra. Demo Ficticia" });
      return new Promise<Response>((_, rechaza) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          rechaza(e);
        });
      });
    }) as unknown as typeof fetch;
    await expect(
      nuevo(colgado, 300).verConsulta("demo-c1"),
    ).rejects.toThrow(/espera|responde/i);
  });

  it("no filtra la contraseña del adaptador en el error", async () => {
    const { fetchImpl } = transporte(() => json({ detail: "boom" }, 500));
    let mensaje = "";
    try {
      await nuevo(fetchImpl).verConsulta("demo-c1");
      throw new Error("debería haber fallado");
    } catch (e) {
      mensaje = String((e as Error).message) + String((e as Error).stack ?? "");
    }
    expect(mensaje).not.toContain("secreto-de-prueba");
    expect(mensaje).toContain("500");
  });
});

describe("la ficha del paciente aguanta datos mal tipados", () => {
  const conPaciente = (p: unknown) =>
    transporte((path) => {
      if (/\/consultations$/.test(path)) return json([]);
      return json(p);
    });

  it("una edad que no es número no rompe la acción", async () => {
    const { fetchImpl } = conPaciente({ id: "P-DEMO1", age: "cuarenta" });
    const paciente = await nuevo(fetchImpl).verPaciente("demo-p1");
    expect(Number.isFinite(paciente.edad)).toBe(true);
    expect(paciente.edad).toBe(0);
  });

  it("alergias y crónicos siempre son listas", async () => {
    const { fetchImpl } = conPaciente({
      id: "P-DEMO1",
      age: 34,
      allergies: "Penicilina",
      chronic: null,
    });
    const paciente = await nuevo(fetchImpl).verPaciente("demo-p1");
    expect(paciente.alergias).toEqual([]);
    expect(paciente.cronicos).toEqual([]);
  });

  it("los nombres con unicode llegan intactos", async () => {
    const raro = "Ωmega 💊 طبيب — Niño Ñ";
    const { fetchImpl } = conPaciente({ id: "P-DEMO1", age: 34, name: raro });
    const paciente = await nuevo(fetchImpl).verPaciente("demo-p1");
    expect(paciente.nombre).toBe(raro);
  });
});

describe("las alertas se atribuyen al fármaco correcto", () => {
  /** MEGI devuelve el fármaco con su dosis: "Ibuprofeno 400 mg". */
  const conAlerta = (nombrado: string) =>
    transporte((path) => {
      if (/\/consultations$/.test(path)) return json([]);
      if (path.endsWith("/safety/rx-check"))
        return json({
          alerts: [
            {
              severity: "blocker",
              type: "interaccion",
              drug: nombrado,
              contra: "Warfarina 5 mg",
              message: "Interacción grave",
            },
          ],
        });
      if (path.endsWith("/drugs/alternatives")) return json({ sugerencias: [] });
      return json({
        id: "P-DEMO3",
        age: 72,
        allergies: [],
        chronic: [],
        name: "Rosa Ficticia Muestra",
      });
    });

  it("aunque MEGI añada la dosis al nombre", async () => {
    const { fetchImpl } = conAlerta("Ibuprofeno 400 mg");
    const r = await nuevo(fetchImpl).verificarReceta("demo-p3", [
      { nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 h" },
    ]);
    expect(r["Ibuprofeno"]?.resultado).toBe("bloqueado");
  });

  it("y no se la cuelga a otro fármaco de la misma receta", async () => {
    const { fetchImpl } = conAlerta("Naproxeno 550 mg");
    const r = await nuevo(fetchImpl).verificarReceta("demo-p3", [
      { nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 h" },
      { nombre: "Naproxeno", dosis: "550 mg", frecuencia: "cada 12 h" },
    ]);
    expect(r["Naproxeno"]?.resultado).toBe("bloqueado");
    expect(r["Ibuprofeno"]?.resultado).toBe("ok");
  });

  /**
   * La regla contraria, y es deliberada: una alerta que no se puede atribuir a
   * ningún fármaco enviado NO se descarta, se aplica a todos. Antes caía en
   * silencio y un bloqueo global acababa en `ok`. Esta prueba guarda esa
   * decisión: si alguien «arregla» la atribución volviendo a descartar lo que
   * no reconoce, aquí se nota.
   */
  it("una alerta que no nombra nada reconocible se aplica a todos, no se pierde", async () => {
    const { fetchImpl } = conAlerta("Naproxeno");
    const r = await nuevo(fetchImpl).verificarReceta("demo-p3", [
      { nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 h" },
    ]);
    expect(r["Ibuprofeno"]?.resultado).toBe("bloqueado");
  });
});
