"""Corrige los títulos del índice RAG (chunks.jsonl) SIN re-embeber.

Problema: las portadas de las GRR dibujan el título ~4 veces superpuestas
(efecto de capas/sombra). PyMuPDF extrae las 4 capas casi en la misma coordenada
y el título sale intercalado ("Guí Guí Guí Guía de Referencia a de Referencia…").

Solución: re-extraer el título de-duplicando capas por solape horizontal
(quedándose con la palabra más larga = la capa completa). Reescribe `title` y
`citation` en chunks.jsonl; los embeddings (sobre `text`) NO cambian.

Uso:
  python fix_titles.py            # prueba (dry-run): imprime viejo -> nuevo
  python fix_titles.py --apply    # aplica (hace backup de chunks.jsonl)
"""
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import fitz

HERE = Path(__file__).resolve().parent
INDEX = HERE / "index" / "chunks.jsonl"
RAG_DOCS = Path(os.environ.get("MEGI_RAG_DIR", str(HERE.parent.parent / "rag-documentacion")))
MANIFEST = RAG_DOCS / "00_indice" / "clasificacion_megi.jsonl"

_BOILERPLATE = ["guia de referencia", "guia de practica clinica", "guia de practica",
                "rapida", "gpc", "titulo de la gpc", "catalogo maestro", "isbn", "av.",
                "avenida", "instituto mexicano", "cenetec", "secretaria de salud",
                "evidencias y", "guia de evidencias", "mexico,", "cdmx",
                "derechos reservados", "actualizacion", "diagramas de flujo",
                "diagrama de flujo", "algoritmo"]


def _strip(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _is_garbled(t: str) -> bool:
    """Detecta títulos rotos: repetición de frases o muchas palabras duplicadas
    (la firma de las capas intercaladas)."""
    if not t:
        return True
    toks = t.split()
    if len(toks) >= 4:
        low = [w.lower() for w in toks]
        if len(set(low)) / len(low) < 0.6:          # muchas palabras repetidas
            return True
    if re.search(r"(\b.{5,40}?\b)\s+\1", t):         # frase repetida consecutiva
        return True
    if re.search(r"\b(\w{1,4})\b\s+\1\b", t):        # fragmentos cortos tipo "Guí Guí"
        return True
    return False


def _is_boiler_only(t: str) -> bool:
    if len(t) < 12:
        return True
    st = _strip(t)
    for b in ("actualizacion", "guia de practica", "guia de referencia",
              "diagramas de flujo", "diagrama de flujo", "algoritmo", "version"):
        st = st.replace(b, "")
    return len(st.strip()) < 8


def _clean_lines(page) -> list:
    """Líneas de la página de-duplicando capas superpuestas (palabra más larga)."""
    words = page.get_text("words")  # (x0,y0,x1,y1,word,block,line,word_no)
    lines = defaultdict(list)
    for w in words:
        x0, y0, x1, _y1, word = w[0], w[1], w[2], w[3], w[4]
        lines[round(y0 / 2.0) * 2].append((x0, x1, word))
    out = []
    for y in sorted(lines):
        kept = []
        for x0, x1, word in sorted(lines[y], key=lambda t: t[0]):
            if kept and x0 < kept[-1][1] - 1:           # se solapa con la anterior -> es otra capa
                if len(word) > len(kept[-1][2]):        # quédate con la palabra completa
                    kept[-1] = (x0, max(x1, kept[-1][1]), word)
            else:
                kept.append((x0, x1, word))
        line = re.sub(r"\s+", " ", " ".join(w for _, _, w in kept)).strip()
        if line:
            out.append(line)
    return out


def _title_from_lines(lines: list) -> str:
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
    return re.sub(r"\s+", " ", title).strip()[:170]


def extract_title(pdf_path: Path) -> str:
    doc = fitz.open(str(pdf_path))
    try:
        lines = []
        for pg in doc:
            lines += _clean_lines(pg)
            if len(lines) > 35:
                break
        return _title_from_lines(lines)
    finally:
        doc.close()


def _manifest_map() -> dict:
    """stem del archivo -> {path, clave}."""
    out = {}
    for line in open(MANIFEST, encoding="utf-8"):
        r = json.loads(line)
        rr = r.get("ruta_rag") or ""
        if not rr:
            continue
        stem = Path(rr).stem
        out[stem] = {"path": RAG_DOCS / rr, "clave": r.get("gpc_clave") or stem}
    return out


def main():
    apply = "--apply" in sys.argv
    chunks = [json.loads(l) for l in open(INDEX, encoding="utf-8")]
    man = _manifest_map()

    # doc_id -> info (uno por documento)
    docs = {}
    for c in chunks:
        did = c.get("doc_id")
        if did not in docs:
            docs[did] = {"old_title": c.get("title"), "source": c.get("source"), "doc_type": c.get("doc_type")}

    new_title = {}
    garbled_ids = []
    for did, info in docs.items():
        old = info["old_title"] or ""
        if info["doc_type"] not in ("GRR", "GER"):
            new_title[did] = old                       # CIE10/NOM: se dejan igual
            continue
        if not (_is_garbled(old) or _is_boiler_only(old)):
            new_title[did] = old                       # ya está bien -> no tocar
            continue
        garbled_ids.append(did)
        m = man.get(did)
        cand = ""
        if m and m["path"].exists():
            try:
                cand = extract_title(m["path"])
            except Exception:
                cand = ""
        if cand and not _is_garbled(cand) and not _is_boiler_only(cand):
            new_title[did] = cand
        else:
            clave = (m or {}).get("clave", did)        # fallback limpio e identificable
            new_title[did] = f"GPC {info['source']} {clave}"

    # reporte: solo los que estaban rotos (los que vamos a cambiar)
    print(f"documentos: {len(docs)} | títulos ROTOS detectados: {len(garbled_ids)}\n")
    for did in garbled_ids:
        old = docs[did]["old_title"] or ""
        new = new_title[did]
        print(f"[{did}]")
        print(f"   viejo: {old[:72]}")
        print(f"   nuevo: {new[:72]}")

    if not apply:
        print("\n(dry-run) usa --apply para escribir los cambios.")
        return

    # backup + reescritura
    bak = INDEX.with_suffix(".jsonl.bak")
    if not bak.exists():
        bak.write_bytes(INDEX.read_bytes())
        print(f"\nbackup -> {bak}")
    n = 0
    with open(INDEX, "w", encoding="utf-8") as f:
        for c in chunks:
            did = c.get("doc_id")
            nt = new_title.get(did)
            if nt and nt != c.get("title"):
                c["title"] = nt
                if c.get("doc_type") in ("GRR", "GER"):
                    clave = (man.get(did) or {}).get("clave", did)
                    c["citation"] = f"{nt}, pág. {c.get('page_start')} (GPC {c.get('source')} {clave})"
                n += 1
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"\naplicado: {n} fragmentos actualizados en {INDEX}")


if __name__ == "__main__":
    main()
