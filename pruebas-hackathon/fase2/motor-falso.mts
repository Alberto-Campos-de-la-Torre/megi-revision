/**
 * Un proveedor de mentira que habla el protocolo de OpenAI.
 *
 * Para qué
 * --------
 * El camino del chat —`POST /_agent-native/agent-chat` → el bucle del agente →
 * la acción → el plan → la lectura que pinta la pantalla— solo se recorre de
 * verdad con un modelo al otro lado. Pagar una llamada cada vez que quiero
 * comprobar que mi medidor lee bien los eventos es caro y lento, y ya perdí una
 * tanda entera por un fallo mío de medición.
 *
 * Así que este módulo levanta un servidor que responde `/v1/chat/completions`
 * como lo haría xAI u OpenAI, con un guion fijo: primero una llamada a
 * `proponer-plan` con líneas válidas, y en el turno siguiente —cuando ya le
 * llega el resultado de la herramienta— una frase final. Con eso el producto
 * hace el trabajo completo y la prueba puede afirmar sobre recibos reales.
 *
 * Lo que NO es: no mide al modelo. Mide el cableado. La calidad del agente
 * de verdad se mide con `--motor grok` y con `agente-version.mts`.
 */
import { createServer, type Server } from "node:http";

export type Guion = Array<
  | { herramienta: string; argumentos: Record<string, unknown> }
  | { texto: string }
>;

export type MotorFalso = {
  url: string;
  puerto: number;
  /** Cada petición que llegó: útil para ver qué herramientas se le ofrecieron. */
  peticiones: Array<{ modelo: string; herramientas: string[]; mensajes: number; conResultado: boolean }>;
  cierra: () => Promise<void>;
};

const trozo = (delta: unknown, finish: string | null, modelo: string) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-falso",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: modelo,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;

/**
 * El paso del guion que toca.
 *
 * Se decide por lo que trae la conversación, no por un contador: el framework
 * puede reintentar un turno, y un contador haría que el reintento recibiera el
 * paso siguiente y el guion se desordenara sin que se note.
 */
export function pasoDelGuion(guion: Guion, mensajes: Array<{ role?: string }>): Guion[number] {
  const resultados = mensajes.filter((m) => m?.role === "tool").length;
  return guion[Math.min(resultados, guion.length - 1)]!;
}

export async function arrancaMotorFalso(opciones: { guion: Guion; puerto?: number } ): Promise<MotorFalso> {
  const peticiones: MotorFalso["peticiones"] = [];
  const servidor: Server = createServer((req, res) => {
    const responde = (codigo: number, cuerpo: unknown) => {
      const texto = JSON.stringify(cuerpo);
      res.writeHead(codigo, { "content-type": "application/json", "content-length": Buffer.byteLength(texto) });
      res.end(texto);
    };
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      return responde(200, { object: "list", data: [{ id: "falso", object: "model", owned_by: "prueba" }] });
    }
    if (req.method !== "POST" || !req.url?.startsWith("/v1/chat/completions")) {
      return responde(404, { error: { message: `sin ruta para ${req.method} ${req.url}`, type: "invalid_request_error" } });
    }
    let crudo = "";
    req.on("data", (d) => { crudo += d; });
    req.on("end", () => {
      let cuerpo: any = {};
      try { cuerpo = JSON.parse(crudo || "{}"); } catch { return responde(400, { error: { message: "cuerpo ilegible" } }); }
      const mensajes: Array<{ role?: string }> = Array.isArray(cuerpo.messages) ? cuerpo.messages : [];
      const modelo = String(cuerpo.model ?? "falso");
      peticiones.push({
        modelo,
        herramientas: (Array.isArray(cuerpo.tools) ? cuerpo.tools : []).map((t: any) => t?.function?.name).filter((n: unknown): n is string => typeof n === "string"),
        mensajes: mensajes.length,
        conResultado: mensajes.some((m) => m?.role === "tool"),
      });
      const paso = pasoDelGuion(opciones.guion, mensajes);
      const esLlamada = "herramienta" in paso;
      const delta = esLlamada
        ? {
            role: "assistant",
            tool_calls: [{
              index: 0,
              id: `call_falso_${peticiones.length}`,
              type: "function",
              function: { name: paso.herramienta, arguments: JSON.stringify(paso.argumentos) },
            }],
          }
        : { role: "assistant", content: paso.texto };
      const fin = esLlamada ? "tool_calls" : "stop";
      if (cuerpo.stream) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(trozo(delta, null, modelo));
        res.write(trozo({}, fin, modelo));
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      const mensaje: Record<string, unknown> = esLlamada
        ? { role: "assistant", content: null, tool_calls: (delta as any).tool_calls.map(({ index, ...resto }: any) => resto) }
        : { role: "assistant", content: paso.texto };
      return responde(200, {
        id: "chatcmpl-falso",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelo,
        choices: [{ index: 0, message: mensaje, finish_reason: fin }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    });
  });
  const puerto = await new Promise<number>((res, rej) => {
    servidor.once("error", rej);
    servidor.listen(opciones.puerto ?? 0, "127.0.0.1", () => {
      const dir = servidor.address();
      res(typeof dir === "object" && dir ? dir.port : 0);
    });
  });
  return {
    url: `http://127.0.0.1:${puerto}/v1`,
    puerto,
    peticiones,
    cierra: () => new Promise((res) => servidor.close(() => res())),
  };
}
