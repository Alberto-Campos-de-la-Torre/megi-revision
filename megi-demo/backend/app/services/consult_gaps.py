"""Sugerencias de interrogatorio DURANTE la consulta (huecos, no alertas).

Una alerta de `safety.py` dice «lo que ya indicaste es peligroso». Esto dice otra
cosa: «esto que todavía no has preguntado podría cambiar lo que vas a recetar».
Por eso un hueco solo existe cuando el dato NO está por ningún lado — ni en el
expediente ni mencionado en la consulta. En cuanto el médico lo toca, el hueco
desaparece solo: no hay que marcarlo como atendido.

Determinista a propósito, igual que safety.py y dx_reconciler: cruza tablas, no
interpreta. Aquí un falso positivo cuesta la atención del médico a media
consulta, así que ante la duda NO sugiere.

Es apoyo, no obligación: nada de esto bloquea ni exige respuesta.
"""
from __future__ import annotations

from ..routes.safety import DISEASE_RULES, _n

# Etiqueta legible por grupo de condiciones de DISEASE_RULES (se indexa por su
# primer término, que es el estable). Si safety.py gana una regla nueva y no está
# aquí, se cae al propio término: se degrada, no se rompe.
PREGUNTA_POR_COND = {
    "erc": "enfermedad renal",
    "hta": "hipertensión",
    "asma": "asma o EPOC",
    "ulcera": "gastritis, úlcera o reflujo",
}

# Sinónimos por familia, SOLO para decidir si el tema ya se conoce o ya se habló.
# Los términos de DISEASE_RULES son demasiado literales para esto: no reconocen
# "enfermedad renal crónica" como ERC ni "hipertenso" como hipertensión, y un
# aviso que sobra a media consulta cuesta más que uno que falta. Aquí conviene
# pecar de callado, así que la lista es deliberadamente generosa.
FAMILIA = {
    "erc": ["erc", "renal", "nefro", "rinon", "creatinina", "tfg", "dialisis"],
    "hta": ["hta", "hipertens", "presion alta", "tension alta"],
    "asma": ["asma", "epoc", "broncoesp", "bronquitis cronica", "inhalador"],
    "ulcera": ["ulcera", "gastritis", "erge", "reflujo", "gastrointestinal",
               "estomago", "agruras", "acidez"],
}


def _terminos(rule: dict) -> list:
    """Términos con los que se busca si la condición ya está cubierta."""
    return FAMILIA.get(rule["cond"][0], rule["cond"])

# Datos de alarma que, si se mencionan, piden una exploración concreta. El hueco
# aparece si el síntoma está en lo que refiere el paciente y NADA de lo que
# corresponde explorar aparece en la sección O.
ALARMAS = [
    {"term": ["dolor toracico", "dolor en el pecho", "opresion en el pecho"],
     "explorar": ["ruidos cardiacos", "auscultacion", "ecg", "electrocardiograma",
                  "ta ", "tension arterial", "pulsos"],
     "texto": "Refiere dolor torácico y no hay exploración cardiovascular registrada",
     "razon": "Dato de alarma: descartar origen isquémico antes de cerrar la nota."},
    {"term": ["sincope", "desmayo", "perdida del conocimiento", "se desmayo"],
     "explorar": ["ortostatismo", "de pie", "glucemia", "neurologic", "ta ", "pulsos"],
     "texto": "Refiere síncope y no hay TA ortostática ni exploración neurológica",
     "razon": "Dato de alarma: el síncope exige descartar causa cardiaca o hipotensión."},
    {"term": ["disnea", "falta de aire", "ahogo", "dificultad para respirar"],
     "explorar": ["spo2", "saturacion", "campos pulmonares", "auscultacion", "fr "],
     "texto": "Refiere disnea y no hay saturación ni auscultación pulmonar registrada",
     "razon": "Dato de alarma: la disnea sin oximetría deja fuera la hipoxemia."},
    {"term": ["sangrado", "hemorragia", "melena", "hematemesis", "sangre en heces"],
     "explorar": ["palidez", "hemoglobina", "tacto rectal", "ta ", "mucosas"],
     "texto": "Refiere sangrado y no hay datos de repercusión hemodinámica",
     "razon": "Dato de alarma: valorar anemia e inestabilidad."},
    {"term": ["cefalea subita", "peor dolor de cabeza", "el peor dolor"],
     "explorar": ["rigidez de nuca", "fondo de ojo", "neurologic", "focalizacion", "pupilas"],
     "texto": "Refiere cefalea súbita y no hay exploración neurológica registrada",
     "razon": "Dato de alarma: descartar hemorragia subaracnoidea."},
]

# Señales de que en el plan se está recetando algo (para el aviso de alergias).
_SENALES_RECETA = ("mg", "ml", "tableta", "capsula", "vo ", "c/8", "c/12", "c/24")

MAX_SUGERENCIAS = 3


def _texto(soap: dict) -> str:
    return _n(" ".join(str(soap.get(k) or "") for k in ("S", "O", "A", "P")))


def _g(gid: str, texto: str, razon: str, prioridad: str, tipo: str) -> dict:
    return {"id": gid, "texto": texto, "razon": razon,
            "prioridad": prioridad, "tipo": tipo}


def _nombre_real(plan_original: str, patron: str) -> str:
    """El nombre tal como se escribió en el plan ('Ibuprofeno 400 mg' -> 'Ibuprofeno'),
    no el patrón de la regla ('ibuprofen'), que en pantalla se lee como una errata."""
    for palabra in plan_original.replace("\n", " ").split():
        limpia = palabra.strip(".,;:()")
        if patron in _n(limpia):
            return limpia
    return patron


def _farmaco_condicion(soap: dict, chronic_n: list, todo: str) -> list:
    """El caso central: se va a recetar X y no se ha preguntado por la condición
    con la que X choca. Si la condición YA está en el expediente no es un hueco —
    es una alerta, y de eso se encarga compute_alerts.

    Se agrupa POR FÁRMACO: un AINE choca con riñón, HTA y estómago a la vez, y
    tres avisos seguidos por la misma receta son exactamente el ruido que hace
    que el médico deje de mirarlos."""
    plan_original = str(soap.get("P") or "")
    plan = _n(plan_original)
    por_farmaco: dict[str, dict] = {}
    for rule in DISEASE_RULES:
        patron = next((p for p in rule["drug"] if p in plan), None)
        if not patron:
            continue
        terminos = _terminos(rule)
        if any(any(c in cr for c in terminos) for cr in chronic_n):
            continue                       # ya consta: lo cubre la alerta real
        if any(c in todo for c in terminos):
            continue                       # ya se habló en la consulta
        etiqueta = PREGUNTA_POR_COND.get(rule["cond"][0], rule["cond"][0])
        entrada = por_farmaco.setdefault(
            patron, {"nombre": _nombre_real(plan_original, patron),
                     "condiciones": [], "motivos": []})
        if etiqueta not in entrada["condiciones"]:
            entrada["condiciones"].append(etiqueta)
            entrada["motivos"].append(rule["msg"])

    out = []
    for patron, e in por_farmaco.items():
        conds = e["condiciones"]
        lista = conds[0] if len(conds) == 1 else ", ".join(conds[:-1]) + " ni " + conds[-1]
        out.append(_g(
            f"farmaco:{patron}",
            f"No se ha preguntado por {lista} antes de indicar {e['nombre']}",
            " ".join(e["motivos"]), "alta", "farmaco_condicion",
        ))
    return out


def _alergias(soap: dict, allergies: list, todo: str) -> list:
    """Se está recetando y el expediente no tiene NINGUNA alergia registrada.
    Dispara como mucho una vez: 'ninguna' es un dato válido, pero hay que
    haberlo preguntado."""
    if allergies:
        return []
    plan = _n(str(soap.get("P") or ""))
    if not any(s in plan for s in _SENALES_RECETA):
        return []
    if "alergi" in todo:
        return []
    return [_g("alergias", "Sin preguntar: alergias a medicamentos",
               "No hay ninguna alergia registrada en el expediente y se está recetando.",
               "alta", "alergias")]


def _alarmas(soap: dict) -> list:
    refiere = _n(str(soap.get("S") or "") + " " + str(soap.get("A") or ""))
    objetivo = _n(str(soap.get("O") or ""))
    out = []
    for regla in ALARMAS:
        if not any(t in refiere for t in regla["term"]):
            continue
        if any(e in objetivo for e in regla["explorar"]):
            continue
        out.append(_g(f"alarma:{regla['term'][0]}", regla["texto"], regla["razon"],
                      "alta", "alarma"))
    return out


# El tamizaje por edad (Cartilla Nacional / USPSTF) NO va en el aviso en vivo.
# Se probó: salía en 19 de 20 consultas — «tamiz de cáncer colorrectal» en una
# faringitis— y es información que el médico ya vio, con calma, en «Antes de
# empezar». Este aviso queda para lo que SURGE durante la consulta y no podía
# saberse antes: fármaco × padecimiento, alergias, datos de alarma.

_ORDEN = {"alta": 0, "media": 1, "baja": 2}


def detect(soap: dict, allergies: list, chronic: list) -> list:
    """Huecos de interrogatorio para el SOAP acumulado hasta ahora.

    Sin estado: devuelve TODOS los huecos vigentes y quien llama decide cuáles
    ya enseñó. Así dos peticiones seguidas no se pisan y un hueco resuelto
    simplemente deja de venir."""
    if not soap:
        return []
    todo = _texto(soap)
    chronic_n = [_n(c) for c in (chronic or []) if c]

    huecos = (_farmaco_condicion(soap, chronic_n, todo)
              + _alarmas(soap)
              + _alergias(soap, allergies or [], todo))

    vistos, unicos = set(), []
    for h in huecos:
        if h["id"] in vistos:
            continue
        vistos.add(h["id"])
        unicos.append(h)
    unicos.sort(key=lambda h: _ORDEN.get(h["prioridad"], 9))
    return unicos[:MAX_SUGERENCIAS]
