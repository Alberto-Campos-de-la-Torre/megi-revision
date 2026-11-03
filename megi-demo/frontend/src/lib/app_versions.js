// ============ MEGI — VERSIONES DE USO ============
// La selección ocurre después del login. Se guarda dentro de la sesión activa para
// que el usuario elija cómo quiere trabajar antes de montar la app clínica.

export const APP_VERSION_IDS = {
  AUTO: "consulta_automatica",
  VOICE: "consulta_asistida_voz",
};

export const APP_VERSIONS = [
  {
    id: APP_VERSION_IDS.AUTO,
    title: "Consulta automática",
    label: "MEGI automático",
    badge: "Recomendado",
    badgeVariant: "sage-solid",
    summary: "Escucha, transcribe y arma la nota clínica sin controles agénticos.",
    bullets: [
      "Agenda, pacientes, guías, revisión e impresión.",
      "SOAP automático desde audio clínico.",
      "Sin barra global de comandos.",
    ],
    features: { voiceAgent: false },
    startView: "dashboard",
  },
  {
    id: APP_VERSION_IDS.VOICE,
    title: "Consulta asistida por voz",
    label: "MEGI Voz",
    badge: "Beta",
    badgeVariant: "gold",
    summary: "Incluye comandos agénticos bajo política, confirmación y auditoría.",
    bullets: [
      "Barra global de comandos y botón Dictar.",
      "Edición por voz de SOAP, CIE-10 y receta en Revisión.",
      "Modo experto opcional y controles de seguridad.",
    ],
    features: { voiceAgent: true },
    startView: "dashboard",
  },
];

export function getAppVersion(id) {
  return APP_VERSIONS.find((v) => v.id === id) || null;
}

export function isValidAppVersion(id) {
  return !!getAppVersion(id);
}

export function defaultAppVersion() {
  return APP_VERSIONS[0];
}
