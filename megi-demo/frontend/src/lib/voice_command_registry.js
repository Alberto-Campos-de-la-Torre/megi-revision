// ============ MEGI VOZ — REGISTRO EMPRESARIAL DE COMANDOS (Fase 6) ============
// Fuente única de políticas para comandos agénticos: riesgo, contexto, permiso,
// confirmación y auditoría. El clasificador sigue detectando la intención; este
// registro decide qué tan sensible es y dónde puede aplicarse.

export const VOICE_RISK = {
  LOW: "low",
  WORKFLOW: "workflow_sensitive",
  CLINICAL: "clinical_sensitive",
  LEGAL: "legal_sensitive",
  AMBIGUOUS: "ambiguous",
};

export const CONFIRMATION = {
  NONE: "none",
  PROPOSAL: "proposal",
  DOUBLE: "double",
  BLOCKED: "blocked",
};

export const VOICE_CONTEXT = {
  GLOBAL: "global",
  CONSULTATION: "consultation",
  REVIEW: "revision",
  PRINT: "imprimir",
  PATIENTS: "pacientes",
};

// Nombres visibles para el usuario (los mensajes no deben exponer ids internos).
const CONTEXT_LABEL = {
  [VOICE_CONTEXT.GLOBAL]: "la barra global 🎙",
  [VOICE_CONTEXT.CONSULTATION]: "la consulta",
  [VOICE_CONTEXT.REVIEW]: "Revisión",
  [VOICE_CONTEXT.PRINT]: "Impresión",
  [VOICE_CONTEXT.PATIENTS]: "Pacientes",
};

const COMMANDS = [
  // Navegación y lectura: bajo riesgo, ejecutables desde la barra global.
  cmd("set_view", {
    intent: "set_view", risk: VOICE_RISK.LOW, permission: "app.navigate",
    contexts: [VOICE_CONTEXT.GLOBAL], confirmation: CONFIRMATION.NONE,
    auditKind: "voice_nav",
  }),
  cmd("go_back", {
    intent: "go_back", risk: VOICE_RISK.LOW, permission: "app.navigate",
    contexts: [VOICE_CONTEXT.GLOBAL], confirmation: CONFIRMATION.NONE,
    auditKind: "voice_nav",
  }),
  cmd("open_active", {
    intent: "open_active", risk: VOICE_RISK.LOW, permission: "consultation.read",
    contexts: [VOICE_CONTEXT.GLOBAL], confirmation: CONFIRMATION.NONE,
    auditKind: "voice_nav",
  }),
  cmd("search_patient", {
    intent: "search_patient", risk: VOICE_RISK.LOW, permission: "patient.read",
    contexts: [VOICE_CONTEXT.GLOBAL, VOICE_CONTEXT.PATIENTS], confirmation: CONFIRMATION.NONE,
    auditKind: "voice_patient",
  }),
  cmd("open_patient", {
    intent: "open_patient", risk: VOICE_RISK.LOW, permission: "patient.read",
    contexts: [VOICE_CONTEXT.GLOBAL, VOICE_CONTEXT.PATIENTS], confirmation: CONFIRMATION.NONE,
    auditKind: "voice_patient",
  }),
  cmd("start_consult", {
    intent: "start_consult", risk: VOICE_RISK.LOW, permission: "consultation.start",
    contexts: [VOICE_CONTEXT.GLOBAL, VOICE_CONTEXT.PATIENTS], confirmation: CONFIRMATION.NONE,
    auditKind: "voice_consult",
  }),
  cmd("show_allergies", {
    intent: "show_allergies", risk: VOICE_RISK.LOW, permission: "patient.read",
    contexts: [VOICE_CONTEXT.GLOBAL, VOICE_CONTEXT.REVIEW, VOICE_CONTEXT.CONSULTATION],
    confirmation: CONFIRMATION.NONE, auditKind: "voice_patient",
  }),
  cmd("show_summary", {
    intent: "show_summary", risk: VOICE_RISK.LOW, permission: "consultation.read",
    contexts: [VOICE_CONTEXT.GLOBAL, VOICE_CONTEXT.REVIEW, VOICE_CONTEXT.PRINT],
    confirmation: CONFIRMATION.NONE, auditKind: "voice_review",
  }),
  cmd("check_interactions", {
    intent: "check_interactions", risk: VOICE_RISK.LOW, permission: "consultation.rx.read",
    contexts: [VOICE_CONTEXT.GLOBAL, VOICE_CONTEXT.REVIEW], confirmation: CONFIRMATION.NONE,
    auditKind: "voice_rx",
  }),

  // Flujo de consulta. Detener/finalizar cambia estado de trabajo, por eso no se
  // ejecuta silenciosamente desde el router global.
  cmd("start_recording", {
    intent: "start_recording", risk: VOICE_RISK.WORKFLOW, permission: "consultation.record",
    contexts: [VOICE_CONTEXT.CONSULTATION], confirmation: CONFIRMATION.NONE,
    auditKind: "voice_recording",
  }),
  cmd("pause_recording", {
    intent: "pause_recording", risk: VOICE_RISK.WORKFLOW, permission: "consultation.record",
    contexts: [VOICE_CONTEXT.CONSULTATION], confirmation: CONFIRMATION.NONE,
    auditKind: "voice_recording",
  }),
  cmd("resume_recording", {
    intent: "resume_recording", risk: VOICE_RISK.WORKFLOW, permission: "consultation.record",
    contexts: [VOICE_CONTEXT.CONSULTATION], confirmation: CONFIRMATION.NONE,
    auditKind: "voice_recording",
  }),
  cmd("stop_recording", {
    intent: "stop_recording", risk: VOICE_RISK.WORKFLOW, permission: "consultation.record",
    contexts: [VOICE_CONTEXT.CONSULTATION], confirmation: CONFIRMATION.PROPOSAL,
    auditKind: "voice_recording",
  }),

  // Nota, diagnóstico y receta: solo se aplican dentro de Revisión.
  cmd("soap_add", {
    intent: "soap_add", risk: VOICE_RISK.CLINICAL, permission: "consultation.soap.write",
    contexts: [VOICE_CONTEXT.REVIEW], confirmation: CONFIRMATION.PROPOSAL,
    auditKind: "voice_soap",
  }),
  cmd("soap_replace", {
    intent: "soap_replace", risk: VOICE_RISK.CLINICAL, permission: "consultation.soap.write",
    contexts: [VOICE_CONTEXT.REVIEW], confirmation: CONFIRMATION.PROPOSAL,
    auditKind: "voice_soap",
  }),
  cmd("soap_delete_last", {
    intent: "soap_delete_last", risk: VOICE_RISK.CLINICAL, permission: "consultation.soap.write",
    contexts: [VOICE_CONTEXT.REVIEW], confirmation: CONFIRMATION.PROPOSAL,
    auditKind: "voice_soap",
  }),
  cmd("change_primary_dx", {
    intent: "change_primary_diagnosis", risk: VOICE_RISK.CLINICAL,
    permission: "consultation.dx.write", contexts: [VOICE_CONTEXT.REVIEW],
    confirmation: CONFIRMATION.PROPOSAL, auditKind: "voice_dx",
  }),
  cmd("add_dx", {
    intent: "add_diagnosis", risk: VOICE_RISK.CLINICAL, permission: "consultation.dx.write",
    contexts: [VOICE_CONTEXT.REVIEW], confirmation: CONFIRMATION.PROPOSAL,
    auditKind: "voice_dx",
  }),
  cmd("remove_dx", {
    intent: "remove_diagnosis", risk: VOICE_RISK.CLINICAL, permission: "consultation.dx.write",
    contexts: [VOICE_CONTEXT.REVIEW], confirmation: CONFIRMATION.PROPOSAL,
    auditKind: "voice_dx",
  }),
  cmd("add_med", {
    intent: "add_medication", risk: VOICE_RISK.CLINICAL, permission: "consultation.rx.write",
    contexts: [VOICE_CONTEXT.REVIEW], confirmation: CONFIRMATION.PROPOSAL,
    auditKind: "voice_rx",
  }),
  cmd("remove_med", {
    intent: "remove_medication", risk: VOICE_RISK.CLINICAL, permission: "consultation.rx.write",
    contexts: [VOICE_CONTEXT.REVIEW], confirmation: CONFIRMATION.PROPOSAL,
    auditKind: "voice_rx",
  }),

  // Documentos y actos legales. Se mantienen bloqueados para ejecución por voz.
  cmd("save_draft", {
    intent: "save_draft", risk: VOICE_RISK.WORKFLOW, permission: "consultation.draft.write",
    contexts: [VOICE_CONTEXT.REVIEW], confirmation: CONFIRMATION.NONE,
    auditKind: "voice_save",
  }),
  cmd("prepare_print", {
    intent: "prepare_print", risk: VOICE_RISK.LEGAL, permission: "consultation.print.prepare",
    contexts: [VOICE_CONTEXT.REVIEW, VOICE_CONTEXT.PRINT], confirmation: CONFIRMATION.DOUBLE,
    auditKind: "voice_print",
    enabled: false,
    disabledReason: "Preparar impresión por voz queda bloqueado hasta tener política legal por institución.",
  }),
];

export const COMMAND_REGISTRY = Object.freeze(COMMANDS);
const BY_ACTION = new Map(COMMANDS.map((c) => [c.action, c]));
const BY_INTENT = new Map(COMMANDS.map((c) => [c.intent, c]));

function cmd(action, def) {
  return Object.freeze({
    action,
    enabled: true,
    allowGlobalProposal: true,
    ...def,
  });
}

export function getCommandDefinition(actionOrResult, maybeIntent) {
  if (!actionOrResult) return null;
  if (typeof actionOrResult === "string") {
    return BY_ACTION.get(actionOrResult) || BY_INTENT.get(maybeIntent || actionOrResult) || null;
  }
  return BY_ACTION.get(actionOrResult.action) || BY_INTENT.get(actionOrResult.intent) || null;
}

export function attachCommandMeta(result) {
  const command = getCommandDefinition(result);
  if (!command) return { ...result, command: null };
  return {
    ...result,
    command,
    risk_level: command.risk,
    requires_confirmation: result.requires_confirmation || command.confirmation !== CONFIRMATION.NONE,
  };
}

export function permissionsForRole(role) {
  if (role === "admin") return ["*"];
  if (role === "medico") {
    return [
      "app.navigate",
      "patient.read",
      "consultation.read",
      "consultation.start",
      "consultation.record",
      "consultation.soap.write",
      "consultation.dx.write",
      "consultation.rx.read",
      "consultation.rx.write",
      "consultation.draft.write",
    ];
  }
  // Rol desconocido o ausente: fail-closed — solo navegación y lectura, nunca
  // escritura clínica (SOAP/dx/receta) por voz.
  return ["app.navigate", "patient.read", "consultation.read"];
}

export function evaluateCommandPolicy(result, options = {}) {
  const command = getCommandDefinition(result);
  if (!command) return { allowed: true, command: null };

  if (!command.enabled) {
    return {
      allowed: false,
      command,
      reason: "disabled",
      message: command.disabledReason || "Comando deshabilitado por política.",
    };
  }

  const policy = options.policy || {};
  if ((policy.disabledActions || []).includes(command.action)) {
    return { allowed: false, command, reason: "policy_disabled", message: "Comando deshabilitado para esta institución." };
  }

  const context = options.context || VOICE_CONTEXT.GLOBAL;
  const enforceContext = options.enforceContext !== false;
  if (enforceContext && !command.contexts.includes(context)) {
    return {
      allowed: false,
      command,
      reason: "context",
      message: `Este comando solo está disponible en ${command.contexts.map((c) => CONTEXT_LABEL[c] || c).join(", ")}.`,
    };
  }

  const permissions = options.permissions;
  if (Array.isArray(permissions) && !permissions.includes("*") && !permissions.includes(command.permission)) {
    return {
      allowed: false,
      command,
      reason: "permission",
      message: "Tu rol no tiene permiso para ejecutar ese comando.",
    };
  }

  return { allowed: true, command };
}

export function commandNeedsDoubleConfirm(command, { expert = false } = {}) {
  if (!command) return false;
  return command.confirmation === CONFIRMATION.DOUBLE || (expert && command.risk === VOICE_RISK.CLINICAL);
}
