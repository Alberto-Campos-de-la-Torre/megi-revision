"""Importa las notas IMSS OCReadas como PACIENTES REALES de MEGI.

Cada paciente de notas_imss.db (consolidado por CURP, o por nombre si no hay
CURP) se crea en MEGI con id 'P-IMSS-*' y source='imss_ocr', y cada una de sus
notas se vuelve una consulta APROBADA con su SOAP reconstruido (S=resumen,
O=exploración+vitales, A=diagnósticos, P=indicaciones+receta+incapacidad),
receta, dx y vitales estructurados. Así puedes abrir expedientes reales,
recorrer su historial y probar la app (rx-check, documentos, tendencias) con
datos verdaderos.

Idempotente: borra e re-importa TODO lo source='imss_ocr' (no toca pacientes
capturados en MEGI). Uso:  cd backend && .venv/bin/python scripts/import_notas_pacientes.py
"""
from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
MEGI_DB = BACKEND / "data" / "megi.sqlite"
NOTAS_DB = Path.home() / "Desktop" / "entrenamiento mlx" / "ocr_notas" / "notas_imss.db"


def norm_name(n: str) -> str:
    n = unicodedata.normalize("NFKD", (n or "").upper())
    n = "".join(c for c in n if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", n).strip()


def clean(s):
    s = (s or "").strip()
    return s or None


def build_vitals(v: dict) -> dict:
    out = {}
    if v.get("ta"):
        out["ta"] = str(v["ta"])
    for src, dst in (("fc", "fc"), ("fr", "fr"), ("temp_c", "temp"),
                     ("peso_kg", "peso"), ("talla_m", "talla"), ("glucosa", "glucosa")):
        if v.get(src) is not None:
            out[dst] = v[src]
    if v.get("peso_kg") and v.get("talla_m"):
        try:
            out["imc"] = round(float(v["peso_kg"]) / (float(v["talla_m"]) ** 2), 1)
        except (ValueError, ZeroDivisionError):
            pass
    return out


def build_soap(ex: dict, dxs: list, rx: list, inc, ref) -> dict:
    o = clean(ex.get("exploracion")) or ""
    vit = ex.get("vitales") or {}
    vline = " ".join(f"{k.upper()} {v}" for k, v in build_vitals(vit).items())
    if vline:
        o = (o + "\n" + vline).strip()
    plan = []
    if clean(ex.get("indicaciones")):
        plan.append(ex["indicaciones"].strip())
    if rx:
        plan.append("Rx: " + "; ".join(
            " ".join(filter(None, [r["farmaco"], r["dosis"], r["frecuencia"], r["duracion"]])) for r in rx))
    if inc:
        d = f"{inc['dias']} días" if inc["dias"] else "incapacidad"
        plan.append(f"Incapacidad: {d}" + (f" (acum. {inc['dias_acumulados']})" if inc["dias_acumulados"] else ""))
    if ref:
        plan.append(f"Envío a {ref}")
    return {
        "S": clean(ex.get("resumen_clinico")) or "",
        "O": o,
        "A": "; ".join(dxs) if dxs else "",
        "P": "\n".join(plan),
    }


def main() -> None:
    src = sqlite3.connect(NOTAS_DB)
    src.row_factory = sqlite3.Row
    dst = sqlite3.connect(MEGI_DB)
    dst.row_factory = sqlite3.Row
    now = datetime.now(timezone.utc).isoformat()

    # Limpieza de una importación previa (idempotente).
    old = [r["id"] for r in dst.execute("SELECT id FROM patients WHERE source = 'imss_ocr'")]
    if old:
        qmarks = ",".join("?" * len(old))
        cons = [r["id"] for r in dst.execute(f"SELECT id FROM consultations WHERE patient_id IN ({qmarks})", old)]
        dst.execute(f"DELETE FROM consultations WHERE patient_id IN ({qmarks})", old)
        dst.execute(f"DELETE FROM patients WHERE id IN ({qmarks})", old)
        dst.commit()
        print(f"limpieza: {len(old)} pacientes y {len(cons)} consultas previas importadas")

    # Consolidar notas por paciente (CURP; si no hay, nombre normalizado).
    notas = src.execute("""
        SELECT n.*, p.curp, p.nss, p.nombre, p.sexo, p.edad
        FROM notas n LEFT JOIN pacientes p ON n.paciente_id = p.id
        WHERE p.nombre IS NOT NULL AND TRIM(p.nombre) != ''
        ORDER BY n.fecha
    """).fetchall()
    grupos: dict[str, list] = {}
    for n in notas:
        key = (n["curp"] or "").strip().upper() or "NOM:" + norm_name(n["nombre"])
        grupos.setdefault(key, []).append(n)
    print(f"{len(notas)} notas -> {len(grupos)} pacientes reales")

    seq = 0
    total_cons = 0
    for key, gnotas in grupos.items():
        seq += 1
        pid = f"P-IMSS-{seq:04d}"
        base = gnotas[-1]  # la más reciente para datos demográficos
        edades = [g["edad"] for g in gnotas if g["edad"]]
        dst.execute(
            """INSERT INTO patients (id, name, short, curp, nss, age, sex, status, reason,
               last, allergies, chronic, kind, created_at, source)
               VALUES (?,?,?,?,?,?,?,'terminada',?,?,?,?,'importado',?,'imss_ocr')""",
            (pid, norm_name(base["nombre"]).title(), norm_name(base["nombre"]).split(" ")[0].title(),
             clean(base["curp"]), clean(base["nss"]), max(edades) if edades else None,
             (base["sexo"] or "").strip().upper()[:1] or None,
             clean(base["diagnosticos_txt"] if "diagnosticos_txt" in base.keys() else None) or "Consulta IMSS",
             clean(base["fecha"]), "[]", "[]", now),
        )

        for n in gnotas:
            try:
                ex = json.loads(n["extract_json"] or "{}")
            except Exception:
                ex = {}
            nid = n["id"]
            dxs = [r["texto"] for r in src.execute("SELECT texto FROM diagnosticos WHERE nota_id = ?", (nid,))]
            rx = [dict(r) for r in src.execute(
                "SELECT farmaco, dosis, frecuencia, duracion FROM receta_items WHERE nota_id = ?", (nid,))]
            inc = src.execute("SELECT dias, dias_acumulados FROM incapacidades WHERE nota_id = ?", (nid,)).fetchone()
            ref = src.execute("SELECT servicio FROM referencias WHERE nota_id = ?", (nid,)).fetchone()
            ref_s = clean(ref["servicio"]) if ref else None

            soap = build_soap(ex, dxs, rx, dict(inc) if inc else None, ref_s)
            vitals = build_vitals(ex.get("vitales") or {})
            prescription = [{"drug": r["farmaco"], "dose": r["dosis"] or "",
                             "freq": r["frecuencia"] or "", "duration": r["duracion"] or ""} for r in rx]
            dx_codes = [{"code": "", "label": d} for d in dxs]

            cid = f"C-IMSS-{nid:05d}"
            fecha = clean(n["fecha"]) or now
            dst.execute(
                """INSERT INTO consultations (id, patient_id, status, started_at, updated_at,
                   doctor_id, transcript, soap, final_soap, approved_soap, prescription,
                   dx_codes, vitals, approved_by, approved_at, finalized_at)
                   VALUES (?,?,'approved',?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (cid, pid, fecha, fecha, clean(n["matricula_medico"]),
                 clean(n["ocr_texto"]), json.dumps(soap, ensure_ascii=False),
                 json.dumps(soap, ensure_ascii=False), json.dumps(soap, ensure_ascii=False),
                 json.dumps(prescription, ensure_ascii=False), json.dumps(dx_codes, ensure_ascii=False),
                 json.dumps(vitals, ensure_ascii=False), "importado_imss", fecha, fecha),
            )
            total_cons += 1
    dst.commit()

    tp = dst.execute("SELECT COUNT(*) FROM patients WHERE source='imss_ocr'").fetchone()[0]
    print(f"LISTO: {tp} pacientes importados, {total_cons} consultas aprobadas (source=imss_ocr)")
    dst.close()


if __name__ == "__main__":
    main()
