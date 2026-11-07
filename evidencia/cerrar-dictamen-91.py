#!/usr/bin/env python3
"""Resumen de la respuesta al dictamen de 91/100 (7 nov 2026): resultados, hashes y límites."""
import json, hashlib, datetime, pathlib
B = pathlib.Path(__file__).resolve().parent.parent
R = B / "evidencia/resultados"
def leer(p): return json.loads((R / p).read_text())
def pasan(lista, k="pasa"): return sum(1 for x in lista if x.get(k)), len(lista)
sha = lambda p: hashlib.sha256((B / p).read_bytes()).hexdigest()
fr = leer("friccion-ui.json"); va = leer("valor-diferencial.json"); co = leer("continuidad.json")
re_ = leer("recorrido.json"); ad = leer("advertencias.json"); ag = leer("agente.json"); rv = leer("ux-2026-11-07/reverificacion-final/resultados.json")
ve = leer("verificacion-ui-2026-11-07.json")
res = {
  "fecha": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "responde_a": "evidencia/resultados/ux-2026-11-07/reverificacion/dictamen.json (91/100)",
  "frentes": {
    "creatividad_diseno": {"script": "evidencia/friccion-ui.mjs", "pasan": pasan(fr["resultados"]), "fallos": fr.get("fallos"), "capturas": "evidencia/capturas-friccion/", "correcciones": ["F1 barra lateral acotada al viewport", "F2 mensaje de vacío de exportadas", "F3 cuadrícula por ancho de contenido", "F4 chip de alergias envuelve", "F5 formulario de nueva línea por contenedor", "F6 un solo <main>", "R1 aviso y reintento cuando el turno termina sin guardar plan", "R2 aviso cuando el turno no cambió el plan", "R3 sin avisos si el turno terminó con ask-question"], "pendiente": "Observar usuarios nuevos (I4, sin participantes por decisión de David)."},
    "innovacion": {"script": "evidencia/valor-diferencial.mts", "pasan": [va["pasan"], va["total"]], "comparacion": va["comparacion"]["mesaDeRevision"], "resumen": "evidencia/valor-diferencial.md", "limite": va["comparacion"]["nota"]},
    "agent_native": {"script": "evidencia/continuidad.mjs", "pasan": pasan(co["resultados"]), "fallos": co.get("fallos"), "guion": "evidencia/demo-continuidad.md", "capturas": "evidencia/capturas-continuidad/", "respaldo": {"recorrido": pasan(re_["resultados"]), "advertencias": pasan(ad["resultados"]), "agente": pasan(ag["resultados"]), "servidor": "195/195 (sin cambios de servidor; no repetidas)"}},
    "utilidad_ejecucion": {"estado": "detenido por decisión de David (7 nov): sin sesiones con médicos ni cuentas individuales reales", "referencia": "PENDIENTE_VALIDACION_USUARIOS.md"},
    "entrega": {"estado": "detenida por decisión de David (7 nov)"},
  },
  "reverificacion_auditor_repetida": {"carpeta": "evidencia/resultados/ux-2026-11-07/reverificacion-final/", "pasan": pasan(rv["checks"], "passed")},
  "verificacion_estatica": {k: ve[k]["exit"] for k in ("typecheck", "doctor", "build")},
  "codigo_sha256": {p: sha(p) for p in [
    "megi-revision/app/global.css", "megi-revision/app/routes/revision._index.tsx", "megi-revision/app/routes/revision.$consultaId.tsx",
    "megi-revision/app/components/revision/Chips.tsx", "megi-revision/app/components/revision/TrabajoAgente.tsx", "megi-revision/app/components/revision/agente.ts",
    "megi-revision/app/components/chat/ChatRouteContent.tsx", "megi-revision/server/plugins/agent-chat.ts",
    "evidencia/friccion-ui.mjs", "evidencia/valor-diferencial.mts", "evidencia/continuidad.mjs"]},
  "limite_de_nota": "La nota la pone el jurado; estos resultados acreditan trabajo verificable, no una puntuación.",
}
(R / "respuesta-dictamen-91.json").write_text(json.dumps(res, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({k: (v.get("pasan") if isinstance(v, dict) else v) for k, v in res["frentes"].items()}, ensure_ascii=False))
print("reverificación:", res["reverificacion_auditor_repetida"]["pasan"], "| estática:", res["verificacion_estatica"])
