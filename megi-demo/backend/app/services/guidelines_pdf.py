"""PDF original de cada guía del índice RAG.

La biblioteca de «Guías» muestra los fragmentos de texto que indexó el ASR;
el médico pidió ver también el documento tal cual (tablas, algoritmos,
imágenes: en el PDF sabe dónde mirar). Aquí se resuelve `doc_id` -> archivo.

`doc_id` es el nombre del PDF sin extensión (así lo fija `rag/ingest.py`), y
la ruta relativa sale del manifiesto del corpus (`00_indice/
clasificacion_megi.jsonl`, `ruta_rag`). Tres documentos se indexaron con id
propio y se mapean a mano. El corpus (1.4 GB de PDFs) no viaja en git: vive
en `MEGI_RAG_DIR` (por defecto `<repo>/rag-documentacion`, en el servidor
`/opt/megi/rag-documentacion`). Si el archivo no está, la guía sigue
leyéndose como texto: el PDF es un extra, no un requisito.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

RAG_DOCS_DIR = Path(os.environ.get(
    "MEGI_RAG_DIR",
    str(Path(__file__).resolve().parent.parent.parent.parent / "rag-documentacion"),
))
MANIFEST = RAG_DOCS_DIR / "00_indice" / "clasificacion_megi.jsonl"

# Ids que `ingest.py` asigna a mano (no salen del nombre del archivo).
_ESPECIALES = {"cie10": "cie_10.pdf", "cemece": "CEMECE_AUXCOD_2023_2_10jul.pdf"}

_CACHE: dict = {"rutas": None}


def _rutas() -> dict:
    """doc_id -> ruta relativa. Se lee una vez; el manifiesto no cambia en caliente."""
    if _CACHE["rutas"] is not None:
        return _CACHE["rutas"]
    rutas: dict = dict(_ESPECIALES)
    if MANIFEST.exists():
        with open(MANIFEST, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                ruta = r.get("ruta_rag") or ""
                if not ruta.lower().endswith(".pdf"):
                    continue
                rutas.setdefault(Path(ruta).stem, ruta)
                # La única NOM del corpus se indexó como `nom_004`.
                if r.get("doc_type") == "NOM_pdf":
                    rutas.setdefault("nom_004", ruta)
    _CACHE["rutas"] = rutas
    return rutas


def pdf_path(doc_id: str) -> Path | None:
    """Ruta absoluta del PDF de la guía, o None si no hay archivo. Nunca sale
    de `RAG_DOCS_DIR` aunque el manifiesto trajera una ruta rara."""
    ruta = _rutas().get(doc_id or "")
    if not ruta:
        return None
    p = (RAG_DOCS_DIR / ruta)
    try:
        p.resolve().relative_to(RAG_DOCS_DIR.resolve())
    except ValueError:
        return None
    return p if p.is_file() else None


def reset_cache() -> None:
    _CACHE["rutas"] = None
