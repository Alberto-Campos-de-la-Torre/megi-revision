"""Demostración: corre una consulta REAL por todo el pipeline modular de SOAP y
muestra el resultado como se vería en la revisión (SOAP + medicamentos por rol +
diagnósticos CIE + hechos clínicos). Uso: .venv/bin/python scripts/demo_finalize.py C-xxxx"""
import json
import sys

from app.db import db
from app.services import asr_client, dx_reconciler, facts_validator, med_reconciler


def line(c="─", n=78):
    print(c * n)


def main(cid):
    with db() as conn:
        row = conn.execute("SELECT transcript FROM consultations WHERE id=?", (cid,)).fetchone()
        prow = conn.execute(
            "SELECT p.name, p.age, p.sex, p.allergies, p.chronic FROM patients p "
            "JOIN consultations c ON c.patient_id=p.id WHERE c.id=?", (cid,)).fetchone()
    transcript = (row["transcript"] or "").strip()
    allergies = json.loads(prow["allergies"] or "[]") if prow else []
    chronic = json.loads(prow["chronic"] or "[]") if prow else []

    print(f"\nPACIENTE: {prow['name']} · {prow['age']}a · {prow['sex']}")
    print(f"TRANSCRIPCIÓN: {len(transcript)} caracteres")
    line("═")

    res = asr_client.soap_finalize(transcript, {}, cid)
    cf = res.get("clinical_facts") or {}
    cf = facts_validator.validate(cf)
    cf = dx_reconciler.reconcile(cf)["clinical_facts"]
    rec = med_reconciler.reconcile(cf, allergies, chronic)
    cf = rec["clinical_facts"]
    soap = res.get("soap") or {}

    for k, name in [("S", "SUBJETIVO"), ("O", "OBJETIVO"), ("A", "ANÁLISIS"), ("P", "PLAN")]:
        print(f"\n{k} · {name}")
        print("  " + (soap.get(k) or "—").replace("\n", "\n  "))

    line()
    print("DIAGNÓSTICOS (CIE-10):")
    for d in cf.get("diagnosticos", []):
        tag = {"exacto": "", "aproximado": "  ⚠ aprox.", "sin_codigo": ""}.get(d.get("match"), "")
        pr = " (principal)" if d.get("principal") else ""
        print(f"  {d['code'] or 'sin código':<9} {d['texto']}{pr}{tag}")
    if cf.get("diagnosticos_diferenciales"):
        difs = []
        for d in cf["diagnosticos_diferenciales"]:
            difs.append(d["texto"] + (f" ({d['code']})" if d["code"] else ""))
        print("  Diferenciales: " + ", ".join(difs))

    line()
    print("MEDICAMENTOS:")
    for key, lbl in [("medicamentos", "Se receta hoy"), ("medicamentos_habitual", "Tratamiento habitual"),
                     ("medicamentos_suspender", "A suspender"), ("medicamentos_automedicacion", "Automedicación")]:
        for m in cf.get(key, []):
            cat = "" if m.get("en_catalogo") else "  (no en catálogo)"
            det = " ".join(x for x in [m.get("dosis", ""), m.get("frecuencia", "")] if x)
            print(f"  [{lbl:<20}] {m['nombre']} {det}{cat}".rstrip())
    if rec.get("med_alerts"):
        print("  ALERTAS DE SEGURIDAD:")
        for a in rec["med_alerts"]:
            print(f"    ⛔ {a['message'][:100]}" if a["severity"] == "blocker" else f"    ⚠ {a['message'][:100]}")

    line()
    print("HECHOS CLÍNICOS:")
    print("  Presentes:", ", ".join(cf.get("sintomas_presentes") or []) or "—")
    print("  Negados:  ", ", ".join(cf.get("sintomas_negados") or []) or "—")
    print("  Alarmas:  ", ", ".join(cf.get("datos_alarma_condicionales") or []) or "—")
    sv = cf.get("signos_vitales") or {}
    print("  Vitales:  ", " · ".join(f"{k} {v}" for k, v in sv.items()) or "—")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "C-4bd065fc")
