import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ServiceHealth, TranscriptionWarning, VersionWarning } from "../components/service_health";
import { BUILD } from "../api/client";

// §4: el indicador existe para que nadie documente una consulta sobre un
// transcript simulado. Lo que se prueba es justo eso: cuándo avisa y cuándo no.

const healthy = {
  transcription_mode: "real", safe_to_document: true, warning: null,
  services: {
    asr: { configured: true, reachable: true, models_ok: true },
    llm: { loaded: true }, rag: { index_present: true, loaded: true },
  },
};

describe("TranscriptionWarning", () => {
  it("no molesta cuando la transcripción es real", () => {
    const { container } = render(<TranscriptionWarning health={healthy} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("avisa en modo simulado y explica por qué", () => {
    render(<TranscriptionWarning health={{
      transcription_mode: "mock", safe_to_document: false,
      warning: "Transcripción SIMULADA: no documentes una consulta con este texto.",
      services: {},
    }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/MODO SIMULADO/)).toBeInTheDocument();
    expect(screen.getByText(/no documentes/i)).toBeInTheDocument();
  });

  it("avisa cuando el ASR no responde", () => {
    render(<TranscriptionWarning health={{
      transcription_mode: "unavailable", safe_to_document: false,
      warning: "El servicio de ASR no responde.", services: {},
    }} />);
    expect(screen.getByText(/ASR NO DISPONIBLE/)).toBeInTheDocument();
  });

  it("no inventa un estado cuando no hay datos", () => {
    const { container } = render(<TranscriptionWarning health={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("VersionWarning", () => {
  it("avisa cuando el backend corre otra versión que la app", () => {
    render(<VersionWarning health={{ build: "otracosa" }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/megi update/)).toBeInTheDocument();
  });

  it("calla cuando coinciden", () => {
    const { container } = render(<VersionWarning health={{ build: BUILD }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("calla si el backend no informa versión (no inventar desfases)", () => {
    const { container } = render(<VersionWarning health={{ build: "unknown" }} />);
    expect(container).toBeEmptyDOMElement();
    expect(render(<VersionWarning health={null} />).container).toBeEmptyDOMElement();
  });
});

describe("ServiceHealth", () => {
  it("marca los tres servicios en verde cuando todo está cargado", () => {
    const { container } = render(<ServiceHealth health={healthy} />);
    expect(container.querySelectorAll(".hd-ok")).toHaveLength(3);
  });

  it("distingue 'aún no cargado' de 'caído' (carga perezosa del LLM/RAG)", () => {
    const { container } = render(<ServiceHealth health={{
      ...healthy,
      services: {
        asr: { configured: true, reachable: true, models_ok: true },
        llm: { loaded: false }, rag: { index_present: true, loaded: false },
      },
    }} />);
    // ASR operativo; LLM aún sin cargar => 'idle', no 'down' (no es un fallo).
    expect(container.querySelectorAll(".hd-ok")).toHaveLength(2);   // ASR + RAG (índice presente)
    expect(container.querySelectorAll(".hd-idle")).toHaveLength(1); // LLM
    expect(container.querySelectorAll(".hd-down")).toHaveLength(0);
  });

  it("marca el ASR en rojo cuando está configurado pero no responde", () => {
    const { container } = render(<ServiceHealth health={{
      transcription_mode: "unavailable", safe_to_document: false, warning: "x",
      services: {
        asr: { configured: true, reachable: false, models_ok: false },
        llm: { loaded: false }, rag: { index_present: true },
      },
    }} />);
    const asr = container.querySelector(".hd");
    expect(asr.className).toContain("hd-down");
  });

  it("el ASR apagado por configuración no se pinta como avería", () => {
    const { container } = render(<ServiceHealth health={{
      transcription_mode: "mock", safe_to_document: false, warning: "x",
      services: { asr: { configured: false, reachable: false }, llm: {}, rag: {} },
    }} />);
    expect(container.querySelector(".hd").className).toContain("hd-off");
  });

  it("se queda neutro sin datos en vez de afirmar que todo va bien", () => {
    const { container } = render(<ServiceHealth health={null} />);
    expect(container.querySelectorAll(".hd-unknown")).toHaveLength(3);
    expect(container.querySelectorAll(".hd-ok")).toHaveLength(0);
  });
});
