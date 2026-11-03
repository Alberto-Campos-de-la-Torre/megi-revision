"""Siembra el catálogo de medicamentos de MEGI desde la práctica real.

Lee `farmacos_minados` (tipo=medicamento) de notas_imss.db y los inserta en la
tabla `medications` de megi.sqlite en estado BORRADOR — nada queda aprobado
automáticamente: el médico revisa/edita/aprueba desde Administración.
Idempotente: no toca genéricos que ya existan.

Uso:
    cd backend && .venv/bin/python scripts/seed_medications.py
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
MEGI_DB = BACKEND / "data" / "megi.sqlite"
NOTAS_DB = Path.home() / "Desktop" / "entrenamiento mlx" / "ocr_notas" / "notas_imss.db"


def top1(json_list: str) -> str:
    """'["300 mg (x4)", ...]' -> '300 mg' (el más frecuente, sin el contador)."""
    try:
        items = json.loads(json_list or "[]")
        return items[0].rsplit(" (x", 1)[0] if items else ""
    except Exception:
        return ""


def main() -> None:
    src = sqlite3.connect(NOTAS_DB)
    src.row_factory = sqlite3.Row
    dst = sqlite3.connect(MEGI_DB)
    now = datetime.now(timezone.utc).isoformat()

    rows = src.execute(
        "SELECT * FROM farmacos_minados WHERE tipo = 'medicamento' ORDER BY n_recetas DESC"
    ).fetchall()
    print(f"{len(rows)} medicamentos minados")

    ins = skip = 0
    for r in rows:
        g = (r["generico"] or "").strip().lower()
        if not g:
            continue
        if dst.execute("SELECT 1 FROM medications WHERE generico = ?", (g,)).fetchone():
            skip += 1
            continue
        dst.execute(
            """INSERT INTO medications (generico, sinonimos, clase, via, dosis_habitual,
               frecuencia_habitual, dosis_max_dia, precauciones, n_recetas, fuente,
               estado, created_at)
               VALUES (?,?,?,?,?,?,'','',?,'minado_notas_imss','borrador',?)""",
            (g, r["variantes_crudas"] or "[]", r["clase"] or "", r["via"] or "",
             top1(r["dosis_frecuentes"]), top1(r["frecuencias_frecuentes"]),
             r["n_recetas"], now),
        )
        ins += 1
    dst.commit()
    total = dst.execute("SELECT COUNT(*) FROM medications").fetchone()[0]
    print(f"insertados={ins}, ya existían={skip}, total en catálogo={total} (todos en borrador hasta que el médico apruebe)")


if __name__ == "__main__":
    main()
