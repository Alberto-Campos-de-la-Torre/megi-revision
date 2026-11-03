"""Siembra idempotente de pacientes desde data/seed.json (fuente canónica)."""
import json

from .config import load_seed
from .db import db


def seed_if_empty() -> int:
    data = load_seed()
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) AS n FROM patients").fetchone()["n"]
        if n > 0:
            return 0
        for p in data["PATIENTS"]:
            conn.execute(
                """INSERT INTO patients
                   (id, name, short, curp, nss, age, sex, time, status, reason, last, allergies, chronic)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    p["id"], p["name"], p["short"], p["curp"], p["nss"],
                    p["age"], p["sex"], p["time"], p["status"], p["reason"], p["last"],
                    json.dumps(p.get("allergies", []), ensure_ascii=False),
                    json.dumps(p.get("chronic", []), ensure_ascii=False),
                ),
            )
        return len(data["PATIENTS"])
