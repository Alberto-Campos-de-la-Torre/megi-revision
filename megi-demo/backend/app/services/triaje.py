"""Triaje rápido de cada archivo ANTES de gastar GPU: en CPU y en milisegundos.

Tres salidas:

- `rechazar`: el archivo ya está subido (mismo sha256 para el mismo paciente).
  No se guarda ni se analiza; la subida responde 409 con el nombre original.
- `descartar`: se guarda para que el médico vea por qué, pero no va a ningún
  modelo: foto repetida (huella perceptual a ≤ 4 bits de otra de la misma
  consulta), imagen vacía/uniforme (pantalla negra, hoja en blanco), imagen
  minúscula, o texto sin datos de estudio.
- `analizar`: sigue a la cadena normal (clasificador, modelos, pre-diagnóstico).

Umbrales calibrados el 11-oct-2026 con radiografías reales, fotos de ECG y
hojas de laboratorio: la misma placa recortada/rotada o con otro brillo queda
a 0–2 bits; placas distintas, a 23–25; dos fotos de ECG distintas, a 6 (por
eso el corte está en 4). El contraste (std) de los estudios reales va de 21 a
75; una hoja en blanco o una foto negra dan 0. No se descarta por «borrosa»:
la nitidez por Laplaciano no separa una placa KUB (42) de texto borroso (627).
"""
from __future__ import annotations

import io
import re
import unicodedata

import numpy as np
from PIL import Image

HAMMING_DUPLICADO = 4
STD_MINIMA = 6.0
LADO_MINIMO = 160
_PALABRAS_ESTUDIO = ("laboratorio", "resultado", "referencia", "glucosa", "hemoglobina", "creatinina", "colesterol",
                     "leucocitos", "plaquetas", "urea", "tsh", "mg/dl", "g/dl", "ecg", "derivacion", "ritmo")


def dhash(png: bytes) -> int:
    """Huella perceptual de 64 bits (diferencias horizontales en 9×8 gris)."""
    with Image.open(io.BytesIO(png)) as im:
        g = im.convert("L").resize((9, 8), Image.LANCZOS)
    d = np.asarray(g, dtype=np.float32)
    bits = (d[:, 1:] > d[:, :-1]).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def calidad_imagen(png: bytes) -> dict:
    """{ancho, alto, std, motivo} — `motivo` es None si la imagen es usable."""
    with Image.open(io.BytesIO(png)) as im:
        ancho, alto = im.size
        g = im.convert("L"); g.thumbnail((512, 512))
        std = float(np.asarray(g, dtype=np.float32).std())
    motivo = None
    if min(ancho, alto) < LADO_MINIMO:
        motivo = f"imagen demasiado pequeña ({ancho}×{alto} px)"
    elif std < STD_MINIMA:
        motivo = "imagen uniforme (vacía, en blanco o a oscuras)"
    return {"ancho": ancho, "alto": alto, "std": round(std, 1), "motivo": motivo}


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def texto_sin_estudio(texto: str) -> str | None:
    t = _norm(texto)
    if len(re.sub(r"\s", "", t)) < 20:
        return "archivo de texto casi vacío"
    tiene_numeros = len(re.findall(r"\d+(?:[.,]\d+)?", t)) >= 3
    tiene_palabras = any(p in t for p in _PALABRAS_ESTUDIO)
    if not tiene_numeros and not tiene_palabras:
        return "texto sin valores ni términos de estudio"
    return None


def triar(conn, consultation_id: str, patient_id: str, sha256: str, formato: str, nombre: str,
          vista_png: bytes | None, raw: bytes) -> dict:
    """{accion: rechazar|descartar|analizar, motivo, duplicado_de, phash}."""
    rep = conn.execute(
        """SELECT e.id, e.nombre_original, e.consultation_id, c.started_at FROM estudios_aportados e
           JOIN consultations c ON c.id = e.consultation_id
           WHERE e.patient_id = ? AND e.sha256 = ? ORDER BY e.created_at LIMIT 1""", (patient_id, sha256)).fetchone()
    if rep:
        donde = "en esta consulta" if rep["consultation_id"] == consultation_id else f"en la consulta del {(rep['started_at'] or '')[:10]}"
        return {"accion": "rechazar", "motivo": f"archivo repetido: ya está subido como «{rep['nombre_original']}» {donde}",
                "duplicado_de": rep["id"], "phash": None}

    if vista_png:
        q = calidad_imagen(vista_png)
        if q["motivo"]:
            return {"accion": "descartar", "motivo": q["motivo"], "duplicado_de": None, "phash": None, "calidad": q}
        h = dhash(vista_png)
        for r in conn.execute("SELECT id, nombre_original, phash FROM estudios_aportados WHERE consultation_id = ? AND phash IS NOT NULL",
                              (consultation_id,)).fetchall():
            try:
                if hamming(h, int(r["phash"])) <= HAMMING_DUPLICADO:
                    return {"accion": "descartar", "motivo": f"foto repetida de «{r['nombre_original']}»",
                            "duplicado_de": r["id"], "phash": str(h), "calidad": q}
            except (TypeError, ValueError):
                continue
        return {"accion": "analizar", "motivo": None, "duplicado_de": None, "phash": str(h), "calidad": q}

    if formato == "csv":
        motivo = texto_sin_estudio(raw.decode("utf-8", "ignore"))
        if motivo:
            return {"accion": "descartar", "motivo": motivo, "duplicado_de": None, "phash": None}
    return {"accion": "analizar", "motivo": None, "duplicado_de": None, "phash": None}
