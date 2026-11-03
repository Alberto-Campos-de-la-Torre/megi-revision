import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SubirTelefono from "./components/subir_telefono";
import "./styles.css";

// /subir/<código>: página del teléfono para fotografiar estudios. No hay sesión
// ni login; el código del QR (15 min, una consulta) es la única credencial.
const subida = window.location.pathname.match(/^\/subir\/([A-Za-z0-9_-]+)\/?$/);

createRoot(document.getElementById("root")).render(
  subida ? <SubirTelefono token={subida[1]} /> : <App />,
);
