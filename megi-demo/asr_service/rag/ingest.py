"""Ingesta RAG (offline): selecciona GPC Tier 1 piloto + CIE-10/CEMECE/NOM, extrae texto
(PyMuPDF), chunkea con metadatos, embebe con bge-m3 y guarda el índice local.

Uso:  <venv_mlx>/python -m asr_service.rag.ingest    (o: python ingest.py desde rag/)
Salida: rag/index/{chunks.jsonl, embeddings.npz, meta.json}
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np

HERE = Path(__file__).resolve().parent
RAG_DOCS = Path(os.environ.get(
    "MEGI_RAG_DIR", str(HERE.parent.parent / "rag-documentacion")))
MANIFEST = RAG_DOCS / "00_indice" / "clasificacion_megi.jsonl"
OUT_DIR = HERE / "index"
EMBED_MODEL = os.environ.get("MEGI_EMBED_MODEL", "BAAI/bge-m3")

# Alcance del índice: pilot (lista de condiciones) | tier1_grr (todas las GRR) |
# tier1_grr_ger (GRR + GER). Configurable sin tocar código.
SCOPE = os.environ.get("MEGI_RAG_SCOPE", "tier1_grr")
_DEFAULT_VERSION = {"pilot": "rag_tier1_pilot_v1", "tier1_grr": "rag_tier1_grr_v2",
                    "tier1_grr_ger": "rag_tier1_grr_ger_v3"}.get(SCOPE, "rag_tier1_v")
INDEX_VERSION = os.environ.get("MEGI_RAG_INDEX_VERSION", _DEFAULT_VERSION)
MAX_DOCS = int(os.environ.get("MEGI_RAG_MAX_DOCS", "0")) or None   # 0 = sin límite

# condiciones del piloto (acento-insensitivo); 2 guías máx por condición
PILOT_CONDITIONS = [
    "hipertension arterial", "diabetes mellitus", "dislipidemia",
    "cardiopatia isquemica", "lumbalgia", "infeccion de vias urinarias",
    "asma", "epoc", "enfermedad pulmonar obstructiva", "neumonia",
    "obesidad", "sobrepeso",
]
MAX_PER_CONDITION = 2
MIN_TEXT_CHARS = 400          # menos -> probable escaneado (ocr_needed)
TARGET_WORDS = 600           # ~800 tokens
OVERLAP_WORDS = 90


def _strip(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _page_texts(path: Path) -> list[str]:
    doc = fitz.open(str(path))
    try:
        return [p.get_text("text") or "" for p in doc]
    finally:
        doc.close()


_BOILERPLATE = ["guia de referencia", "guia de practica clinica", "rapida", "gpc",
                "titulo de la gpc", "catalogo maestro", "isbn", "av.", "avenida",
                "instituto mexicano", "cenetec", "secretaria de salud", "evidencias y"]


def _title_from(pages: list[str]) -> str:
    """Título completo: arranca en el primer renglón sustantivo (salta boilerplate) y
    une los renglones de continuación (los títulos de GPC suelen partirse en 2-3 líneas)."""
    lines = []
    for pg in pages[:3]:
        for line in pg.splitlines():
            lines.append(re.sub(r"\s+", " ", line.strip()))
    start = None
    for i, t in enumerate(lines):
        st = _strip(t)
        if len(t) >= 12 and not any(b in st for b in _BOILERPLATE) and not re.search(r"\d{3,}", t):
            start = i
            break
    if start is None:
        return ""
    title = lines[start]
    j = start + 1
    while j < len(lines) and len(title) < 70:
        nxt = lines[j]
        sn = _strip(nxt)
        if len(nxt) < 3 or any(b in sn for b in _BOILERPLATE) or re.search(r"\d{3,}", nxt):
            break
        title = f"{title} {nxt}".strip()
        j += 1
    return title[:170]


def _coverage(pages: list[str]) -> dict:
    chars = sum(len(p.strip()) for p in pages)
    with_text = sum(1 for p in pages if len(p.strip()) > 40)
    return {"pages": len(pages), "pages_with_text": with_text, "text_chars": chars,
            "ocr_needed": chars < MIN_TEXT_CHARS or with_text == 0}


def _chunks_for(pages: list[str]):
    """Genera (text, page_start, page_end) por ventana de ~TARGET_WORDS con overlap."""
    words = []  # (word, page)
    for i, pg in enumerate(pages):
        for w in pg.split():
            words.append((w, i + 1))
    out = []
    step = TARGET_WORDS - OVERLAP_WORDS
    for start in range(0, len(words), step):
        win = words[start:start + TARGET_WORDS]
        if not win:
            break
        text = " ".join(w for w, _ in win).strip()
        if len(text) < 60:
            continue
        out.append((text, win[0][1], win[-1][1]))
        if start + TARGET_WORDS >= len(words):
            break
    return out


def _load_manifest() -> list[dict]:
    return [json.loads(l) for l in open(MANIFEST, encoding="utf-8")]


def select_docs() -> list[dict]:
    """Devuelve lista de docs a indexar: {path, doc_id, title, source, doc_type, tier, use_case}."""
    rows = _load_manifest()
    selected, per_cond = [], {c: 0 for c in PILOT_CONDITIONS}

    # 1) GPC Tier 1 IMSS (use_case dx_analisis_plan); preferir GRR
    gpc = [r for r in rows if r.get("megi_tier") == 1
           and "gpc_imss" in r.get("categoria_rag", "")]
    gpc.sort(key=lambda r: 0 if "grr_guia_referencia_rapida" in r.get("categoria_rag", "") else 1)

    def _gpc_doc(r, pages, cov):
        p = RAG_DOCS / r["ruta_rag"]
        cat = r.get("categoria_rag", "")
        return {
            "path": p, "pages": pages, "coverage": cov,
            "doc_id": p.stem,                          # único (gpc_clave '000' colisiona)
            "clave": r.get("gpc_clave") or p.stem,
            "title": _title_from(pages) or p.stem,
            "source": r.get("source_name", "IMSS"),
            "doc_type": "GRR" if "grr_guia_referencia_rapida" in cat else "GER",
            "tier": 1, "use_case": "dx_analisis_plan",
        }

    if SCOPE == "pilot":
        for r in gpc:
            if sum(per_cond.values()) >= len(PILOT_CONDITIONS) * MAX_PER_CONDITION:
                break
            path = RAG_DOCS / r["ruta_rag"]
            if not path.exists():
                continue
            try:
                pages = _page_texts(path)
            except Exception:
                continue
            head = _strip(" ".join(pages[:2]))
            for cond in PILOT_CONDITIONS:
                if per_cond[cond] < MAX_PER_CONDITION and cond in head:
                    cov = _coverage(pages)
                    if cov["ocr_needed"]:
                        continue
                    per_cond[cond] += 1
                    selected.append(_gpc_doc(r, pages, cov))
                    break
    else:   # tier1_grr | tier1_grr_ger -> todas las GRR (y GER si aplica)
        want_ger = SCOPE == "tier1_grr_ger"
        n = 0
        for r in gpc:
            cat = r.get("categoria_rag", "")
            is_grr = "grr_guia_referencia_rapida" in cat
            is_ger = "ger_guia_evidencias_recomendaciones" in cat
            if not (is_grr or (want_ger and is_ger)):
                continue
            path = RAG_DOCS / r["ruta_rag"]
            if not path.exists():
                continue
            try:
                pages = _page_texts(path)
            except Exception:
                continue
            cov = _coverage(pages)
            if cov["ocr_needed"]:
                continue
            selected.append(_gpc_doc(r, pages, cov))
            n += 1
            if MAX_DOCS and n >= MAX_DOCS:
                break

    # 2) CIE-10 / CEMECE (sueltos en raíz) -> temporal, use_case codificacion
    for fname, did in [("cie_10.pdf", "cie10"), ("CEMECE_AUXCOD_2023_2_10jul.pdf", "cemece")]:
        p = RAG_DOCS / fname
        if p.exists():
            try:
                pages = _page_texts(p)
                selected.append({"path": p, "pages": pages, "coverage": _coverage(pages),
                                 "doc_id": did, "title": fname.replace(".pdf", ""),
                                 "source": "SSA", "doc_type": "CIE10", "tier": 1,
                                 "use_case": "codificacion_cie10"})
            except Exception:
                pass

    # 3) NOM (estructura/cumplimiento)
    for r in rows:
        if r.get("doc_type") == "NOM_pdf":
            p = RAG_DOCS / r["ruta_rag"]
            if p.exists():
                try:
                    pages = _page_texts(p)
                    selected.append({"path": p, "pages": pages, "coverage": _coverage(pages),
                                     "doc_id": "nom_004", "title": _title_from(pages) or "NOM-004",
                                     "source": "Secretaria de Salud", "doc_type": "NOM",
                                     "tier": 1, "use_case": "cumplimiento_nota_nom"})
                except Exception:
                    pass
    return selected


def main():
    print(f"[ingest] scope: {SCOPE} | index_version: {INDEX_VERSION}")
    print(f"[ingest] manifiesto: {MANIFEST}")
    print(f"[ingest] modelo embeddings: {EMBED_MODEL}")
    docs = select_docs()
    by_type = {}
    for d in docs:
        by_type[d["doc_type"]] = by_type.get(d["doc_type"], 0) + 1
    print(f"[ingest] documentos seleccionados: {len(docs)} {by_type}")
    for d in docs[:15]:
        print(f"   - {d['doc_type']:5} {d['doc_id']:18} :: {d['title'][:55]}")
    if len(docs) > 15:
        print(f"   ... (+{len(docs) - 15} más)")

    chunks = []
    for d in docs:
        if d["coverage"]["ocr_needed"]:
            continue
        for ci, (text, p0, p1) in enumerate(_chunks_for(d["pages"])):
            cid = f"{d['doc_id']}_p{p0}_c{ci:03d}"
            if d["doc_type"] in ("GRR", "GER"):
                citation = f"{d['title']}, pág. {p0} (GPC {d['source']} {d.get('clave', d['doc_id'])})"
            elif d["doc_type"] == "CIE10":
                citation = f"CIE-10, pág. {p0}" if d["doc_id"] == "cie10" else f"CEMECE AUXCOD, pág. {p0}"
            elif d["doc_type"] == "NOM":
                citation = f"NOM-004-SSA3-2012, pág. {p0}"
            else:
                citation = f"{d['title']}, pág. {p0}"
            chunks.append({
                "chunk_id": cid, "doc_id": d["doc_id"], "title": d["title"],
                "source": d["source"], "doc_type": d["doc_type"], "tier": d["tier"],
                "use_case": d["use_case"], "page_start": p0, "page_end": p1,
                "citation": citation, "text": text,
            })
    print(f"[ingest] chunks: {len(chunks)} de {len(docs)} docs")
    if not chunks:
        print("[ingest] sin chunks; abortando."); return

    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(EMBED_MODEL)
    emb = model.encode([c["text"] for c in chunks], normalize_embeddings=True,
                       show_progress_bar=True, batch_size=16)
    emb = np.asarray(emb, dtype=np.float32)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_DIR / "chunks.jsonl", "w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    np.savez_compressed(OUT_DIR / "embeddings.npz", embeddings=emb)
    meta = {
        "index_version": INDEX_VERSION, "embedding_model": EMBED_MODEL,
        "embedding_dim": int(emb.shape[1]), "chunk_count": len(chunks),
        "source_doc_count": len(docs),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_manifest_sha256": hashlib.sha256(MANIFEST.read_bytes()).hexdigest(),
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print(f"[ingest] OK -> {OUT_DIR}  dim={meta['embedding_dim']} chunks={meta['chunk_count']}")


if __name__ == "__main__":
    sys.exit(main())
