"""Archivos que el paciente trae a la consulta: fotos, PDF y DICOM.

Distinto de `radiologia_imagen` (las imágenes de un informe que dicta el
radiólogo): aquí son estudios EXTERNOS que el médico sube desde el escritorio o
el paciente/médico fotografía con el teléfono. Se guardan tal cual (el original
nunca se toca) y, cuando es imagen, se genera `vista.png` para la miniatura.

Formato por firma de bytes, nunca por extensión: un PDF renombrado .jpg sigue
siendo PDF. HEIC (fotos de iPhone) se convierte con pillow-heif si está
instalado; si no, se guarda igual y queda sin miniatura.
"""
from __future__ import annotations

import io
import re

from PIL import Image

from . import radiologia_imagen

MAX_ESTUDIOS_POR_CONSULTA = 20
MAX_ESTUDIO_BYTES = 60 * 1024 * 1024
LADO_MAX_VISTA = 1600
# Además de imagen y PDF: registros de ECG en formato WFDB (PhysioNet: `.hea`
# cabecera de texto + `.dat` señal binaria + `.atr` anotaciones) y tablas CSV
# (señal exportada por el electrocardiógrafo o resultados de laboratorio).
FORMATOS = ("jpg", "png", "webp", "heic", "pdf", "dicom", "wfdb_hea", "wfdb_dat", "wfdb_anot", "csv")
EXTENSION = {"jpg": ".jpg", "png": ".png", "webp": ".webp", "heic": ".heic", "pdf": ".pdf", "dicom": ".dcm",
             "wfdb_hea": ".hea", "wfdb_dat": ".dat", "wfdb_anot": ".atr", "csv": ".csv"}
MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "heic": "image/heic",
        "pdf": "application/pdf", "dicom": "application/dicom",
        "wfdb_hea": "text/plain", "wfdb_dat": "application/octet-stream", "wfdb_anot": "application/octet-stream",
        "csv": "text/csv"}
_WFDB_HEA = re.compile(r"^\s*[\w.\-]+(?:/\d+)?\s+\d+\s+[\d.]+", re.M)


class ArchivoInvalido(ValueError):
    def __init__(self, detail: str, status: int = 415):
        super().__init__(detail)
        self.detail, self.status = detail, status


def _es_texto(raw: bytes) -> str | None:
    try:
        t = raw[:200000].decode("utf-8")
    except UnicodeDecodeError:
        try:
            t = raw[:200000].decode("latin-1")
        except UnicodeDecodeError:
            return None
    if "\x00" in t:
        return None
    return t


def detectar_formato(raw: bytes, nombre: str = "") -> str:
    if raw[:5] == b"%PDF-":
        return "pdf"
    ext = (nombre or "").lower().rsplit(".", 1)[-1] if "." in (nombre or "") else ""
    texto = _es_texto(raw)
    if texto is not None:
        if ext == "hea" or (_WFDB_HEA.match(texto) and ".dat" in texto[:4000]):
            return "wfdb_hea"
        if ext in ("csv", "txt", "tsv") or (texto.count(",") + texto.count(";") >= 20 and len(texto.splitlines()) >= 5):
            return "csv"
    if ext == "dat":
        return "wfdb_dat"
    if ext in ("atr", "qrs", "ecg", "ann"):
        return "wfdb_anot"
    if len(raw) > 12 and raw[4:8] == b"ftyp" and raw[8:12] in (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"):
        return "heic"
    try:
        return radiologia_imagen.detectar_formato(raw, nombre)
    except radiologia_imagen.ImagenInvalida:
        raise ArchivoInvalido("formato no reconocido: se aceptan fotos (JPG, PNG, WebP, HEIC), PDF, DICOM, registros de ECG (.hea/.dat/.atr) y CSV")


def _heic_a_pillow(raw: bytes):
    try:
        import pillow_heif
    except ImportError:
        return None
    try:
        pillow_heif.register_heif_opener()
        im = Image.open(io.BytesIO(raw))
        im.load()
        return im.convert("RGB")
    except Exception as e:  # HEIC corrupto o no soportado: sin miniatura, no se rechaza
        _ = e
        return None


def vista_png(raw: bytes, formato: str) -> tuple[bytes | None, int | None, int | None]:
    """(png, ancho, alto) para la miniatura; (None, None, None) si no hay forma
    de verla aquí (PDF, HEIC sin pillow-heif)."""
    if formato in ("pdf", "wfdb_hea", "wfdb_dat", "wfdb_anot", "csv"):
        return None, None, None
    try:
        if formato == "dicom":
            im, _meta = radiologia_imagen._dicom_a_pillow(raw)
        elif formato == "heic":
            im = _heic_a_pillow(raw)
            if im is None:
                return None, None, None
        else:
            im = radiologia_imagen._abrir_pillow(raw)
    except radiologia_imagen.ImagenInvalida as e:
        raise ArchivoInvalido(e.detail, e.status)
    if max(im.size) > LADO_MAX_VISTA:
        im.thumbnail((LADO_MAX_VISTA, LADO_MAX_VISTA))
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), im.size[0], im.size[1]
