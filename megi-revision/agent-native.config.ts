import { defineAgentNativeConfig } from "@agent-native/core/config";

export default defineAgentNativeConfig({
  changelog: { enabled: false },
  harness: true,
  // La pantalla de entrada es la mesa de revisión; la portada genérica del
  // framework («Inicio») se retiró de la barra y /home redirige aquí.
  app: { homePath: "/revision" },
});
