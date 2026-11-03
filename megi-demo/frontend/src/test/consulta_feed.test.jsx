import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ConsultaFeed from "../components/consulta_feed";
import TechTranscript from "../components/tech_transcript";

// La columna derecha de la consulta en vivo ahora es el feed de sugerencias y
// alertas; la transcripción y los eventos viven en el panel técnico.

describe("ConsultaFeed", () => {
  it("explica qué aparecerá mientras no hay nada", () => {
    render(<ConsultaFeed alertas={null} gaps={[]} recording={false} />);
    expect(screen.getByText(/Inicia la consulta/)).toBeInTheDocument();
    render(<ConsultaFeed alertas={null} gaps={[]} recording />);
    expect(screen.getByText(/Escuchando/)).toBeInTheDocument();
  });

  it("lista sugerencias de interrogatorio y alertas FDA en vivo", () => {
    render(<ConsultaFeed recording
      gaps={[{ id: "g1", texto: "¿Preguntar por fiebre?", razon: "herida con secreción" }]}
      alertas={{ resumen: { mayor: 1 }, alertas: [{
        tipo_alerta: "farmaco_condicion", farmaco: "ibuprofen", condicion: "insuficiencia renal",
        seccion: "DRUG INTERACTIONS", severidad: "mayor", evidencias: 2, cita: "cita", fuente: "es",
      }] }} />);
    expect(screen.getByText("¿Preguntar por fiebre?")).toBeInTheDocument();
    expect(screen.getByText(/herida con secreción/)).toBeInTheDocument();
    expect(screen.getByText(/1 alerta\(s\) alta\(s\)/)).toBeInTheDocument();
    expect(screen.getByText("ibuprofen")).toBeInTheDocument();
    expect(screen.getByText(/insuficiencia renal/)).toBeInTheDocument();
    expect(screen.queryByText(/Inicia la consulta/)).not.toBeInTheDocument();
  });
});

describe("TechTranscript", () => {
  it("muestra transcripción, hablantes y eventos", () => {
    render(<TechTranscript transcript="Paciente masculino de 58 años"
      turns={[{ start: 0, speaker: "medico", text: "¿Cómo sigue la mano?" }]}
      events={[{ ts: "00:02", label: "chunk_0 transcrito (done)" }, { ts: "00:03", label: "error: x" }]} />);
    expect(screen.getByText(/Paciente masculino/)).toBeInTheDocument();
    expect(screen.getByText("MÉDICO")).toBeInTheDocument();
    expect(screen.getByText(/chunk_0 transcrito/)).toBeInTheDocument();
    expect(screen.getByText(/error: x/)).toBeInTheDocument();
  });
});

describe("ConsultaFeed tras finalizar", () => {
  it("conserva las sugerencias y alertas cuando la nota ya se consolidó", () => {
    render(<ConsultaFeed recording={false} finished
      gaps={[{ id: "g1", texto: "¿Preguntar por fiebre?" }]}
      alertas={{ resumen: { mayor: 1 }, alertas: [{ tipo_alerta: "farmaco_farmaco", farmaco: "ibuprofen",
        con_farmaco: "diclofenac", seccion: "DRUG INTERACTIONS", severidad: "mayor", cita: "c", fuente: "es" }] }} />);
    expect(screen.getByText("¿Preguntar por fiebre?")).toBeInTheDocument();
    expect(screen.getByText("ibuprofen")).toBeInTheDocument();
    expect(screen.queryByText(/Inicia la consulta/)).not.toBeInTheDocument();
  });

  it("si no hubo nada, lo dice sin pedir que inicie otra vez", () => {
    render(<ConsultaFeed recording={false} finished gaps={[]} alertas={null} />);
    expect(screen.getByText(/no generó sugerencias ni alertas/)).toBeInTheDocument();
  });
});

describe("ConsultaFeed · rehabilitación en vivo", () => {
  const rehab = {
    es_rehabilitacion: true, confianza: 1, reglas: [{ tipo: "restringe", accion: "Sin carga axial", hallazgo: "dolor a la carga" }],
    protocolos: [
      { id: "cadera/po", region: "Cadera", nombre: "PO fractura de cadera o fémur", requiere_lateralidad: true,
        pasos: [{ texto: "CHC a cadera y rodilla **DERECHA/IZQUIERDA** durante `15 min`" }, { texto: "Movilización activo-asistida de cadera" }] },
      { id: "rodilla/x", region: "Rodilla", nombre: "Otro protocolo", pasos: [] },
    ],
  };

  it("muestra el protocolo detectado con sus pasos, reglas y alternativas", () => {
    render(<ConsultaFeed recording gaps={[]} alertas={null} rehab={rehab} />);
    expect(screen.getByText("PO fractura de cadera o fémur")).toBeInTheDocument();
    expect(screen.getByText(/Terapia sugerida · Cadera/)).toBeInTheDocument();
    expect(screen.getByText(/CHC a cadera y rodilla DERECHA\/IZQUIERDA durante 15 min/)).toBeInTheDocument();
    expect(screen.getByText(/No hacer:/)).toBeInTheDocument();
    expect(screen.getByText(/Al agregar entra completo al Plan/)).toBeInTheDocument();
    expect(screen.getByText(/Otras opciones: Otro protocolo/)).toBeInTheDocument();
    expect(screen.queryByText(/Escuchando/)).not.toBeInTheDocument();
  });

  it("no muestra nada si la consulta no es de rehabilitación", () => {
    render(<ConsultaFeed recording gaps={[]} alertas={null} rehab={{ es_rehabilitacion: false, protocolos: [] }} />);
    expect(screen.queryByTestId("rehab-en-vivo")).not.toBeInTheDocument();
  });
});

describe("ConsultaFeed · agregar rehabilitación a la nota", () => {
  const rehab = { es_rehabilitacion: true, protocolos: [
    { id: "cadera/po", region: "Cadera", nombre: "PO fractura de cadera o fémur", requiere_lateralidad: true, pasos: [{ texto: "CHC 15 min" }] },
  ] };

  it("el botón manda el protocolo y el lado elegido", () => {
    const onInsertar = vi.fn();
    render(<ConsultaFeed recording gaps={[]} alertas={null} rehab={rehab} onInsertarRehab={onInsertar} />);
    fireEvent.click(screen.getByRole("button", { name: "IZQUIERDO" }));
    fireEvent.click(screen.getByRole("button", { name: /Agregar el protocolo a la nota SOAP/ }));
    expect(onInsertar).toHaveBeenCalledWith("cadera/po", "izquierdo");
  });

  it("tras agregarlo, lo dice y ya no ofrece el botón", () => {
    render(<ConsultaFeed recording gaps={[]} alertas={null} rehab={rehab} onInsertarRehab={() => {}}
      rehabInsertado={{ insertados: 8, lateralidad: "derecho", lateralidad_inferida: true, lado_pendiente: false }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Agregado al Plan \(8 pasos\) · lado derecho \(tomado de la nota\)/);
    expect(screen.queryByRole("button", { name: /Agregar el protocolo/ })).not.toBeInTheDocument();
    render(<ConsultaFeed recording gaps={[]} alertas={null} rehab={rehab} onInsertarRehab={() => {}}
      rehabInsertado={{ insertados: 8, lateralidad: null, lado_pendiente: true }} />);
    expect(screen.getAllByRole("status")[1]).toHaveTextContent(/lado por definir/);
  });
});
