// ============ MEGI VOZ — ROUTER DE COMANDOS (Fase 2) ============
// Traduce la intención (del clasificador) a ACCIONES REALES de la app, pero SOLO
// para comandos de baja sensibilidad (navegación, abrir/buscar paciente, volver).
// Las acciones sensibles (SOAP/dx/receta, aprobar, imprimir, detener) NO se
// ejecutan aquí: se devuelven como propuesta (ejecución real en Fase 3/4).
//
// `actions` inyecta las capacidades reales del contenedor (App):
//   setView(id), openPatient(patient), goBack(), hasActiveConsult(), goRevision()
// `patients` es la lista real de pacientes (para resolver nombres).

import { evaluateCommandPolicy, VOICE_CONTEXT, VOICE_RISK } from "./voice_command_registry";

const norm = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();

const VIEW_LABEL = {
  dashboard: "Agenda", pacientes: "Pacientes", guias: "Guías",
  estadisticas: "Estadísticas", voz: "MEGI Voz", revision: "Revisión",
  imprimir: "Impresión", consulta: "Consulta",
};

// Vistas de baja sensibilidad a las que se puede navegar directo por voz.
const NAV_ALLOWED = new Set(["dashboard", "pacientes", "guias", "estadisticas", "voz", "imprimir"]);

// Distancia de edición acotada, para tolerar cómo el ASR escribe los nombres
// ("JORGIE" por "Jorge") sin abrir el match a nombres realmente distintos.
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array(b.length + 1).fill(0); row[0] = i; return row;
  });
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// Tolerancia proporcional al largo: nombres cortos exigen exactitud.
function tokenMatches(spoken, nameTok) {
  if (nameTok.includes(spoken) || spoken.includes(nameTok)) return true;
  const tol = spoken.length >= 6 ? 2 : spoken.length >= 4 ? 1 : 0;
  return tol > 0 && editDistance(spoken, nameTok) <= tol;
}

export function resolvePatients(name, patients) {
  const q = norm(name);
  if (!q) return [];
  const toks = q.split(/\s+/).filter(Boolean);
  // 1) Pase exacto (substring por token), como siempre.
  const exact = (patients || []).filter((p) => {
    const hay = `${norm(p.name)} ${norm(p.short || "")}`;
    return toks.every((t) => hay.includes(t));
  });
  if (exact.length) return exact;
  // 2) Pase difuso: cada token dictado debe acercarse a ALGÚN token del nombre.
  //    Si hay varios candidatos, el flujo de desambiguación existente decide.
  return (patients || []).filter((p) => {
    const nameToks = `${norm(p.name)} ${norm(p.short || "")}`.split(/\s+/).filter(Boolean);
    return toks.every((t) => nameToks.some((nt) => tokenMatches(t, nt)));
  });
}

// Ejecuta (o propone) un comando ya clasificado. Devuelve un resultado uniforme:
//   { status, message, candidates?, proposal? }
//   status: executed | info | not_found | ambiguous | needs_confirmation | rejected
export function routeCommand(result, { actions, patients, context = VOICE_CONTEXT.GLOBAL, permissions, policy } = {}) {
  if (!result || result.rejected)
    return { status: "rejected", message: result?.message || 'Los comandos deben iniciar con "MEGI".' };

  if (result.risk_level === "ambiguous")
    return { status: "info", message: result.message };

  const decision = evaluateCommandPolicy(result, {
    context,
    permissions,
    policy,
    // La barra global puede mostrar propuestas de acciones clínicas, pero nunca
    // aplicarlas. El editor clínico sí exige contexto estricto antes de aplicar.
    enforceContext: false,
  });
  if (!decision.allowed) {
    return { status: "rejected", message: decision.message, command: decision.command, reason: decision.reason };
  }

  const risk = decision.command?.risk || result.risk_level;

  // Acciones sensibles: NO se ejecutan desde el router global.
  if (risk !== VOICE_RISK.LOW && result.requires_confirmation) {
    return {
      status: "needs_confirmation",
      message: "Acción sensible: se muestra como propuesta y solo puede aplicarse desde el contexto autorizado.",
      proposal: result.proposal || null,
      command: decision.command,
    };
  }

  // --- Baja sensibilidad: ejecución real ---
  switch (result.action) {
    case "set_view": {
      const v = result.entities.view;
      if (v === "revision") {
        if (actions.hasActiveConsult()) { actions.goRevision(); return ok("Revisión"); }
        return { status: "info", message: "No hay una consulta activa para revisar." };
      }
      if (v === "imprimir" && !actions.hasActiveConsult())
        return { status: "info", message: "No hay una consulta activa para imprimir." };
      if (!NAV_ALLOWED.has(v) && v !== "imprimir")
        return { status: "info", message: "No puedo navegar ahí por voz." };
      actions.setView(v);
      return ok(VIEW_LABEL[v] || v);
    }

    case "open_active": {
      if (actions.hasActiveConsult()) { actions.setView("consulta"); return ok("Consulta activa"); }
      return { status: "info", message: "No hay una consulta activa." };
    }

    case "go_back": {
      actions.goBack();
      return { status: "executed", message: "Listo: pantalla anterior." };
    }

    case "open_patient":
      return resolveAndAct(result.entities.name, patients, "openExpediente", actions,
        (p) => `Abriendo el expediente de ${p.name}.`);

    case "start_consult":
      return resolveAndAct(result.entities.name, patients, "startConsulta", actions,
        (p) => `Iniciando consulta de ${p.name}.`);

    case "search_patient": {
      const matches = resolvePatients(result.entities.name, patients);
      actions.setView("pacientes");
      if (matches.length === 0)
        return { status: "info", message: `Fui a Pacientes; sin coincidencias para "${result.entities.name}".` };
      return { status: "info", message: `Fui a Pacientes. Coincidencias: ${matches.map((m) => m.name).join(", ")}.` };
    }

    // Comandos aún sin acción real conectada -> informativos y honestos sobre dónde viven.
    case "start_recording":
    case "pause_recording":
    case "resume_recording":
      return { status: "info", message: `“${labelFor(result.action)}” se controla por voz desde el panel MEGI Voz de la pantalla de consulta.` };
    case "save_draft":
      return { status: "info", message: "“guardar borrador” por voz aún no está conectado; usa el botón Guardar en Revisión." };
    case "show_allergies":
    case "check_interactions":
    case "show_summary":
      return { status: "info", message: `“${labelFor(result.action)}” aún no está conectado por voz.` };

    default:
      return { status: "info", message: result.message || "No pude interpretar el comando." };
  }
}

function ok(label) {
  return { status: "executed", message: `Listo: ${label}.` };
}

// Resuelve un nombre contra la lista real y ejecuta `actionName` (o desambigua).
function resolveAndAct(name, patients, actionName, actions, msg) {
  const matches = resolvePatients(name, patients);
  if (matches.length === 0)
    return { status: "not_found", message: `No encontré a "${name}" en la lista de pacientes.` };
  if (matches.length > 1)
    return { status: "ambiguous", message: `Hay ${matches.length} pacientes que coinciden con "${name}". ¿Cuál?`, candidates: matches, pickAction: actionName };
  actions[actionName](matches[0]);
  return { status: "executed", message: msg(matches[0]) };
}

function labelFor(action) {
  return {
    show_allergies: "mostrar alergias", check_interactions: "revisar interacciones",
    show_summary: "mostrar resumen", save_draft: "guardar borrador",
    start_recording: "iniciar escucha", pause_recording: "pausar escucha",
    resume_recording: "continuar escucha",
  }[action] || action;
}
