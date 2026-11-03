import { describe, expect, it } from "vitest";
import { classifyCommand } from "../lib/voice_mock";
import {
  commandNeedsDoubleConfirm,
  evaluateCommandPolicy,
  getCommandDefinition,
  permissionsForRole,
  VOICE_CONTEXT,
  VOICE_RISK,
} from "../lib/voice_command_registry";

describe("voice_command_registry (Fase 6)", () => {
  it("anexa metadatos empresariales al resultado clasificado", () => {
    const r = classifyCommand("MEGI, cambiar diagnóstico principal a I10", {});
    expect(r.command.permission).toBe("consultation.dx.write");
    expect(r.command.contexts).toContain(VOICE_CONTEXT.REVIEW);
    expect(r.risk_level).toBe(VOICE_RISK.CLINICAL);
  });

  it("bloquea comandos clínicos fuera del contexto autorizado cuando se aplica política estricta", () => {
    const r = classifyCommand("MEGI, agrega a plan: control en 7 días", {});
    const decision = evaluateCommandPolicy(r, {
      context: VOICE_CONTEXT.GLOBAL,
      permissions: permissionsForRole("medico"),
      enforceContext: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("context");
  });

  it("permite comandos clínicos en revisión con permiso médico", () => {
    const r = classifyCommand("MEGI, agrega a plan: control en 7 días", {});
    const decision = evaluateCommandPolicy(r, {
      context: VOICE_CONTEXT.REVIEW,
      permissions: permissionsForRole("medico"),
      enforceContext: true,
    });
    expect(decision.allowed).toBe(true);
  });

  it("puede deshabilitar un comando por política institucional", () => {
    const r = classifyCommand("MEGI, abrir paciente María", {});
    const decision = evaluateCommandPolicy(r, {
      context: VOICE_CONTEXT.GLOBAL,
      permissions: permissionsForRole("medico"),
      policy: { disabledActions: ["open_patient"] },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("policy_disabled");
  });

  it("niega escritura clínica a roles desconocidos (fail-closed)", () => {
    const r = classifyCommand("MEGI, agrega a plan: control en 7 días", {});
    const decision = evaluateCommandPolicy(r, {
      context: VOICE_CONTEXT.REVIEW,
      permissions: permissionsForRole("auxiliar"),
      enforceContext: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("permission");
    expect(permissionsForRole(undefined)).not.toContain("consultation.rx.write");
  });

  it("marca doble confirmación para acciones clínicas en modo experto", () => {
    const cmd = getCommandDefinition("add_med");
    expect(commandNeedsDoubleConfirm(cmd, { expert: true })).toBe(true);
    expect(commandNeedsDoubleConfirm(cmd, { expert: false })).toBe(false);
  });
});
