/**
 * Batería 2 · bloques F, G y H — el adaptador bajo un MEGI hostil, la paridad
 * entre los dos adaptadores, y entradas hostiles que sí pasan el esquema.
 *
 * La fase 1 probó el camino feliz del transporte y el escape de ids. Aquí el
 * backend contesta mal a propósito: 500, JSON roto, campos que faltan, tipos
 * equivocados, listas enormes, nunca responde. Lo que se exige no es que el
 * adaptador acierte, sino que falle con un error que la mesa pueda explicar.
 *
 * Aislada: PGlite en memoria y transporte simulado. El bloque G sí habla con
 * el backend de demo (solo lecturas) para comparar forma con el mock.
 *
 * Uso, desde la raíz del repo del hackatón:
 *   megi-revision/node_modules/.bin/tsx pruebas-hackathon/fase2/adaptador.mts
 *   APP_MEGI_REVISION=/ruta/a/megi-revision/ ... tsx adaptador.mts
 *   ... tsx adaptador.mts --sin-red      # omite el bloque G
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const dir = process.env.APP_MEGI_REVISION ?? "../../megi-revision/";
const app = dir.startsWith("/")
  ? pathToFileURL(dir.endsWith("/") ? dir : `${dir}/`)
  : new URL(dir, import.meta.url);
const req = createRequire(new URL("package.json", app));
process.env.DATABASE_URL = "pglite:memory://";
process.env.MEGI_MODE = "mock";
const load = (p: string) => import(new URL(p, app).href);
const sinRed = process.argv.includes("--sin-red");

const { getPgliteClient, closePgliteClients } = await import(
  new URL("client.js", pathToFileURL(req.resolve("@agent-native/core/db"))).href
);
const client = await getPgliteClient(process.env.DATABASE_URL);
// Todas las migraciones, no solo la primera: la app empezó con una y el cierre
// del 7-nov añadió cuatro más (revisión trazable, conciliación, mediciones,
// turno del agente). Con `match` en vez de `matchAll` la base de prueba se
// quedaba en la v1 y cualquier escritura fallaba contra un esquema incompleto.
const migraciones = [
  ...readFileSync(new URL("server/plugins/db.ts", app), "utf8").matchAll(
    /sql: `([\s\S]*?)`,/g,
  ),
];
if (!migraciones.length) throw new Error("No se encontró ninguna migración de la app");
for (const m of migraciones) await client.exec(m[1]!);

const acciones: Record<string, any> = {};
for (const n of [
  "proponer-plan",
  "obtener-plan",
  "actualizar-linea",
  "reajustar-plan",
  "aprobar-plan",
  "agregar-linea",
  "ver-contexto-consulta",
  "listar-consultas",
  "historial-plan",
]) {
  acciones[n] = (await load(`actions/${n}.ts`)).default;
}
const { megi, MegiError } = await load("server/lib/megi/index.ts");
const { MegiHttp } = await load("server/lib/megi/megi-http.ts");
const mock = await megi();

const agente = { caller: "tool", userEmail: "fase2@prueba.local", orgId: null };
const medico = { caller: "frontend", userEmail: "fase2@prueba.local", orgId: null };
const call = (n: string, args: unknown, ctx: any = agente) =>
  acciones[n].run(args, ctx);
const falla = async (n: string, args: unknown, ctx: any = agente) => {
  try {
    await call(n, args, ctx);
    return null;
  } catch (e: any) {
    return { code: e.errorCode, status: e.statusCode, message: e.message, nombre: e.name };
  }
};

const resultados: any[] = [];
let bloque = "";
function sección(t: string) {
  bloque = t;
  console.log(`\n── ${t} ──`);
}
function anota(id: string, pasa: boolean, detalle?: unknown) {
  resultados.push({ bloque, id, passed: !!pasa, detail: detalle ?? null });
  console.log(
    `${pasa ? "PASA " : "FALLA"} ${id}${detalle === undefined ? "" : `: ${JSON.stringify(detalle)?.slice(0, 220)}`}`,
  );
}
function mide(id: string, valor: unknown) {
  resultados.push({ bloque, id, medicion: valor });
  console.log(`MIDE  ${id}: ${JSON.stringify(valor)?.slice(0, 220)}`);
}

const SECRETO = "contrasena-que-no-debe-salir-9f2a";

function abortada() {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}

/** Transporte simulado con contador de peticiones y rutas vistas. */
function transporte(tabla: (path: string, init: any) => any) {
  const vistas: Array<{ metodo: string; path: string }> = [];
  let logins = 0;
  const fetchImpl = (async (url: any, init: any) => {
    const path = new URL(String(url)).pathname;
    const metodo = init?.method ?? "GET";
    if (path.endsWith("/auth/login")) {
      logins++;
      return new Response(
        JSON.stringify({ token: "tok", name: "Dra. Demo Ficticia" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // Las lecturas por lotes de la mesa de revisión (`/review/pending`,
    // `/review/medication-history`) son opcionales en MEGI: con un 404 «not
    // found» el adaptador cae al camino por paciente, que es el que miden estos
    // casos. Se responde aquí, en el transporte común, para que cada caso siga
    // declarando solo las rutas que le interesan; y no se apunta en `vistas`,
    // que es la lista que revisan las comprobaciones de fugas.
    if (/\/review\/(pending|medication-history)$/.test(path)) {
      return new Response(JSON.stringify({ detail: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    vistas.push({ metodo, path });
    const r = tabla(path, init);
    if (r === undefined)
      throw new Error(`Ruta no prevista en el transporte: ${metodo} ${path}`);
    if (r?.__crudo) return r.__crudo as Response;
    if (r?.__nunca) {
      // Como el fetch de verdad: no contesta, pero obedece al AbortController.
      return await new Promise<Response>((_, rechaza) => {
        const señal = init?.signal as AbortSignal | undefined;
        if (!señal) return;
        if (señal.aborted) return rechaza(abortada());
        señal.addEventListener("abort", () => rechaza(abortada()));
      });
    }
    const status = r?.__status ?? 200;
    return new Response(JSON.stringify(r?.__body ?? r), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { vistas, fetchImpl, get logins() { return logins; } };
}
const nuevoHttp = (fetchImpl: any, extra: any = {}) =>
  new MegiHttp({
    url: "http://megi.invalido",
    user: "usuario",
    password: SECRETO,
    fetchImpl,
    ...extra,
  });

/** Qué clase de error salió: controlado (MegiError) o tripa de JavaScript. */
async function capta(fn: () => Promise<unknown>) {
  try {
    const v = await fn();
    return { ok: true as const, valor: v };
  } catch (e: any) {
    return {
      ok: false as const,
      nombre: e?.name ?? "?",
      esMegi: e instanceof MegiError || e?.name === "MegiError",
      mensaje: String(e?.message ?? ""),
      status: e?.status,
    };
  }
}
const filtra = (texto: string) =>
  texto.includes(SECRETO) || /Bearer\s+\S/.test(texto);

const PACIENTE_OK = {
  id: "P-DEMO1",
  name: "Ana Ficticia Prueba",
  age: 34,
  sex: "F",
  allergies: ["Penicilina"],
  chronic: [],
};

try {
  // =========================================================================
  sección("F · el adaptador frente a un MEGI hostil");
  // =========================================================================

  // F1 · 500 con una página de error en lugar de JSON.
  {
    const { fetchImpl } = transporte(() => ({
      __crudo: new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      }),
    }));
    const r = await capta(() => nuevoHttp(fetchImpl).verConsulta("demo-c1"));
    anota(
      "f1-500-con-html-es-error-controlado",
      !r.ok && r.esMegi && !filtra(r.mensaje),
      { nombre: r.ok ? "sin error" : r.nombre, status: r.ok ? null : r.status },
    );
  }

  // F2 · 502 con cuerpo vacío.
  {
    const { fetchImpl } = transporte(() => ({
      __crudo: new Response("", { status: 502 }),
    }));
    const r = await capta(() => nuevoHttp(fetchImpl).verPaciente("demo-p1"));
    anota("f2-502-vacio-es-error-controlado", !r.ok && r.esMegi, {
      nombre: r.ok ? "sin error" : r.nombre,
    });
  }

  // F3 · JSON roto con status 200: el peor caso, porque parece éxito.
  {
    const { fetchImpl } = transporte(() => ({
      __crudo: new Response('{"id":"C-DEMO1","motivo":', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }));
    const r = await capta(() => nuevoHttp(fetchImpl).verConsulta("demo-c1"));
    anota(
      "f3-json-roto-no-pasa-por-exito",
      !r.ok ? r.esMegi : false,
      r.ok ? { devolvió: r.valor } : { nombre: r.nombre, mensaje: r.mensaje.slice(0, 90) },
    );
  }

  // F4 · 200 con cuerpo vacío.
  {
    const { fetchImpl } = transporte(() => ({
      __crudo: new Response("", { status: 200 }),
    }));
    const r = await capta(() => nuevoHttp(fetchImpl).verConsulta("demo-c1"));
    anota(
      "f4-200-vacio-no-inventa-una-consulta",
      !r.ok || !(r.valor as any)?.id,
      r.ok ? { devolvió: (r.valor as any)?.id ?? null } : { nombre: r.nombre },
    );
  }

  // F5 · faltan campos en el paciente: no debe explotar al leer.
  {
    const { fetchImpl } = transporte((path) =>
      path.endsWith("/consultations") || path.includes("/consultations")
        ? []
        : { id: "P-DEMO1" },
    );
    const r = await capta(() => nuevoHttp(fetchImpl).verPaciente("demo-p1"));
    anota(
      "f5-paciente-incompleto-no-rompe",
      r.ok && typeof (r.valor as any).nombre === "string",
      r.ok ? r.valor : { nombre: r.nombre, mensaje: r.mensaje.slice(0, 90) },
    );
  }

  // F6 · tipos equivocados en campos que la mesa muestra tal cual.
  {
    const { fetchImpl } = transporte((path) =>
      path.includes("/consultations")
        ? []
        : {
            id: "P-DEMO1",
            name: 12345,
            age: "cuarenta",
            sex: "otro",
            allergies: "Penicilina",
            chronic: null,
          },
    );
    const r = await capta(() => nuevoHttp(fetchImpl).verPaciente("demo-p1"));
    anota(
      "f6-tipos-equivocados-se-normalizan",
      r.ok &&
        Array.isArray((r.valor as any).alergias) &&
        Array.isArray((r.valor as any).cronicos) &&
        Number.isFinite((r.valor as any).edad) &&
        typeof (r.valor as any).nombre === "string",
      r.ok
        ? {
            nombre: (r.valor as any).nombre,
            edad: (r.valor as any).edad,
            alergias: (r.valor as any).alergias,
          }
        : { error: r.nombre },
    );
  }

  // F7 · una lista grande de pacientes: cuántas peticiones cuesta la agenda.
  {
    const pacientes = Array.from({ length: 50 }, (_, i) => ({
      ...PACIENTE_OK,
      id: `P-D${i}`,
    }));
    const { fetchImpl, vistas } = transporte((path) => {
      if (path.endsWith("/patients")) return pacientes;
      if (/\/patients\/[^/]+\/consultations$/.test(path))
        return [
          {
            id: `C-${path.split("/")[4]}`,
            finalized: true,
            status: "in_review",
            started_at: "2026-11-01T00:00:00Z",
          },
        ];
      if (/\/consultations\/[^/]+$/.test(path))
        return {
          id: path.split("/").pop(),
          patient_id: "P-D0",
          motivo: "x",
          status: "in_review",
          started_at: "2026-11-01T00:00:00Z",
          final_soap: null,
          soap: null,
        };
      return {};
    });
    const t0 = Date.now();
    const r = await capta(() => nuevoHttp(fetchImpl).listarConsultasCerradas());
    const ms = Date.now() - t0;
    anota(
      "f7-una-agenda-de-50-pacientes-se-lista",
      r.ok && (r.valor as any[]).length === 50,
      { filas: r.ok ? (r.valor as any[]).length : null, ms },
    );
    mide("f7-peticiones-por-paciente", +(vistas.length / 50).toFixed(2));
    mide("f7-peticiones-totales", vistas.length);
    mide("f7-milisegundos", ms);
  }

  // F8 · nombres y fármacos con unicode, emoji y escritura de derecha a izquierda.
  {
    const raro = "Ωmega 💊 طبيب — Niño Ñ";
    const { fetchImpl } = transporte((path) =>
      path.includes("/consultations")
        ? []
        : { ...PACIENTE_OK, name: raro, allergies: [raro] },
    );
    const r = await capta(() => nuevoHttp(fetchImpl).verPaciente("demo-p1"));
    anota(
      "f8-unicode-y-emoji-llegan-intactos",
      r.ok &&
        (r.valor as any).nombre === raro &&
        (r.valor as any).alergias[0] === raro,
      r.ok ? (r.valor as any).nombre : { error: r.nombre },
    );
  }

  // F9 · MEGI nunca responde: el adaptador corta y lo dice.
  {
    const { fetchImpl } = transporte(() => ({ __nunca: true }));
    const t0 = Date.now();
    const r = await capta(() =>
      nuevoHttp(fetchImpl, { timeoutMs: 800 }).verConsulta("demo-c1"),
    );
    const ms = Date.now() - t0;
    anota(
      "f9-sin-respuesta-corta-por-tiempo",
      !r.ok && r.esMegi && /espera|responde/i.test(r.mensaje) && ms < 5000,
      { ms, mensaje: r.ok ? null : r.mensaje.slice(0, 110) },
    );
  }

  // F10 · una redirección a otro host no se sigue a ciegas.
  {
    const { fetchImpl, vistas } = transporte(() => ({
      __crudo: new Response("", {
        status: 302,
        headers: { location: "http://exfiltracion.invalido/api/patients" },
      }),
    }));
    const r = await capta(() => nuevoHttp(fetchImpl).verConsulta("demo-c1"));
    anota(
      "f10-no-sigue-redirecciones-a-otro-host",
      !r.ok && !vistas.some((v) => v.path.includes("exfiltracion")),
      { rutas: vistas.map((v) => v.path), error: r.ok ? null : r.nombre },
    );
  }

  // F11 · un 401 se reintenta una sola vez, no en bucle.
  {
    let n = 0;
    const { fetchImpl, ...t } = transporte(() => {
      n++;
      return { __status: 401, __body: { detail: "token caducado" } };
    });
    const http = nuevoHttp(fetchImpl);
    const r = await capta(() => http.verConsulta("demo-c1"));
    anota("f11-el-401-no-entra-en-bucle", !r.ok && n <= 2, {
      intentos: n,
      logins: (t as any).logins,
    });
  }

  // F12 · ningún error del transporte lleva la contraseña o el token dentro.
  {
    const casos: Array<[string, any]> = [
      ["500", () => ({ __status: 500, __body: { detail: "boom" } })],
      ["json roto", () => ({ __crudo: new Response("{", { status: 200 }) })],
      ["sin respuesta", () => ({ __nunca: true })],
    ];
    const fugas: string[] = [];
    for (const [nombre, tabla] of casos) {
      const { fetchImpl } = transporte(tabla as any);
      const r = await capta(() =>
        nuevoHttp(fetchImpl, { timeoutMs: 600 }).verConsulta("demo-c1"),
      );
      if (!r.ok && filtra(r.mensaje)) fugas.push(nombre);
    }
    anota("f12-los-errores-no-llevan-credenciales", fugas.length === 0, {
      fugas,
    });
  }

  // =========================================================================
  sección("G · paridad entre el mock y el adaptador http");
  // =========================================================================
  if (sinRed) {
    mide("g-omitido", "--sin-red");
  } else {
    const url = process.env.MEGI_URL ?? "http://127.0.0.1:8020";
    const vivo = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(2500),
    }).then(
      (r) => r.ok,
      () => false,
    );
    if (!vivo) {
      mide("g-omitido", `${url} no responde`);
    } else {
      const http = new MegiHttp({
        url,
        user: process.env.MEGI_USER ?? "demo_medico",
        password: process.env.MEGI_PASSWORD ?? "demo-megi-2026",
      });
      /** Forma de un valor: claves y tipos, sin los datos. */
      const forma = (v: any): any => {
        if (Array.isArray(v)) return v.length ? [forma(v[0])] : [];
        if (v && typeof v === "object")
          return Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, forma(v[k])]),
          );
        return v === null ? "null" : typeof v;
      };
      const pares: Array<[string, () => Promise<any>, () => Promise<any>]> = [
        ["estado", () => mock.estado(), () => http.estado()],
        [
          "verConsulta",
          () => mock.verConsulta("demo-c1"),
          () => http.verConsulta("demo-c1"),
        ],
        [
          "verPaciente",
          () => mock.verPaciente("demo-p1"),
          () => http.verPaciente("demo-p1"),
        ],
        [
          "listarConsultasCerradas",
          () => mock.listarConsultasCerradas(),
          () => http.listarConsultasCerradas(),
        ],
        [
          "verificarReceta",
          () =>
            mock.verificarReceta("demo-p1", [
              { nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 h" },
            ]),
          () =>
            http.verificarReceta("demo-p1", [
              { nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 h" },
            ]),
        ],
        [
          "alternativas",
          () => mock.alternativas("demo-p1", "Ibuprofeno"),
          () => http.alternativas("demo-p1", "Ibuprofeno"),
        ],
      ];
      for (const [nombre, a, b] of pares) {
        const ra = await capta(a);
        const rb = await capta(b);
        if (!ra.ok || !rb.ok) {
          anota(`g-${nombre}-ambos-responden`, false, {
            mock: ra.ok ? "ok" : ra.mensaje.slice(0, 80),
            http: rb.ok ? "ok" : rb.mensaje.slice(0, 80),
          });
          continue;
        }
        const fa = JSON.stringify(forma(ra.valor));
        const fb = JSON.stringify(forma(rb.valor));
        anota(`g-${nombre}-misma-forma`, fa === fb, fa === fb ? "idéntica" : { mock: fa.slice(0, 160), http: fb.slice(0, 160) });
      }
      // Lo que la mesa decide con esto: el veredicto de un AINE sobre un
      // hipertenso no puede depender de qué adaptador esté puesto.
      const vm = await capta(() =>
        mock.verificarReceta("demo-p2", [
          { nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 h" },
        ]),
      );
      const vh = await capta(() =>
        http.verificarReceta("demo-p2", [
          { nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 h" },
        ]),
      );
      const sev = (r: any) =>
        r.ok
          ? Object.entries(r.valor as Record<string, any>)
              .map(([k, v]) => `${k}:${v?.resultado ?? "?"}`)
              .sort()
          : null;
      const conMotivo = (r: any) =>
        r.ok
          ? Object.values(r.valor as Record<string, any>).every(
              (v: any) => v?.resultado === "ok" || !!v?.motivo,
            )
          : false;
      anota(
        "g-el-veredicto-del-aine-coincide",
        !!sev(vm) && JSON.stringify(sev(vm)) === JSON.stringify(sev(vh)),
        { mock: sev(vm), http: sev(vh) },
      );
      anota(
        "g-los-dos-explican-por-que",
        conMotivo(vm) && conMotivo(vh),
        {
          mock: vm.ok ? Object.values(vm.valor as any).map((v: any) => v?.motivo?.slice(0, 60)) : null,
          http: vh.ok ? Object.values(vh.valor as any).map((v: any) => v?.motivo?.slice(0, 60)) : null,
        },
      );
    }
  }

  // =========================================================================
  sección("H · entradas hostiles que sí pasan el esquema");
  // =========================================================================

  // H1 · un texto larguísimo: o lo rechaza el esquema, o se guarda entero.
  {
    const largo = "A".repeat(10_000);
    const parse = acciones["proponer-plan"].schema.safeParse({
      consultaId: "demo-c1",
      lineas: [{ tipo: "pendiente", texto: largo }],
      explicacion: "x",
      origen: "agente",
    });
    if (!parse.success) {
      anota("h1-texto-de-10k-rechazado-por-el-esquema", true, "el esquema lo corta antes");
    } else {
      const p = await capta(() =>
        call("proponer-plan", {
          consultaId: "demo-c1",
          lineas: [{ tipo: "pendiente", texto: largo }],
          explicacion: "texto largo",
        }),
      );
      anota(
        "h1-texto-de-10k-se-guarda-entero-o-falla-claro",
        p.ok
          ? (p.valor as any).lineas[0].texto.length === 10_000
          : !!(p as any).status || p.esMegi,
        p.ok ? { guardado: (p.valor as any).lineas[0].texto.length } : { error: p.nombre },
      );
    }
  }

  // H2 · un byte NUL en el texto. Postgres no lo admite en `text`.
  {
    const conNul = `Paracetamol\u0000 oculto`;
    const r = await falla("proponer-plan", {
      consultaId: "demo-c3",
      lineas: [{ tipo: "farmaco", texto: conNul, dosis: "1 g", frecuencia: "cada 8 h" }],
      explicacion: "byte nulo",
    });
    const ok = await capta(() => call("obtener-plan", { consultaId: "demo-c3" }));
    anota(
      "h2-el-byte-nulo-no-deja-la-mesa-rota",
      r === null || !!r.code,
      r === null ? "se guardó sin incidente" : { code: r.code, nombre: r.nombre, mensaje: r.message?.slice(0, 110) },
    );
    anota(
      "h2b-y-la-consulta-sigue-consultable",
      ok.ok || (ok as any).mensaje?.includes("todavía no tiene plan"),
      ok.ok ? "plan legible" : (ok as any).mensaje?.slice(0, 80),
    );
  }

  // H3 · inyección SQL en un campo de texto: debe guardarse como texto.
  {
    const ataque = `'; DROP TABLE planes; --`;
    const p = await capta(() =>
      call("proponer-plan", {
        consultaId: "demo-c4",
        lineas: [{ tipo: "pendiente", texto: ataque }],
        explicacion: "inyección",
      }),
    );
    const sigue = await capta(() => call("listar-consultas", {}));
    anota(
      "h3-la-inyeccion-sql-se-guarda-como-texto",
      p.ok && (p.valor as any).lineas[0].texto === ataque && sigue.ok,
      p.ok ? { guardado: (p.valor as any).lineas[0].texto } : { error: p.nombre },
    );
  }

  // H4 · etiquetas HTML: se guardan literales (la interfaz las escapa).
  {
    const plan = await capta(() => call("obtener-plan", { consultaId: "demo-c4" }));
    const html = `<img src=x onerror="alert(1)">`;
    // Desde el cierre del 7-nov toda edición del agente exige `versionEsperada`,
    // y `obtener-plan` no la devuelve: la única lectura que la trae es
    // `historial-plan`. Se lee por ahí, que es el camino que tendría el agente.
    const hist = await capta(() =>
      call("historial-plan", { planId: (plan.valor as any).id }),
    );
    const version = (hist.valor as any)?.versiones?.[0]?.version;
    const r = await capta(() =>
      call("agregar-linea", {
        planId: (plan.valor as any).id,
        tipo: "pendiente",
        texto: html,
        versionEsperada: version,
      }),
    );
    anota(
      "h4-el-html-se-guarda-literal",
      r.ok && (r.valor as any).linea.texto === html,
      r.ok ? (r.valor as any).linea.texto : { error: r.nombre },
    );
  }

  // H5 · el agente no puede vaciar el plan; la interfaz sí.
  {
    const vacíoAgente = acciones["proponer-plan"].schema.safeParse({
      consultaId: "demo-c1",
      lineas: [],
      explicacion: "x",
      origen: "agente",
    });
    const e = vacíoAgente.success
      ? await falla("proponer-plan", {
          consultaId: "demo-c2",
          lineas: [],
          explicacion: "vacío desde el agente",
        })
      : { code: "esquema" };
    anota(
      "h5-el-agente-no-vacia-el-plan",
      !!e?.code,
      e?.code ?? "lo aceptó",
    );
  }

  // H6 · rechazar sin motivo no se acepta.
  {
    const plan = await capta(() => call("obtener-plan", { consultaId: "demo-c4" }));
    const linea = (plan.valor as any).lineas[0];
    const e = await falla(
      "actualizar-linea",
      { lineaId: linea.id, estado: "rechazada", motivo: "", origen: "medico" },
      medico,
    );
    anota("h6-rechazar-sin-motivo-no-se-acepta", !!e?.code, e?.code ?? "lo aceptó");
  }

  // H7 · un id que no es de este médico no se toca.
  {
    const plan = await capta(() => call("obtener-plan", { consultaId: "demo-c4" }));
    const ajeno = {
      caller: "frontend",
      userEmail: "otra.doctora@prueba.local",
      orgId: null,
    };
    const e = await falla(
      "actualizar-linea",
      {
        lineaId: (plan.valor as any).lineas[0].id,
        estado: "bloqueada",
        motivo: "intento ajeno",
        origen: "medico",
      },
      ajeno,
    );
    anota("h7-otro-medico-no-toca-el-plan", !!e?.code, e?.code ?? "lo aceptó");
  }

  // H8 · más cambios de los permitidos en un reajuste.
  {
    const plan = await capta(() => call("obtener-plan", { consultaId: "demo-c4" }));
    const muchos = Array.from({ length: 31 }, () => ({
      accion: "agregar",
      tipo: "pendiente",
      texto: "relleno",
      motivo: "relleno",
    }));
    const parse = acciones["reajustar-plan"].schema.safeParse({
      planId: (plan.valor as any).id,
      cambios: muchos,
      explicacion: "demasiados",
      origen: "agente",
    });
    anota(
      "h8-el-esquema-limita-los-cambios-por-reajuste",
      !parse.success,
      parse.success ? "aceptó 31 cambios" : "rechazado en el esquema",
    );
  }
} catch (e: any) {
  anota("error-de-la-bateria", false, e?.stack?.split("\n").slice(0, 3).join(" | "));
} finally {
  try {
    await closePgliteClients?.();
  } catch {}
}

const checks = resultados.filter((r) => "passed" in r);
const fallos = checks.filter((r) => !r.passed);
const commit = (() => {
  try {
    return execFileSync(
      "git",
      ["-C", new URL(".", app).pathname, "rev-parse", "--short", "HEAD"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return null;
  }
})();
const salida = {
  bateria: "fase 2 · adaptador hostil, paridad y entradas hostiles",
  cuando: new Date().toISOString(),
  app: new URL(".", app).pathname,
  appCommit: commit,
  node: process.version,
  total: checks.length,
  pasan: checks.length - fallos.length,
  fallan: fallos.length,
  resultados,
};
const destino = new URL("adaptador-resultados.json", import.meta.url);
writeFileSync(destino, JSON.stringify(salida, null, 2) + "\n");
console.log(
  `\n${salida.pasan}/${salida.total} · ${fallos.length} FALLA · ${destino.pathname}`,
);
if (fallos.length) {
  console.log("fallan: " + fallos.map((f) => f.id).join(", "));
  process.exitCode = 1;
}
