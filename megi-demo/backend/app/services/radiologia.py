"""Informe radiológico: catálogo de estudios y estructura del dictado.

El radiólogo casi nunca tiene al paciente delante: dicta un INFORME sobre un
estudio. La estructura es fija y conocida —técnica, comparación, hallazgos,
impresión, recomendaciones— y el dictado suele nombrarla en voz alta
(«técnica: … hallazgos: … impresión: …»).

Por eso la primera capa es DETERMINISTA: si el dictado dice los encabezados, se
reparte sin LLM. Solo cuando no los dice se pide a gemma que lo estructure, y
aun así **el dictado crudo se conserva siempre**: perder lo dictado sería mucho
peor que no estructurarlo.

MEGI SUGIERE, NO DECIDE: el informe queda en borrador y no es válido hasta que
el radiólogo lo revisa y lo firma.
"""
from __future__ import annotations

import re
import unicodedata

# Modalidad -> (etiqueta, técnica que se propone por defecto). La técnica es un
# texto de arranque que el radiólogo corrige; no se firma nada solo.
MODALIDADES = {
    "radiografia": ("Radiografía", "Proyecciones convencionales, sin contraste."),
    "ultrasonido": ("Ultrasonido", "Estudio en tiempo real con transductor convexo/lineal, sin contraste."),
    "tomografia": ("Tomografía computarizada", "Cortes axiales; especificar si con o sin contraste intravenoso."),
    "resonancia": ("Resonancia magnética", "Secuencias multiplanares; especificar si con o sin gadolinio."),
    "mastografia": ("Mastografía", "Proyecciones cráneo-caudal y medio-lateral oblicua bilaterales."),
    "otro": ("Otro estudio", ""),
}

SECCIONES = ("tecnica", "comparacion", "hallazgos", "impresion", "recomendaciones")

# Cómo suena cada encabezado cuando se dicta. Se buscan sobre texto normalizado.
_ENCABEZADOS = {
    "tecnica": r"tecnica|tecnica del estudio|protocolo",
    "comparacion": r"comparacion|se compara con|estudio previo|estudios previos",
    "hallazgos": r"hallazgos|descripcion",
    "impresion": r"impresion|impresion diagnostica|conclusion|conclusiones",
    "recomendaciones": r"recomendacion|recomendaciones|sugerencia|se sugiere",
}

_RX_ENCABEZADO = re.compile(
    r"\b(" + "|".join(f"(?P<{k}>{v})" for k, v in _ENCABEZADOS.items()) + r")\s*[:.,]",
)


def _norm(t: str) -> str:
    """Normaliza SIN mover los índices: un carácter dentro, un carácter fuera.

    Hace falta que sea 1:1 porque los cortes se calculan sobre el texto
    normalizado y se aplican sobre el original. Un NFKD normal no lo garantiza
    ("½" se expande a tres caracteres, las ligaduras a dos) y el informe se
    partiría por donde no toca.
    """
    fuera = []
    for ch in (t or ""):
        base = "".join(c for c in unicodedata.normalize("NFKD", ch)
                       if not unicodedata.combining(c))
        fuera.append(base[0].lower() if base else ch.lower())
    return "".join(fuera)


def dividir_secciones(transcript: str) -> dict:
    """Reparte el dictado en secciones SI el radiólogo las nombró.

    Devuelve `{"secciones": {...}, "estructurado": bool}`. Si no se reconoce
    ningún encabezado, `estructurado` es False y no se reparte nada: es la señal
    de que hace falta el LLM (o que el radiólogo lo ordene a mano).
    """
    texto = (transcript or "").strip()
    if not texto:
        return {"secciones": {}, "estructurado": False, "reconocidos": []}

    norm = _norm(texto)
    marcas = []
    for m in _RX_ENCABEZADO.finditer(norm):
        seccion = next(k for k in SECCIONES if m.groupdict().get(k))
        marcas.append((m.start(), m.end(), seccion))
    if not marcas:
        return {"secciones": {}, "estructurado": False, "reconocidos": []}

    secciones, reconocidos = {}, []
    for i, (_, fin, seccion) in enumerate(marcas):
        ini_txt = fin
        fin_txt = marcas[i + 1][0] if i + 1 < len(marcas) else len(texto)
        # Los índices salen del texto normalizado y se aplican al ORIGINAL:
        # vale porque `_norm` conserva la longitud carácter a carácter.
        trozo = texto[ini_txt:fin_txt].strip(" .,;:\n")
        if trozo:
            # Si una sección se dicta dos veces, se concatena en vez de perderse.
            secciones[seccion] = (secciones[seccion] + " " + trozo).strip() if seccion in secciones else trozo
            if seccion not in reconocidos:
                reconocidos.append(seccion)
    return {"secciones": secciones, "estructurado": bool(secciones), "reconocidos": reconocidos}


def informe_vacio(modalidad: str) -> dict:
    """Borrador inicial: solo la técnica propuesta por modalidad."""
    _, tecnica = MODALIDADES.get(modalidad, MODALIDADES["otro"])
    return {"tecnica": tecnica, "comparacion": "", "hallazgos": "",
            "impresion": "", "recomendaciones": ""}


def listo_para_firmar(informe: dict) -> tuple[bool, list]:
    """Un informe sin hallazgos ni impresión no es un informe.

    No se bloquea por la técnica ni por las recomendaciones: hay estudios
    normales que se resuelven en dos líneas.
    """
    faltan = [s for s in ("hallazgos", "impresion") if not (informe.get(s) or "").strip()]
    return (not faltan), faltan
