"""RAGService: búsqueda semántica local sobre el índice piloto (bge-m3 + numpy coseno).

Dos instancias: `rag` (guías GPC, sin cambios) y `rag_fda` (etiquetas FDA/DailyMed
ES+EN del paquete FDA_movil). Las reglas de idioma y el filtro por fármaco solo
actúan cuando los chunks traen `language` / `drugs` (el índice GPC no los trae).

Carga perezosa (índice + modelo). Asigna citation_id CERRADOS (S1, S2…) por resultado:
gemma solo podrá citar esos IDs. Si no hay índice, `available()` es False y el SOAP sigue
funcionando sin RAG.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import unicodedata
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
INDEX_DIR = Path(os.environ.get("MEGI_RAG_INDEX_DIR", str(HERE / "index")))


class RAGService:
    def __init__(self, index_dir=None, label="gpc"):
        # index_dir=None mantiene el comportamiento historico (INDEX_DIR global),
        # para no alterar el indice de guias ya montado.
        self._dir = Path(index_dir) if index_dir else INDEX_DIR
        self.label = label
        self._loaded = False
        self._error = None
        self._chunks = []
        self._emb = None
        self._model = None
        self._meta = {}

    def _ensure(self):
        if self._loaded or self._error:
            return
        try:
            meta_p = self._dir / "meta.json"
            chunks_p = self._dir / "chunks.jsonl"
            emb_p = self._dir / "embeddings.npz"
            if not (meta_p.exists() and chunks_p.exists() and emb_p.exists()):
                self._error = "index_not_available"
                return
            self._meta = json.loads(meta_p.read_text(encoding="utf-8"))
            self._chunks = [json.loads(l) for l in open(chunks_p, encoding="utf-8")]
            self._emb = np.load(emb_p)["embeddings"].astype(np.float32)
            # regla 2: pares (seccion, farmaco) con version en español en TODO el indice
            self._es_pairs = {key for c in self._chunks
                              if c.get("language", "es") == "es"
                              for key in self._tie_keys(c)}
            # filtro por farmaco: lexico base -> indices de chunks (solo si hay `drugs`)
            self._build_drug_index()
            self._section_arr = np.array([c.get("section") or "" for c in self._chunks])
            self._section_mask = True if any(c.get("section") for c in self._chunks) else None
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self._meta.get("embedding_model", "BAAI/bge-m3"))
            self._loaded = True
        except Exception as e:  # pragma: no cover
            self._error = f"index_load_error: {e}"

    def available(self) -> bool:
        self._ensure()
        return self._loaded

    def status(self) -> dict:
        """Estado para health-checks, SIN forzar la carga (a diferencia de
        `available()`, que dispara la carga de bge-m3 la primera vez).
        Usa self._dir para reportar el indice correcto (gpc o fda)."""
        files = {p: (self._dir / p).exists()
                 for p in ("meta.json", "chunks.jsonl", "embeddings.npz")}
        return {"label": self.label, "index_dir": str(self._dir),
                "index_present": all(files.values()), "loaded": self._loaded,
                "error": self._error}

    @property
    def index_version(self) -> str:
        self._ensure()
        return self._meta.get("index_version", "unknown")

    # Reglas de idioma (capa provisional EN del indice FDA). Solo actuan si los
    # chunks traen `language`; el indice GPC no lo trae y queda igual que antes.
    #   1. cada resultado expone language / validation_status
    #   2. ante empate de farmaco + seccion, se prefiere el chunk en español
    #   3. los pasajes en ingles llevan `notice` y la cita lo dice
    NOTICE_EN = "texto original en ingles · traduccion no validada"
    OVERFETCH = 4  # candidatos = k * OVERFETCH antes de aplicar la regla 2

    # ------------------------------------------------------------------
    # Filtro por nombre de farmaco (mismo enfoque que AskFDALabel, FDA 2025:
    # reconocer el farmaco en la consulta, normalizar marca/sal a generico, y
    # consultar por farmaco + seccion antes de la similitud semantica).
    # Solo actua en indices cuyos chunks traen `drugs`; el GPC queda igual.
    # ------------------------------------------------------------------
    SALTS = {"hydrochloride", "hcl", "sodium", "potassium", "calcium", "magnesium", "sulfate",
             "sulphate", "acetate", "mesylate", "maleate", "tartrate", "bitartrate", "citrate",
             "phosphate", "succinate", "fumarate", "besylate", "monohydrate", "dihydrate",
             "anhydrous", "usp", "dipropionate", "propionate", "furoate", "valerate", "hydrobromide",
             "bromide", "chloride", "nitrate", "hemihydrate", "trihydrate", "disodium", "dipotassium",
             "medocaril", "pamoate", "lactate", "gluconate", "carbonate", "oxide", "hydroxide",
             "extended", "release", "delayed", "tablets", "tablet", "capsules", "capsule", "injection", "oral",
             "solution", "and", "with", "in", "of", "for", "er", "xr", "sr", "cr", "dr",
             # formas farmacéuticas / vías / envases: no identifican al principio activo
             "cream", "ointment", "gel", "lotion", "spray", "drops", "patch", "inhalation", "suspension",
             "syrup", "elixir", "powder", "topical", "ophthalmic", "otic", "nasal", "vaginal", "rectal",
             "transdermal", "sublingual", "chewable", "film", "coated", "liquid", "concentrate", "water",
             "alcohol", "kit", "pack", "prefilled", "syringe", "vial", "ampule", "aerosol", "inhaler",
             "lozenge", "lozenges", "suppository", "suppositories", "enema", "foam", "shampoo", "soap",
             "wipes", "pads", "swab", "swabs", "strength", "extra", "maximum", "childrens", "infants",
             "adult", "junior", "regular", "plus", "forte", "daily", "hour", "hours", "relief", "formula",
             "brand", "generic", "usp", "nf", "bp", "compounding", "bulk", "preservative", "free",
             "sterile", "isotonic", "buffered", "flavored", "unflavored", "sugar", "dye", "single", "dose",
             "unit", "multi", "sodium chloride", "dextrose", "sterile water", "acid", "acids", "salt", "salts", "base", "complex",
             "tromethamine", "hyclate", "mesilate", "tosylate", "hemifumarate", "malate", "oxalate", "decanoate",
             "palmitate", "enanthate", "cypionate", "undecanoate", "stearate", "benzoate", "dihydrochloride",
             "trihydrate", "pentahydrate", "hydrate", "sesquihydrate", "monobasic", "dibasic"}
    # principios activos de varias palabras que NO deben partirse (se unen en un solo token)
    COMPOUNDS = {"ethinyl estradiol": "ethinylestradiol", "conjugated estrogens": "conjugatedestrogens",
                 "esterified estrogens": "esterifiedestrogens", "insulin glargine": "insulinglargine",
                 "insulin lispro": "insulinlispro", "insulin aspart": "insulinaspart", "insulin detemir": "insulindetemir",
                 "insulin degludec": "insulindegludec", "insulin human": "insulinhuman", "insulin isophane": "insulinisophane",
                 "medroxyprogesterone": "medroxyprogesterone", "norethindrone acetate": "norethindrone",
                 "levonorgestrel": "levonorgestrel", "sodium bicarbonate": "sodiumbicarbonate",
                 "magnesium sulfate": "magnesiumsulfate", "potassium chloride": "potassiumchloride",
                 "calcium carbonate": "calciumcarbonate", "zinc oxide": "zincoxide", "titanium dioxide": "titaniumdioxide",
                 "ferrous sulfate": "ferroussulfate", "lithium carbonate": "lithium", "nitrous oxide": "nitrousoxide"}
    _MIN_TOKEN = 5
    # nombres en español/INN que en las etiquetas de EE.UU. aparecen con otro nombre
    SYNONYMS = {"paracetamol": "acetaminophen", "salbutamol": "albuterol", "adrenalina": "epinephrine",
                "noradrenalina": "norepinephrine", "aspirina": "aspirin", "acetilsalicilico": "aspirin",
                "glibenclamida": "glyburide", "furosemida": "furosemide", "hidroclorotiazida": "hydrochlorothiazide",
                "clorfenamina": "chlorpheniramine", "clorfeniramina": "chlorpheniramine", "bencilpenicilina": "penicillin",
                "rifampicina": "rifampin", "isoniazida": "isoniazid", "nitrofurantoina": "nitrofurantoin",
                "trimetoprima": "trimethoprim", "sulfametoxazol": "sulfamethoxazole", "amikacina": "amikacin",
                "gentamicina": "gentamicin", "vancomicina": "vancomycin", "heparina": "heparin",
                "enoxaparina": "enoxaparin", "insulina": "insulin", "levotiroxina": "levothyroxine",
                "hidrocortisona": "hydrocortisone", "dexametasona": "dexamethasone", "betametasona": "betamethasone",
                "metilprednisolona": "methylprednisolone", "ketorolaco": "ketorolac", "diclofenaco": "diclofenac",
                "naproxeno": "naproxen", "tramadol": "tramadol", "morfina": "morphine", "fentanilo": "fentanyl",
                "codeina": "codeine", "oxicodona": "oxycodone", "hidrocodona": "hydrocodone",
                "difenhidramina": "diphenhydramine", "loratadina": "loratadine", "cetirizina": "cetirizine",
                "ranitidina": "ranitidine", "famotidina": "famotidine", "metoclopramida": "metoclopramide",
                "ondansetron": "ondansetron", "lansoprazol": "lansoprazole", "pantoprazol": "pantoprazole",
                "esomeprazol": "esomeprazole", "captopril": "captopril", "nifedipino": "nifedipine",
                "amlodipino": "amlodipine", "verapamilo": "verapamil", "digoxina": "digoxin",
                "espironolactona": "spironolactone", "clortalidona": "chlorthalidone", "acido": "",
                "valproico": "valproate", "valproato": "valproate", "carbamazepina": "carbamazepine",
                "fenitoina": "phenytoin", "levetiracetam": "levetiracetam", "lamotrigina": "lamotrigine",
                "sertralina": "sertraline", "paroxetina": "paroxetine", "escitalopram": "escitalopram",
                "citalopram": "citalopram", "venlafaxina": "venlafaxine", "amitriptilina": "amitriptyline",
                "haloperidol": "haloperidol", "risperidona": "risperidone", "olanzapina": "olanzapine",
                "quetiapina": "quetiapine", "clonazepam": "clonazepam", "alprazolam": "alprazolam",
                "diazepam": "diazepam", "lorazepam": "lorazepam", "zolpidem": "zolpidem",
                "metronidazol": "metronidazole", "fluconazol": "fluconazole", "ketoconazol": "ketoconazole",
                "aciclovir": "acyclovir", "valaciclovir": "valacyclovir", "oseltamivir": "oseltamivir",
                "sildenafilo": "sildenafil", "tamsulosina": "tamsulosin", "finasterida": "finasteride",
                "alopurinol": "allopurinol", "colchicina": "colchicine", "metotrexato": "methotrexate",
                "tamoxifeno": "tamoxifen", "anastrozol": "anastrozole", "warfarina": "warfarin",
                "clopidogrel": "clopidogrel", "rivaroxaban": "rivaroxaban", "apixaban": "apixaban"}
    # palabras clinicas frecuentes que NO deben emparejarse (ni exacto ni aproximado)
    STOP = {"renal", "hepatic", "hepatica", "hepatico", "cardiac", "cardiaca", "cardiaco", "embarazo",
            "lactancia", "pediatric", "pediatrico", "pediatricos", "geriatric", "adultos", "adulto",
            "dosis", "dosage", "insuficiencia", "tratamiento", "treatment", "contraindicaciones",
            "contraindicacion", "contraindicado", "contraindicada", "contraindications", "interacciones",
            "interaccion", "interactions", "sobredosis", "overdose", "reacciones", "adversas", "adverse",
            "advertencias", "warnings", "precauciones", "precautions", "pacientes", "paciente", "patients",
            "diabetes", "diabetico", "diabeticos", "hipertension", "hypertension", "antihipertensivo",
            "infeccion", "infection", "funcion", "function", "ajuste", "puede", "usarse", "usar",
            "cuando", "situaciones", "administrar", "recibir", "recomienda", "absoluta", "niños",
            "ninos", "children", "embarazada", "pregnancy", "anciano", "ancianos", "elderly",
            "medicamento", "medicamentos", "farmaco", "farmacos", "efectos", "effects", "largo",
            "plazo", "sindrome", "syndrome", "enfermedad", "disease", "cronica", "aguda", "severa",
            "grave", "leve", "moderada", "alergia", "alergico", "allergy", "allergic", "vacuna", "vaccine",
            "antibiotico", "analgesico", "anticoagulante", "antidepresivo", "anticonvulsivo", "diuretico",
            "esteroide", "hormona", "hormonal", "insulina", "glucosa", "presion", "arterial", "sangre",
            "higado", "riñon", "rinon", "riñones", "corazon", "pulmon", "cerebro", "estomago", "gastrico",
            "intestinal", "toxicidad", "toxicity", "riesgo", "risk", "seguridad", "safety", "manejo",
            "terapia", "therapy", "clinico", "clinica", "clinical", "estudio", "studies", "evidencia"}

    @staticmethod
    def _fold(s: str) -> str:
        s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
        return re.sub(r"[^a-z0-9 ]+", " ", s.lower())

    @classmethod
    def _join_compounds(cls, folded: str) -> str:
        for k, v in cls.COMPOUNDS.items():
            if k in folded:
                folded = folded.replace(k, v)
        return folded

    @classmethod
    def _bases(cls, name: str) -> set:
        """'methylphenidate hydrochloride' -> {'methylphenidate'};
        'amoxicillin and clavulanate potassium' -> {'amoxicillin', 'clavulanate'};
        'ethinyl estradiol' -> {'ethinylestradiol'} (no se parte en ethinyl + estradiol)."""
        return {t for t in cls._join_compounds(cls._fold(name)).split()
                if t not in cls.SALTS and len(t) >= 4 and not any(ch.isdigit() for ch in t)}

    def _build_drug_index(self):
        by = {}
        for i, c in enumerate(self._chunks):
            for d in c.get("drugs") or []:
                for b in self._bases(d):
                    by.setdefault(b, []).append(i)
        self._drug_index = {b: np.array(v, dtype=np.int64) for b, v in by.items()}
        # marca -> generico (drug_aliases.json junto al indice, opcional)
        self._alias = {}
        p = self._dir / "drug_aliases.json"
        if p.exists():
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
                for brand, gen in raw.items():
                    bs = self._bases(gen) & set(self._drug_index)
                    key = self._fold(brand).strip()
                    if bs and 1 <= len(bs) <= 3 and key and key not in self.STOP \
                            and not (len(key.split()) == 1 and key in self.STOP):
                        self._alias[key] = bs
            except Exception:
                self._alias = {}
        # indice por prefijo para el emparejamiento aproximado (warfarina -> warfarin)
        self._by_prefix = {}
        for b in self._drug_index:
            self._by_prefix.setdefault(b[:4], []).append(b)

    @staticmethod
    def _variants(t: str) -> list:
        """Grafias inglesas plausibles de un nombre en español: cefalexina -> cephalexin,
        azitromicina -> azithromycin, omeprazol -> omeprazole, prednisona -> prednisone."""
        v = {t}
        for a, b in (("icina", "ycin"), ("ina", "in"), ("ona", "one"), ("ida", "ide"), ("azol", "azole"),
                     ("ol", "ol"), ("ato", "ate"), ("ano", "ane"), ("eno", "ene"), ("ino", "ine")):
            if t.endswith(a):
                v.add(t[:-len(a)] + b)
        for x in list(v):
            v.add(x.replace("f", "ph"))
            v.add(x.replace("z", "z").replace("tr", "thr"))
            v.add(x.replace("f", "ph").replace("tr", "thr"))
        return sorted(v, key=lambda x: (x != t, x))

    # intencion de seccion (segunda mitad del enfoque AskFDALabel: farmaco + seccion)
    SECTION_HINTS = [
        (("contraindic",), {"CONTRAINDICATIONS"}),
        (("interacci", "interaction"), {"DRUG INTERACTIONS"}),
        (("sobredosis", "overdos", "intoxicac"), {"OVERDOSAGE"}),
        (("reacciones adversas", "efectos adversos", "efectos secundarios", "adverse"), {"ADVERSE REACTIONS"}),
        (("embaraz", "gestaci", "pregnan"), {"PREGNANCY", "USE IN SPECIFIC POPULATIONS"}),
        (("lactancia", "lactanc", "nursing", "amamant"), {"NURSING MOTHERS", "USE IN SPECIFIC POPULATIONS"}),
        (("caja negra", "boxed", "recuadro"), {"BOXED WARNING"}),
        (("advertencia", "warning"), {"WARNINGS", "WARNINGS AND PRECAUTIONS", "BOXED WARNING"}),
        (("precaucion", "precaution"), {"PRECAUTIONS", "GENERAL PRECAUTIONS", "WARNINGS AND PRECAUTIONS"}),
        (("dosis", "dosificac", "posolog", "dosage", "ajuste de dosis"), {"DOSAGE & ADMINISTRATION"}),
        (("pediatr", "ninos", "niños", "infantil", "children"), {"PEDIATRIC USE"}),
        (("geriatr", "anciano", "adulto mayor", "elderly"), {"GERIATRIC USE"}),
        (("indicacion", "indicado para", "para que sirve", "indication"), {"INDICATIONS & USAGE"}),
    ]
    SECTION_BOOST = 0.06
    MULTI_DRUG_BOOST = 0.04   # por cada farmaco adicional de la consulta que el chunk cubre   # ~10% del score tipico (0.5-0.7): sube la seccion pedida sin anular el resto

    def detect_sections(self, query: str) -> set:
        q = self._fold(query)
        out = set()
        for keys, secs in self.SECTION_HINTS:
            if any(k in q for k in keys):
                out |= secs
        return out

    def detect_drugs(self, query: str) -> set:
        """Farmacos (nombres base del indice) mencionados en la consulta."""
        if not getattr(self, "_drug_index", None):
            return set()
        q = self._join_compounds(self._fold(query))
        toks = q.split()
        found = set()
        # 1) marcas / nombres multi-palabra exactos (hasta 3 tokens)
        for n in (3, 2, 1):
            for i in range(len(toks) - n + 1):
                g = " ".join(toks[i:i + n])
                if g in self._alias:
                    found |= self._alias[g]
        # 2) genericos exactos o aproximados por token (tolera grafia en español y sales)
        for t in toks:
            if len(t) < 4 or t in self.SALTS or t in self.STOP:
                continue
            if len(t) < self._MIN_TOKEN:
                if t in self._drug_index:
                    found.add(t)
                continue
            hit = None
            syn = self.SYNONYMS.get(t)
            if syn is not None:
                if syn:
                    for b in self._bases(syn):
                        if b in self._drug_index:
                            found.add(b)
                continue
            for v in self._variants(t):
                cands = self._by_prefix.get(v[:4], [])
                if not cands:
                    continue
                if v in self._drug_index:
                    hit = v
                    found.add(v)
                    # variantes ortograficas del mismo generico (acetaminofen / acetaminophen)
                    found |= {c for c in difflib.get_close_matches(v, cands, n=3, cutoff=0.9) if c != v}
                    break
                best = difflib.get_close_matches(v, cands, n=1, cutoff=0.86) if len(t) >= 6 else []
                if best and best[0] not in self.STOP:
                    hit = best[0]
                    found.add(best[0])
                    found |= {c for c in difflib.get_close_matches(best[0], cands, n=3, cutoff=0.9) if c != best[0]}
                    break
        return found

    @classmethod
    def _tie_keys(cls, c: dict):
        """Claves de empate: (seccion, principio activo) por cada farmaco del chunk.
        'warfarin sodium' y 'warfarin' comparten clave (misma base sin sal)."""
        sec = c.get("section") or c.get("title") or ""
        ds = c.get("drugs") or []
        keys = {(sec, " ".join(sorted(cls._bases(d)))) for d in ds if d}
        return {k for k in keys if k[1]} or {(sec, "")}

    def _boost(self, idx_arr, sc, sections):
        if sections and len(idx_arr):
            m = np.fromiter((self._chunks[int(i)].get("section") in sections for i in idx_arr), dtype=bool, count=len(idx_arr))
            sc = sc + self.SECTION_BOOST * m
        return sc

    def _rank(self, q, k: int, use_cases=None, tiers=None, drugs=None, sections=None):
        """Devuelve [(indice_chunk, score)] ordenado, ya con la regla 2 aplicada.
        Si `drugs` (nombres base detectados) no esta vacio, se restringe a los
        chunks de esos farmacos; si quedan menos de k, se completa con la
        busqueda libre (esos resultados llevan drug_match=False)."""
        if drugs:
            allowed = np.unique(np.concatenate([self._drug_index[d] for d in drugs if d in self._drug_index]))
            if tiers or use_cases:
                allowed = np.array([i for i in allowed
                                    if not (tiers and self._chunks[i].get("tier") not in tiers)
                                    and not (use_cases and self._chunks[i].get("use_case") not in use_cases)], dtype=np.int64)
            if len(allowed):
                sc = self._boost(allowed, self._emb[allowed] @ q, sections)
                if len(drugs) > 1:
                    # chunks que mencionan varios de los farmacos pedidos (combos, interacciones)
                    cover = np.zeros(len(allowed))
                    for d in drugs:
                        cover += np.isin(allowed, self._drug_index.get(d, np.array([], dtype=np.int64)))
                    sc = sc + self.MULTI_DRUG_BOOST * np.maximum(cover - 1, 0)
                order = np.argsort(-sc)
                cand = [(int(allowed[j]), float(sc[j]), True) for j in order[:k * self.OVERFETCH]]
                cand = self._apply_rule2(cand)
                if len(cand) < k:
                    seen = {i for i, _, _ in cand}
                    extra = [(i, s2, False) for i, s2 in self._rank(q, k, use_cases, tiers, sections=sections) if i not in seen]
                    cand += extra[:k - len(cand)]
                return cand[:k]
        if not tiers and not use_cases:
            # Sin filtros no se copia nada: con 80k+ chunks la submatriz son
            # cientos de MB, y copiarla en cada consulta domina el tiempo de respuesta.
            idx = None
            scores = self._emb @ q
            if sections and getattr(self, "_section_mask", None) is not None:
                scores = scores + self.SECTION_BOOST * np.isin(self._section_arr, list(sections))
        else:
            idx = [i for i, c in enumerate(self._chunks)
                   if not (tiers and c.get("tier") not in tiers)
                   and not (use_cases and c.get("use_case") not in use_cases)]
            if not idx:
                return []
            scores = self._boost(np.array(idx), self._emb[idx] @ q, sections)
        n_cand = min(len(scores), k * self.OVERFETCH)
        order = np.argpartition(-scores, n_cand - 1)[:n_cand] if n_cand < len(scores) else np.arange(len(scores))
        order = order[np.argsort(-scores[order])]
        cand = [(int(j) if idx is None else idx[int(j)], float(scores[int(j)])) for j in order]

        return [(i, sc) for i, sc, _ in self._apply_rule2([(i, sc, True) for i, sc in cand])][:k]

    def _apply_rule2(self, cand):
        # regla 2: un chunk EN se descarta si ese (seccion, farmaco) ya tiene version
        # validada en español en el indice, aunque el EN haya puntuado mas alto.
        # Solo sobreviven los EN de farmacos/secciones que NO tienen español.
        es_pairs = getattr(self, "_es_pairs", None)
        if cand and es_pairs:
            cand = [t for t in cand
                    if self._chunks[t[0]].get("language", "es") == "es"
                    or not (self._tie_keys(self._chunks[t[0]]) & es_pairs)]
        return cand

    def search(self, query: str, k: int = 5, use_cases=None, tiers=None) -> list:
        self._ensure()
        if not self._loaded:
            return []
        q = self._model.encode([query], normalize_embeddings=True)[0].astype(np.float32)
        drugs = self.detect_drugs(query)
        sections = self.detect_sections(query) if getattr(self, "_section_mask", None) else set()
        ranked = self._rank(q, k, use_cases, tiers, drugs=drugs, sections=sections)
        out = []
        for rank, item in enumerate(ranked, start=1):
            i, sc = item[0], item[1]
            matched = item[2] if len(item) > 2 else None
            c = self._chunks[i]
            lang = c.get("language")
            r = {
                "citation_id": f"S{rank}",
                "source_id": c["doc_id"],
                "chunk_id": c["chunk_id"],
                "title": c["title"],
                "page": c.get("page_start"),
                "score": round(sc, 4),
                "citation": c["citation"],
                "text": c["text"],
                "metadata": {"source": c["source"], "doc_type": c["doc_type"],
                             "tier": c["tier"], "use_case": c["use_case"]},
            }
            if drugs:
                r["drug_filter"] = sorted(drugs)
                r["drug_match"] = bool(matched)
            if sections:
                r["section_filter"] = sorted(sections)
            if lang is not None:
                # regla 1
                r["language"] = lang
                r["validation_status"] = c.get("validation_status")
                r["metadata"]["language"] = lang
                r["metadata"]["validation_status"] = c.get("validation_status")
                # regla 3
                if lang != "es":
                    r["notice"] = c.get("notice") or self.NOTICE_EN
                    if self.NOTICE_EN not in r["citation"]:
                        r["citation"] = f"{r['citation']} · {self.NOTICE_EN}"
            out.append(r)
        return out


# instancia única (carga perezosa) — indice de guias GPC, sin cambios
rag = RAGService()

# Indice FDA/DailyMed, SEPARADO. Son ~260k chunks contra los ~4k de las guias:
# en un indice unico las fichas de farmacos ahogarian a las GPC en cualquier
# consulta de diagnostico. Ruta por MEGI_RAG_FDA_INDEX_DIR; si no se define,
# se busca el paquete portable `FDA_movil/` en la raiz del repo (ver
# FDA_movil/README.md y docs/cambios_2026-09-13_a_16_fda_rag_contraindicaciones.md).
FDA_MOVIL_DIR = Path(os.environ.get("MEGI_FDA_MOVIL_DIR", str(HERE.parent.parent / "FDA_movil")))
FDA_INDEX_DIR = os.environ.get("MEGI_RAG_FDA_INDEX_DIR", str(FDA_MOVIL_DIR / "index_fda"))
rag_fda = RAGService(index_dir=FDA_INDEX_DIR, label="fda")
