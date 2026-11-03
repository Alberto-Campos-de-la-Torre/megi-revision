// ============ MEGI VOZ — CLASIFICADOR MOCK (Fase 1) ============
// Prototipo SIN ejecución real y SIN ASR/LLM: clasifica un comando de texto de
// forma determinista (palabras clave) para demostrar la UX de "Consulta asistida
// por voz". No toca el SOAP/dx/receta reales; opera sobre un contexto de ejemplo.
//
// Decisión de producto: la palabra de activación "MEGI" es OBLIGATORIA (no hay
// modo sin wake-word en esta fase).

import { attachCommandMeta, VOICE_RISK } from "./voice_command_registry";

export const WAKE = "megi";

// Detección DIFUSA de la palabra de activación: el ASR real escribe "MEGI" con
// variantes ("Meji" verificado, "Megui", "Meggi"...). Se acepta el primer token
// si coincide con las variantes frecuentes o queda a ≤1 edición de "megi".
// Opera sobre texto normalizado (sin acentos, minúsculas).
export function isWakeToken(tok) {
  if (!tok) return false;
  if (/^me[gj]{1,2}u?i$/.test(tok)) return true;   // meji / megui / meggi (distancia 2 incluida)
  const b = WAKE;                                   // distancia de edición ≤ 1
  if (Math.abs(tok.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < tok.length && j < b.length) {
    if (tok[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (tok.length > b.length) i++;
    else if (tok.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (tok.length - i) + (b.length - j) <= 1;
}

export const LISTENING = {
  CLINICAL: "escuchando consulta",
  COMMAND: "esperando comando",
  CONFIRM: "esperando confirmación",
};

const LOW = VOICE_RISK.LOW;
const SENSITIVE = VOICE_RISK.CLINICAL;
const AMBIGUOUS = VOICE_RISK.AMBIGUOUS;

const norm = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const titleCase = (s) => (s || "").replace(/\b\w/g, (ch) => ch.toUpperCase());

// Limpia colas de intención dentro de un nombre dictado, p. ej.
// "edgar torres para iniciar consulta" -> "Edgar Torres".
const cleanName = (s) => titleCase((s || "")
  .replace(/\s+(para|y|e)\s+(iniciar|inicia|empezar|empieza|comenzar|comienza|abrir|hacer|ver)\b.*/, "")
  .replace(/\s+para\s+(la\s+|una\s+)?consulta\b.*/, "")
  .replace(/\s+(para\s+)?consultar?\b.*/, "")
  .replace(/\s+por\s+favor\b.*/, "")
  .replace(/[\s,.]+$/, "")
  .trim());

// Extrae el texto dictado del ORIGINAL (con acentos), para agregar/reemplazar SOAP.
const dictatedText = (origRest, kind) => {
  const re = kind === "add"
    ? /(?:agrega|añade|agregar|añadir)\s+(?:a\s+|en\s+)?(?:subjetivo|objetivo|an[aá]lisis|plan)\s*[:,]?\s*(.+)/i
    : /reemplaza(?:r)?\s+(?:el\s+|la\s+)?(?:subjetivo|objetivo|an[aá]lisis|plan)\s+(?:con|por)\s+(.+)/i;
  const mm = (origRest || "").match(re);
  return mm ? cap(mm[1].trim()) : null;
};

// Extrae el texto del medicamento del ORIGINAL (con acentos), para la receta.
const medFromOrig = (origRest) => {
  const mm = (origRest || "").match(/(?:agrega|añade|agregar|añadir)\s+(.+?\d+\s?m(?:g|iligramos).+)/i);
  return mm ? cap(mm[1].trim()) : null;
};

// Parte un texto de medicamento en {drug, dose, freq} (heurística ligera).
// "Losartán 50 mg cada 24 horas" -> { drug:"Losartán", dose:"50 mg", freq:"cada 24 horas" }
export function parseMed(text) {
  const t = (text || "").trim();
  const doseM = t.match(/(\d+(?:[.,]\d+)?\s*(?:mg|g|mcg|ml|ui|comprimidos?|tabletas?|c[aá]psulas?))/i);
  const freqM = t.match(/(cada\s+[\w\s]+?horas?|c\/\s?\d+\s*h(?:oras?)?|(?:una|dos|tres) veces al d[ií]a|una vez al d[ií]a|prn|sublingual|por raz[oó]n necesaria)/i);
  const dose = doseM ? doseM[1].trim() : "";
  const freq = freqM ? freqM[1].trim() : "";
  let drug = t;
  if (dose) drug = drug.replace(dose, " ");
  if (freq) drug = drug.replace(freq, " ");
  drug = drug.replace(/\s+/g, " ").replace(/[\s,]+$/, "").trim();
  return { drug: cap(drug), dose, freq };
}

// Mini-catálogo CIE-10 para que las propuestas muestren descripción (demo).
const CIE = {
  "i10": "I10 Hipertensión esencial (primaria)",
  "e78.5": "E78.5 Hiperlipidemia, no especificada",
  "i20.9": "I20.9 Angina de pecho, no especificada",
  "e11.9": "E11.9 Diabetes mellitus tipo 2 sin complicaciones",
  "n39.0": "N39.0 Infección de vías urinarias",
};
const cieLabel = (code) => CIE[norm(code)] || code.toUpperCase();

const SECTIONS = {
  subjetivo: "subjetivo", objetivo: "objetivo",
  analisis: "analisis", "análisis": "analisis", plan: "plan",
};

// Contexto clínico de EJEMPLO (no es un paciente real).
export function initialContext() {
  return {
    primaryDx: "I20.9 Angina de pecho, no especificada",
    dxList: ["I20.9 Angina de pecho, no especificada"],
    meds: ["Aspirina 100 mg c/24h"],
    soap: {
      subjetivo: "Dolor torácico opresivo de 30 minutos.",
      objetivo: "TA 150/95, FC 88.",
      analisis: "Probable síndrome coronario; requiere valoración.",
      plan: "Reposo. ECG. Valoración por cardiología.",
    },
  };
}

// Comandos de ejemplo mostrados como chips en la consola (del documento de diseño).
export const EXAMPLE_COMMANDS = [
  { group: "Navegación", items: ["MEGI, ir a agenda", "MEGI, ir a revisión", "MEGI, mostrar impresión"] },
  { group: "Pacientes", items: ["MEGI, abrir paciente Jorge Delgado", "MEGI, mostrar alergias del paciente"] },
  { group: "Grabación", items: ["MEGI, pausar escucha", "MEGI, continuar escucha", "MEGI, detener consulta"] },
  { group: "SOAP", items: ["MEGI, agrega a plan: seguimiento en siete días", "MEGI, reemplaza el plan con control en un mes", "MEGI, elimina la última frase del análisis"] },
  { group: "Diagnósticos", items: ["MEGI, cambiar diagnóstico principal a I10", "MEGI, agrega diagnóstico E78.5", "MEGI, quitar diagnóstico I20.9"] },
  { group: "Receta", items: ["MEGI, agrega losartán 50 mg cada 24 horas", "MEGI, elimina aspirina"] },
  { group: "Documentos", items: ["MEGI, guardar borrador", "MEGI, preparar impresión"] },
];

// Construye la respuesta base.
function make(over) {
  return attachCommandMeta({
    source: "voice",
    utterance: "",
    wake_word_detected: false,
    rejected: false,          // true solo cuando falta "MEGI" y es obligatorio
    intent: "unknown",
    entities: {},
    risk_level: AMBIGUOUS,
    requires_confirmation: false,
    action: null,
    message: "",
    proposal: null,
    ...over,
  });
}

function proposal({ intent, action, field, current, proposed, entities }) {
  return {
    proposal_id: `prop_${intent}`,
    intent,
    action,
    field,
    current_value: current,
    proposed_value: proposed,
    entities,
    requires_confirmation: true,
    confirmation_prompt: `Voy a ${propVerb(action)}. Confirma con "sí" o cancela con "no".`,
  };
}

function propVerb(action) {
  switch (action) {
    case "change_primary_dx": return "cambiar el diagnóstico principal";
    case "add_dx": return "agregar un diagnóstico";
    case "remove_dx": return "quitar un diagnóstico";
    case "add_med": return "agregar un medicamento";
    case "remove_med": return "quitar un medicamento";
    case "soap_add": return "agregar texto a la nota";
    case "soap_replace": return "reemplazar una sección de la nota";
    case "soap_delete_last": return "eliminar la última frase";
    case "stop_recording": return "detener la consulta";
    case "prepare_print": return "preparar la impresión";
    default: return "aplicar el cambio";
  }
}

// Clasifica un comando (texto) en intención + (si aplica) propuesta.
// options.requireWake (default true): si es false (modo experto), procesa comandos
// aunque NO empiecen con "MEGI".
export function classifyCommand(raw, ctx, options = {}) {
  const requireWake = options.requireWake !== false;
  const utterance = (raw || "").trim();
  const n = norm(utterance);

  const wm = n.match(/^([^\s,]+)[\s,]+(.*)$/);
  let c, origRest, wakeDetected;
  if (wm && isWakeToken(wm[1]) && wm[2].trim()) {
    c = wm[2].trim();
    // Texto original (con acentos/mayúsculas) sin la palabra de activación, para
    // preservar el dictado clínico tal cual (la nota SOAP no debe perder acentos).
    origRest = utterance.replace(/^\s*[^\s,]+[\s,]+/, "").trim();
    wakeDetected = true;
  } else if (!requireWake && n) {
    // Modo experto: sin palabra de activación, se procesa el texto completo.
    c = n;
    origRest = utterance;
    wakeDetected = false;
  } else {
    // Palabra de activación obligatoria y ausente.
    if (/^(si|no|cancela|cancelar|aplica|aplicar)$/.test(n)) {
      return make({ utterance, intent: "confirmation",
        message: "No hay ningún cambio pendiente que confirmar." });
    }
    return make({ utterance, rejected: true,
      message: 'Los comandos deben iniciar con "MEGI". Ejemplo: "MEGI, ir a agenda".' });
  }
  const b = { utterance, wake_word_detected: wakeDetected };

  // Contexto tolerante a vacío (el bar global no tiene SOAP real).
  const ctxo = ctx || {};
  const soap = ctxo.soap || {};
  const meds = ctxo.meds || [];
  const dxList = ctxo.dxList || [];
  const primaryDx = ctxo.primaryDx || "(sin diagnóstico principal)";

  // --- Navegación (baja sensibilidad, ejecución directa) ---
  // Con manos libres global, mencionar una vista NO basta ("¿cuántos pacientes
  // tengo hoy?" no debe navegar): se exige verbo de navegación, o que el
  // comando sea SOLO la vista ("MEGI, pacientes").
  const navVerb = /\b(ir|ve|vamos|abrir|abre|mostrar|muestra(?:me)?|ensename?|llevame|volver|regresa)\b/.test(c);
  const bareCmd = c.split(/\s+/).filter(Boolean).length <= 2;
  const wantsNav = navVerb || bareCmd;
  if (/\b(agenda)\b/.test(c) && wantsNav)
    return make({ ...b, intent: "set_view", action: "set_view", entities: { view: "dashboard" }, risk_level: LOW, message: "Abriendo la agenda." });
  if (/\bpacientes\b|\bexpedientes\b/.test(c)) {
    if (wantsNav && !/\bpaciente\b/.test(c))
      return make({ ...b, intent: "set_view", action: "set_view", entities: { view: "pacientes" }, risk_level: LOW, message: "Abriendo pacientes." });
    if (!navVerb && !bareCmd)
      return make({ ...b, intent: "unknown", risk_level: AMBIGUOUS,
        message: 'Para ir a la lista di "MEGI, ir a pacientes"; para abrir uno, "MEGI, abrir paciente [nombre]".' });
  }
  if (/\bgu[i]as\b|\bfuentes\b|\bbiblioteca\b/.test(c) && wantsNav)
    return make({ ...b, intent: "set_view", action: "set_view", entities: { view: "guias" }, risk_level: LOW, message: "Abriendo guías." });
  if (/\bestadisticas\b|\bmetricas\b/.test(c) && wantsNav)
    return make({ ...b, intent: "set_view", action: "set_view", entities: { view: "estadisticas" }, risk_level: LOW, message: "Abriendo estadísticas." });
  if (/megi voz|control por voz/.test(c))
    return make({ ...b, intent: "set_view", action: "set_view", entities: { view: "voz" }, risk_level: LOW, message: "Abriendo MEGI Voz." });
  if (/revisi[o]n/.test(c))
    return make({ ...b, intent: "set_view", action: "set_view", entities: { view: "revision" }, risk_level: LOW, message: "Abriendo revisión." });
  if (/consulta activa/.test(c))
    return make({ ...b, intent: "open_active", action: "open_active", risk_level: LOW, message: "Abriendo la consulta activa." });
  if (/mostrar impresi[o]n|ir a impresi[o]n/.test(c))
    return make({ ...b, intent: "set_view", action: "set_view", entities: { view: "imprimir" }, risk_level: LOW, message: "Mostrando la vista de impresión." });
  if (/^(volver|regresa|atras)/.test(c))
    return make({ ...b, intent: "go_back", action: "go_back", risk_level: LOW, message: "Volviendo a la pantalla anterior." });

  // --- Pacientes (tolerante a artículos y a colas de intención) ---
  let m;
  if ((m = c.match(/buscar\s+(?:a\s+|al\s+|el\s+|la\s+)?(?:paciente|expediente(?:\s+de)?)\s+(.+)/))) {
    const name = cleanName(m[1]);
    return make({ ...b, intent: "search_patient", action: "search_patient", entities: { name }, risk_level: LOW, message: `Buscando "${name}" en pacientes.` });
  }
  const pm =
    c.match(/(?:abrir|abre|abreme|ver|mostrar|muestrame|ensename?)\s+(?:a\s+|al\s+|el\s+|la\s+)?(?:paciente|expediente(?:\s+de)?)\s+(.+)/) ||
    c.match(/(?:iniciar|inicia|empezar|empieza|comenzar|comienza)\s+(?:la\s+|una\s+)?consulta\s+(?:de|con|para|a|al)\s+(.+)/) ||
    c.match(/(?:abrir|abre)\s+(?:a\s+|al\s+)?(.+?)\s+(?:para|y|e)\s+(?:iniciar|inicia|empezar|comenzar)\b/);
  if (pm) {
    const name = cleanName(pm[1]);
    if (!name)
      return make({ ...b, intent: "open_patient", risk_level: AMBIGUOUS, message: "¿A qué paciente te refieres?" });
    // Si el comando menciona iniciar/empezar consulta, arranca la consulta;
    // si no, solo abre el expediente.
    const wantsConsult = /\b(iniciar|inicia|empezar|empieza|comenzar|comienza)\b/.test(c);
    if (wantsConsult)
      return make({ ...b, intent: "start_consult", action: "start_consult", entities: { name }, risk_level: LOW, message: `Iniciando consulta de ${name}.` });
    return make({ ...b, intent: "open_patient", action: "open_patient", entities: { name }, risk_level: LOW, message: `Abriendo el expediente de ${name}.` });
  }
  if (/mostrar alergias/.test(c))
    return make({ ...b, intent: "show_allergies", action: "show_allergies", risk_level: LOW, message: "Mostrando alergias del paciente." });

  // --- Grabación (tolerante a conjugación y artículos: "finaliza la consulta") ---
  if (/(inicia(r)?|empieza|comienza)\s+(la\s+|una\s+)?(consulta|escucha|grabaci[o]n)\b/.test(c))
    return make({ ...b, intent: "start_recording", action: "start_recording", risk_level: LOW, message: "Iniciando la escucha de la consulta." });
  if (/\bpausa(r)?\b/.test(c))
    return make({ ...b, intent: "pause_recording", action: "pause_recording", risk_level: LOW, message: "Escucha en pausa." });
  if (/\bcontinua(r)?\b|\breanuda(r)?\b/.test(c))
    return make({ ...b, intent: "resume_recording", action: "resume_recording", risk_level: LOW, message: "Reanudando la escucha." });
  if (/(deten(er)?|finaliza(r)?|termina(r)?)\s+(la\s+|el\s+)?(consulta|escucha|grabaci[o]n)\b|finalizar y revisar|ya terminamos|ya acabamos/.test(c))
    return make({ ...b, intent: "stop_recording", action: "stop_recording", risk_level: SENSITIVE, requires_confirmation: true,
      proposal: proposal({ intent: "stop_recording", action: "stop_recording", field: "consulta", current: "en curso", proposed: "detenida (pasar a revisión)", entities: {} }) });

  // --- SOAP (edición: siempre propuesta antes de aplicar) ---
  if ((m = c.match(/(agrega|anade|agregar|anadir) (?:a |en )?(subjetivo|objetivo|analisis|plan)[:,]? (.+)/))) {
    const sec = SECTIONS[m[2]]; const text = dictatedText(origRest, "add") || cap(m[3]);
    const cur = (soap[sec] || "");
    return make({ ...b, intent: "soap_add", action: "soap_add", entities: { section: sec, text }, risk_level: SENSITIVE, requires_confirmation: true,
      proposal: proposal({ intent: "soap_add", action: "soap_add", field: `soap.${sec}`, current: cur, proposed: `${cur} ${text}`.trim(), entities: { section: sec, text } }) });
  }
  if ((m = c.match(/reemplaza(?:r)? (?:el |la )?(subjetivo|objetivo|analisis|plan) (?:con|por) (.+)/))) {
    const sec = SECTIONS[m[1]]; const text = dictatedText(origRest, "replace") || cap(m[2]);
    return make({ ...b, intent: "soap_replace", action: "soap_replace", entities: { section: sec, text }, risk_level: SENSITIVE, requires_confirmation: true,
      proposal: proposal({ intent: "soap_replace", action: "soap_replace", field: `soap.${sec}`, current: (soap[sec] || ""), proposed: text, entities: { section: sec, text } }) });
  }
  if ((m = c.match(/elimina(?:r)? la ultima frase (?:del|de la|de) (subjetivo|objetivo|analisis|plan)/))) {
    const sec = SECTIONS[m[1]]; const cur = (soap[sec] || "");
    const parts = cur.split(/(?<=\.)\s+/).filter(Boolean); parts.pop();
    return make({ ...b, intent: "soap_delete_last", action: "soap_delete_last", entities: { section: sec }, risk_level: SENSITIVE, requires_confirmation: true,
      proposal: proposal({ intent: "soap_delete_last", action: "soap_delete_last", field: `soap.${sec}`, current: cur, proposed: parts.join(" ") || "(vacío)", entities: { section: sec } }) });
  }

  // --- Diagnósticos ---
  // Diagnósticos por CÓDIGO CIE o por NOMBRE. Con código, propone directo; con
  // nombre ("hipertensión"), el editor lo resuelve contra el buscador CIE-10 y
  // presenta pick-list estructurada (nunca texto libre directo al diagnóstico).
  // El código no captura el punto FINAL de oración del ASR ("I10.").
  const CODE_RE = /^([a-z]\d\w*(?:\.\w+)?)\.?$/;
  const dxEntity = (raw, origRe) => {
    const codeM = (raw || "").trim().match(CODE_RE);
    if (codeM) return { code: codeM[1] };
    // Nombre: se toma del ORIGINAL (con acentos) para buscar bien en CIE-10.
    const om = (origRest || "").match(origRe);
    const query = ((om && om[1]) || raw || "").replace(/[\s,.]+$/, "").trim();
    return { query };
  };
  if ((m = c.match(/cambi[ao]r? (?:el )?diagn[o]stico principal a (.+)/))) {
    const e = dxEntity(m[1], /principal a (.+)/i);
    return make({ ...b, intent: "change_primary_diagnosis", action: "change_primary_dx", entities: e, risk_level: SENSITIVE, requires_confirmation: true,
      proposal: proposal({ intent: "change_primary_diagnosis", action: "change_primary_dx", field: "selected_dx.primary", current: primaryDx,
        proposed: e.code ? cieLabel(e.code) : `${cap(e.query)} (por confirmar código CIE-10)`, entities: e }) });
  }
  if ((m = c.match(/(agrega|anade|agregar) (?:el )?diagn[o]stico (?:de )?(.+)/))) {
    const e = dxEntity(m[2], /diagn[oó]stico (?:de )?(.+)/i);
    return make({ ...b, intent: "add_diagnosis", action: "add_dx", entities: e, risk_level: SENSITIVE, requires_confirmation: true,
      proposal: proposal({ intent: "add_diagnosis", action: "add_dx", field: "selected_dx", current: dxList.join("; "),
        proposed: [...dxList, e.code ? cieLabel(e.code) : `${cap(e.query)} (por confirmar código CIE-10)`].join("; "), entities: e }) });
  }
  if ((m = c.match(/(quita|quitar|elimina|eliminar) (?:el )?diagn[o]stico (?:de )?(.+)/))) {
    const e = dxEntity(m[2], /diagn[oó]stico (?:de )?(.+)/i);
    const key = e.code || e.query;
    return make({ ...b, intent: "remove_diagnosis", action: "remove_dx", entities: e, risk_level: SENSITIVE, requires_confirmation: true,
      proposal: proposal({ intent: "remove_diagnosis", action: "remove_dx", field: "selected_dx", current: dxList.join("; "),
        proposed: dxList.filter((d) => !norm(d).includes(norm(key))).join("; ") || "(vacío)", entities: e }) });
  }

  // --- Receta ---
  if ((m = c.match(/(agrega|anade|agregar) (.+\d+\s?m(?:g|iligramos).+)/))) {
    const med = medFromOrig(origRest) || cap(m[2]);
    return make({ ...b, intent: "add_medication", action: "add_med", entities: { med }, risk_level: SENSITIVE, requires_confirmation: true,
      proposal: proposal({ intent: "add_medication", action: "add_med", field: "prescription", current: meds.join("; "), proposed: [...meds, med].join("; "), entities: { med } }) });
  }
  if ((m = c.match(/(elimina|quita|quitar|eliminar) (aspirina|losartan|nitroglicerina|[a-z]+)/))) {
    const med = m[2];
    return make({ ...b, intent: "remove_medication", action: "remove_med", entities: { med }, risk_level: SENSITIVE, requires_confirmation: true,
      proposal: proposal({ intent: "remove_medication", action: "remove_med", field: "prescription", current: meds.join("; "), proposed: meds.filter((x) => !norm(x).includes(norm(med))).join("; ") || "(vacío)", entities: { med } }) });
  }
  if (/revisar interacciones/.test(c))
    return make({ ...b, intent: "check_interactions", action: "check_interactions", risk_level: LOW, message: "Revisando interacciones de la receta." });

  // --- Documentos ---
  if (/guardar? borrador/.test(c))
    return make({ ...b, intent: "save_draft", action: "save_draft", risk_level: LOW, message: "Borrador guardado." });
  if (/preparar impresi[o]n/.test(c))
    return make({ ...b, intent: "prepare_print", action: "prepare_print", risk_level: SENSITIVE, requires_confirmation: true,
      proposal: proposal({ intent: "prepare_print", action: "prepare_print", field: "impresión", current: "sin preparar", proposed: "hoja lista para imprimir", entities: {} }) });
  if (/mostrar resumen/.test(c))
    return make({ ...b, intent: "show_summary", action: "show_summary", risk_level: LOW, message: "Mostrando el resumen para el paciente." });

  // --- Ambiguo ---
  return make({ ...b, intent: "unknown", risk_level: AMBIGUOUS,
    message: "No estoy seguro de qué acción quieres. Prueba con un comando de la lista." });
}

// Aplica (SIMULADO) una propuesta al contexto de ejemplo. Devuelve un contexto nuevo.
export function applyProposal(ctx, p) {
  const next = JSON.parse(JSON.stringify(ctx));
  const e = p.entities || {};
  switch (p.action) {
    case "change_primary_dx":
      next.primaryDx = p.proposed_value;
      if (next.dxList.length) next.dxList[0] = p.proposed_value; else next.dxList = [p.proposed_value];
      break;
    case "add_dx": next.dxList.push(p.proposed_value.split("; ").pop()); break;
    case "remove_dx": next.dxList = next.dxList.filter((d) => !norm(d).startsWith(norm(e.code))); break;
    case "add_med": next.meds.push(e.med); break;
    case "remove_med": next.meds = next.meds.filter((x) => !norm(x).includes(norm(e.med))); break;
    case "soap_add": next.soap[e.section] = `${next.soap[e.section]} ${e.text}`.trim(); break;
    case "soap_replace": next.soap[e.section] = e.text; break;
    case "soap_delete_last": {
      const parts = next.soap[e.section].split(/(?<=\.)\s+/).filter(Boolean); parts.pop();
      next.soap[e.section] = parts.join(" ");
      break;
    }
    default: break; // stop_recording / prepare_print: no cambian el contexto de ejemplo
  }
  return next;
}
