import React from "react";
import RealConsulta from "./real_consulta";

// ============ CONSULTA ACTIVA (v0.0.1) ============
// Siempre graba audio real (MediaRecorder/AudioWorklet -> backend -> ASR/MLX).
// El timeline simulado (SimulatedConsulta, resumen ejecutivo, SOAP/vitales/Dx
// progresivos con datos enlatados) se eliminó en la 0.0.1.
const Consulta = ({ patient, motivo, consultationId, ensureConsultation, onBack, onFinish, user, voiceEnabled }) => (
  <RealConsulta
    patient={patient}
    motivo={motivo}
    consultationId={consultationId}
    ensureConsultation={ensureConsultation}
    onBack={onBack}
    onFinish={onFinish}
    user={user}
    voiceEnabled={voiceEnabled}
  />
);

export default Consulta;
