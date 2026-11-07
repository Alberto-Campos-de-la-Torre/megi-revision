import { navigateWithAgentChatViewTransition } from "@agent-native/core/client/agent-chat";

import { focusAgentChat } from "@agent-native/toolkit/app/chat";
import { AgentSidebar } from "@agent-native/toolkit/app/chat";
import { type ReactNode } from "react";
import { useNavigate } from "react-router";

import { chatThreadPath } from "@/lib/chat-paths";
import { TAB_ID } from "@/lib/tab-id";

interface AgentInspectorProps {
  children: ReactNode;
  chatHomeHandoffActive: boolean;
  chatHomeHandoffPending: boolean;
}

/** Contextual inspector shell used on secondary chat routes. */
export function AgentInspector({
  children,
  chatHomeHandoffActive,
  chatHomeHandoffPending,
}: AgentInspectorProps) {
  const navigate = useNavigate();


  function openAskAgentFullscreen(threadId?: string) {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, chatThreadPath(threadId));
  }

  return (
    <AgentSidebar
      position="right"
      chatViewTransition
      chatViewTransitionHandoff={chatHomeHandoffPending}
      storageKey="chat"
      browserTabId={TAB_ID}
      openOnChatRunning={chatHomeHandoffActive}
      onFullscreenRequest={openAskAgentFullscreen}
      emptyStateText="Prepara y revisa el plan junto al agente."
      agentPageHref="/settings/agent"
      dynamicSuggestions={false}
      suggestions={[
        "Ayúdame con esta revisión",
        "Explica las fuentes y las alertas",
        "¿Qué falta por confirmar?",
      ]}
    >
      {children}
    </AgentSidebar>
  );
}
