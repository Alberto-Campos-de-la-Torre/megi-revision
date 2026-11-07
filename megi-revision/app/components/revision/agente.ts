import { sendToAgentChat } from "@agent-native/core/client/agent-chat";

/**
 * Botones de «trabajo del agente»: abren la barra lateral del agente con la
 * petición del médico y un contexto acotado (ids, nunca registros completos).
 */
export function pedirPropuesta(consultaId: string, pacienteNombre: string, reintento = false) {
  sendToAgentChat({
    message: reintento
      ? `El tablero de la consulta ${consultaId} (${pacienteNombre}) sigue SIN plan guardado: tu respuesta anterior fue solo texto. Llama ahora a la herramienta proponer-plan con todas las líneas (fármacos con dosis, frecuencia, duración y justificación; pendientes con texto) y la explicación. No describas el plan en el chat sin guardarlo.`
      : `Prepara la receta y los pendientes de la consulta ${consultaId} (${pacienteNombre}). Usa el contexto fresco de la pantalla o léelo si falta; crea todo el plan llamando a la herramienta proponer-plan, que verifica los fármacos y lo guarda en el tablero. No escribas el plan como texto en el chat. Guarda el motivo en el plan y confirma el resultado brevemente.`,
    context: JSON.stringify({ consultaId }),
    newTab: true,
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

export function pedirSeleccion(planId: string, consultaId: string, lineas: string[], version: number, editar: boolean) {
  sendToAgentChat({
    message: editar ? `Reajusta únicamente las líneas seleccionadas del plan ${planId}: ` : `Explica la propuesta, fuentes y alertas de estas líneas del plan ${planId}. No hagas cambios.`,
    context: JSON.stringify({ consultaId, planId, lineasSeleccionadas: lineas, versionEsperada: version, instruccion: "Usa la versión y el alcance vigentes de current-screen; lee obtener-plan si faltan o hay un conflicto. El servidor exige versión, alcance y bloqueos." }),
    contextLabel: "Selección del plan",
    submit: !editar,
    openSidebar: true,
  });
}

export function pedirAlternativaAutomatica(planId: string, consultaId: string, lineaId: string, version: number, texto: string, motivo: string) {
  sendToAgentChat({ message: `El médico fijó o rechazó ${texto}, que tiene un bloqueo de seguridad: ${motivo}. Propón automáticamente UNA alternativa usando sugerir-reemplazo para lineaId=${lineaId}, planId=${planId}, versionEsperada=${version}. Lee el contexto clínico si falta. No edites la receta ni desbloquees nada. La alternativa debe quedar pendiente de revisión médica.`, context: JSON.stringify({ consultaId, planId, lineaId, versionEsperada: version, modo: "sugerencias" }), submit: true, openSidebar: true });
}
