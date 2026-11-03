"""Verificador de contraindicaciones e interacciones (tipo Drugs.com) sobre la
tabla estructurada `contraindicaciones.sqlite` del paquete FDA_movil.

Origen: `FDA_movil/checker/contra_checker.py` (verificador independiente, 16-sep-2026),
adaptado al servicio: carga perezosa (el ASR arranca aunque falte la tabla),
`status()` para el health-check, alertas de tres tipos para la receta del SOAP
(`check_rx`) y filas por fármaco para el consultor (`rows`).

Solo se lee `contra_agg` (78 484 filas de confianza alta: 30 244 contraindicaciones,
14 486 boxed warnings y 33 754 interacciones; 2 248 fármacos). Cada alerta lleva
la cita textual de la etiqueta FDA y su origen (`es` validado / `en_sin_validar`).

Reglas de uso (auditorías en FDA_movil/docs/CAMBIOS_2026-09-13_a_16.md, §3):
  - cita obligatoria en toda alerta; el médico decide, esto es APOYO;
  - contraindicaciones: 100 % soportadas, severidad 92.9 %;
  - interacciones: severidad calibrada ≈91 %: orientación, no decisión;
  - contenido regulatorio de EE.UU.: puede no coincidir con COFEPRIS.

Rutas: `FDA_CONTRA_DB` (sqlite) y `FDA_INDEX_DIR` (para `drug_aliases.json`);
por defecto se buscan en `FDA_movil/` en la raíz del repo (ver rag_service.py).
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import unicodedata
from pathlib import Path

from .rag_service import FDA_INDEX_DIR, FDA_MOVIL_DIR, RAGService

CONTRA_DB = os.environ.get("FDA_CONTRA_DB", str(FDA_MOVIL_DIR / "contra" / "contraindicaciones.sqlite"))
ALIAS_DIR = os.environ.get("FDA_INDEX_DIR", FDA_INDEX_DIR)

SEV_ORDER = {"absoluta": 0, "mayor": 1, "moderada": 2, "menor": 3}
SEV_ALTA = ("absoluta", "mayor")
NOTICE_EN = RAGService.NOTICE_EN

# Texto libre (transcripción): la tabla trae "bases" que son palabras corrientes
# (fragmentos de nombres de producto: "para", "control", "water", "test"…). En una
# receta explícita no molestan; en una conversación sí. En modo texto se ignoran
# las bases de < 5 letras y estas palabras.
TEXT_STOP = {
    "control", "acacia", "acetic", "acetyl", "acide", "alpha", "amyl", "apple", "arabic", "armour", "arnica",
    "atropa", "benzyl", "black", "bound", "butal", "carob", "casein", "cattle", "citric", "citrus", "combo",
    "copper", "coral", "cortef", "cotton", "cresol", "cupric", "donor", "equine", "ester", "esters", "ethyl",
    "factor", "fatty", "fecal", "ferric", "filled", "flavor", "folate", "fruit", "fusion", "gamma", "glycol",
    "grain", "grape", "grass", "green", "guerin", "hemin", "house", "human", "immune", "indigo", "infant",
    "iodide", "iodine", "jelly", "lactic", "lauric", "lauryl", "light", "lipoic", "lutein", "maltol", "matrix",
    "methyl", "miller", "moth", "olive", "omega", "opium", "orally", "ovine", "peanut", "pegol", "pellet",
    "phenol", "phenyl", "pollen", "rabbit", "resin", "rinse", "rubrum", "rutin", "saliva", "salmon", "serine",
    "short", "silver", "skin", "snake", "spores", "stool", "strong", "sulfer", "sulfur", "susp", "system",
    "tables", "talc", "thymus", "tissue", "toxin", "trace", "trypan", "units", "valent", "valine", "vessel",
    "water", "white", "willow", "solution", "tablet", "tablets", "capsule", "powder", "cream", "liquid",
    "extra", "strength", "relief", "formula", "complex", "natural", "herbal", "vitamin", "mineral",
    "sodium", "potassium", "calcium", "magnesium", "chloride", "sulfate", "citrate", "carbonate", "oxide",
    # palabras corrientes en inglés que también son "bases" y se parecen a palabras
    # españolas de la consulta ("completa" -> complete)
    "complete", "regular", "special", "advanced", "original", "classic", "daily", "night", "morning",
    "children", "adult", "junior", "senior", "maximum", "medium", "small", "large", "family",
    "clear", "clean", "fresh", "total", "active", "rapid", "instant", "ultra", "super", "plus",
}

# Clases farmacológicas: la tabla describe muchas interacciones por CLASE
# ("otros depresores del SNC", "relajantes musculares", "AINE"), no por nombre.
# Sin esto, tramadol + carisoprodol no se cruzan aunque ambos estén en la receta.
# Términos tal como aparecen en `objeto_norm` (minúsculas, sin acentos).
CLASES = {
    "opioide": {"terminos": ("opioide", "opioides", "opiaceo", "opiaceos", "analgesicos opioides",
                             "depresores del snc", "depresores del sistema nervioso central", "sedantes"),
                "farmacos": {"tramadol", "morphine", "oxycodone", "hydrocodone", "codeine", "fentanyl",
                             "buprenorphine", "methadone", "tapentadol", "meperidine", "hydromorphone", "oxymorphone"}},
    "relajante muscular": {"terminos": ("relajante muscular", "relajantes musculares", "depresores del snc",
                                        "depresores del sistema nervioso central", "sedantes"),
                           "farmacos": {"carisoprodol", "cyclobenzaprine", "methocarbamol", "baclofen",
                                        "tizanidine", "orphenadrine", "chlorzoxazone", "metaxalone"}},
    "benzodiacepina": {"terminos": ("benzodiacepina", "benzodiacepinas", "benzodiazepina", "benzodiazepinas",
                                    "depresores del snc", "depresores del sistema nervioso central", "sedantes", "hipnoticos"),
                       "farmacos": {"diazepam", "alprazolam", "clonazepam", "lorazepam", "midazolam", "bromazepam"}},
    "aine": {"terminos": ("aine", "aines", "nsaid", "nsaids", "antiinflamatorios no esteroideos",
                          "antiinflamatorio no esteroideo", "antiinflamatorios no esteroides", "salicilatos"),
             "farmacos": {"ibuprofen", "naproxen", "diclofenac", "ketorolac", "meloxicam", "celecoxib", "piroxicam",
                          "indomethacin", "ketoprofen", "etoricoxib", "aspirin", "nimesulide", "etodolac", "nabumetone"}},
    "isrs": {"terminos": ("isrs", "ssri", "ssris", "inhibidores selectivos de la recaptacion de serotonina",
                          "serotoninergicos", "agentes serotoninergicos", "farmacos serotoninergicos"),
             "farmacos": {"fluoxetine", "sertraline", "paroxetine", "citalopram", "escitalopram", "fluvoxamine",
                          "venlafaxine", "duloxetine", "desvenlafaxine"}},
    "triciclico": {"terminos": ("antidepresivos triciclicos", "triciclicos", "triciclico"),
                   "farmacos": {"amitriptyline", "imipramine", "nortriptyline", "clomipramine"}},
    "ieca/ara": {"terminos": ("inhibidores de la eca", "inhibidores de la enzima convertidora de angiotensina", "ieca",
                              "ace", "ace inhibitors", "arb", "arbs", "antagonistas de los receptores de angiotensina",
                              "bloqueadores de los receptores de angiotensina"),
                 "farmacos": {"enalapril", "captopril", "lisinopril", "ramipril", "losartan", "valsartan",
                              "telmisartan", "irbesartan", "candesartan", "olmesartan"}},
    "diuretico": {"terminos": ("diuretico", "diureticos", "diuretics"),
                  "farmacos": {"furosemide", "hydrochlorothiazide", "spironolactone", "chlorthalidone",
                               "bumetanide", "indapamide", "torsemide"}},
    "anticoagulante": {"terminos": ("anticoagulante", "anticoagulantes", "anticoagulants"),
                       "farmacos": {"warfarin", "rivaroxaban", "apixaban", "dabigatran", "enoxaparin", "heparin"}},
    "corticosteroide": {"terminos": ("corticosteroide", "corticosteroides", "corticoesteroides", "glucocorticoides",
                                     "esteroides", "corticosteroids"),
                        "farmacos": {"prednisone", "prednisolone", "dexamethasone", "methylprednisolone",
                                     "hydrocortisone", "betamethasone", "deflazacort"}},
    "antiagregante": {"terminos": ("antiagregantes", "antiagregantes plaquetarios", "antiplaquetarios"),
                      "farmacos": {"aspirin", "clopidogrel", "ticagrelor", "prasugrel"}},
}
_CLASE_DE = {f: c for c, d in CLASES.items() for f in d["farmacos"]}
_TERMINOS_RE = {c: re.compile(r"\b(" + "|".join(re.escape(t) for t in d["terminos"]) + r")\b")
                for c, d in CLASES.items()}


def clase_de(base: str) -> str | None:
    return _CLASE_DE.get(base)


# Condiciones sintéticas a partir de la ficha del paciente. Los objetos de la
# tabla vienen normalizados en español (`objeto_norm`), de ahí estas grafías.
_POBLACION_EMBARAZO = ("embarazo", "mujeres embarazadas")
_POBLACION_NINOS = ("ninos", "pacientes pediatricos")
_POBLACION_ADOLESC = ("adolescentes", "pacientes pediatricos")
_POBLACION_MAYORES = ("pacientes de edad avanzada", "pacientes ancianos")


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def _obj_norm(s: str) -> str:
    s = _fold(s)
    s = re.sub(r"^(pacientes? con|paciente con|uso en|en|los|las|el|la|de|del)\s+", "", s)
    return re.sub(r"[^a-z0-9 ]+", "", s).strip()


def _rx_name(item) -> str:
    """Nombre del fármaco a partir de lo que llega del SOAP / backend:
    `{"nombre": "warfarina", "dosis": "5 mg"}`, `{"drug": ...}` o texto."""
    if isinstance(item, dict):
        return str(item.get("nombre") or item.get("drug") or item.get("generico") or item.get("name") or "")
    return str(item or "")


class ContraChecker:
    def __init__(self, db_path: str | None = None, index_dir: str | None = None):
        self.db_path = db_path or CONTRA_DB
        self.index_dir = index_dir or ALIAS_DIR
        self._con = None
        self._svc = None
        self._loaded = False
        self._error = None
        self.n_farmacos = 0
        self._lock = threading.Lock()

    # ------------------------------------------------------------ carga
    def _ensure(self):
        if self._loaded or self._error:
            return
        with self._lock:
            if self._loaded or self._error:
                return
            try:
                if not Path(self.db_path).exists():
                    self._error = "contra_db_not_available"
                    return
                con = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, check_same_thread=False)
                # Léxico de fármacos: las bases de la tabla + alias marca->genérico
                # del índice. Se reutiliza la normalización de RAGService.detect_drugs
                # SIN cargar el índice semántico (no hace falta bge-m3 para verificar).
                svc = RAGService(index_dir=self.index_dir, label="fda")
                svc._chunks, svc._drug_index, svc._alias, svc._by_prefix = [], {}, {}, {}
                bases = [b for (b,) in con.execute("SELECT DISTINCT farmaco_base FROM contra_agg")]
                svc._drug_index = {b: [0] for b in bases}
                for b in bases:
                    svc._by_prefix.setdefault(b[:4], []).append(b)
                p = Path(self.index_dir) / "drug_aliases.json"
                if p.exists():
                    try:
                        raw = json.loads(p.read_text(encoding="utf-8"))
                        for brand, gen in raw.items():
                            bs = RAGService._bases(gen) & set(svc._drug_index)
                            key = RAGService._fold(brand).strip()
                            if bs and 1 <= len(bs) <= 3 and key and key not in RAGService.STOP:
                                svc._alias[key] = bs
                    except Exception:
                        pass
                # Vista SIN alias de marca para texto libre: en una transcripción,
                # marcas que son palabras corrientes ("para", "control") se
                # detectarían como fármacos. Comparte el léxico; solo vacía el alias.
                svc_txt = RAGService(index_dir=self.index_dir, label="fda")
                svc_txt._chunks, svc_txt._alias = [], {}
                svc_txt._drug_index, svc_txt._by_prefix = svc._drug_index, svc._by_prefix
                self._con, self._svc, self._svc_txt, self.n_farmacos = con, svc, svc_txt, len(bases)
                self._loaded = True
            except Exception as e:  # pragma: no cover
                self._error = f"contra_load_error: {e}"

    def available(self) -> bool:
        self._ensure()
        return self._loaded

    def status(self) -> dict:
        """Para el health-check: NO fuerza la carga (aunque cargar tarda < 1 s)."""
        return {"db_present": Path(self.db_path).exists(), "db_path": self.db_path,
                "loaded": self._loaded, "error": self._error, "n_farmacos": self.n_farmacos}

    # ------------------------------------------------------------ consultas
    def detect(self, text: str, brands: bool = True) -> set:
        """Bases (nombre genérico en inglés, como en la tabla) mencionadas en el texto.
        Acepta español, marcas Rx (Coumadin -> warfarin), sales y grafías españolas.
        `brands=False` para texto libre (transcripción): solo genéricos."""
        if not self.available():
            return set()
        return (self._svc if brands else self._svc_txt).detect_drugs(text)

    def _detect_laxo(self, text: str, ya: set) -> set:
        """Segunda pasada SOLO para texto libre: el ASR deforma nombres de fármaco
        ("ketrolaco", "caripromodol") y el emparejamiento normal, que exige las
        mismas 4 primeras letras y similitud ≥ 0.86, los pierde. Aquí se admite
        prefijo de 3 letras y similitud ≥ 0.82 en palabras de ≥ 8 letras que no
        sean vocabulario clínico. Nunca se aplica a recetas explícitas."""
        import difflib
        svc = self._svc_txt
        out = set()
        for t in svc._join_compounds(svc._fold(text)).split():
            if len(t) < 8 or t in svc.STOP or t in svc.SALTS or any(ch.isdigit() for ch in t):
                continue
            cands = [b for pre, bs in svc._by_prefix.items() if pre.startswith(t[:3]) for b in bs
                     if len(b) >= 5 and b not in TEXT_STOP and abs(len(b) - len(t)) <= 3]
            if not cands or any(b in ya for b in cands if difflib.SequenceMatcher(None, t, b).ratio() >= 0.82):
                continue
            best = difflib.get_close_matches(t, cands, n=1, cutoff=0.82)
            if best:
                out.add(best[0])
        return out

    def _rows(self, base: str) -> list[tuple]:
        return self._con.execute(
            "SELECT objeto, tipo, seccion, severidad_max, n_evidencias, ejemplo_cita, objeto_norm, "
            "ejemplo_detalle, n_es, n_en FROM contra_agg WHERE farmaco_base=?", (base,)).fetchall()

    @staticmethod
    def _alert(base, row, alerta: str) -> dict:
        objeto, tipo, sec, sev, n, cita, _on, det, n_es, n_en = row
        fuente = "es" if (n_es or 0) >= (n_en or 0) else "en_sin_validar"
        a = {"farmaco": base, "objeto": objeto, "tipo": tipo, "seccion": sec, "severidad": sev,
             "evidencias": n, "cita": cita or "", "detalle": det or "", "fuente": fuente, "alerta": alerta}
        if fuente != "es":
            a["notice"] = NOTICE_EN
        return a

    def rows(self, drug: str, limit: int = 12, secciones: tuple | None = None) -> dict:
        """Filas de la tabla para UN fármaco (consultor): ordenadas por severidad y
        evidencia. `secciones` restringe (p. ej. CONTRAINDICATIONS, DRUG INTERACTIONS)."""
        found = self.detect(drug)
        out = []
        for b in sorted(found):
            for r in self._rows(b):
                if secciones and r[2] not in secciones:
                    continue
                out.append(self._alert(b, r, "listado"))
        out.sort(key=lambda a: (SEV_ORDER.get(a["severidad"], 9), -a["evidencias"]))
        return {"farmacos_detectados": sorted(found), "filas": out[:limit]}

    def check(self, drugs, conditions=None, k_per_drug: int = 200, context_text: str | None = None,
              clases: bool = False) -> dict:
        """Mismo contrato que el verificador del paquete (FDA_movil/docs/PRUEBAS_Y_USO.md §3.1):
        `alerta` = coincide_condicion | coincide_farmaco | listado.

        `context_text` (transcripción de la consulta en vivo): se detectan en él los
        fármacos mencionados y cuentan como condición los objetos de la tabla que
        aparecen literalmente en el texto (palabra completa, ≥ 6 letras: "asma" no
        dispara por "plasma"). Así las alertas van saliendo conforme avanza la
        consulta, sin LLM.

        `clases=False` mantiene el contrato del paquete (mismos conteos que
        FDA_movil/docs/PRUEBAS_Y_USO.md); `check_rx` activa el cruce por clase."""
        if not self.available():
            return {"farmacos_detectados": [], "condiciones": [], "alertas": [], "error": self._error}
        if isinstance(drugs, str):
            drugs = [drugs]
        found = set()
        for d in drugs:
            found |= self.detect(_rx_name(d))
        ctx = _obj_norm(context_text) if context_text and str(context_text).strip() else ""
        if ctx:
            found |= {b for b in self.detect(context_text, brands=False)
                      if len(b) >= 5 and b not in TEXT_STOP}
            found |= self._detect_laxo(context_text, found)
        conds = [_obj_norm(c) for c in (conditions or []) if c and str(c).strip()]
        out = []
        for b in sorted(found):
            for row in self._rows(b):
                on, tipo = row[6], row[1]
                cond_hit = next((c for c in conds if c and (c in on or on in c)), None)
                # Del texto solo cuentan condiciones/poblaciones del paciente: los
                # objetos que son fármacos o clases ya entran por `drug_hit` (y la
                # propia mención del fármaco no debe leerse como "hipersensibilidad").
                if (cond_hit is None and ctx and tipo in ("condicion", "poblacion", "procedimiento")
                        and len(on) >= 6 and re.search(r"\b" + re.escape(on) + r"\b", ctx)):
                    cond_hit = on
                other = [x for x in found if x != b]
                drug_hit, clase_hit = None, None
                if tipo in ("farmaco", "clase_farmacologica"):
                    drug_hit = next((x for x in other if x in on or on.startswith(x)), None)
                if clases and drug_hit is None and tipo in ("farmaco", "clase_farmacologica", "poblacion", "otro"):
                    # por clase: "otros depresores del SNC" en tramadol cruza con carisoprodol
                    for x in other:
                        c = _CLASE_DE.get(x)
                        if c and _TERMINOS_RE[c].search(on):
                            drug_hit, clase_hit = x, c
                            break
                if cond_hit or drug_hit or (not conds and not ctx and len(found) == 1):
                    a = self._alert(b, row, "coincide_condicion" if cond_hit
                                    else ("coincide_farmaco" if drug_hit else "listado"))
                    if cond_hit:
                        a["condicion"] = cond_hit
                    if drug_hit and not cond_hit:
                        a["con_farmaco"] = drug_hit
                        if clase_hit:
                            a["clase"] = clase_hit
                    out.append(a)
        out.sort(key=lambda a: (SEV_ORDER.get(a["severidad"], 9), -a["evidencias"]))
        return {"farmacos_detectados": sorted(found), "condiciones": conds,
                "alertas": out[:k_per_drug * max(1, len(found))]}

    def check_rx(self, rx_list, conditions=None, allergies=None, age=None, sex=None,
                 embarazo: bool | None = None, max_alertas: int = 60,
                 context_text: str | None = None) -> dict:
        """Alertas para una RECETA (contrato de `/v1/drugs/check`, plan §5 del registro
        de cambios): `tipo_alerta` = farmaco_condicion | farmaco_farmaco | alergia.

        - farmaco_condicion: contraindicaciones/boxed/interacciones del fármaco con una
          condición del paciente (diagnósticos, crónicos, embarazo, edad).
        - farmaco_farmaco: cruces entre los fármacos de la propia receta.
        - alergia: alergia registrada que la etiqueta lista como hipersensibilidad, o
          alergia directa a un fármaco de la receta (fuente `expediente`).
        No lista TODO lo del fármaco (eso es `rows`/`check` sin condiciones)."""
        if not self.available():
            return {"farmacos_detectados": [], "alertas": [], "resumen": {}, "error": self._error}
        conds = [str(c) for c in (conditions or []) if c and str(c).strip()]
        if embarazo:
            conds += list(_POBLACION_EMBARAZO)
        try:
            years = float(age) if age is not None and str(age).strip() != "" else None
        except (TypeError, ValueError):
            years = None
        if years is not None:
            if years < 12:
                conds += list(_POBLACION_NINOS)
            elif years < 18:
                conds += list(_POBLACION_ADOLESC)
            elif years >= 65:
                conds += list(_POBLACION_MAYORES)
        # Las poblaciones sintéticas van en pares de sinónimos: se canonizan para que
        # la deduplicación deje UNA alerta por fármaco y sección.
        canon = {"mujeres embarazadas": "embarazo", "pacientes ancianos": "pacientes de edad avanzada",
                 "pacientes pediatricos": "ninos" if (years is not None and years < 12) else "adolescentes"}
        base = self.check(rx_list, conds, context_text=context_text, clases=True)
        found = set(base["farmacos_detectados"])
        alertas = []
        for a in base["alertas"]:
            if a["alerta"] == "listado":
                continue
            a["tipo_alerta"] = "farmaco_condicion" if a["alerta"] == "coincide_condicion" else "farmaco_farmaco"
            if a.get("condicion") in canon:
                a["condicion"] = canon[a["condicion"]]
            alertas.append(a)
        # alergias del expediente
        seen = {(a["farmaco"], a["objeto"], a["seccion"]) for a in alertas}
        for al in (allergies or []):
            al_s = str(al or "").strip()
            if not al_s:
                continue
            al_n = _obj_norm(al_s)
            al_bases = self.detect(al_s)
            for b in sorted(found):
                if b in al_bases:
                    # alergia directa al fármaco recetado: la cita, si existe, es la fila
                    # de hipersensibilidad de la propia etiqueta
                    rows = [r for r in self._rows(b) if r[1] == "alergia"]
                    rows.sort(key=lambda r: (SEV_ORDER.get(r[3], 9), -(r[4] or 0)))
                    if rows:
                        a = self._alert(b, rows[0], "alergia")
                    else:
                        a = {"farmaco": b, "objeto": al_s, "tipo": "alergia", "seccion": "EXPEDIENTE",
                             "severidad": "absoluta", "evidencias": 0, "cita": "", "detalle": "",
                             "fuente": "expediente", "alerta": "alergia"}
                    a.update({"tipo_alerta": "alergia", "alergia": al_s, "severidad": "absoluta"})
                    key = (b, a["objeto"], a["seccion"])
                    if key not in seen:
                        seen.add(key)
                        alertas.append(a)
                    continue
                if len(al_n) < 4:
                    continue
                for r in self._rows(b):
                    if r[1] != "alergia" or al_n not in r[6]:
                        continue
                    key = (b, r[0], r[2])
                    if key in seen:
                        continue
                    seen.add(key)
                    a = self._alert(b, r, "alergia")
                    a.update({"tipo_alerta": "alergia", "alergia": al_s})
                    alertas.append(a)
        alertas = _dedupe(alertas)[:max_alertas]
        resumen = {}
        for a in alertas:
            resumen[a["severidad"]] = resumen.get(a["severidad"], 0) + 1
        return {"farmacos_detectados": sorted(found), "condiciones": base["condiciones"],
                "alertas": alertas, "resumen": resumen,
                "nota": "Apoyo con etiquetas FDA (EE.UU.); cita obligatoria; el médico decide."}


def _dedupe(alertas: list) -> list:
    """Una alerta por (fármaco, tipo, con qué chocó): la tabla trae varias filas
    para el mismo concepto ("embarazo" y "mujeres embarazadas"; "penicilina" en
    tres etiquetas; "edad avanzada" en el boxed warning Y en interacciones). Se
    muestra la más grave, con más evidencia y, a igualdad, la de fuente en
    español validado; las demás quedan en `otras_citas` (sección, severidad,
    cita, fuente) para que nada se pierda al desplegar."""
    best = {}
    for a in alertas:
        contra_que = a.get("alergia") or a.get("condicion") or a.get("con_farmaco") or a.get("objeto")
        if a.get("tipo_alerta") == "farmaco_farmaco" and a.get("con_farmaco"):
            # Un PAR es una sola interacción aunque cada etiqueta la cuente desde su
            # lado ("ketorolac -> meloxicam" y "meloxicam -> ketorolac"): se fusionan.
            key = ("farmaco_farmaco", frozenset((a["farmaco"], a["con_farmaco"])))
        else:
            key = (a["farmaco"], a.get("tipo_alerta"), contra_que)
        rank = (SEV_ORDER.get(a["severidad"], 9), 0 if a.get("fuente") == "es" else 1, -(a.get("evidencias") or 0))
        best.setdefault(key, []).append((rank, a))
    out = []
    for grupo in best.values():
        grupo.sort(key=lambda t: t[0])
        a = grupo[0][1]
        otras = []
        vistas = {(a["seccion"], a["cita"])}
        for _, o in grupo[1:]:
            k = (o["seccion"], o["cita"])
            if k in vistas:
                continue
            vistas.add(k)
            objeto = o["objeto"]
            if o["farmaco"] != a["farmaco"]:
                objeto = f"desde la etiqueta de {o['farmaco']}: {objeto}"
            otras.append({"seccion": o["seccion"], "severidad": o["severidad"], "cita": o["cita"],
                          "fuente": o["fuente"], "objeto": objeto})
        if otras:
            a["otras_citas"] = otras
        out.append(a)
    out.sort(key=lambda a: (SEV_ORDER.get(a["severidad"], 9), -(a.get("evidencias") or 0)))
    return out


def alertas_altas(alertas: list) -> list:
    """Solo absoluta/mayor: las que van a `/v1/drugs/alternatives` y al aviso de validación."""
    return [a for a in (alertas or []) if a.get("severidad") in SEV_ALTA]


# instancia única (carga perezosa): la tabla se abre en la primera consulta
contra = ContraChecker()
