import { redirect } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

const SEO_TITLE = `${APP_TITLE} - Revisión clínica de recetas con MEGI`;
const SEO_DESCRIPTION =
  "Mesa de revisión clínica: el agente propone el plan y el médico lo revisa, bloquea o aprueba antes de exportarlo a MEGI.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

// «Inicio» era la portada genérica del framework (Get started, documentación,
// Discord). La entrada de MEGI Revisión es la mesa de revisión.
export function loader() {
  return redirect("/revision");
}

export default function HomeRoute() {
  return null;
}
