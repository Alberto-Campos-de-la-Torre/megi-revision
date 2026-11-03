"""Lectura de resultados de LABORATORIO que trae el paciente (PDF, foto u hoja CSV).

Mientras no haya un modelo propio para laboratorio, la cadena es:

1. Texto: del PDF (pypdf), de la foto (OCR tesseract en español) o del CSV.
2. Analitos: se buscan por nombre y sinónimos (hemoglobina, glucosa, creatinina…)
   con su valor y, si la hoja lo trae, su intervalo de referencia. El intervalo
   del laboratorio emisor manda; si no viene, se usa una tabla general de
   adultos (marcada como tal) para señalar lo que queda fuera.
3. Guías: cada grupo fuera de rango se liga a las guías de práctica clínica
   del índice RAG de MEGI (526 GPC del IMSS) por tema: glucosa -> diabetes,
   LDL -> dislipidemia, creatinina -> enfermedad renal crónica, TSH ->
   hipotiroidismo, hemoglobina -> anemia… Con el servicio MLX activo, además
   se le PREGUNTA al modelo sobre esas guías (RAG) y la respuesta se adjunta
   con sus fuentes. Sin servicio, solo se citan las guías encontradas.

Nada aquí diagnostica: señala, cita y deja la decisión al médico. Los valores
de referencia generales son aproximados y se dicen aproximados.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import unicodedata

# ---------------------------------------------------------------- referencia
# (clave, nombres/sinónimos, unidad habitual, rango H, rango M, tema de guía)
# Rangos generales de adulto, orientativos: cada laboratorio publica los suyos.
_NUM = r"(-?\d+(?:[.,]\d+)?)"
REFERENCIA = [
    ("hemoglobina", ["hemoglobina", "hgb", "hb"], "g/dL", (13.5, 17.5), (12.0, 15.5), "anemia"),
    ("hematocrito", ["hematocrito", "hct", "hto"], "%", (41, 53), (36, 46), "anemia"),
    ("leucocitos", ["leucocitos", "wbc", "glóbulos blancos", "globulos blancos"], "x10³/µL", (4.5, 11.0), (4.5, 11.0), "infeccion"),
    ("plaquetas", ["plaquetas", "plt"], "x10³/µL", (150, 450), (150, 450), "hematologia"),
    ("glucosa", ["glucosa", "glucose", "glicemia", "glucemia"], "mg/dL", (70, 99), (70, 99), "diabetes"),
    ("hba1c", ["hba1c", "hemoglobina glucosilada", "hemoglobina glicosilada", "a1c"], "%", (4.0, 5.6), (4.0, 5.6), "diabetes"),
    ("creatinina", ["creatinina", "creatinine"], "mg/dL", (0.7, 1.3), (0.6, 1.1), "renal"),
    ("urea", ["urea"], "mg/dL", (15, 45), (15, 45), "renal"),
    ("bun", ["bun", "nitrógeno ureico", "nitrogeno ureico"], "mg/dL", (7, 20), (7, 20), "renal"),
    ("acido_urico", ["ácido úrico", "acido urico", "uric acid"], "mg/dL", (3.5, 7.2), (2.6, 6.0), "hiperuricemia"),
    ("colesterol_total", ["colesterol total", "colesterol"], "mg/dL", (0, 199), (0, 199), "dislipidemia"),
    ("ldl", ["ldl", "c-ldl", "colesterol ldl"], "mg/dL", (0, 129), (0, 129), "dislipidemia"),
    ("hdl", ["hdl", "c-hdl", "colesterol hdl"], "mg/dL", (40, 999), (50, 999), "dislipidemia"),
    ("trigliceridos", ["triglicéridos", "trigliceridos", "tg"], "mg/dL", (0, 149), (0, 149), "dislipidemia"),
    ("ast", ["ast", "tgo", "aspartato"], "U/L", (10, 40), (10, 40), "hepatico"),
    ("alt", ["alt", "tgp", "alanino", "alanina"], "U/L", (7, 56), (7, 56), "hepatico"),
    ("ggt", ["ggt", "gamma glutamil"], "U/L", (9, 48), (9, 48), "hepatico"),
    ("fosfatasa_alcalina", ["fosfatasa alcalina", "alp"], "U/L", (44, 147), (44, 147), "hepatico"),
    ("bilirrubina_total", ["bilirrubina total", "bilirrubina"], "mg/dL", (0.1, 1.2), (0.1, 1.2), "hepatico"),
    ("tsh", ["tsh", "tirotropina"], "mUI/L", (0.4, 4.0), (0.4, 4.0), "tiroides"),
    ("t4_libre", ["t4 libre", "t4l", "tiroxina libre"], "ng/dL", (0.8, 1.8), (0.8, 1.8), "tiroides"),
    ("sodio", ["sodio", "na"], "mmol/L", (135, 145), (135, 145), "electrolitos"),
    ("potasio", ["potasio", "k"], "mmol/L", (3.5, 5.0), (3.5, 5.0), "electrolitos"),
    ("cloro", ["cloro", "cl"], "mmol/L", (98, 107), (98, 107), "electrolitos"),
    ("calcio", ["calcio", "ca"], "mg/dL", (8.5, 10.5), (8.5, 10.5), "electrolitos"),
    ("albumina", ["albúmina", "albumina"], "g/dL", (3.5, 5.0), (3.5, 5.0), "nutricion"),
    ("pcr", ["proteína c reactiva", "proteina c reactiva", "pcr"], "mg/L", (0, 10), (0, 10), "infeccion"),
    ("ferritina", ["ferritina"], "ng/mL", (30, 400), (15, 150), "anemia"),
    ("hierro", ["hierro sérico", "hierro serico", "hierro"], "µg/dL", (60, 170), (50, 170), "anemia"),
    ("tfg", ["tfg", "filtrado glomerular", "egfr", "tasa de filtración"], "mL/min/1.73m²", (90, 999), (90, 999), "renal"),
    ("vitamina_d", ["vitamina d", "25-oh"], "ng/mL", (30, 100), (30, 100), "nutricion"),
    ("vitamina_b12", ["vitamina b12", "cobalamina"], "pg/mL", (200, 900), (200, 900), "anemia"),
    ("psa", ["psa", "antígeno prostático", "antigeno prostatico"], "ng/mL", (0, 4.0), (0, 4.0), "prostata"),
]

# Tema -> palabras que se buscan en los TÍTULOS del índice de guías (GPC IMSS).
TEMAS_GUIAS = {
    "diabetes": ["diabetes"], "dislipidemia": ["dislipidemia", "hipercolesterolemia"],
    "renal": ["enfermedad renal", "renal crónica", "renal cronica"], "anemia": ["anemia"],
    "tiroides": ["hipotiroidismo", "hipertiroidismo", "tiroid"], "hepatico": ["hepatitis", "hígado", "higado", "hepát"],
    "infeccion": ["infección", "infeccion", "sepsis"], "electrolitos": ["hiponatremia", "hiperkalemia", "hipokalemia", "electrol"],
    "hiperuricemia": ["gota", "hiperuricemia"], "nutricion": ["desnutrición", "desnutricion", "nutricional"],
    "prostata": ["próstata", "prostata", "prostático"], "hematologia": ["trombocitopenia", "plaquet"],
}

_ABREV_CORTAS = {"hb", "k", "na", "cl", "ca", "tg", "alt", "ast", "alp", "ggt", "plt", "hct", "hto", "wbc", "hgb", "bun", "tsh", "psa", "ldl", "hdl", "tfg", "a1c"}


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


# ---------------------------------------------------------------- texto
def ocr_imagen(png_o_jpg: bytes, idiomas: str = "spa+eng") -> str:
    """OCR con tesseract (CLI, sin dependencia Python). Vacío si no está o falla."""
    exe = shutil.which("tesseract")
    if not exe:
        return ""
    with tempfile.TemporaryDirectory() as d:
        src = f"{d}/img.png"
        with open(src, "wb") as f:
            f.write(png_o_jpg)
        try:
            r = subprocess.run([exe, src, "stdout", "-l", idiomas, "--psm", "6"], capture_output=True, text=True, timeout=120)
            return (r.stdout or "").strip()
        except Exception:
            return ""


def parece_laboratorio(texto: str) -> bool:
    t = _norm(texto)
    if len(re.sub(r"[^a-z0-9]", "", t)) < 40:
        return False
    hits = sum(1 for _, nombres, *_ in REFERENCIA for n in nombres if len(n) > 3 and _norm(n) in t)
    return hits >= 2 or any(p in t for p in ("laboratorio", "resultado", "referencia", "quimica", "biometria", "hematica"))


# ---------------------------------------------------------------- analitos
def _rango_en_linea(linea: str, pos_valor: int):
    """Intervalo «70 - 99» o «70 a 99» que venga en la misma línea tras el valor."""
    m = re.search(_NUM + r"\s*(?:-|–|a|to)\s*" + _NUM, linea[pos_valor:])
    if not m:
        return None
    lo, hi = float(m.group(1).replace(",", ".")), float(m.group(2).replace(",", "."))
    return (lo, hi) if lo < hi else None


def extraer_analitos(texto: str, sexo: str | None = None) -> list[dict]:
    """[{clave, nombre, valor, unidad, rango, rango_fuente, estado, tema}] en el orden del texto."""
    out, vistos = [], set()
    for linea in texto.splitlines():
        ln = _norm(linea)
        if not re.search(r"\d", ln):
            continue
        for clave, nombres, unidad, rh, rm, tema in REFERENCIA:
            if clave in vistos:
                continue
            for n in nombres:
                nn = _norm(n)
                patron = (r"(?<![a-z])" + re.escape(nn) + r"(?![a-z])") if nn in _ABREV_CORTAS else re.escape(nn)
                m = re.search(patron, ln)
                if not m:
                    continue
                mv = re.search(_NUM, ln[m.end():])
                if not mv:
                    continue
                valor = float(mv.group(1).replace(",", "."))
                pos = m.end() + mv.end()
                rango = _rango_en_linea(ln, pos)
                fuente = "laboratorio" if rango else "general"
                if not rango:
                    rango = rm if (sexo == "F" and rm) else rh
                if rango[0] <= valor <= rango[1]:
                    estado = "normal"
                else:
                    estado = "bajo" if valor < rango[0] else "alto"
                out.append({"clave": clave, "nombre": nombres[0], "valor": valor, "unidad": unidad,
                            "rango": [rango[0], rango[1] if rango[1] < 999 else None], "rango_fuente": fuente,
                            "estado": estado, "tema": tema, "linea": linea.strip()[:160]})
                vistos.add(clave)
                break
    return out


def _fmt_rango(r) -> str:
    lo, hi = r
    if hi is None:
        return f"≥ {lo:g}"
    if lo == 0:
        return f"< {hi + 1:g}" if float(hi).is_integer() else f"≤ {hi:g}"
    return f"{lo:g}–{hi:g}"


# ---------------------------------------------------------------- guías
def guias_para_temas(temas: set) -> list[dict]:
    """Guías del índice local cuyo título toca el tema (sin modelo, sin red)."""
    try:
        from ..routes.guidelines import _load
        _chunks, docs = _load()
    except Exception:
        return []
    out, vistos = [], set()
    for tema in sorted(temas):
        n = 0
        for d in docs.values():
            t = _norm(d.get("title") or "")
            if any(_norm(p) in t for p in TEMAS_GUIAS.get(tema, [])) and d["doc_id"] not in vistos:
                vistos.add(d["doc_id"])
                out.append({"tema": tema, "doc_id": d["doc_id"], "title": d.get("title"), "citation": d.get("citation")})
                n += 1
                if n >= 3:        # hasta tres por tema, para que ningún tema tape a los demás
                    break
    return out


def pregunta_para_guias(anormales: list[dict], contexto: dict) -> str:
    vals = "; ".join(f"{a['nombre']} {a['valor']:g} {a['unidad']} ({a['estado']}, ref {_fmt_rango(a['rango'])})" for a in anormales[:8])
    return (f"Paciente de {contexto.get('edad', '?')} años, {contexto.get('sexo', '?')}, motivo de consulta: {contexto.get('motivo') or 'no indicado'}. "
            f"Laboratorio: {vals}. Según las guías de práctica clínica, ¿qué sugieren estos valores, qué criterios diagnósticos "
            f"aplican y qué confirmación o estudios adicionales indica la guía? Responde solo con lo que digan las guías.")


# ---------------------------------------------------------------- lectura completa
def leer(texto: str, contexto: dict, consultar_llm=None) -> dict:
    """Devuelve {analitos, anormales, guias, consulta_guias, resumen}. `consultar_llm`
    es opcional: fn(pregunta) -> {answer, sources} (RAG del servicio MLX)."""
    sexo = contexto.get("sexo_codigo")
    analitos = extraer_analitos(texto, sexo)
    anormales = [a for a in analitos if a["estado"] != "normal"]
    temas = {a["tema"] for a in anormales}
    guias = guias_para_temas(temas) if temas else []
    consulta = None
    if anormales and consultar_llm:
        try:
            r = consultar_llm(pregunta_para_guias(anormales, contexto))
            if r and (r.get("answer") or "").strip():
                consulta = {"respuesta": r["answer"].strip(), "fuentes": r.get("sources") or []}
            elif r and r.get("error"):
                consulta = {"error": r["error"]}
        except Exception as e:
            consulta = {"error": str(e)}

    partes = []
    if not analitos:
        lineas = [l.strip() for l in texto.splitlines() if l.strip()]
        partes.append("Documento con texto, sin valores de laboratorio reconocidos. Primeras líneas: " + " | ".join(lineas[:8])[:500])
    else:
        partes.append(f"{len(analitos)} analito{'s' if len(analitos) != 1 else ''} reconocido{'s' if len(analitos) != 1 else ''}")
        if anormales:
            partes.append("Fuera de rango: " + "; ".join(
                f"{a['nombre']} {a['valor']:g} {a['unidad']} ({a['estado'].upper()}, referencia {_fmt_rango(a['rango'])}"
                f"{' del laboratorio' if a['rango_fuente'] == 'laboratorio' else ' general aprox.'})" for a in anormales))
        else:
            partes.append("Todos dentro de su referencia: " + "; ".join(f"{a['nombre']} {a['valor']:g}" for a in analitos[:10]))
        if guias:
            partes.append("Guías relacionadas (GPC IMSS): " + "; ".join(f"{g['title']}" for g in guias[:9]))
        if consulta and consulta.get("respuesta"):
            partes.append("Consulta a las guías (Megi-LLM): " + consulta["respuesta"][:700])
        elif consulta and consulta.get("error"):
            partes.append(f"La consulta a las guías con el modelo no estuvo disponible ({consulta['error'][:80]}); se citan las guías encontradas")
        elif anormales:
            partes.append("Consulta a las guías con el modelo: pendiente de servicio MLX (modo simulado)")
    return {"analitos": analitos, "anormales": anormales, "guias": guias, "consulta_guias": consulta,
            "resumen": ". ".join(partes) + "."}
