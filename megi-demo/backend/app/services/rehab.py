"""Detección de consulta de REHABILITACIÓN y búsqueda de su protocolo.

Dos piezas separadas a propósito:

  detectar(texto)   ¿esta consulta va de rehabilitación? Determinista, por
                    vocabulario. Barata de equivocar: solo decide si vale la
                    pena buscar, no toca la nota.
  buscar(texto)     ¿qué protocolo aplica? Búsqueda por región + diagnóstico
                    contra el catálogo, y devuelve el protocolo LITERAL.

Por qué catálogo y no índice semántico (mismo criterio que dx_reconciler con la
CIE-10): estos protocolos son dosimetría exacta — `US 50% · 1 MHz · 1.4 W/cm² ·
6 min`. Un vecino semántico devuelve parámetros plausibles pero equivocados, y
eso no se distingue a simple vista. Aquí el modelo elige CUÁL; el texto sale tal
cual del catálogo. Si no hay match confiable, no se devuelve protocolo: mejor
vacío que uno irrelevante.

El catálogo sale de `r/INDICACIONES REHABILITACION CLASIFICADAS.md` (55
protocolos, UMF 51 · Medicina de Rehabilitación). Es APOYO: el médico decide,
y la lateralidad nunca se resuelve sola.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata

from ..config import DATA_DIR

CATALOGO_PATH = DATA_DIR / "protocolos_rehabilitacion.json"

# --- señales de que la consulta es de rehabilitación -----------------------
# FUERTES: una sola basta.
FUERTES = [
    "rehabilitacion", "terapia fisica", "fisioterapia", "electroterapia",
    "medicina fisica", "terapia ocupacional",
    # La frase estándar del plan en estas notas: «TF INSTITUCIONAL 10 SESIONES».
    "tf institucional", "terapia fisica institucional",
]
# MEDIAS: modalidades y ejercicios con nombre propio. Dos bastan, o una + débil.
MEDIAS = [
    "compresa humedo-caliente", "compresa humedo caliente", "ultrasonido terapeutico",
    "corriente interferencial", "tens", "laser puntual", "fluidoterapia", "parafina",
    "corrientes rusas", "neurodinamia", "masoterapia", "propiocepcion",
    "higiene de columna", "proteccion articular", "reeducar marcha", "reeducacion de marcha",
    "ejercicios de williams", "ejercicios de codman", "pendulares de codman",
    "ejercicios de klapp", "isometricos", "isotonicos", "estiramiento",
    "fortalecimiento", "movilizacion articular", "arcos de movilidad",
    "antiedema", "terapia con espejo", "escalerillas", "cicloergometro",
    # Epónimos: no hay forma de escribirlos fuera de una nota de rehabilitación.
    "codman", "williams", "klapp", "risser", "buerger", "quervain",
]
# DÉBILES: abreviaturas de la nota. Solas no dicen nada (chocan con palabras
# comunes), pero dos o tres juntas son inequívocas. Se buscan con frontera de
# palabra: "us" aparece dentro de decenas de palabras.
DEBILES = [
    "chc", "c.i.", "tens", "ee", "us", "ir", "tf", "adm", "rems", "eva", "emm",
    "maa", "mp", "fto", "to", "pv", "ecm", "ddp", "stc", "vcr", "po", "rafi",
    "mcf", "ifp", "ifd", "msts", "msps", "am", "aa",
]
# Maniobras de exploración musculoesquelética.
MANIOBRAS = ["lasegue", "jobe", "yocum", "hawkins", "tinel", "phalen",
             "neer", "finkelstein", "mcmurray", "cajon anterior", "thompson"]

# Regiones del catálogo y cómo se nombran en la consulta.
REGIONES = {
    "Cara": ["facial", "cara", "parálisis facial", "paralisis facial"],
    "Columna": ["columna", "cervical", "lumbar", "dorsal", "lumbalgia", "cervicalgia",
                "lumbociatalgia", "ciatica", "espalda", "paravertebral", "sacroiliaca"],
    "Hombro": ["hombro", "supraespinoso", "manguito rotador", "subacromial",
               "capsulitis", "escapular", "deltoides", "bicipital"],
    "Codo": ["codo", "epicondilitis", "epitroclea", "epicondilo"],
    "Muñeca y mano": ["muneca", "mano", "dedo", "falange", "metacarpiano", "escafoides",
                      "radio distal", "quervain", "carpo", "pulgar", "tenorrafia"],
    "Cadera": ["cadera", "artroplastia de cadera", "trocanter", "psoas"],
    "Rodilla": ["rodilla", "rotula", "menisco", "cruzado", "pata de ganso", "cuadriceps"],
    "Tobillo y pie": ["tobillo", "pie", "calcaneo", "aquiles", "fascitis plantar",
                      "maleolo", "esguince de tobillo", "peroneo distal"],
    "Nervio periférico": ["nervio", "tunel del carpo", "radial", "cubital", "ciatico",
                          "peroneo", "tibial", "neuropatia", "parestesias"],
    "Rehabilitación pulmonar": ["pulmonar", "respiratoria", "post covid", "postcovid",
                                "desaturacion", "disnea de esfuerzo", "espirometria"],
}

UMBRAL_PROTOCOLO = 0.34   # por debajo, no se propone protocolo
MAX_PROTOCOLOS = 3

_catalogo = None
_pesos_cache = None
_frec_cache = None


def _n(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _palabra(texto_n: str, termino: str) -> bool:
    """Coincidencia con frontera de palabra (las abreviaturas cortas la exigen)."""
    return re.search(r"(?<![a-z0-9])" + re.escape(termino) + r"(?![a-z0-9])", texto_n) is not None


def catalogo() -> dict:
    """Catálogo en memoria. Si falta el archivo, el módulo se calla en vez de
    romper la consulta: esto es apoyo, no una pieza crítica."""
    global _catalogo
    if _catalogo is None:
        try:
            _catalogo = json.loads(CATALOGO_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _catalogo = {"protocolos": [], "ensenanzas": [], "modalidades_referencia": []}
    return _catalogo


# «Hace años fue a fisioterapia por la rodilla» en una rinofaringitis: la palabra
# fuerte está, pero es pasado ajeno a esta consulta. Se descarta si en las 4
# palabras previas hay una marca de pasado.
_PASADO_ANTES = re.compile(
    r"\b(hace (?:anos|meses|tiempo)|fue a|estuvo en|anteriormente|previamente|antes (?:iba|fue)|"
    r"ya (?:tuvo|hizo)|antecedentes? de|historia de|menciona antecedente)\b")
# gemma lo reescribe como «antecedente de fisioterapia por rodilla hace años»:
# la marca de historia va antes y la de tiempo, después. Se miran las dos.
_PASADO_DESPUES = re.compile(r"\b(hace (?:anos|meses|tiempo)|previ[oa]s?|anterior(?:es)?|en el pasado)\b")


def _presente(texto_n: str, termino: str) -> bool:
    for m in re.finditer(r"(?<![a-z0-9])" + re.escape(termino) + r"(?![a-z0-9])", texto_n):
        antes = " ".join(texto_n[max(0, m.start() - 48):m.start()].split()[-4:])
        despues = " ".join(texto_n[m.end():m.end() + 60].split()[:7])
        if not _PASADO_ANTES.search(antes) and not _PASADO_DESPUES.search(despues):
            return True
    return False


def detectar(texto: str) -> dict:
    """¿La consulta es de rehabilitación? Devuelve la evidencia, no solo el sí/no:
    sin poder ver QUÉ lo disparó, un falso positivo es imposible de depurar."""
    t = _n(texto or "")
    if len(t) < 12:
        return {"es_rehabilitacion": False, "confianza": 0.0, "senales": {}}

    # TODO con frontera de palabra, no por subcadena: «tens» vive dentro de
    # «cefalea tensional» y de «hipertensión», y marcaba como rehabilitación
    # consultas que no lo eran.
    fuertes = [s for s in FUERTES if _palabra(t, s) and _presente(t, s)]
    medias = [s for s in MEDIAS if _palabra(t, s)]
    maniobras = [s for s in MANIOBRAS if _palabra(t, s)]
    debiles = [s for s in DEBILES if _palabra(t, s)]

    # Ponderación conservadora: una señal fuerte decide; si no, hacen falta
    # varias medias, o medias acompañadas de abreviaturas y maniobras.
    puntos = len(fuertes) * 3 + len(medias) * 1.5 + len(maniobras) * 1.0 + len(debiles) * 0.4
    # Tres o más abreviaturas del vocabulario de la nota juntas («TF … CHC … US»)
    # no aparecen fuera de rehabilitación: sueltas son ambiguas, en grupo no.
    if len(debiles) >= 3:
        puntos += 1.5
    es = bool(fuertes) or puntos >= 3.0
    return {
        "es_rehabilitacion": es,
        "confianza": round(min(puntos / 6.0, 1.0), 2),
        "senales": {"fuertes": fuertes, "modalidades": medias,
                    "maniobras": maniobras, "abreviaturas": debiles},
    }


def _regiones_en(t: str) -> list:
    return [r for r, claves in REGIONES.items() if any(k in t for k in claves)]


def _pesos() -> dict:
    """Peso de cada palabra según en cuántos protocolos aparece. «columna» está en
    media docena y no distingue nada; «lumbociatalgia» está en uno y decide. Sin
    esto, «Columna cervicodorsal» empataba con el protocolo correcto solo por
    compartir la palabra genérica."""
    global _pesos_cache
    if _pesos_cache is None:
        docs = [{w for w in re.split(r"[^a-z0-9]+", _n(p["nombre"])) if len(w) > 3}
                for p in catalogo()["protocolos"]]
        total = len(docs) or 1
        frec = {}
        for d in docs:
            for w in d:
                frec[w] = frec.get(w, 0) + 1
        _pesos_cache = {w: math.log(1 + total / n) for w, n in frec.items()}
        globals()["_frec_cache"] = frec
    return _pesos_cache


def _frecuencias() -> dict:
    """En cuántos protocolos aparece cada palabra (1–2 = término distintivo)."""
    _pesos()
    return _frec_cache or {}


def _etiquetas(nombre_n: str) -> list:
    """Nombres alternativos del mismo cuadro. El documento usa dos marcas:

      «/»   sinónimos completos   → «Tendinopatía de supraespinoso / pinzamiento
                                     subacromial»
      «o»   modificador alterno   → «Epicondilitis lateral o medial», que son dos
                                     etiquetas: «epicondilitis lateral» y
                                     «epicondilitis medial»

    La distribución del «o» solo se aplica cuando lo que sigue es UNA palabra
    («lateral o medial», «peroneo o tibial»). En «Muñeca o mano quirúrgica» el
    segundo término trae su propio sustantivo y repartir ahí dejaría «muñeca»
    suelta, que casaría con cualquier nota de muñeca."""
    salida = []
    for parte in nombre_n.split("/"):
        parte = parte.strip()
        trozos = re.split(r"\s+o\s+", parte)
        if len(trozos) != 2:
            salida.append(parte)
            continue
        izq, der = trozos[0].split(), trozos[1].split()
        if len(der) == 1 and len(izq) >= 2:
            # modificador alterno: «epicondilitis lateral o medial»
            salida.append(" ".join(izq))
            salida.append(" ".join(izq[:-1] + der))
        elif len(izq) == 1 and len(der) >= 2:
            # núcleo alterno con complemento compartido:
            # «lesión o tendinosis del manguito rotador»
            salida.append(" ".join(izq + der[1:]))
            salida.append(" ".join(der))
        else:
            salida.append(parte)
    return [s for s in salida if s]


def _similitud(texto_n: str, nombre_n: str, alias: list | None = None) -> float:
    """Proporción del PESO del nombre del protocolo presente en el texto. No es
    semántica a propósito: se busca coincidencia de términos, no parecido.

    Regla: alguna ETIQUETA del nombre debe estar COMPLETA en el texto. Los
    nombres con «/» listan sinónimos del mismo cuadro («Tendinopatía de
    supraespinoso / pinzamiento subacromial»), así que basta con que encaje uno.

    Coincidir a medias no vale: una nota de «lumbalgia mecánica» casaba con
    «Lumbalgia con sacroilitis» por compartir «lumbalgia» —sin que hubiera
    sacroilitis por ningún lado— y encima le ganaba a la opción correcta por
    tener el nombre más corto. El peso IDF se queda solo para ordenar entre los
    que sí encajan."""
    pesos = _pesos()
    mejor = 0.0
    for etiqueta in _etiquetas(nombre_n) + [_n(a) for a in (alias or [])]:
        palabras = {w for w in re.split(r"[^a-z0-9]+", etiqueta) if len(w) > 3}
        if not palabras:                      # alias corto («po de rodilla»): frase literal
            if etiqueta.strip() and etiqueta.strip() in texto_n:
                mejor = max(mejor, 1.0)
            continue
        if not all(w in texto_n for w in palabras):
            continue
        mejor = max(mejor, sum(pesos.get(w, 1.0) for w in palabras) / len(palabras))
    return mejor


def buscar(texto: str, region: str | None = None) -> list:
    """Protocolos candidatos, del más probable al menos. Lista vacía si ninguno
    supera el umbral — que es el resultado correcto cuando no hay match claro."""
    t = _n(texto or "")
    regiones = [region] if region else _regiones_en(t)
    salida = []
    for p in catalogo()["protocolos"]:
        sim = _similitud(t, _n(p["nombre"]), p.get("alias"))
        en_region = p["region"] in regiones
        # La región sola no basta ("hombro" aparece en cualquier nota de hombro),
        # pero sube a un protocolo cuyo nombre ya coincide en parte.
        score = sim + (0.25 if en_region else 0.0)
        if score >= UMBRAL_PROTOCOLO:
            # Posición de la primera etiqueta que casa: el diagnóstico se enuncia
            # antes que sus alternativas, así que a igualdad gana el que va antes.
            pos = min((t.find(_n(e)) for e in _etiquetas(_n(p["nombre"])) + [_n(a) for a in p.get("alias", [])]
                       if e and t.find(_n(e)) >= 0), default=10**6)
            salida.append({
                "_pos": pos,
                "id": p["id"], "region": p["region"], "nombre": p["nombre"],
                "score": round(score, 2), "base_plantilla": p["base_plantilla"],
                "requiere_lateralidad": p["requiere_lateralidad"],
                "fuentes": p["fuentes"], "pasos": p["pasos"], "notas": p["notas"],
                "advertencias": p["advertencias"], "modalidades": p["modalidades"],
            })
    # Score primero; a empate práctico (misma etiqueta completa), posición.
    salida.sort(key=lambda x: (-round(x["score"], 1), x["_pos"]))
    for x in salida:
        x.pop("_pos", None)
    return salida[:MAX_PROTOCOLOS]


# Términos que disparan cada regla de «Hallazgo → qué se agrega». Se escriben a
# mano y no se derivan del texto del hallazgo: son 13, la precisión importa más
# que la comodidad, y «Edema en cm» derivado daría «cm» como disparador.
DISPARADORES = {
    "Fuerza de cuádriceps ≤ 3, hipotrofia en cm": ["hipotrofia", "cuadriceps 3", "fuerza 3"],
    "Cicatriz adherida o dolorosa": ["cicatriz adherida", "cicatriz dolorosa", "cicatriz hipertrofica"],
    "Edema en cm": ["edema", "aumento de volumen", "godete"],
    "Marcha con andadera, muleta o claudicante": ["andadera", "muleta", "claudicante",
                                                  "baston", "marcha claudicante"],
    "Inestabilidad o esguinces previos": ["inestabilidad", "esguinces previos", "cajon anterior"],
    "Tinel / Phalen +, parestesias": ["tinel", "phalen", "parestesias", "hormigueo"],
    "Contractura de trapecio, espasmo": ["contractura de trapecio", "contractura cervical",
                                          "espasmo", "trapecio"],
    "Hiperlaxitud, luxación recurrente": ["hiperlaxitud", "luxacion recurrente", "luxaciones recurrentes"],
    "PO artroplastia de cadera": ["artroplastia de cadera", "protesis de cadera"],
    "Tornillo situacional en tobillo": ["tornillo situacional", "tornillo de posicion"],
    "Osteoporosis": ["osteoporosis", "osteopenia"],
    "Ampolla en la zona": ["ampolla", "flictena"],
    "Dolor cervical EVA ≥ 3": ["cervicalgia", "dolor cervical"],
}


# Negaciones que anulan un hallazgo si van justo antes: «niega parestesias»,
# «sin edema», «no hay contractura». Ventana corta a propósito (hasta 3 palabras):
# «niega fiebre, pero sí parestesias» no debe borrar las parestesias.
_NEGACION = re.compile(r"\b(niega|sin|no hay|no presenta|no refiere|ausencia de|negativo[s]? (?:para|a))\b")


def _afirmado(texto_n: str, termino: str) -> bool:
    """¿Aparece el término y NO está negado en su contexto inmediato? Un
    disparador leído sin esto agregaba neurodinamia a un hombro cuyo dictado
    decía «niega parestesias»."""
    for m in re.finditer(re.escape(termino), texto_n):
        antes = texto_n[max(0, m.start() - 40):m.start()]
        ventana = " ".join(antes.split()[-3:])
        if not _NEGACION.search(ventana):
            return True
    return False


def reglas_para(soap: dict) -> list:
    """Reglas de adaptación que dispara ESTA exploración. Es la pieza que decide
    si un paso se mantiene, cambia de dosis, se quita o se sustituye — el
    catálogo dice qué se puede indicar y esto dice cuándo.

    Las `restringe` van primero: un paso que SOBRA puede hacer daño (no forzar
    dorsiflexión con tornillo, no calor sobre una ampolla), mientras que uno que
    falta solo se queda corto."""
    t = _n(" ".join(str(soap.get(k) or "") for k in ("S", "O", "A")))
    orden = {"restringe": 0, "condiciona": 1, "agrega": 2}
    salida = []
    for regla in catalogo().get("reglas_adaptacion", []):
        disparos = [d for d in DISPARADORES.get(regla["hallazgo"], []) if _afirmado(t, d)]
        if disparos:
            salida.append({**regla, "disparado_por": disparos})
    salida.sort(key=lambda r: orden.get(r["tipo"], 9))
    return salida


def adaptar_a_equipo(pasos: list, equipo: list | None) -> list:
    """Ajusta los pasos al equipo del consultorio. En consulta privada cada
    médico tiene lo suyo, y una dosis de un aparato que no está sobra.

    Tres desenlaces por paso, y ninguno lo borra en silencio:
      disponible      se usa tal cual
      sustituido      el documento trae alternativa («en caso de no haber TENS
                      aplicar US 1.0 W/cm²»), así que se aplica y se marca
      sin_equipo      no hay alternativa escrita: el paso se marca y se
                      desactiva, pero SE VE. Que el médico sepa qué se queda
                      fuera es parte de la indicación; ocultarlo sería decidir
                      por él.

    Sin perfil de equipo configurado no se toca nada: no saber qué hay no es lo
    mismo que saber que no hay."""
    if not equipo:
        return [{**p, "equipo_estado": "disponible"} for p in pasos]
    tiene = {_n(e) for e in equipo}

    def hay(mods):
        return all(_n(m) in tiene for m in mods)

    salida = []
    for p in pasos:
        if not p.get("modalidades") or hay(p["modalidades"]):
            salida.append({**p, "equipo_estado": "disponible"})
            continue
        sus = p.get("sustitucion")
        if sus and _n(sus.get("requiere", "")) not in tiene and hay(sus.get("modalidades_alt") or []):
            salida.append({**p, "texto": sus["si_no_hay"],
                           "modalidades": sus.get("modalidades_alt") or [],
                           "dosis": re.findall(r"`([^`]+)`", sus["si_no_hay"]),
                           "equipo_estado": "sustituido",
                           "sustituye_a": sus["principal"]})
            continue
        salida.append({**p, "equipo_estado": "sin_equipo",
                       "falta": [m for m in p["modalidades"] if _n(m) not in tiene]})
    return salida


def analizar(soap: dict, equipo: list | None = None) -> dict:
    """Punto de entrada desde la consulta en vivo: detecta y, solo si detecta,
    busca. Se alimenta del SOAP acumulado (A y P llevan el diagnóstico y el plan,
    que es donde vive la señal)."""
    texto = " ".join(str(soap.get(k) or "") for k in ("S", "O", "A", "P"))
    det = detectar(texto)
    if not det["es_rehabilitacion"]:
        return {**det, "protocolos": [], "reglas": []}
    # Primero la IMPRESIÓN: la primera frase de A («Cuadro compatible con X») más
    # el plan. Los diferenciales («Considerar capsulitis…») van después y solo
    # entran si la impresión no casa con nada: en una ronda real, un diferencial
    # de capsulitis le ganó al diagnóstico de manguito rotador.
    A = str(soap.get("A") or "")
    P = str(soap.get("P") or "")
    impresion = re.split(r"(?<=[.;])\s+", A.strip(), maxsplit=1)[0]
    # «compatible con X, considerar Y» en una sola frase: Y es diferencial.
    impresion = re.split(r"[,;]?\s+(?:considerar|valorar|descartar|diferencial(?:es)?|"
                         r"a descartar|vs\.?)\b", impresion, maxsplit=1, flags=re.I)[0]
    # En CASCADA, no concatenado: impresión → A entera → plan → todo. Antes se
    # buscaba en impresión + plan a la vez, y una complicación a descartar en el
    # plan («…para descartar capsulitis adhesiva») le ganaba al diagnóstico por
    # tener dos palabras raras. El plan solo sirve de respaldo cuando A no dice
    # nada (al principio de la consulta), y sin sus frases de descarte.
    P_sin_descartes = " ".join(f for f in re.split(r"(?<=[.;])\s+", P)
                               if not re.search(r"\b(descartar|considerar|diferencial|complicaci)", f, re.I))
    encontrados = []
    for clave in (impresion, A, P_sin_descartes, texto):
        if clave.strip():
            encontrados = buscar(clave)
            if encontrados:
                break
    protocolos = [{**p, "pasos": adaptar_a_equipo(p["pasos"], equipo)} for p in encontrados]
    return {**det, "protocolos": protocolos, "reglas": reglas_para(soap)}
