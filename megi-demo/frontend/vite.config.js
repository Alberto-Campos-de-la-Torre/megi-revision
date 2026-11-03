import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Identificador de la versión construida. El backend expone el suyo en
// /api/health y la app avisa si no coinciden: es lo que evita operar con un
// frontend recargado contra un backend viejo (nos pasó el 27-jul y el streaming
// quedó roto sin que nadie lo notara).
function buildId() {
  if (process.env.MEGI_BUILD_ID) return process.env.MEGI_BUILD_ID;
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch (e) {
    return "unknown";
  }
}

// Frontend dev server. The `/api` proxy forwards to the FastAPI backend so the
// browser uses prod-like relative URLs and we avoid CORS in development.
export default defineConfig({
  plugins: [react()],
  define: { __MEGI_BUILD__: JSON.stringify(buildId()) },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // MEGI_API_PROXY permite apuntar a un backend de desarrollo (p. ej.
        // :8001 con su propia base) sin tocar el :8000 de producción.
        target: process.env.MEGI_API_PROXY || "http://localhost:8000",
        changeOrigin: true,
      },
      // La mesa del anestesiólogo embebida la sirve el backend por /mesa.
      "/mesa": {
        target: process.env.MEGI_API_PROXY || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
    css: false,
  },
});
