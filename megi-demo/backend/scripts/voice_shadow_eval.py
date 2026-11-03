"""Fase 9B — evaluación shadow del parser LLM sobre comandos REALES retenidos.

Corre todos los transcripts de voice_command guardados en la tabla `audio` por
el parser LLM del servicio ASR y muestra qué habría propuesto para cada uno.
No ejecuta nada ni toca la base: es la comparación que decide cuándo (y en qué
dominios) darle autoridad real al parser.

Uso (con el servicio ASR corriendo en :8010):
    cd backend && .venv/bin/python scripts/voice_shadow_eval.py [ruta_db]
"""
import json
import sqlite3
import sys
from pathlib import Path

import httpx

DB = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "megi.sqlite"
ASR = "http://localhost:8010"


def main() -> None:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT created_at, transcript FROM audio "
        "WHERE audio_kind = 'voice_command' AND transcript != '' ORDER BY created_at"
    ).fetchall()
    if not rows:
        print(f"Sin transcripts de comandos en {DB}")
        return

    print(f"{len(rows)} comandos retenidos · parser: {ASR}/v1/command/parse\n")
    counts = {}
    for r in rows:
        text = r["transcript"]
        try:
            resp = httpx.post(f"{ASR}/v1/command/parse", json={"text": text}, timeout=300).json()
            p = resp.get("parse") or {}
            intent = p.get("intent", "?")
            counts[intent] = counts.get(intent, 0) + 1
            ents = json.dumps(p.get("entities") or {}, ensure_ascii=False)
            print(f"  {text!r}\n    -> {intent}  conf={p.get('confidence')}  {ents}"
                  + (f"  [aclarar]" if p.get("needs_clarification") else "")
                  + (f"  razon: {p.get('reason')}" if p.get("reason") else "")
                  + f"  ({resp.get('latency_ms')} ms)")
        except Exception as e:
            print(f"  {text!r}\n    -> ERROR: {e}")

    print("\nResumen por intención:")
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
