"""Complementa el catálogo con GPC (RAG) y aprueba — por instrucción del médico.

Para cada medicamento en BORRADOR: pide la sugerencia GPC; si las guías traen
información (no abstención), llena SOLO los campos vacíos (precauciones y, si el
texto trae una dosis máxima explícita, dosis_max_dia) citando la fuente; si las
GPC no cubren el fármaco, se deja vacío (nunca se inventa). Después APRUEBA la
entrada — la firma sale del token del médico que corre el script.

Uso:
    .venv/bin/python scripts/complement_approve_medications.py <usuario> <password>
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request

API = "http://localhost:8000/api"

ABSTAIN_RE = re.compile(
    r"no (?:es posible|contiene|se menciona|hay informaci|proporciona|se encontr)", re.I
)
DOSE_RE = re.compile(
    r"dosis m[aá]xima[^.]{0,90}?(\d[\d\s.,]*\s*(?:mg|g|mcg)(?:\s*(?:al d[ií]a|/d[ií]a|diarios?|por d[ií]a))?)", re.I
)


def call(path: str, token: str | None = None, body: dict | None = None, method: str | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data,
                                 method=method or ("POST" if data is not None else "GET"))
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    token = call("/auth/login", body={"username": sys.argv[1], "password": sys.argv[2]})["token"]

    meds = call("/medications?estado=borrador", token)
    print(f"{len(meds)} medicamentos en borrador", flush=True)

    complemented = abstained = approved = 0
    t0 = time.time()
    for i, m in enumerate(meds, 1):
        tag = f"[{i}/{len(meds)}] {m['generico']}"
        try:
            s = call(f"/medications/{m['id']}/gpc-suggest", token, body={})
            ans = (s.get("sugerencia") or "").strip()
            fuentes = s.get("fuentes") or []
            useful = ans and fuentes and not ABSTAIN_RE.search(ans)
            if useful:
                patch = {}
                if not (m.get("precauciones") or "").strip():
                    citas = "; ".join(f.get("citation", "") for f in fuentes[:2])
                    patch["precauciones"] = re.sub(r"\s+", " ", ans)[:420] + f" [GPC: {citas}]"
                dm = DOSE_RE.search(ans)
                if dm and not (m.get("dosis_max_dia") or "").strip():
                    patch["dosis_max_dia"] = re.sub(r"\s+", " ", dm.group(1)).strip()
                if patch:
                    call(f"/medications/{m['id']}", token, body=patch, method="PATCH")
                    complemented += 1
                    print(f"  {tag}: complementado ({', '.join(patch)})", flush=True)
                else:
                    print(f"  {tag}: GPC con info pero campos ya llenos", flush=True)
            else:
                abstained += 1
                print(f"  {tag}: GPC sin cobertura (queda como está)", flush=True)
        except Exception as e:
            print(f"  {tag}: ERROR sugerencia ({e}); se aprueba sin complementar", flush=True)
        try:
            call(f"/medications/{m['id']}/approve", token, body={})
            approved += 1
        except Exception as e:
            print(f"  {tag}: ERROR al aprobar: {e}", flush=True)

    print(f"\nLISTO en {int((time.time() - t0) / 60)} min: aprobados={approved}, "
          f"complementados con GPC={complemented}, sin cobertura GPC={abstained}", flush=True)


if __name__ == "__main__":
    main()
