"""Etapa 3: genera reglas de interacción fármaco-fármaco para el catálogo.

Para cada medicamento APROBADO, gemma propone interacciones bien establecidas
contra el resto del catálogo (nunca fuera de él). Los pares se deduplican
(a<b) quedándose con la severidad mayor, y se insertan en drug_interactions
en estado BORRADOR: el rx-check solo usará las que el médico apruebe.

Uso: cd backend && .venv/bin/python scripts/generate_interactions.py
"""
from __future__ import annotations

import json
import sqlite3
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "data" / "megi.sqlite"
ASR = "http://localhost:8010"
SEV_RANK = {"leve": 1, "moderada": 2, "grave": 3}


def propose(farmaco: str, clase: str, candidatos: list[dict]) -> list[dict]:
    body = json.dumps({"farmaco": farmaco, "clase": clase, "candidatos": candidatos}).encode()
    req = urllib.request.Request(f"{ASR}/v1/drugs/interactions", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.loads(r.read())
    if d.get("status") != "done":
        raise RuntimeError(d.get("error"))
    return d["interacciones"]


def main() -> None:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    meds = conn.execute(
        "SELECT generico, clase FROM medications WHERE estado = 'aprobado' ORDER BY n_recetas DESC"
    ).fetchall()
    print(f"{len(meds)} medicamentos aprobados en el catálogo", flush=True)

    pares: dict[tuple, dict] = {}
    t0 = time.time()
    for i, m in enumerate(meds, 1):
        otros = [{"generico": x["generico"], "clase": x["clase"]} for x in meds if x["generico"] != m["generico"]]
        try:
            props = propose(m["generico"], m["clase"] or "", otros)
        except Exception as e:
            print(f"  [{i}/{len(meds)}] {m['generico']}: ERROR {e}", flush=True)
            continue
        for p in props:
            a, b = sorted([m["generico"], p["con"]])
            key = (a, b)
            # doble dirección: conserva la severidad mayor
            if key not in pares or SEV_RANK[p["severidad"]] > SEV_RANK[pares[key]["severidad"]]:
                pares[key] = {"severidad": p["severidad"], "mecanismo": p["mecanismo"],
                              "recomendacion": p["recomendacion"]}
        if i % 10 == 0:
            print(f"  [{i}/{len(meds)}] · p