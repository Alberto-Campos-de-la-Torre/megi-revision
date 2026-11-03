import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../api/client", () => ({
  api: {
    logReviewEvent: vi.fn(),
    transcribeVoiceCommand: vi.fn(),
    probeWakeCommand: vi.fn(),
    parseCommandShadow: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("../lib/audio_session", () => ({
  beginCommandCapture: vi.fn().mockResolvedValue(true),
  endCommandCapture: vi.fn(),
  cancelCommandCapture: vi.fn(),
  enableHandsFree: vi.fn().mockReturnValue(true),
  disableHandsFree: vi.fn(),
  encodeWav: vi.fn(() => new Blob(["w"], { type: "audio/wav" })),
}));

import { api } from "../api/client";
import { beginCommandCapture, enableHandsFree, endCommandCapture } from "../lib/audio_session";
import ConsultaVoice from "../components/consulta_voice";

function renderPanel(overrides = {}) {
  const props = {
    user: { username: "dra", role: "medico" },
    recording: true,
    paused: false,
    getConsultationId: () => "C-1",
    onStart: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStopAndReview: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<ConsultaVoice {...props} />);
  return props;
}

async function send(command) {
  fireEvent.change(screen.getByPlaceholderText(/MEGI, finaliza/i), { target: { value: command } });
  fireEvent.click(screen.getByRole("button", { name: /^ir$/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    localStorage.setItem("megi.voice.expert", "0");
    localStorage.setItem("megi.voice.handsfree", "1"); // pref global ON (default)
  } catch (e) { /* noop */ }
  api.logReviewEvent.mockResolvedValue({ ok: true });
});

describe("ConsultaVoice (Fase 7)", () => {
  it("finalizar exige propuesta + confirmación y audita antes de aplicar", async () => {
    const props = renderPanel();
    await send("MEGI, finaliza la consulta");

    // Propuesta visible; nada aplicado aún.
    expect(await screen.findByText(/detenida \(pasar a revisión\)/i)).toBeInTheDocument();
    expect(props.onStopAndReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /confirmar y finalizar/i }));
    await waitFor(() => expect(props.onStopAndReview).toHaveBeenCalled());
    expect(api.logReviewEvent).toHaveBeenCalledWith(expect.objectContaining({
      consultation_id: "C-1",
      kind: "voice_recording",
    }));
  });

  it("NO finaliza si la auditoría persistente falla (fail-closed)", async () => {
    api.logReviewEvent.mockRejectedValueOnce(new Error("audit down"));
    const props = renderPanel();
    await send("MEGI, finaliza la consulta");
    fireEvent.click(await screen.findByRole("button", { name: /confirmar y finalizar/i }));

    expect(await screen.findByText(/Cambio no aplicado/i)).toBeInTheDocument();
    expect(props.onStopAndReview).not.toHaveBeenCalled();
  });

  it("pausar se ejecuta directo (no destructivo) y queda auditado", async () => {
    const props = renderPanel();
    await send("MEGI, pausar escucha");
    await waitFor(() => expect(props.onPause).toHaveBeenCalled());
    expect(api.logReviewEvent).toHaveBeenCalled();
  });

  it("rechaza edición clínica: eso vive en Revisión", async () => {
    const props = renderPanel();
    await send("MEGI, agrega a plan: control en 7 días");
    expect(await screen.findByText(/Revisión/i)).toBeInTheDocument();
    expect(props.onStopAndReview).not.toHaveBeenCalled();
    expect(props.onPause).not.toHaveBeenCalled();
  });

  it("orienta a la barra global para comandos de navegación", async () => {
    renderPanel();
    await send("MEGI, ir a pacientes");
    expect(await screen.findByText(/usa la barra/i)).toBeInTheDocument();
  });

  it("shadow mode: un comando NO entendido va al parser LLM solo para registro", async () => {
    const props = renderPanel();
    await send("MEGI, hazme un café");
    await waitFor(() => expect(api.parseCommandShadow).toHaveBeenCalledWith(
      expect.objectContaining({ text: "MEGI, hazme un café", source: "consulta" }),
    ));
    // Shadow jamás ejecuta nada.
    expect(props.onPause).not.toHaveBeenCalled();
    expect(props.onStopAndReview).not.toHaveBeenCalled();
  });

  it("un comando DICTADO funciona aunque el ASR se coma la palabra MEGI", async () => {
    // Push-to-command: pulsar Dictar es la activación; el transcript sin wake
    // word ("pausar escucha.") debe ejecutarse igual.
    endCommandCapture.mockReturnValue({ blob: new Blob(["x"], { type: "audio/wav" }), durationMs: 1500 });
    api.transcribeVoiceCommand.mockResolvedValue({ transcript: "pausar escucha." });
    const props = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /dictar/i }));
    await waitFor(() => screen.getByRole("button", { name: /detener/i }));
    fireEvent.click(screen.getByRole("button", { name: /detener/i }));
    await waitFor(() => expect(props.onPause).toHaveBeenCalled());
  });

  it("un comando ESCRITO sí exige la palabra MEGI (modo seguro)", async () => {
    const props = renderPanel();
    await send("pausar escucha");
    expect(await screen.findByText(/deben iniciar con "MEGI"/i)).toBeInTheDocument();
    expect(props.onPause).not.toHaveBeenCalled();
  });

  it("manos libres: un enunciado con MEGI ejecuta pausa; sin comando permitido solo informa", async () => {
    api.probeWakeCommand.mockResolvedValueOnce({ wake_word_detected: true, command_text: "Meji, pausar escucha." });
    const props = renderPanel();

    // Pref global ON por defecto: se arma solo al estar grabando, sin tocar botones.
    await waitFor(() => expect(enableHandsFree).toHaveBeenCalled());
    expect(screen.getByText(/manos libres — di/i)).toBeInTheDocument(); // indicador permanente

    // Simula que el segmentador VAD emitió un enunciado corto.
    const segmenter = enableHandsFree.mock.calls.at(-1)[0];
    segmenter.onUtterance(new Float32Array(4096), 1500);
    await waitFor(() => expect(props.onPause).toHaveBeenCalled());

    // Un comando NO permitido en manos libres (navegación) no ejecuta nada.
    api.probeWakeCommand.mockResolvedValueOnce({ wake_word_detected: true, command_text: "MEGI, ir a pacientes." });
    segmenter.onUtterance(new Float32Array(4096), 1500);
    expect(await screen.findByText(/solo controlo pausar\/continuar\/finalizar/i)).toBeInTheDocument();
  });

  it("manos libres: con huella registrada, una voz DESCONOCIDA no ejecuta nada (Fase 10)", async () => {
    api.probeWakeCommand.mockResolvedValueOnce({
      wake_word_detected: true, command_text: "Meji, pausar escucha.",
      speaker: "desconocido", speaker_score: 0.12,
    });
    const props = renderPanel();

    await waitFor(() => expect(enableHandsFree).toHaveBeenCalled());
    const segmenter = enableHandsFree.mock.calls.at(-1)[0];
    segmenter.onUtterance(new Float32Array(4096), 1500);

    expect(await screen.findByText(/voz no coincide con el médico registrado/i)).toBeInTheDocument();
    expect(props.onPause).not.toHaveBeenCalled();
  });

  it("manos libres: la voz del MÉDICO verificada sí ejecuta (Fase 10)", async () => {
    api.probeWakeCommand.mockResolvedValueOnce({
      wake_word_detected: true, command_text: "Meji, pausar escucha.",
      speaker: "medico", speaker_score: 0.71,
    });
    const props = renderPanel();

    await waitFor(() => expect(enableHandsFree).toHaveBeenCalled());
    enableHandsFree.mock.calls.at(-1)[0].onUtterance(new Float32Array(4096), 1500);
    await waitFor(() => expect(props.onPause).toHaveBeenCalled());
  });

  it("manos libres: 'finaliza la consulta' NO ejecuta directo, pide confirmación en pantalla", async () => {
    api.probeWakeCommand.mockResolvedValueOnce({ wake_word_detected: true, command_text: "MEGI, finaliza la consulta." });
    const props = renderPanel();

    await waitFor(() => expect(enableHandsFree).toHaveBeenCalled());
    const segmenter = enableHandsFree.mock.calls.at(-1)[0];
    segmenter.onUtterance(new Float32Array(4096), 2000);

    expect(await screen.findByText(/detenida \(pasar a revisión\)/i)).toBeInTheDocument();
    expect(props.onStopAndReview).not.toHaveBeenCalled(); // solo con confirmación táctil
  });

  it("el interruptor apaga el manos libres (pref global persistente)", async () => {
    const props = renderPanel();
    await waitFor(() => expect(enableHandsFree).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /manos libres: on/i }));
    await waitFor(() => expect(screen.queryByText(/manos libres — di/i)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^👂 manos libres$/i })).toBeInTheDocument(); // quedó apagado
    expect(props.onPause).not.toHaveBeenCalled();
  });

  it("muestra el aura azul de escucha al dictar y flash verde al ejecutar", async () => {
    endCommandCapture.mockReturnValue({ blob: new Blob(["x"], { type: "audio/wav" }), durationMs: 1200 });
    api.transcribeVoiceCommand.mockResolvedValue({ transcript: "MEGI, pausar escucha" });
    const props = renderPanel();

    // Activar dictado -> aura azul respirando (mic-listening).
    const dictar = screen.getByRole("button", { name: /dictar/i });
    fireEvent.click(dictar);
    await waitFor(() => expect(beginCommandCapture).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /detener/i }).className).toMatch(/mic-listening/));

    // Terminar -> transcribe -> comando ejecutado -> flash verde (mic-success).
    fireEvent.click(screen.getByRole("button", { name: /detener/i }));
    await waitFor(() => expect(props.onPause).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /dictar/i }).className).toMatch(/mic-success/));
  });
});
