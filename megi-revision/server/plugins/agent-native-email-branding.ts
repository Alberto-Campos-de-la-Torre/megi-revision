import { defineAppConfig } from "@agent-native/core/server";

// Registra la conexión personal con MEGI en la superficie compartida de secretos.
import "../lib/megi/secretos.js";

export default defineAppConfig({
  app: {
    id: "megi-revision",
    // This name appears in transactional emails. Change it to your product name.
    name: "MEGI Revisión",
    // The source template keeps a renamed app from inheriting first-party email branding.
    sourceTemplate: "chat",
    // Keep the template's authenticated entry explicit after renaming the app.
    homePath: "/revision",
    // Optional: use your own absolute HTTPS logo URL in transactional emails.
    // logoUrl: "https://example.com/logo.png",
  },
});
