"""Imágenes del informe radiológico: validación de formato y conversión a PNG.

El radiólogo sube la imagen del estudio (foto o exportación en JPG/PNG/WebP, o
el DICOM que saca el equipo). Aquí se decide QUÉ es el archivo mirando sus bytes
—no la extensión, que la elige el cliente— y se produce `vista.png`, que es lo
que ve el radiólogo en pantalla y lo que lee el LLM. El original se conserva
tal cual junto a la vista.

DICOM: se aplican las LUT de modalidad y de ventana (VOI) que trae el archivo,
se invierte MONOCHROME1 y se pasa a 8 bits. En un estudio multi-corte se toma
el corte central: es una primera versión; elegir el corte es trabajo futuro.
Las sintaxis comprimidas (JPEG 2000, JPEG-LS…) necesitan códecs que no están
instalados: se rechazan con un mensaje claro en vez de fallar a medias.
"""
from __future__ import annotations

import io
import json

MAX_IMAGENES_POR_INFORME = 4
# Una placa exportada suele pesar 1-5 MB; un DICOM de TC o mastografía puede
# pasar de 30. Acotado para que un archivo cualquiera no llene el disco.
MAX_IMAGEN_BYTES = 60 * 1024 * 1024
# Lado mayor de `vista.png`. Suficiente para revisar en pantalla; al modelo le
# llega reescalada de todos modos.
LADO_MAX_VISTA = 2048

FORMATOS = ("jpg", "png", "webp", "dicom")


class ImagenInvalida(ValueError):
    """El archivo no es una imagen que se pueda usar. `status` sugiere el HTTP."""

    def __init__(self, detail: str, status: int = 415):
        super().__init__(detail)
        self.detail = detail
        self.status = status


def detectar_formato(raw: bytes, nombre: str = "") -> str:
    """Formato por firma de bytes. La extensión solo desempata un DICOM sin
    preámbulo (los hay), nunca decide sola."""
    if raw[:3] == b"\xff\xd8\xff":
        return "jpg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    if len(raw) > 132 and raw[128:132] == b"DICM":
        return "dicom"
    if (nombre or "").lower().endswith((".dcm", ".dicom")):
        return "dicom"
    raise ImagenInvalida("formato no reconocido: se aceptan JPG, PNG, WebP y DICOM")


def _abrir_pillow(raw: bytes):
    from PIL import Image, ImageOps
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception as e:
        raise ImagenInvalida(f"la imagen no se pudo abrir: {e}") from e
    im = ImageOps.exif_transpose(im)      # fotos de celular: respetar la rotación
    if im.mode not in ("L", "RGB"):
        im = im.convert("RGB")
    return im


def _dicom_a_pillow(raw: bytes):
    """Pixel data del DICOM -> imagen de 8 bits. Devuelve (imagen, meta)."""
    try:
        import numpy as np
        import pydicom
        from pydicom.pixels import apply_modality_lut, apply_voi_lut
    except ImportError as e:  # pragma: no cover
        raise ImagenInvalida(f"soporte DICOM no instalado: {e}", status=503) from e
    from PIL import Image

    try:
        ds = pydicom.dcmread(io.BytesIO(raw), force=True)
    except Exception as e:
        raise ImagenInvalida(f"DICOM ilegible: {e}") from e
    if "PixelData" not in ds:
        raise ImagenInvalida("el DICOM no trae imagen (sin PixelData)")
    try:
        arr = ds.pixel_array
    except Exception as e:
        ts = getattr(getattr(ds, "file_meta", None), "TransferSyntaxUID", None)
        nombre = getattr(ts, "name", str(ts)) if ts else "desconocida"
        raise ImagenInvalida(
            f"no se pudo decodificar el pixel data (sintaxis {nombre}): "
            f"exporta el estudio sin comprimir o como JPG/PNG — {e}") from e

    frames = int(getattr(ds, "NumberOfFrames", 1) or 1)
    corte = None
    if frames > 1 and arr.ndim >= 3 and arr.shape[0] == frames:
        corte = frames // 2
        arr = arr[corte]

    foto = str(getattr(ds, "PhotometricInterpretation", "") or "")
    if arr.ndim == 2:
        arr = apply_modality_lut(arr, ds)
        try:
            arr = apply_voi_lut(arr, ds)
        except Exception:
            pass                                    # sin ventana: se normaliza abajo
        arr = arr.astype(np.float32)
        lo, hi = float(np.min(arr)), float(np.max(arr))
        arr = (arr - lo) / (hi - lo) * 255.0 if hi > lo else np.zeros_like(arr)
        if foto == "MONOCHROME1":                   # 0 = blanco en MONOCHROME1
            arr = 255.0 - arr
        im = Image.fromarray(arr.astype(np.uint8), mode="L")
    elif arr.ndim == 3 and arr.shape[-1] == 3:
        im = Image.fromarray(arr.astype(np.uint8), mode="RGB")
    else:
        raise ImagenInvalida(f"forma de pixel data no soportada: {arr.shape}")

    # Solo lo que describe el ESTUDIO, nunca al paciente (nombre, fechas de
    # nacimiento, ids): eso se queda dentro del DICOM original y no se indexa.
    def _s(tag):
        v = getattr(ds, tag, None)
        return None if v in (None, "") else str(v)

    meta = {
        "modality": _s("Modality"), "body_part": _s("BodyPartExamined"),
        "study_description": _s("StudyDescription"), "series_description": _s("SeriesDescription"),
        "rows": int(getattr(ds, "Rows", 0) or 0), "columns": int(getattr(ds, "Columns", 0) or 0),
        "frames": frames, "frame_usado": corte, "photometric": foto or None,
        "window_center": _s("WindowCenter"), "window_width": _s("WindowWidth"),
        "bits_stored": int(getattr(ds, "BitsStored", 0) or 0),
    }
    return im, {k: v for k, v in meta.items() if v not in (None, 0)}


def a_vista_png(raw: bytes, formato: str) -> tuple[bytes, int, int, dict]:
    """(png_bytes, ancho, alto, meta) de `vista.png` a partir del original."""
    if formato == "dicom":
        im, meta = _dicom_a_pillow(raw)
    else:
        im, meta = _abrir_pillow(raw), {}
    if max(im.size) > LADO_MAX_VISTA:
        im.thumbnail((LADO_MAX_VISTA, LADO_MAX_VISTA))
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), im.size[0], im.size[1], meta


def meta_json(meta: dict) -> str | None:
    return json.dumps(meta, ensure_ascii=False) if meta else None
