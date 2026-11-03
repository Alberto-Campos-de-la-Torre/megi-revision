// ============ MEGI VOZ — SESIÓN ÚNICA DE AUDIO (Fase 7) ============
// ÚNICO módulo autorizado a abrir el micrófono para consulta y comandos.
// Una sola captura física (getUserMedia + AudioWorklet 16k) y un router por
// estados con dos carriles lógicos:
//
//   idle                 -> sin captura.
//   consultation_active  -> los frames van SOLO al consumidor clínico (chunker).
//   command_capture      -> los frames van SOLO al buffer del comando; el carril
//                           clínico queda excluido (el comando "MEGI, ..." nunca
//                           entra al audio que alimenta el SOAP).
//
// Motivo (doc "habilidades agenticas por voz"): la plataforma web permite dos
// getUserMedia simultáneos sobre el mismo micrófono, así que la exclusión debe
// vivir aquí, en la capa de sesión — no en cada componente.

const RATE = 16000;

// Codifica PCM Float32 16k mono a WAV (compartido con el chunker clínico).
export function encodeWav(float32, sampleRate = RATE) {
  const buf = new ArrayBuffer(44 + float32.length * 2);
  const view = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); view.setUint32(4, 36 + float32.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); w(36, "data");
  view.setUint32(40, float32.length * 2, true);
  let o = 44;
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

const S = {
  mode: "idle",            // idle | consultation_active | command_capture
  clinicalPaused: false,   // pausa del carril clínico (frames descartados)
  ctx: null,
  stream: null,
  clinicalOnFrame: null,   // consumidor clínico (LiveSoap)
  commandBuf: null,        // muestras del comando en captura (o null)
  tempCapture: false,      // captura abierta SOLO para un comando (sin consulta)
  handsFree: null,         // segmentador VAD del modo manos libres (Fase 8) o null
  monitorCapture: false,   // captura abierta SOLO para manos libres (sin consulta)
  listeners: new Set(),
};

export function getAudioSessionState() {
  return {
    mode: S.mode,
    clinicalPaused: S.clinicalPaused,
    consultationActive: !!S.clinicalOnFrame,
    handsFree: !!S.handsFree,
  };
}

export function subscribeAudioSession(fn) {
  S.listeners.add(fn);
  return () => S.listeners.delete(fn);
}

function emit() {
  const st = getAudioSessionState();
  S.listeners.forEach((fn) => { try { fn(st); } catch (e) { /* noop */ } });
}

// Router: cada frame del worklet va EXACTAMENTE a un carril clínico/comando.
// El tap de manos libres corre EN PARALELO (antes de la pausa clínica: debe
// poder oír "MEGI, continuar escucha" aunque la nota esté pausada), pero se
// apaga durante push-to-command para no procesar el mismo comando dos veces.
function routeFrame(frame) {
  if (S.commandBuf) { for (let i = 0; i < frame.length; i++) S.commandBuf.push(frame[i]); return; }
  if (S.handsFree) { try { S.handsFree.feed(frame); } catch (e) { /* noop */ } }
  if (S.clinicalPaused) return;
  if (S.clinicalOnFrame) S.clinicalOnFrame(frame);
}

async function openCapture() {
  if (S.ctx) return;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Micrófono no disponible en este navegador.");
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule("/megi-worklet.js");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "megi-streamer");
  node.port.onmessage = (e) => routeFrame(e.data);
  src.connect(node); // sin conectar a destination (evita eco)
  S.ctx = ctx;
  S.stream = stream;
}

function closeCapture() {
  try { S.stream?.getTracks().forEach((t) => t.stop()); } catch (e) { /* noop */ }
  try { S.ctx?.close(); } catch (e) { /* noop */ }
  S.ctx = null;
  S.stream = null;
}

// ---- Carril clínico (consulta) ----

export async function startConsultation({ onFrame }) {
  // Un comando temporal en curso se descarta: la consulta manda.
  if (S.tempCapture) cancelCommandCapture();
  if (S.clinicalOnFrame) throw new Error("Ya hay una consulta capturando audio.");
  await openCapture();
  S.clinicalOnFrame = onFrame;
  S.clinicalPaused = false;
  S.mode = "consultation_active";
  emit();
}

export function stopConsultation() {
  S.clinicalOnFrame = null;
  S.clinicalPaused = false;
  S.handsFree = null;      // el controlador global re-arma su monitor al ver el cambio
  S.monitorCapture = false;
  if (S.commandBuf) { S.commandBuf = null; }
  closeCapture();
  S.mode = "idle";
  emit();
}

export function pauseClinical() {
  if (!S.clinicalOnFrame) return false;
  S.clinicalPaused = true;
  emit();
  return true;
}

export function resumeClinical() {
  if (!S.clinicalOnFrame) return false;
  S.clinicalPaused = false;
  emit();
  return true;
}

// ---- Carril de comando (push-to-command) ----

// Empieza a capturar un comando. Si hay consulta activa, REUSA la misma captura
// y excluye el carril clínico (el chunk vigente queda partido justo aquí: todo
// frame posterior pertenece al comando). Si no hay consulta, abre una captura
// temporal solo para el comando.
export async function beginCommandCapture() {
  if (S.commandBuf) return false;
  if (!S.ctx) {
    await openCapture();
    S.tempCapture = true;
  }
  S.commandBuf = [];
  S.mode = "command_capture";
  emit();
  return true;
}

// Termina la captura y devuelve { blob (wav 16k), durationMs }. Restaura el
// carril clínico (o cierra la captura temporal).
export function endCommandCapture() {
  if (!S.commandBuf) return null;
  const buf = S.commandBuf;
  S.commandBuf = null;
  if (S.tempCapture) { S.tempCapture = false; closeCapture(); }
  S.mode = S.clinicalOnFrame ? "consultation_active" : "idle";
  emit();
  return {
    blob: encodeWav(Float32Array.from(buf)),
    durationMs: Math.round((buf.length / RATE) * 1000),
  };
}

// ---- Manos libres (Fase 8): tap paralelo con segmentador VAD ----
// `segmenter` es un objeto con feed(frame) (UtteranceSegmenter de wake_vad.js).
// Con consulta activa reusa esa captura; sin consulta abre una captura MONITOR
// propia (Fase 8.1: micrófono siempre activo en toda la app).
export async function enableHandsFree(segmenter) {
  if (!S.ctx) {
    await openCapture();
    S.monitorCapture = true;
  }
  S.handsFree = segmenter;
  emit();
  return true;
}

// Solo el dueño puede apagar su tap: si otro componente ya instaló su propio
// segmentador (p. ej. consulta reemplazó al global), el cleanup ajeno no lo pisa.
export function disableHandsFree(segmenter) {
  if (segmenter && S.handsFree && S.handsFree !== segmenter) return;
  S.handsFree = null;
  if (S.monitorCapture && !S.clinicalOnFrame && !S.commandBuf) {
    S.monitorCapture = false;
    closeCapture();
  }
  emit();
}

// Descarta el comando en curso sin transcribir (cerrar panel, error, etc.).
export function cancelCommandCapture() {
  if (!S.commandBuf) return;
  S.commandBuf = null;
  if (S.tempCapture) { S.tempCapture = false; closeCapture(); }
  S.mode = S.clinicalOnFrame ? "consultation_active" : "idle";
  emit();
}
