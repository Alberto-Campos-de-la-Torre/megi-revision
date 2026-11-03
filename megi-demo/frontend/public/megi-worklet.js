// AudioWorklet: captura micrófono, resamplea a 16 kHz mono y emite frames Float32
// hacia el hilo principal (que los envía por WebSocket al ASR service).
class MegiStreamer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;   // p.ej. 48000/16000 = 3
    this.inBuf = [];                    // muestras de entrada acumuladas
    this.pos = 0;                       // posición fraccional de lectura
    this.out = [];                      // muestras 16k acumuladas
    this.FRAME = 2048;                  // ~128 ms @ 16k por mensaje
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i++) this.inBuf.push(ch[i]);

    // resample lineal a 16k
    while (this.pos + 1 < this.inBuf.length) {
      const idx = Math.floor(this.pos);
      const frac = this.pos - idx;
      this.out.push(this.inBuf[idx] * (1 - frac) + this.inBuf[idx + 1] * frac);
      this.pos += this.ratio;
    }
    // descartar entrada ya consumida, conservando la cola
    const consumed = Math.floor(this.pos);
    if (consumed > 0) {
      this.inBuf = this.inBuf.slice(consumed);
      this.pos -= consumed;
    }
    // emitir frames completos
    while (this.out.length >= this.FRAME) {
      const frame = new Float32Array(this.out.slice(0, this.FRAME));
      this.out = this.out.slice(this.FRAME);
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}
registerProcessor("megi-streamer", MegiStreamer);
