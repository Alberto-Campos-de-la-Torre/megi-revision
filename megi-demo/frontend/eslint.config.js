// ESLint del frontend. Orientado a BUGS, no a estilo: lo que aquí es `error`
// es algo que compila, pasa los tests y no funciona.
//
// Por qué existe: `setMotivoHoy(...)` se usó sin haberlo declarado. Vite lo
// compiló sin quejarse (un identificador sin declarar no es error de sintaxis
// en JS) y los 83 tests pasaron (ninguno pulsaba ese botón). Reventó en la
// consulta del médico. `no-undef` lo habría cazado en el segundo en que se
// escribió. Lo mismo con `upcoming.slice` sobre un objeto.
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },

  js.configs.recommended,

  {
    files: ["**/*.{js,jsx}"],
    plugins: { react, "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser, ...globals.es2021,
        __MEGI_BUILD__: "readonly",   // lo inyecta Vite (vite.config.js: define)
      },
    },
    settings: { react: { version: "detect" } },
    rules: {
      // --- lo que compila y no funciona: ERROR ---------------------------
      "no-undef": "error",                     // setMotivoHoy sin declarar
      "react/jsx-no-undef": "error",           // <Componente> sin importar
      "react-hooks/rules-of-hooks": "error",   // hook dentro de un if
      "react/jsx-key": "error",                // .map sin key: render roto
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-constant-condition": ["error", { checkLoops: false }],

      // --- señales de descuido: WARN (no bloquean, pero se ven) ----------
      "no-unused-vars": ["warn", {
        args: "none",                          // callbacks con (e) sin usar son normales
        varsIgnorePattern: "^_",
        caughtErrors: "none",                  // catch (e) { /* noop */ } es intencional aquí
      }],
      "react-hooks/exhaustive-deps": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],

      // --- JSX moderno: React 18 con el runtime automático ----------------
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "error",          // que un import solo usado en JSX no cuente como sin usar
    },
  },

  // Tests: vitest expone describe/it/expect/vi como globales (vite.config: globals: true).
  {
    files: ["src/test/**/*.{js,jsx}", "**/*.test.{js,jsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
  },

  // Config y tooling corren en Node.
  {
    files: ["*.config.js", "vite.config.js", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
