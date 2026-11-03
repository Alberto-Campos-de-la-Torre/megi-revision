// ============ MEGI VOZ — SEGMENTADOR DE ENUNCIADOS (Fase 8, manos libres) ============
// Etapa 1 del detector de "MEGI": corre LOCAL sobre los frames PCM 16k de la
// sesión única y separa enunciados por energía (VAD simple con piso de ruido
// adaptativo). Solo emite enunciados CORTOS (los comandos duran 1-4s; el dictado
// clínico es más largo), que la etapa 2 manda a sondear al ASR local.
//
// Incluye pre-roll (~256ms) antes del inicio de voz: el ASR se come la primera
// palabra si el audio empieza justo en ella (medido con el v1.5).

const RATE = 16000;

export class UtteranceSegmenter {
  constructor({ onUtterance, minMs = 400, maxMs = 4500, hangMs = 700, preFrames = 2 } = {}) {
    this.onUtterance = onUtterance;
    this.minMs = minMs;
    this.maxMs = maxMs;
    this.hangMs = hangMs;
    this.preFrames = preFrames;
    this.pre = [];          // ring buffer de pre-roll
    this.buf = null;        // frames del enunciado en curso (null = en silencio)
    this.silentMs = 0;
    this.speechMs = 0;
    this.tooLong = false;
    this.noise = 0.004;     // piso de ruido (EMA), se adapta al ambiente
  }

  feed(frame) {
    const frameMs = (frame.length / RATE) * 1000;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);

    if (this.buf === null) {
      // Silencio: adapta el piso de ruido y mantiene el pre-roll.
      this.noise = this.noise * 0.95 + rms * 0.05;
      const threshold = Math.max(0.010, this.noise * 2.5);
      this.pre.push(frame);
      if (this.pre.length > this.preFrames) this.pre.shift();
      if (rms > threshold) {
        this.buf = [...this.pre];
        this.buf.push(frame);
        this.silentMs = 0;
        this.speechMs = frameMs;
        this.tooLong = false;
      }
      return;
    }

    // Enunciado en curso.
    const threshold = Math.max(0.010, this.noise * 2.5);
    this.buf.push(frame);
    if (rms > threshold) { this.silentMs = 0; this.speechMs += frameMs; }
    else this.silentMs += frameMs;

    const durMs = this.speechMs;
    if (durMs > this.maxMs) {
      // Demasiado largo para ser comando (dictado clínico): descarta y espera silencio.
      this.tooLong = true;
      this.buf = [];   // no acumular memoria
    }

    if (this.silentMs >= this.hangMs) {
      const emit = !this.tooLong && durMs >= this.minMs && durMs <= this.maxMs;
      if (emit && this.onUtterance) {
        let total = 0;
        for (const f of this.buf) total += f.length;
        const out = new Float32Array(total);
        let o = 0;
        for (const f of this.buf) { out.set(f, o); o += f.length; }
        this.onUtterance(out, Math.round(durMs));
      }
      this.buf = null;
      this.pre = [];
      this.silentMs = 0;
      this.speechMs = 0;
      this.tooLong = false;
    }
  }
}
