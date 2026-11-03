// ============ MEGI API CLIENT (v0.0.1) ============
// Transporte HTTP contra el backend FastAPI (proxy /api -> :8000).
// Modos soportados: "real" (inferencia real vía microservicio ASR/MLX) y
// "local_mock" (backend/SQLite reales, ASR/LLM mock). El antiguo modo "demo"
// (sin backend, datos de src/mock/data.js) se eliminó en la 0.0.1.

export const MODE = import.meta.env.VITE_MEGI_MODE || "real";

// Versión de ESTE build (la inyecta vite.config.js). Se compara con la del
// backend para detectar que app y servidor no son de la misma versión.
export const BUILD = typeof __MEGI_BUILD__ === "string" ? __MEGI_BUILD__ : "dev";

const API_BASE = ""; // relativo: Vite proxya /api -> http://localhost:8000

// Token de sesión firmado (lo emite /auth/login). Se manda en cada petición;
// el backend verifica firma + rol en los endpoints protegidos.
function authHeader() {
  try {
    const s = JSON.parse(localStorage.getItem("megi.session") || "null");
    return s && s.token ? { Authorization: `Bearer ${s.token}` } : {};
  } catch (e) {
    return {};
  }
}

// Token de sesión crudo (para el WebSocket ASR, que no admite cabeceras).
export function sessionToken() {
  try {
    const s = JSON.parse(localStorage.getItem("megi.session") || "null");
    return (s && s.token) || "";
  } catch (e) {
    return "";
  }
}

// URL del WebSocket ASR (proxy autenticado del backend). El navegador no puede
// mandar Authorization en `new WebSocket()`, así que se pide por REST un TICKET
// de un solo uso y 30 s de vida: eso —y no el token de sesión— es lo único que
// viaja en la URL (antes el token quedaba expuesto en logs).
export async function asrStreamUrl(consultationId) {
  // En producción la app la sirve el propio backend, así que el WS sale del
  // mismo origen que la página (funcione en el puerto que funcione). En
  // desarrollo, `.env` apunta a :8000 porque la página vive en Vite (:5173).
  const sameOrigin = typeof window !== "undefined" && window.location
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/asr/stream/general`
    : "ws://localhost:8000/api/asr/stream/general";
  const base = import.meta.env.VITE_ASR_WS_URL || sameOrigin;
  const { ticket } = await request("/asr/ticket", {
    method: "POST",
    body: { consultation_id: consultationId || null },
  });
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}ticket=${encodeURIComponent(ticket)}`;
}

// ---- transporte HTTP ----
async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...authHeader(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== "/auth/login") {
    // Sesión inválida/expirada -> avisar a la app para cerrar sesión.
    try { window.dispatchEvent(new Event("megi:unauthorized")); } catch (e) { /* noop */ }
  }
  if (!res.ok) {
    let detail = `${method} ${path} -> ${res.status}`;
    try { const j = await res.json(); if (j && j.detail) detail = j.detail; } catch (e) { /* sin cuerpo */ }
    throw new Error(detail);
  }
  return res.json();
}

// Descarga un recurso protegido (audio) con el token y devuelve un object URL.
// Necesario porque <audio src> nativo no envía el header Authorization.
export async function apiBlobUrl(path) {
  const res = await fetch(`${API_BASE}/api${path}`, { headers: authHeader() });
  if (res.status === 401) { try { window.dispatchEvent(new Event("megi:unauthorized")); } catch (e) { /* noop */ } }
  if (!res.ok) throw new Error(`media ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

// ============================================================================
// API pública — todo contra backend; sin ramas demo ni datos mock en el cliente.
// ============================================================================
export const api = {
  mode: MODE,

  async getHealth() {
    return request("/health");
  },

  async login({ username, password }) {
    return request("/auth/login", { method: "POST", body: { username, password } });
  },

  // Cierra la sesión EN EL SERVIDOR (el token deja de valer, no basta con
  // borrar localStorage). Nunca revienta: cerrar sesión no puede fallar.
  async logout() {
    try { return await request("/auth/logout", { method: "POST" }); }
    catch (e) { return { ok: false }; }
  },
  async sessions() {
    return request("/auth/sessions");
  },

  // Perfil profesional del médico (lo que se imprime en documentos legales).
  async getMe() {
    return request("/me");
  },
  async updateMe(body) {
    return request("/me", { method: "PATCH", body });
  },

  // Salud REAL de los servicios de modelo (§4): el backend pregunta al ASR en
  // vez de fiarse del flag de config. Devuelve null si no se puede consultar,
  // para que el indicador se quede neutro en vez de mentir diciendo "ok".
  async servicesHealth() {
    try { return await request("/health/services"); }
    catch (e) { return null; }
  },

  // P2 — primer arranque seguro.
  async setupStatus() {
    return request("/auth/setup-status");
  },
  async setup({ username, name, password }) {
    return request("/auth/setup", { method: "POST", body: { username, name, password } });
  },
  async changePassword({ current_password, new_password }) {
    return request("/auth/change-password", { method: "POST", body: { current_password, new_password } });
  },

  async getUsers() {
    return request("/users");
  },

  async createUser(body) {
    return request("/users", { method: "POST", body });
  },

  async deleteUser(username) {
    return request(`/users/${username}`, { method: "DELETE" });
  },
  async setUserVisibility(username, soloVisibleParaMi) {
    return request(`/users/${encodeURIComponent(username)}/visibilidad`,
                   { method: "PATCH", body: { solo_visible_para_mi: !!soloVisibleParaMi } });
  },

  // ---- Catálogo de medicamentos (Etapa 2) ----
  async getMedications(estado) {
    return request(`/medications${estado ? `?estado=${estado}` : ""}`);
  },
  async createMedication(body) {
    return request("/medications", { method: "POST", body });
  },
  async patchMedication(id, body) {
    return request(`/medications/${id}`, { method: "PATCH", body });
  },
  async approveMedication(id) {
    return request(`/medications/${id}/approve`, { method: "POST" });
  },
  async deleteMedication(id) {
    return request(`/medications/${id}`, { method: "DELETE" });
  },
  async gpcSuggestMedication(id) {
    return request(`/medications/${id}/gpc-suggest`, { method: "POST" });
  },

  // ---- Consultor de fármacos (tipo Drugs.com) ----
  async drugsConsult({ question, rx_context }) {
    return request("/drugs/consult", { method: "POST", body: { question, rx_context } });
  },
  async drugsAlternatives({ rx_list, farmaco_a, farmaco_b, severidad, mecanismo }) {
    return request("/drugs/alternatives", { method: "POST", body: { rx_list, farmaco_a, farmaco_b, severidad, mecanismo } });
  },
  // Verificador FDA (tabla de contraindicaciones de FDA_movil): alertas con cita.
  async drugsCheck({ rx_list, conditions, allergies, age, sex, embarazo, patient_id }) {
    return request("/drugs/check", { method: "POST", body: { rx_list, conditions, allergies, age, sex, embarazo, patient_id } });
  },

  // ---- Interacciones farmacológicas (Etapa 3) ----
  async getDrugInteractions(estado) {
    return request(`/drug-interactions${estado ? `?estado=${estado}` : ""}`);
  },
  async generateDrugInteractions() {
    return request("/drug-interactions/generate", { method: "POST" });
  },
  async patchDrugInteraction(id, body) {
    return request(`/drug-interactions/${id}`, { method: "PATCH", body });
  },
  async approveDrugInteraction(id) {
    return request(`/drug-interactions/${id}/approve`, { method: "POST" });
  },
  async deleteDrugInteraction(id) {
    return request(`/drug-interactions/${id}`, { method: "DELETE" });
  },

  async createPatient(body) {
    return request("/patients", { method: "POST", body });
  },

  async updatePatientProfile(patientId, { allergies, chronic }) {
    return request(`/patients/${patientId}/profile`, { method: "PATCH", body: { allergies, chronic } });
  },

  async getConfig() {
    return request("/config");
  },

  async getPatients() {
    const data = await request("/patients");
    return Array.isArray(data) ? data : data.patients || [];
  },

  async getPatient(id) {
    return request(`/patients/${id}`);
  },

  async getPatientConsultations(id) {
    return request(`/patients/${id}/consultations`);
  },

  async getPatientVitals(id) {
    return request(`/patients/${id}/vitals`);
  },

  // Expediente consolidado del paciente y su lectura por el modelo (resumen +
  // preguntas). Van por POST: generan texto, no consultan un recurso fijo. En
  // local_mock el backend responde sin modelo y lo marca en `fuente`.
  async getExpediente(id) {
    return request(`/patients/${id}/expediente`);
  },
  async getExpedienteResumen(id) {
    return request(`/patients/${id}/expediente/resumen`, { method: "POST", body: {} });
  },
  async preguntarExpediente(id, { pregunta, historial = [] }) {
    return request(`/patients/${id}/expediente/preguntar`, { method: "POST", body: { pregunta, historial } });
  },
  // ---- Estudios que trae el paciente (pantalla previa al SOAP) ----
  // Escritorio: con sesión, por consulta. Teléfono: sin sesión, con el código
  // del QR (ver `subida*`). Los archivos van en multipart, no en JSON.
  async getEstudios(cid) {
    return request(`/consultations/${cid}/estudios`);
  },
  async subirEstudio(cid, file) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    const res = await fetch(`${API_BASE}/api/consultations/${cid}/estudios`, { method: "POST", body: fd, headers: authHeader() });
    if (res.status === 401) { try { window.dispatchEvent(new Event("megi:unauthorized")); } catch (e) { /* noop */ } }
    if (!res.ok) {
      let detail = `archivo ${res.status}`;
      try { const j = await res.json(); if (j && j.detail) detail = j.detail; } catch (e) { /* sin cuerpo */ }
      throw new Error(detail);
    }
    return res.json();
  },
  async borrarEstudio(cid, eid) {
    return request(`/consultations/${cid}/estudios/${eid}`, { method: "DELETE" });
  },
  async estadoEstudios(cid, estado) {
    return request(`/consultations/${cid}/estudios/estado`, { method: "POST", body: { estado } });
  },
  estudioVistaPath(cid, eid) {
    return `/consultations/${cid}/estudios/${eid}/vista`;
  },
  estudioOriginalPath(cid, eid) {
    return `/consultations/${cid}/estudios/${eid}/original`;
  },
  // Análisis automático: tipo identificado, lo que dijeron los modelos y el
  // pre-diagnóstico vigente. El backend lo rehace solo tras cada subida.
  async getEstudiosAnalisis(cid) {
    return request(`/consultations/${cid}/estudios/analisis`);
  },
  async analizarEcografia(cid, eid, seleccion) {
    return request(`/consultations/${cid}/estudios/${eid}/ecografia`, { method: "POST", body: seleccion });
  },
  ecografiaVistaPath(cid, eid) { return `/consultations/${cid}/estudios/${eid}/ecografia/vista`; },
  async reanalizarEstudio(cid, eid) {
    return request(`/consultations/${cid}/estudios/${eid}/analizar`, { method: "POST", body: {} });
  },
  async regenerarPrediagnostico(cid) {
    return request(`/consultations/${cid}/estudios/prediagnostico`, { method: "POST", body: {} });
  },
  async preguntarEstudios(cid, { pregunta, historial = [] }) {
    return request(`/consultations/${cid}/estudios/preguntar`, { method: "POST", body: { pregunta, historial } });
  },
  // Megi IA en Revisión: sobre esta consulta y este paciente (con la nota tal
  // como el médico la está dejando), más guías por RAG en el servicio real.
  async preguntarConsulta(cid, { pregunta, historial = [], soap = null, dx = null, rx = null }) {
    return request(`/consultations/${cid}/preguntar`, { method: "POST", body: { pregunta, historial, soap, dx, rx } });
  },
  // Radiología MEGI: catálogo de modelos y carpeta de estudios del paciente.
  async getModelosRadiologia() {
    return request("/radiologia/modelos");
  },
  async carpetaRadiologia(pid) {
    return request(`/patients/${pid}/radiologia/carpeta`, { method: "POST", body: {} });
  },
  // Anestesio (modelos restringidos): catálogo (403 si el usuario no está autorizado)
  // y autorización por usuario desde Administración.
  async getModelosAnestesio() {
    return request("/anestesio/modelos");
  },
  // Abrir la mesa del anestesiólogo: segundo factor (la misma contraseña).
  async ingresarAnestesio(password) {
    return request("/anestesio/ingresar", { method: "POST", body: { password } });
  },
  async patchUserAnestesio(username, acceso) {
    return request(`/users/${encodeURIComponent(username)}/anestesio`, { method: "PATCH", body: { acceso } });
  },
  async crearEnlaceSubida(cid) {
    return request(`/consultations/${cid}/estudios/enlace`, { method: "POST", body: {} });
  },
  async revocarEnlaceSubida(cid) {
    return request(`/consultations/${cid}/estudios/enlace`, { method: "DELETE" });
  },
  // Teléfono (sin sesión): el código del QR es la única credencial.
  async subidaInfo(token) {
    const res = await fetch(`${API_BASE}/api/subida/${encodeURIComponent(token)}`);
    if (!res.ok) {
      let detail = `código ${res.status}`;
      try { const j = await res.json(); if (j && j.detail) detail = j.detail; } catch (e) { /* sin cuerpo */ }
      throw new Error(detail);
    }
    return res.json();
  },
  async subidaArchivo(token, file) {
    const fd = new FormData();
    fd.append("file", file, file.name || "foto.jpg");
    const res = await fetch(`${API_BASE}/api/subida/${encodeURIComponent(token)}/archivo`, { method: "POST", body: fd });
    if (!res.ok) {
      let detail = `archivo ${res.status}`;
      try { const j = await res.json(); if (j && j.detail) detail = j.detail; } catch (e) { /* sin cuerpo */ }
      throw new Error(detail);
    }
    return res.json();
  },

  async getPreconsulta(id, { personalizar = true, motivo = "", consultationId = "" } = {}) {
    // Motor de edad + motivo de hoy: qué preguntar/revisar antes de la consulta.
    //
    // Con motivo va por POST, no por GET: el motivo es dato clínico del paciente
    // y en la query string acabaría en los registros de acceso del servidor y
    // del túnel de Cloudflare. El id de consulta sí puede ir en la URL.
    if (motivo) {
      return request(`/patients/${id}/preconsulta`, {
        method: "POST",
        body: { motivo, personalizar, consultation_id: consultationId || "" },
      });
    }
    const q = new URLSearchParams();
    if (!personalizar) q.set("personalizar", "0");
    if (consultationId) q.set("consultation_id", consultationId);
    const qs = q.toString();
    return request(`/patients/${id}/preconsulta${qs ? `?${qs}` : ""}`);
  },

  // ---- Radiología: informe de estudio (flujo propio, sin paciente delante) ----
  async radiologiaModalidades() {
    return request("/radiologia/modalidades");
  },
  async radiologiaInformes(patientId) {
    return request(`/radiologia/informes${patientId ? `?patient_id=${patientId}` : ""}`);
  },
  async radiologiaCrear(body) {
    return request("/radiologia/informes", { method: "POST", body });
  },
  async radiologiaEditar(id, body) {
    return request(`/radiologia/informes/${id}`, { method: "PATCH", body });
  },
  async radiologiaFirmar(id) {
    return request(`/radiologia/informes/${id}/firmar`, { method: "POST" });
  },
  async radiologiaDictar({ id, file }) {
    // El dictado va como audio: el backend transcribe y reparte en secciones.
    const fd = new FormData();
    fd.append("file", file, file.name || "dictado.webm");
    const res = await fetch(`${API_BASE}/api/radiologia/informes/${id}/dictado`, {
      method: "POST", body: fd, headers: authHeader(),
    });
    if (res.status === 401) { try { window.dispatchEvent(new Event("megi:unauthorized")); } catch (e) { /* noop */ } }
    if (!res.ok) {
      let detail = `dictado ${res.status}`;
      try { const j = await res.json(); if (j && j.detail) detail = j.detail; } catch (e) { /* sin cuerpo */ }
      throw new Error(detail);
    }
    return res.json();
  },
  // --- imágenes del estudio (JPG/PNG/WebP/DICOM, hasta 4) y lectura asistida
  async radiologiaImagenes(id) {
    return request(`/radiologia/informes/${id}/imagenes`);
  },
  async radiologiaSubirImagen({ id, file }) {
    const fd = new FormData();
    fd.append("file", file, file.name || "imagen");
    const res = await fetch(`${API_BASE}/api/radiologia/informes/${id}/imagenes`, {
      method: "POST", body: fd, headers: authHeader(),
    });
    if (res.status === 401) { try { window.dispatchEvent(new Event("megi:unauthorized")); } catch (e) { /* noop */ } }
    if (!res.ok) {
      let detail = `imagen ${res.status}`;
      try { const j = await res.json(); if (j && j.detail) detail = j.detail; } catch (e) { /* sin cuerpo */ }
      throw new Error(detail);
    }
    return res.json();
  },
  async radiologiaBorrarImagen(id, imagenId) {
    return request(`/radiologia/informes/${id}/imagenes/${imagenId}`, { method: "DELETE" });
  },
  async radiologiaVistaUrl(id, imagenId) {
    // La vista va con sesión: un <img src> directo daría 401. Mismo camino que
    // el audio (apiBlobUrl). Quien lo pide revoca el object URL al desmontar.
    return apiBlobUrl(`/radiologia/informes/${id}/imagenes/${imagenId}/vista`);
  },
  async radiologiaAnalizar(id) {
    return request(`/radiologia/informes/${id}/analizar`, { method: "POST" });
  },

  async pendientesEnVivo({ consultationId, motivo, preguntasMotivo = [] }) {
    // Qué falta preguntar. Determinista en el backend: NO pasa por el LLM, así
    // que se puede llamar en cada chunk sin quitarle GPU a la transcripción.
    // `preguntasMotivo` son las que el modelo propuso en la pre-consulta (con
    // sus claves); el backend las vigila junto a las de las guías.
    return request("/live/pendientes", {
      method: "POST",
      body: { consultation_id: consultationId, motivo: motivo || null,
              preguntas_motivo: preguntasMotivo && preguntasMotivo.length ? preguntasMotivo : undefined },
    });
  },

  async calcularGasometria(valores) {
    // Calculadoras deterministas (Winter, anión gap, electrolitos): el backend
    // no guarda nada, solo calcula. Un 400 significa dato mal capturado.
    return request("/calculo/gasometria", { method: "POST", body: valores });
  },

  async calcularTendencia(serie) {
    return request("/calculo/gasometria/tendencia", { method: "POST", body: { serie } });
  },

  async createAppointment(body) {
    return request("/appointments", { method: "POST", body });
  },

  async getPatientAppointments(id) {
    return request(`/patients/${id}/appointments`);
  },

  async getUpcomingAppointments() {
    return request("/appointments/upcoming");
  },

  async getStats() {
    return request("/stats");
  },

  async getAudit(consultationId) {
    return request(`/consultations/${consultationId}/audit`);
  },

  async getFhir(consultationId) {
    return request(`/consultations/${consultationId}/fhir`);
  },

  async checkRx({ rx_list, allergies, chronic }) {
    return request("/safety/rx-check", { method: "POST", body: { rx_list, allergies, chronic } });
  },

  // Fase 4: auditoría persistente de un cambio hecho por voz.
  async logReviewEvent({ consultation_id, kind, payload }) {
    return request("/review/event", { method: "POST", body: { consultation_id, kind, payload } });
  },

  async searchCie10(q) {
    return request(`/cie10/search?q=${encodeURIComponent(q)}`);
  },

  async createDocument(body) {
    return request("/documents", { method: "POST", body });
  },

  async getConsultationDocuments(consultationId) {
    return request(`/consultations/${consultationId}/documents`);
  },

  async getDocumentSuggestions(consultationId, { refresh = false } = {}) {
    // Fase 11: qué documentos amerita la consulta (heurística + gemma, cacheado).
    return request(`/consultations/${consultationId}/documents/suggestions${refresh ? "?refresh=1" : ""}`);
  },

  async getGuidelines(q = "") {
    return request(`/guidelines${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  },

  async getGuideline(docId) {
    return request(`/guidelines/${encodeURIComponent(docId)}`);
  },

  async searchGuidelines(q) {
    return request(`/guidelines/search?q=${encodeURIComponent(q)}`);
  },

  async guidelinePdfUrl(docId) {
    // PDF original de la guía. Va con sesión, así que un <iframe src> directo
    // daría 401: se baja como blob (mismo camino que el audio) y se embebe.
    // Quien lo pide revoca el object URL al cambiar de guía.
    return apiBlobUrl(`/guidelines/${encodeURIComponent(docId)}/pdf`);
  },

  async chatGuidelines({ question, k = 5 }) {
    return request("/guidelines/chat", { method: "POST", body: { question, k } });
  },

  async createConsultation(body) {
    return request("/consultations", { method: "POST", body });
  },

  async getConsultation(id) {
    return request(`/consultations/${id}`);
  },

  async patchConsultation(id, body) {
    return request(`/consultations/${id}`, { method: "PATCH", body });
  },

  async reviewSave(body) {
    return request("/review/save", { method: "POST", body });
  },

  async reviewApprove(body) {
    return request("/review/approve", { method: "POST", body });
  },

  async uploadAudio({ file, consultationId, audioKind, entityType, slotId }) {
    // Sube audio real (FormData) al backend; éste lo convierte a wav16k y llama al ASR.
    const fd = new FormData();
    fd.append("file", file, file.name || "audio.webm");
    fd.append("consultation_id", consultationId);
    fd.append("audio_kind", audioKind);
    if (entityType) fd.append("entity_type", entityType);
    if (slotId) fd.append("slot_id", slotId);
    const res = await fetch(`${API_BASE}/api/audio/upload`, { method: "POST", body: fd, headers: authHeader() });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    return res.json();
  },

  async transcribeVoiceCommand({ file, consultationId }) {
    // Fase 6: audio corto de comando agéntico -> ASR local/backend. No usa Web
    // Speech API del navegador para evitar depender de servicios externos.
    const fd = new FormData();
    fd.append("file", file, file.name || "voice-command.webm");
    if (consultationId) fd.append("consultation_id", consultationId);
    const res = await fetch(`${API_BASE}/api/voice/command/transcribe`, { method: "POST", body: fd, headers: authHeader() });
    if (res.status === 401) { try { window.dispatchEvent(new Event("megi:unauthorized")); } catch (e) { /* noop */ } }
    if (!res.ok) {
      let detail = `voice command ${res.status}`;
      try { const j = await res.json(); if (j && j.detail) detail = j.detail; } catch (e) { /* sin cuerpo */ }
      throw new Error(detail);
    }
    return res.json();
  },

  async parseCommandShadow({ text, regex_intent, source, context }) {
    // Fase 9B: parser LLM en SHADOW MODE — propone, no ejecuta; queda registrado
    // en el backend (voice_shadow.jsonl) para evaluación.
    return request("/voice/command/parse", { method: "POST", body: { text, regex_intent, source, context } });
  },

  async speakerStatus() {
    // Fase 10: ¿hay huella vocal del médico registrada para este usuario?
    return request("/voice/speaker/status");
  },

  async enrollSpeaker({ file, password }) {
    // Fase 10: registra la huella vocal (solo se persiste el embedding).
    // Regrabar una huella existente exige la contraseña (re-autenticación).
    const fd = new FormData();
    fd.append("file", file, file.name || "enroll.wav");
    if (password) fd.append("password", password);
    const res = await fetch(`${API_BASE}/api/voice/speaker/enroll`, { method: "POST", body: fd, headers: authHeader() });
    if (res.status === 401) { try { window.dispatchEvent(new Event("megi:unauthorized")); } catch (e) { /* noop */ } }
    if (!res.ok) {
      let detail = `enroll ${res.status}`;
      try { const j = await res.json(); if (j && j.detail) detail = j.detail; } catch (e) { /* sin cuerpo */ }
      throw new Error(detail);
    }
    return res.json();
  },

  async probeWakeCommand({ file, consultationId }) {
    // Fase 8 (manos libres): sondea un enunciado corto por la palabra "MEGI".
    // Sin wake word el backend descarta el audio y NO devuelve texto.
    const fd = new FormData();
    fd.append("file", file, file.name || "wake-probe.wav");
    if (consultationId) fd.append("consultation_id", consultationId);
    const res = await fetch(`${API_BASE}/api/voice/wake/probe`, { method: "POST", body: fd, headers: authHeader() });
    if (res.status === 401) { try { window.dispatchEvent(new Event("megi:unauthorized")); } catch (e) { /* noop */ } }
    if (!res.ok) {
      let detail = `wake probe ${res.status}`;
      try { const j = await res.json(); if (j && j.detail) detail = j.detail; } catch (e) { /* sin cuerpo */ }
      throw new Error(detail);
    }
    return res.json();
  },

  async uploadChunk({ file, consultationId, chunkIdx }) {
    const fd = new FormData();
    fd.append("file", file, file.name || "chunk.wav");
    fd.append("consultation_id", consultationId);
    fd.append("chunk_idx", String(chunkIdx));
    const res = await fetch(`${API_BASE}/api/audio/chunk`, { method: "POST", body: fd, headers: authHeader() });
    if (!res.ok) throw new Error(`chunk ${res.status}`);
    return res.json();
  },

  // --- Rehabilitación: sugerencia de indicaciones y captura de la corrección.
  async rehabConsulta(consultationId) {
    return request(`/rehab/consulta/${consultationId}`);
  },
  async rehabMostrada({ consultationId, protocoloId, alternativas }) {
    return request("/rehab/mostrada", { method: "POST", body: {
      consultation_id: consultationId, protocolo_id: protocoloId, alternativas,
    } });
  },
  // Consulta en vivo: agrega el protocolo al Plan en automático (el médico lo edita al aprobar).
  async rehabInsertar({ consultationId, protocoloId, lateralidad }) {
    return request("/rehab/insertar", { method: "POST", body: {
      consultation_id: consultationId, protocolo_id: protocoloId, lateralidad: lateralidad || null,
    } });
  },
  async rehabAplicar({ consultationId, protocoloId, pasosPropuestos, pasosAceptados, lateralidad, reglasMostradas, elegidoOrden }) {
    return request("/rehab/aplicar", { method: "POST", body: {
      consultation_id: consultationId, protocolo_id: protocoloId,
      pasos_propuestos: pasosPropuestos, pasos_aceptados: pasosAceptados,
      lateralidad, reglas_mostradas: reglasMostradas, elegido_orden: elegidoOrden,
    } });
  },

  async soapUpdate({ consultationId, newConfirmedText, chunkIdx }) {
    return request("/soap/update", { method: "POST", body: {
      consultation_id: consultationId, new_confirmed_text: newConfirmedText, chunk_idx: chunkIdx,
    } });
  },

  async soapFinalize({ consultationId }) {
    return request("/soap/finalize", { method: "POST", body: {
      consultation_id: consultationId,
    } });
  },

  async getSoap(consultationId) {
    return request(`/soap/${consultationId}`);
  },

  async exportConsultation(id) {
    return request(`/export/consultation/${id}`, { method: "GET" });
  },
};

export default api;
