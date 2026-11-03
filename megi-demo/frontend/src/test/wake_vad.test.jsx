import { describe, it, expect, vi } from "vitest";
import { UtteranceSegmenter } from "../lib/wake_vad";

// Frames de 2048 muestras (128ms @ 16k), como los del worklet.
const FRAME = 2048;
const silence = () => new Float32Array(FRAME); // rms 0
const speech = (amp = 0.15) => {
  const f = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) f[i] = amp * Math.sin(i / 3);
  return f;
};
const feedMany = (seg, frame, n) => { for (let i = 0; i < n; i++) seg.feed(frame()); };

describe("UtteranceSegmenter (Fase 8, manos libres)", () => {
  it("el silencio no emite nada", () => {
    const onUtterance = vi.fn();
    const seg = new UtteranceSegmenter({ onUtterance });
    feedMany(seg, silence, 50);
    expect(onUtterance).not.toHaveBeenCalled();
  });

  it("un enunciado corto (~1.5s) se emite con pre-roll incluido", () => {
    const onUtterance = vi.fn();
    const seg = new UtteranceSegmenter({ onUtterance });
    feedMany(seg, silence, 10);       // establece piso de ruido
    feedMany(seg, speech, 12);        // ~1.5s de voz
    feedMany(seg, silence, 8);        // ~1s de silencio -> cierre
    expect(onUtterance).toHaveBeenCalledTimes(1);
    const [samples, durMs] = onUtterance.mock.calls[0];
    expect(durMs).toBeGreaterThanOrEqual(1400);
    // pre-roll: el buffer incluye ~2 frames previos al inicio de la voz
    expect(samples.length).toBeGreaterThanOrEqual(14 * FRAME);
  });

  it("el habla larga (dictado clínico, >4.5s) se descarta", () => {
    const onUtterance = vi.fn();
    const seg = new UtteranceSegmenter({ onUtterance });
    feedMany(seg, silence, 10);
    feedMany(seg, speech, 45);        // ~5.8s de voz continua
    feedMany(seg, silence, 8);
    expect(onUtterance).not.toHaveBeenCalled();
  });

  it("los ruidos muy cortos (<400ms) se descartan", () => {
    const onUtterance = vi.fn();
    const seg = new UtteranceSegmenter({ onUtterance });
    feedMany(seg, silence, 10);
    feedMany(seg, speech, 2);         // ~256ms
    feedMany(seg, silence, 8);
    expect(onUtterance).not.toHaveBeenCalled();
  });

  it("tras un descarte por longitud, el siguiente comando corto sí se emite", () => {
    const onUtterance = vi.fn();
    const seg = new UtteranceSegmenter({ onUtterance });
    feedMany(seg, silence, 10);
    feedMany(seg, speech, 45);        // dictado largo -> descartado
    feedMany(seg, silence, 8);
    feedMany(seg, speech, 12);        // comando corto
    feedMany(seg, silence, 8);
    expect(onUtterance).toHaveBeenCalledTimes(1);
  });
});
