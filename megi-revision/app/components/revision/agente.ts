import { sendToAgentChat } from "@agent-native/core/client/agent-chat";

/**
 * Botones de «trabajo del agente»: abren la barra lateral del agente con la
 * petición del médico y un contexto acotado (ids, nunca registros completos).
 */
export function pedirPropuesta(consultaId: string, pacienteNombre: string) {
  sendToAgentChat({
    message: `Prepara la receta y los pendientes de la consulta ${consultaId} (${pacienteNombre}). Lee primero el contexto, verifica cada fármaco y crea el plan con proponer-plan. Explica en qué te basaste.`,
    context: JSON.stringify({ consultaId }),
    submit: true,
    openSidebar: true,
  });
}

export function pedirReajuste(planId: string, consultaId: string) {
  sendToAgentChat({
    message: `Ajusta el plan ${planId}: `,
    context: JSON.stringify({ consultaId, planId }),
    submit: false,
    openSidebar: true,
  });
}

export function pedirReemplazo(planId: string, consultaId: string, lineaTexto: string, motivo: string) {
  sendToAgentChat({
    message: `En el plan ${planId}, reemplaza "${lineaTexto}" por una alternativa segura para este paciente. Motivo del bloqueo: ${motivo}. Usa reajustar-plan y explica el cambio.`,
    context: JSON.stringify({ consultaId, planId }),
    submit: true,
    openSidebar: true,
  });
}

export function preguntarAlAgente(consultaId: string, planId: string | null) {
  sendToAgentChat({
    message: "",
    context: JSON.stringify({ consultaId, planId }),
    submit: false,
    openSidebar: true,
  });
}
