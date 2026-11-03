import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import EstudiosPaciente from "../components/estudios_paciente";
import SubirTelefono from "../components/subir_telefono";
import { api } from "../api/client";

// La pantalla previa al SOAP: crea la consulta al entrar, sube lo que se
// arrastra o se elige, genera el QR para el teléfono y deja constancia al
// continuar sin estudios. La página del teléfono sube solo con el código.

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QR") } }));

const PACIENTE = { id: "P-1", name: "Ana López", age: 40, sex: "F" };
const archivo = (nombre) => new File(["x"], nombre, { type: "image/png" });

describe("estudios que trae el paciente", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getEstudiosAnalisis").mockResolvedValue({ estado: null, estudios: [], max: 20, prediagnostico: null, servicio_modelos: { url: true, disponible: true } });
    vi.spyOn(api, "revocarEnlaceSubida").mockResolvedValue({ ok: true });
  });

  it("crea la consulta al entrar y sube lo que se suelta en la zona", async () => {
    const ensure = vi.fn().mockResolvedValue("C-1");
    const subir = vi.spyOn(api, "subirEstudio").mockResolvedValue({ id: "EA-1", nombre: "rx.png", formato: "png", bytes: 1200, tiene_vista: false, origen: "escritorio" });
    render(<EstudiosPaciente patient={PACIENTE} motivo="tos" consultationId={null} ensureConsultation={ensure} onContinue={() => {}} onBack={() => {}} />);
    expect(await screen.findByText(/Estudios que trae Ana López/)).toBeInTheDocument();
    await waitFor(() => expect(ensure).toHaveBeenCalled());
    await waitFor(() => expect(api.getEstudiosAnalisis).toHaveBeenCalledWith("C-1"));

    const zona = screen.getByLabelText("Zona para soltar archivos");
    fireEvent.drop(zona, { dataTransfer: { files: [archivo("rx.png")] } });
    await waitFor(() => expect(subir).toHaveBeenCalledWith("C-1", expect.any(File)));
    expect(await screen.findByText("rx.png")).toBeInTheDocument();
    expect(screen.getByText("escritorio")).toBeInTheDocument();
  });

  it("también sube lo elegido desde el selector de archivos y muestra el fallo", async () => {
    vi.spyOn(api, "subirEstudio").mockRejectedValue(new Error("formato no reconocido"));
    render(<EstudiosPaciente patient={PACIENTE} consultationId="C-1" ensureConsultation={vi.fn()} onContinue={() => {}} onBack={() => {}} />);
    const input = await screen.findByLabelText("Elegir archivos");
    fireEvent.change(input, { target: { files: [archivo("nota.txt")] } });
    expect(await screen.findByText(/No se subió «nota.txt»: formato no reconocido/)).toBeInTheDocument();
  });

  it("genera el QR con el enlace del backend y muestra la cuenta atrás", async () => {
    const crear = vi.spyOn(api, "crearEnlaceSubida").mockResolvedValue({
      token: "abc", url: "https://megiia.com/subir/abc", expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), expira_en_s: 900,
    });
    render(<EstudiosPaciente patient={PACIENTE} consultationId="C-1" ensureConsultation={vi.fn()} onContinue={() => {}} onBack={() => {}} />);
    fireEvent.click(await screen.findByLabelText("Generar código QR"));
    expect(await screen.findByAltText("Código QR para subir desde el teléfono")).toHaveAttribute("src", "data:image/png;base64,QR");
    expect(crear).toHaveBeenCalledWith("C-1");
    expect(screen.getByText("https://megiia.com/subir/abc")).toBeInTheDocument();
    expect(screen.getByText(/caduca en 1[45]:/)).toBeInTheDocument();
  });

  it("«Continuar sin estudios» deja constancia y pasa a la consulta", async () => {
    const estado = vi.spyOn(api, "estadoEstudios").mockResolvedValue({ ok: true });
    const onContinue = vi.fn();
    render(<EstudiosPaciente patient={PACIENTE} consultationId="C-1" ensureConsultation={vi.fn()} onContinue={onContinue} onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Continuar sin estudios"));
    await waitFor(() => expect(onContinue).toHaveBeenCalled());
    expect(estado).toHaveBeenCalledWith("C-1", "sin_estudios");
  });

  it("con estudios ya subidos, «sin estudios» se bloquea y «Continuar» marca con_estudios", async () => {
    api.getEstudiosAnalisis.mockResolvedValue({ estado: "con_estudios", max: 20, servicio_modelos: { url: true, disponible: true },
      estudios: [{ id: "EA-9", nombre: "labs.pdf", formato: "pdf", bytes: 5000, tiene_vista: false, origen: "telefono", tipo: "pdf_texto",
                   tipo_label: "Documento PDF con texto", analisis_estado: "listo",
                   analisis: [{ id: 1, analizador: "pdf_texto", modelo: "pypdf", status: "done", resumen: "Texto extraído del PDF (primeras líneas): GLUCOSA 142" }] }],
      prediagnostico: { version: 1, fuente: "mock", texto: "[E1] labs.pdf — Documento PDF con texto. GLUCOSA 142", aviso: "Pre-diagnóstico automático." } });
    const estado = vi.spyOn(api, "estadoEstudios").mockResolvedValue({ ok: true });
    const onContinue = vi.fn();
    render(<EstudiosPaciente patient={PACIENTE} consultationId="C-1" ensureConsultation={vi.fn()} onContinue={onContinue} onBack={() => {}} />);
    expect(await screen.findByText("labs.pdf")).toBeInTheDocument();
    expect(screen.getByText("teléfono")).toBeInTheDocument();
    expect(screen.getByText("Documento PDF con texto")).toBeInTheDocument();
    expect(screen.getAllByText(/GLUCOSA 142/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("Pre-diagnóstico de los estudios")).toHaveTextContent("[E1] labs.pdf");
    expect(screen.getByText("simulado · sin modelo de lenguaje")).toBeInTheDocument();
    expect(screen.getByText("Continuar sin estudios")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Continuar a la consulta"));
    await waitFor(() => expect(onContinue).toHaveBeenCalled());
    expect(estado).toHaveBeenCalledWith("C-1", "con_estudios");
  });
});

describe("página del teléfono", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("muestra a quién sube y manda la foto con el código", async () => {
    vi.spyOn(api, "subidaInfo").mockResolvedValue({ ok: true, paciente: "Ana L.", expira_en_s: 600, subidos: 0, max: 20, max_mb: 60 });
    const subir = vi.spyOn(api, "subidaArchivo").mockResolvedValue({ id: "EA-2" });
    render(<SubirTelefono token="abc" />);
    expect(await screen.findByText("Subir estudios de Ana L.")).toBeInTheDocument();
    const input = screen.getByLabelText("Tomar foto").querySelector("input");
    expect(input).toHaveAttribute("capture", "environment");
    fireEvent.change(input, { target: { files: [archivo("foto.jpg")] } });
    await waitFor(() => expect(subir).toHaveBeenCalledWith("abc", expect.any(File)));
    expect(await screen.findByText("✓ listo")).toBeInTheDocument();
  });

  it("con un código inválido lo dice y no deja subir", async () => {
    vi.spyOn(api, "subidaInfo").mockRejectedValue(new Error("el código no es válido o ya caducó"));
    render(<SubirTelefono token="malo" />);
    expect(await screen.findByText("Este código no sirve")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tomar foto")).not.toBeInTheDocument();
  });
});


describe("estudios y pre-diagnóstico en revisión", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("«→ Objetivo» añade el hallazgo y el pre-diagnóstico a la sección O", async () => {
    const { default: EstudiosStrip } = await import("../components/estudios_strip");
    vi.spyOn(api, "getEstudiosAnalisis").mockResolvedValue({
      estado: "con_estudios",
      estudios: [{ id: "EA-1", nombre: "rx.png", formato: "png", tiene_vista: false, tipo: "torax", tipo_label: "Radiografía de tórax", analisis_estado: "listo",
                   analisis: [{ id: 7, modelo: "Megi_torax_one", status: "done", resumen: "Presente: Cardiomegalia (61 %)." }] }],
      prediagnostico: { version: 2, fuente: "mock", texto: "Cardiomegalia probable [E1].", aviso: "apoyo" },
    });
    let soap = { S: "", O: "FC 88.", A: "", P: "" };
    const setSoap = vi.fn((s) => { soap = s; });
    vi.spyOn(api, "radiologiaInformes").mockResolvedValue([{ id: "IR-1", modalidad: "radiografia", modalidad_label: "Radiografía", region: "tórax",
      fecha_estudio: "2026-10-01", status: "firmado", impresion: "Sin alteraciones." }]);
    const { rerender } = render(<EstudiosStrip consultationId="C-1" patientId="P-1" soap={soap} setSoap={setSoap} />);
    expect(await screen.findByLabelText("Estudios del Paciente")).toBeInTheDocument();
    expect(await screen.findByText("Sin alteraciones.")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Externo").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByLabelText("Interno").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(await screen.findByLabelText("Pasar al Objetivo: rx.png"));
    expect(soap.O).toBe("FC 88.\nrx.png (Radiografía de tórax): Presente: Cardiomegalia (61 %).");
    rerender(<EstudiosStrip consultationId="C-1" patientId="P-1" soap={soap} setSoap={setSoap} />);
    fireEvent.click(screen.getByLabelText("Pasar el pre-diagnóstico al Objetivo"));
    expect(soap.O).toContain("pre-diagnóstico MEGI, revisar): Cardiomegalia probable [E1].");
    rerender(<EstudiosStrip consultationId="C-1" patientId="P-1" soap={soap} setSoap={setSoap} />);
    fireEvent.click(screen.getByLabelText("Pasar al Objetivo: informe IR-1"));
    expect(soap.O).toContain("Radiografía de tórax (MEGI, 2026-10-01): Sin alteraciones.");
  });

  it("sin nota editable no ofrece el botón", async () => {
    const { default: EstudiosStrip } = await import("../components/estudios_strip");
    vi.spyOn(api, "getEstudiosAnalisis").mockResolvedValue({
      estado: "con_estudios",
      estudios: [{ id: "EA-1", nombre: "rx.png", formato: "png", tiene_vista: false, tipo: "torax", tipo_label: "Radiografía de tórax", analisis_estado: "listo",
                   analisis: [{ id: 7, modelo: "Megi_torax_one", status: "done", resumen: "Presente: Cardiomegalia (61 %)." }] }],
      prediagnostico: { version: 1, fuente: "llm", texto: "Cardiomegalia probable [E1].", aviso: "apoyo" },
    });
    render(<EstudiosStrip consultationId="C-1" />);
    expect(await screen.findByText(/Cardiomegalia probable/)).toBeInTheDocument();
    expect(screen.getByText("Megi-LLM")).toBeInTheDocument();
    expect(screen.queryByText("→ Objetivo")).not.toBeInTheDocument();
  });
});


describe("tarjeta vacía en la consulta", () => {
  it("con `siempre` se pinta aunque no haya estudios", async () => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getEstudiosAnalisis").mockResolvedValue({ estado: "sin_estudios", estudios: [], prediagnostico: null });
    vi.spyOn(api, "radiologiaInformes").mockResolvedValue([]);
    const { default: EstudiosStrip } = await import("../components/estudios_strip");
    render(<EstudiosStrip consultationId="C-1" patientId="P-1" siempre />);
    expect(await screen.findByText("El paciente no trajo estudios.")).toBeInTheDocument();
    expect(screen.getByLabelText("Estudios del Paciente")).toBeInTheDocument();
  });
});


describe("modo de una línea en la consulta", () => {
  it("muestra cada estudio con su marca y sin el detalle de los análisis; el pre-diagnóstico va aparte", async () => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getEstudiosAnalisis").mockResolvedValue({
      estado: "con_estudios",
      estudios: [{ id: "EA-1", nombre: "labs.jpg", formato: "jpg", tiene_vista: false, tipo: "documento_foto", tipo_label: "Foto de documento (leída por OCR)", analisis_estado: "listo",
                   analisis: [{ id: 1, modelo: "Lectura de laboratorio", status: "done", resumen: "1 analito reconocido. Todos dentro de su referencia: colesterol total 157." }] }],
      prediagnostico: { version: 2, fuente: "mock", texto: "[E1] labs.jpg — Foto de documento. 1 analito reconocido.", aviso: "apoyo" },
    });
    vi.spyOn(api, "radiologiaInformes").mockResolvedValue([{ id: "IR-1", modalidad: "radiografia", modalidad_label: "Radiografía", region: "tórax", fecha_estudio: "2026-10-01", status: "firmado", impresion: "Sin alteraciones." }]);
    const { default: EstudiosStrip, PrediagnosticoMegi } = await import("../components/estudios_strip");
    render(<EstudiosStrip consultationId="C-1" patientId="P-1" siempre lineaUnica conPrediagnostico={false} />);
    expect(await screen.findByLabelText("Abrir labs.jpg")).toBeInTheDocument();
    expect(screen.getByText("Radiografía de tórax")).toBeInTheDocument();
    expect(screen.queryByText(/Todos dentro de su referencia/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Pre-diagnóstico MEGI")).not.toBeInTheDocument();

    render(<PrediagnosticoMegi consultationId="C-1" />);
    expect(await screen.findByLabelText("Pre-diagnóstico MEGI")).toHaveTextContent("[E1] labs.jpg");
    expect(screen.getByLabelText("Pregúntale a Megi IA sobre estos estudios")).toBeInTheDocument();
  });
});


describe("agregar más estudios en plena consulta", () => {
  it("abre la ventana de subida sin pre-diagnóstico y se cierra sin cortar nada", async () => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getEstudiosAnalisis").mockResolvedValue({ estado: "con_estudios", estudios: [], prediagnostico: { version: 1, fuente: "mock", texto: "x", aviso: "a" } });
    vi.spyOn(api, "radiologiaInformes").mockResolvedValue([]);
    vi.spyOn(api, "revocarEnlaceSubida").mockResolvedValue({ ok: true });
    const { default: EstudiosStrip } = await import("../components/estudios_strip");
    render(<EstudiosStrip consultationId="C-1" patientId="P-1" patient={PACIENTE} siempre lineaUnica conPrediagnostico={false} />);
    fireEvent.click(await screen.findByLabelText("Agregar Más Estudios"));
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo).toHaveTextContent("Agregar más estudios");
    expect(screen.getByLabelText("Zona para soltar archivos")).toBeInTheDocument();
    expect(screen.getByLabelText("Generar código QR")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pre-diagnóstico de los estudios")).not.toBeInTheDocument();
    expect(screen.queryByText("Continuar sin estudios")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Cerrar"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
