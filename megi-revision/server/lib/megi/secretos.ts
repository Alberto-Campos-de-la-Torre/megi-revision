/**
 * Conexión INDIVIDUAL con MEGI (I2). Cada médico guarda su propio usuario y
 * contraseña de MEGI en la superficie compartida de secretos del framework
 * (Ajustes → claves; ámbito `user`, cifradas en servidor). Con ellas la app
 * lee solo sus pacientes y MEGI firma la aprobación con SU identidad. Nunca se
 * leen de `process.env` ni se exponen al cliente, al modelo ni a los logs.
 */
import { registerRequiredSecret } from "@agent-native/core/secrets";

export const CLAVE_USUARIO_MEGI = "MEGI_USUARIO";
export const CLAVE_CONTRASENA_MEGI = "MEGI_CONTRASENA";

const usedFor = [
  {
    feature: "Conexión personal con MEGI",
    effectWhenRemoved:
      "La app deja de leer y firmar en MEGI con tu identidad; vuelve a la cuenta de servicio solo si tu correo está autorizado (MEGI_MEDICOS).",
  },
];

registerRequiredSecret({
  key: CLAVE_USUARIO_MEGI,
  label: "MEGI user",
  description: "Your own MEGI username. Reads only your patients and signs approvals as you.",
  scope: "user",
  kind: "api-key",
  required: false,
  usedFor,
  validator: (value) => (value.trim().length > 0 ? true : { ok: false, error: "Empty username" }),
});

registerRequiredSecret({
  key: CLAVE_CONTRASENA_MEGI,
  label: "MEGI password",
  description: "Password of your own MEGI user. Stored encrypted on the server; never shown again.",
  scope: "user",
  kind: "api-key",
  required: false,
  usedFor,
  validator: (value) => (value.length >= 6 ? true : { ok: false, error: "MEGI requires at least 6 characters" }),
});
