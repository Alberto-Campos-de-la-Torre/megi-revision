"""I6 · Matriz de las iteraciones I1–I6 de PARA_EL_100.md con estado (completado / mitigado /
pendiente), pruebas que lo acreditan y hashes de código y evidencia. Lee resultados ya generados;
no ejecuta nada ni hace commit. Uso: python3 evidencia/cerrar-iteraciones.py
"""
from pathlib import Path
import datetime, hashlib, json, subprocess
r = Path(__file__).resolve().parents[1]; app = r / "megi-revision"
read = lambda p: json.loads((r / p).read_text())
sha = lambda p: hashlib.sha256((r / p).read_bytes()).hexdigest()

def suite(p, key):
    rows = [x for x in read(p)[key] if "passed" in x]
    return {"archivo": p, "pasan": sum(1 for x in rows if x["passed"]), "fallan": sum(1 for x in rows if not x["passed"])}
def navegador(p):
    d = read(p); return {"archivo": p, "pasan": sum(1 for x in d["resultados"] if x["pasa"]), "fallan": sum(1 for x in d["resultados"] if not x["pasa"]), "fecha": d["fecha"]}

verificacion = read("evidencia/resultados/verificacion.json")
suites = {"auditoria_http": suite("evidencia/auditoria-hackathon-resultados.json", "results"), "bateria_http": suite("pruebas-hackathon/bateria-resultados.json", "resultados"), "revision_trazable": suite("pruebas-hackathon/revision-trazable-resultados.json", "resultados")}
recorrido_http = navegador("evidencia/resultados/recorrido-http.json")
navegador_demo = {n: navegador(f"evidencia/resultados/{n}.json") for n in ("recorrido", "advertencias", "agente")}
coste = read("evidencia/resultados/coste-historial.json")
auditoria_rows = read("evidencia/auditoria-hackathon-resultados.json")["results"]
pasadas = {x["id"] for x in auditoria_rows if x["passed"]}
def pruebas(*ids):
    for i in ids: assert i in pasadas, i
    return list(ids)
todo_ok = all(x["codigo"] == 0 for x in verificacion["resultados"]) and all(s["fallan"] == 0 for s in suites.values()) and recorrido_http["fallan"] == 0 and all(v["fallan"] == 0 for v in navegador_demo.values())

iteraciones = [
  {"id": "I1", "titulo": "Revalidar la integración HTTP actual", "estado": "completado" if todo_ok else "con fallos",
   "evidencia": ["evidencia/resultados/verificacion.json", "evidencia/resultados/recorrido-http.json", "evidencia/capturas-http/"],
   "pruebas": pruebas("http-backend-disponible", "http-vivo-pendientes-paginadas-coinciden-con-el-recorrido", "http-vivo-aprobacion-firmada-por-la-identidad-propia", "accion-listar-sin-identidad-clinica-es-403-sin-rol-clinico"),
   "notas": "verificar.mjs (typecheck, doctor, build, auditoría --http, batería --http, trazable) y recorrido de navegador en modo http con fases A/B/C."},
  {"id": "I2", "titulo": "Identidad y autorización por médico", "estado": "mitigado (decisión de David, 7 nov): completo en el backend de evidencia; cuentas individuales reales pendientes del consultorio",
   "evidencia": ["megi-revision/server/lib/megi/secretos.ts", "megi-revision/server/lib/megi/index.ts", "megi-revision/server/lib/plan.ts", "evidencia/sembrar-medico-b.py", "evidencia/resultados/recorrido-http.json"],
   "pruebas": pruebas("http-conexion-propia-crea-instancia-por-medico", "http-dos-medicos-dos-conexiones-distintas", "http-rotacion-de-credenciales-renueva-la-conexion", "http-conexion-retirada-deniega-y-olvida-la-sesion", "http-almacen-de-credenciales-caido-es-503-no-rechazo", "http-vivo-medica-b-solo-ve-sus-pendientes", "http-vivo-medico-a-no-ve-pacientes-de-b", "http-vivo-medica-b-no-ve-pacientes-de-a", "http-vivo-aprobacion-firmada-por-la-identidad-propia", "http-vivo-megi-registra-approved-by-de-b-y-la-nota-con-el-correo", "http-vivo-medico-a-no-lee-la-auditoria-de-b"),
   "notas": "Credenciales por usuario en la superficie de secretos del framework; MEGI firma con la identidad propia. La cuenta de servicio queda como respaldo autorizado por MEGI_MEDICOS (H2 mitigado para quien no conecta). La revocación deniega MEGI y conserva la lectura local de los planes propios."},
  {"id": "I3", "titulo": "Pendientes e historial con coste acotado", "estado": "completado",
   "evidencia": ["megi-demo/backend/app/routes/review.py", "megi-revision/server/lib/megi/megi-http.ts", "evidencia/resultados/coste-historial.json"],
   "pruebas": pruebas("http-pendientes-paginadas-sin-duplicados-ni-huecos", "http-listar-una-pagina-no-descarga-todos-los-pacientes", "http-coste-por-pagina-acotado-a-dos-peticiones", "http-paciente-ajeno-en-historial-es-404-no-respaldo", "http-pagina-fallida-aborta-sin-resultado-parcial", "http-total-cambiado-entre-paginas-se-rechaza", "http-vivo-historial-por-lotes-conserva-fuente-y-fecha"),
   "coste": [{"pacientes": e["pacientes"], "anterior": e["mediciones"][0]["peticiones"], "primeraPagina": e["mediciones"][1]["peticiones"], "todas": e["mediciones"][2]["peticiones"], "coinciden": e["coincidenAnteriorYNuevo"]} for e in coste["escenarios"]],
   "expedienteLargo": {k: coste["expedienteLargo"][k] for k in ("recetasAprobadas", "cronicoAntiguoConservado")},
   "notas": "Coste por página documentado en cada regresión; el expediente largo conserva el crónico antiguo."},
  {"id": "I4", "titulo": "Evidencia de utilidad con usuarios", "estado": "pendiente (sin participantes; decisión de David, 7 nov)", "evidencia": ["PENDIENTE_VALIDACION_USUARIOS.md", "evidencia/protocolo-usuarios.md"], "pruebas": [],
   "notas": "Protocolo, tareas y criterios definidos; ningún resultado. n=1 sintético no acredita ahorro."},
  {"id": "I5", "titulo": "Pulir la interacción visible", "estado": "completado según la aceptación del plan (antes/después, recorridos sin desbordamiento, smoke del agente); abierto solo lo que dependa de observaciones de usuarios (I4)",
   "evidencia": ["megi-revision/app/components/revision/Chips.tsx", "megi-revision/app/routes/revision._index.tsx", "evidencia/capturas-comparacion/", "evidencia/evaluacion-visual-i5.md", "evidencia/capturas-http/"], "pruebas": [],
   "notas": "Evaluación visual registrada en evidencia/evaluacion-visual-i5.md; recorrido http comprueba «Sin alergias conocidas (registrado)» en verde, 390 px sin desbordamiento y acción principal visible."},
  {"id": "I6", "titulo": "Cerrar evidencia y preparar entrega", "estado": "cierre local realizado; entrega detenida por decisión de David (7 nov)",
   "evidencia": ["ESTADO.md", "evidencia/README.md", "PARA_EL_100.md", "evidencia/resultados/iteraciones-i1-i6.json", "evidencia/resultados/recorrido.json", "evidencia/resultados/advertencias.json", "evidencia/resultados/agente.json"], "pruebas": [],
   "notas": "Recorridos de navegador en modo demo repetidos sobre el código final (sin fallos). H5 pendiente del equipo."},
]
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=app, text=True).strip()
cambios = subprocess.check_output(["git", "status", "--porcelain"], cwd=app, text=True).strip().splitlines()
diffstat = subprocess.check_output(["git", "diff", "--stat"], cwd=app, text=True).strip().splitlines()[-1:] 
codigo = {}
for linea in cambios:
    p = linea[3:].strip()
    if (app / p).is_file(): codigo[f"megi-revision/{p}"] = sha(f"megi-revision/{p}")
for p in ["megi-demo/backend/app/routes/review.py", "megi-demo/backend/app/routes/consultations.py", "evidencia/auditoria-hackathon.mts", "evidencia/auditoria-independiente.mts", "evidencia/recorrido-http.mjs", "evidencia/ui-http.mjs", "evidencia/coste-historial.mts", "evidencia/sembrar-medico-b.py", "evidencia/backend.mjs", "pruebas-hackathon/bateria.mts", "pruebas-hackathon/revision-trazable.mts"]:
    codigo[p] = sha(p)
evidencia = {p: sha(p) for p in ["evidencia/resultados/verificacion.json", "evidencia/auditoria-hackathon-resultados.json", "pruebas-hackathon/bateria-resultados.json", "pruebas-hackathon/revision-trazable-resultados.json", "evidencia/resultados/recorrido-http.json", "evidencia/resultados/coste-historial.json", "evidencia/resultados/auditoria-independiente-tras-correccion.json", "evidencia/resultados/dictamen-auditoria-2026-11-06.json"]}
salida = {"fecha": datetime.datetime.now(datetime.timezone.utc).isoformat(), "app_commit_base": head, "app_cambios_sin_commit": len(cambios), "app_diffstat": diffstat, "verificacion": verificacion, "suites": suites, "recorrido_http": recorrido_http, "navegador_demo": navegador_demo, "iteraciones": iteraciones, "codigo_sha256": codigo, "evidencia_sha256": evidencia,
          "limites": ["Backend de evidencia con SQLite aislado y dos cuentas ficticias; no es la instalación del consultorio.", "I2 depende de que el consultorio dé de alta cuentas individuales en MEGI; la lista MEGI_MEDICOS sigue como respaldo.", "I4 sin participantes: ninguna afirmación de ahorro.", "Sin commit, publicación, Clips ni formulario por indicación vigente."]}
(r / "evidencia/resultados/iteraciones-i1-i6.json").write_text(json.dumps(salida, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"ok": todo_ok, "suites": suites, "recorrido_http": recorrido_http, "iteraciones": {i["id"]: i["estado"] for i in iteraciones}}, ensure_ascii=False, indent=1))
