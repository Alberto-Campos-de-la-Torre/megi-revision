// ============ GRABADOR DE AUDIO (MediaRecorder) ============
// Vive aquí y no dentro de una pantalla porque lo usan varias: la consulta
// (audio general e identificador) y el motivo de la visita en la pre-consulta.

import React from "react";

export default function useRecorder() {
  const [recording, setRecording] = React.useState(false);
  const [blob, setBlob] = React.useState(null);
  const [url, setUrl] = React.useState(null);
  const mr = React.useRef(null);
  const chunks = React.useRef([]);
  const streamRef = React.useRef(null);

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    chunks.current = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
    rec.onstop = () => {
      const b = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      setBlob(b);
      setUrl(URL.createObjectURL(b));
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    mr.current = rec;
    rec.start();
    setRecording(true);
  };
  const stop = () => { try { mr.current?.stop(); } catch (e) { /* noop */ } setRecording(false); };
  const reset = () => { setBlob(null); setUrl(null); };

  // Al abandonar la consulta (botón "← Agenda" o flecha del navegador) este
  // componente se desmonta y `rec.onstop` ya NO llega, que es donde se cerraba
  // el micrófono: sin esto el navegador se queda escuchando en segundo plano
  // después de salir. En una consulta eso no es un detalle.
  React.useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return { recording, blob, url, start, stop, reset };
}
