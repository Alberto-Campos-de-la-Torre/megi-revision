"""Parsea el catálogo CIE-10 completo (cie_10.pdf) a data/cie10_full.jsonl.

El PDF tabular lista, por línea: un CÓDIGO ('L98', 'L98.0') y luego su
descripción en 1+ líneas, hasta el siguiente código. Se ignoran las líneas de
metadata (Excluye/Incluye/Usar código/Nota) y los encabezados de rango (A00-A09).

Uso (venv con fitz):
    "…/venv_mlx/bin/python3" scripts/parse_cie10.py
"""
import json
import re
from pathlib import Path

import fitz

PDF = Path.home() / "Desktop" / "pagina_megi" / "ia megi" / "rag-documentacion" / "cie_10.pdf"
OUT = Path(__file__).resolve().parent.parent / "data" / "cie10_full.jsonl"

# Código CIE-10 individual (no rango): letra + 2 dígitos + opcional .N o .NN
CODE_RE = re.compile(r"^([A-Z]\d{2}(?:\.\d{1,2})?)$")
# Líneas de metadata a NO tomar como descripción
META = re.compile(r"^(excluye|incluye|usar|nota|the following|utilícese|utilice|véase|"
                  r"\[véase|codificar|los siguientes|debe|categoría)", re.I)


def main() -> None:
    doc = fitz.open(PDF)
    entries: dict[str, str] = {}
    order: list[str] = []
    cur_code = None
    cur_desc: list[str] = []

    def flush():
        if cur_code and cur_desc:
            desc = re.sub(r"\s+", " ", " ".join(cur_desc)).strip()
            # corta referencias con código: 'Dolor lumbar (M54.4)' -> 'Dolor lumbar'
            desc = re.split(r"\s*\([A-Z]\d{2}", desc)[0].strip(" .,;")
            if desc and cur_code not in entries:
                entries[cur_code] = desc
                order.append(cur_code)

    for page in doc:
        for raw in page.get_text().split("\n"):
            line = raw.strip()
            if not line:
                continue
            m = CODE_RE.match(line)
            if m:
                flush()
                cur_code = m.group(1)
                cur_desc = []
            elif cur_code is not None:
                # metadata o bullet de exclusión/sinónimo -> fin de la descripción
                if META.match(line) or line.startswith("•") or line.isdigit():
                    cur_code = cur_code if cur_desc else None  # deja de acumular
                    if cur_desc:
                        flush()
                        cur_code = None
                    continue
                if not cur_desc or len(" ".join(cur_desc)) < 160:
                    cur_desc.append(line)
    flush()
    doc.close()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        for code in order:
            f.write(json.dumps({"code": code, "label": entries[code]}, ensure_ascii=False) + "\n")
    print(f"{len(order)} códigos CIE-10 -> {OUT}")
    # muestra de control
    for c in ("N17.9", "N18.9", "E11.2", "N04.9", "J01.9", "I10", "M54.5"):
        print(f"  {c}: {entries.get(c, '(no encontrado)')}")


if __name__ == "__main__":
    main()
