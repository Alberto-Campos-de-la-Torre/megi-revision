"""Siembra de DEMO para el hackatón Agent-Native (pacientes FICTICIOS).

Deja la base en el estado exacto que necesita el guion: un médico de demo,
cuatro pacientes con sus alergias/crónicos, una consulta CONSOLIDADA (SOAP
final, pendiente de revisión) por paciente, consultas previas aprobadas para
que exista «medicación activa», y un catálogo de fármacos e interacciones
aprobado para que el rx-check determinista (`/api/safety/rx-check`) dispare.

Idempotente y destructivo SOLO sobre los ids DEMO: borra y vuelve a crear lo
que empieza por `P-DEMO` / `C-DEMO`. Nunca correr contra la base del consultorio.

Uso:
    cd backend && MEGI_MODE=local_mock .venv/bin/python seed_demo.py [--password XXXX]

Ids lógicos del contrato (REPARTO_TRABAJO.md) -> ids reales de MEGI:
    demo-p1 -> P-DEMO1   demo-c1 -> C-DEMO1   (y así hasta 4)
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

from app.db import db, init_db
from app.routes.users import create_admin, set_password

USER = "demo_medico"
NAME = "Dra. Demo Ficticia"
DEFAULT_PASSWORD = "demo-megi-2026"


def _iso(days_ago: int, hour: int = 10) -> str:
    d = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return d.replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()


# ----------------------------------------------------------------- pacientes
# Nombres y datos inventados. CURP/NSS con formato válido pero ficticios.
PATIENTS = [
    {
        "id": "P-DEMO1", "name": "Alba Prueba Ficticia", "short": "Alba P. Ficticia",
        "age": 34, "sex": "F", "curp": "PUFA920101MDFRBL01", "nss": "12345678901",
        "allergies": ["Penicilina"], "chronic": [],
        "reason": "Dolor de garganta y fiebre de 3 días",
    },
    {
        "id": "P-DEMO2", "name": "Mateo Ejemplo Demo", "short": "Mateo E. Demo",
        "age": 61, "sex": "M", "curp": "EEDM650315HDFJMT02", "nss": "23456789012",
        "allergies": [], "chronic": ["Hipertensión arterial"],
        "reason": "Control de presión y dolor lumbar",
    },
    {
        "id": "P-DEMO3", "name": "Rosa Ficticia Muestra", "short": "Rosa F. Muestra",
        "age": 72, "sex": "F", "curp": "FIMR540720MDFCSS03", "nss": "34567890123",
        "allergies": ["Sulfas"], "chronic": ["Fibrilación auricular", "Hipertensión arterial"],
        "reason": "Dolor de rodilla derecha",
    },
    {
        "id": "P-DEMO4", "name": "Luis Modelo Simulado", "short": "Luis M. Simulado",
        "age": 28, "sex": "M", "curp": "MOSL980905HDFDML04", "nss": "45678901234",
        "allergies": ["Ninguna conocida"], "chronic": [],
        "reason": "Cefalea tensional",
    },
]

# ----------------------------------------------- consultas previas (aprobadas)
# Dan la «medicación activa» del paciente: la última receta aprobada.
PREVIOUS = [
    {
        "id": "C-DEMO2-PREV", "patient_id": "P-DEMO2", "days_ago": 90,
        "motivo": "Control de hipertensión",
        "soap": {"S": "Acude a control. Sin cefalea ni disnea. Toma su medicamento diario.",
                 "O": "TA 138/88, FC 76, peso 84 kg.",
                 "A": "Hipertensión arterial esencial en control aceptable.",
                 "P": "Continuar losartán 50 mg cada 24 h. Dieta hiposódica. Control en 3 meses."},
        "rx": [{"drug": "Losartán", "dose": "50 mg", "freq": "cada 24 h", "duration": "continuo"}],
        "dx": [{"code": "I10", "label": "Hipertensión esencial (primaria)"}],
        "vitals": {"ta": "138/88", "fc": "76", "peso": "84"},
    },
    {
        "id": "C-DEMO3-PREV", "patient_id": "P-DEMO3", "days_ago": 60,
        "motivo": "Control de anticoagulación",
        "soap": {"S": "Sin sangrados ni hematomas. Toma anticoagulante y betabloqueador.",
                 "O": "TA 132/80, FC 68 irregular. INR 2.4 (en meta).",
                 "A": "Fibrilación auricular anticoagulada, INR en rango.",
                 "P": "Continuar warfarina 5 mg cada 24 h y metoprolol 50 mg cada 12 h. INR en 4 semanas."},
        "rx": [{"drug": "Warfarina", "dose": "5 mg", "freq": "cada 24 h", "duration": "continuo"},
               {"drug": "Metoprolol", "dose": "50 mg", "freq": "cada 12 h", "duration": "continuo"}],
        "dx": [{"code": "I48.9", "label": "Fibrilación y aleteo auricular, no especificado"},
               {"code": "I10", "label": "Hipertensión esencial (primaria)"}],
        "vitals": {"ta": "132/80", "fc": "68"},
    },
]

# ------------------------------------- consultas de HOY (consolidadas, a revisar)
# Estado `in_review`: SOAP final consolidado, SIN receta aprobada todavía. Es el
# punto de partida del flujo: el agente propone, el médico revisa, se aprueba.
TODAY = [
    {
        "id": "C-DEMO1", "patient_id": "P-DEMO1",
        "motivo": "Dolor de garganta y fiebre de 3 días",
        "transcript": "Doctora, tengo tres días con dolor de garganta muy fuerte y fiebre. "
                      "No tengo tos. Me duele al pasar saliva. Soy alérgica a la penicilina, "
                      "de niña me dio ronchas. Exploración: amígdalas con exudado, ganglios "
                      "en cuello, temperatura treinta y ocho punto cinco.",
        "soap": {
            "S": "Odinofagia intensa de 3 días de evolución, fiebre no cuantificada, sin tos ni rinorrea. Refiere alergia a penicilina (exantema en la infancia).",
            "O": "Temp 38.5 °C, FC 92, TA 110/70. Amígdalas hiperémicas con exudado blanquecino bilateral. Adenopatías cervicales anteriores dolorosas. Sin tos. Centor 4.",
            "A": "Faringoamigdalitis aguda, probable etiología bacteriana (estreptocócica).",
            "P": "Iniciar antibiótico: amoxicilina 500 mg cada 8 h por 10 días. Paracetamol 500 mg cada 8 h si fiebre o dolor. Hidratación. Volver si dificultad respiratoria o persiste fiebre a las 72 h.",
        },
        "facts": {
            "diagnosticos": [{"code": "J03.9", "label": "Amigdalitis aguda, no especificada"}],
            "medicamentos_propuestos": ["Amoxicilina 500 mg cada 8 h 10 días", "Paracetamol 500 mg cada 8 h"],
            "alergias_mencionadas": ["Penicilina"],
            "pendientes": ["Revalorar en 72 h si persiste fiebre", "Datos de alarma: dificultad respiratoria"],
            "signos_vitales": {"temp": "38.5", "fc": "92", "ta": "110/70"},
        },
        "vitals": {"temp": "38.5", "fc": "92", "ta": "110/70"},
    },
    {
        "id": "C-DEMO2", "patient_id": "P-DEMO2",
        "motivo": "Control de presión y dolor lumbar",
        "transcript": "Vengo a control de la presión y además traigo dolor en la espalda baja "
                      "desde hace una semana por cargar cajas. No se me va a la pierna. "
                      "Presión ciento cuarenta y dos sobre noventa.",
        "soap": {
            "S": "Lumbalgia mecánica de 1 semana tras esfuerzo, sin irradiación ni déficit. Acude además a control de HTA.",
            "O": "TA 142/90, FC 78. Contractura paravertebral lumbar, Lasègue negativo, fuerza y reflejos normales.",
            "A": "Lumbalgia mecánica aguda. Hipertensión arterial con control subóptimo.",
            "P": "Naproxeno 250 mg cada 12 h por 5 días para el dolor. Calor local y ejercicios. Continuar losartán; valorar ajuste si TA persiste alta. Solicitar química sanguínea y EGO. Control en 2 semanas.",
        },
        "facts": {
            "diagnosticos": [{"code": "M54.5", "label": "Lumbago no especificado"},
                             {"code": "I10", "label": "Hipertensión esencial (primaria)"}],
            "medicamentos_propuestos": ["Naproxeno 250 mg cada 12 h 5 días", "Losartán 50 mg cada 24 h (continuar)"],
            "alergias_mencionadas": [],
            "pendientes": ["Química sanguínea y EGO", "Control de TA en 2 semanas", "Ejercicios de columna"],
            "signos_vitales": {"ta": "142/90", "fc": "78"},
        },
        "vitals": {"ta": "142/90", "fc": "78"},
    },
    {
        "id": "C-DEMO3", "patient_id": "P-DEMO3",
        "motivo": "Dolor de rodilla derecha",
        "transcript": "Me duele la rodilla derecha desde hace dos semanas, más al subir "
                      "escaleras. Sigo tomando mi anticoagulante y la pastilla del corazón. "
                      "Rodilla con un poco de derrame, sin calor.",
        "soap": {
            "S": "Gonalgia derecha de 2 semanas, mecánica, sin trauma. Anticoagulada con warfarina por FA; toma metoprolol.",
            "O": "Rodilla derecha con leve derrame, sin eritema ni calor, crepitación, arcos de movilidad conservados. TA 130/82, FC 70 irregular.",
            "A": "Gonartrosis derecha con sinovitis leve.",
            "P": "Ibuprofeno 400 mg cada 8 h por 7 días. Paracetamol 1 g cada 8 h. Radiografía de rodilla AP y lateral. Fisioterapia. INR de control en 2 semanas.",
        },
        "facts": {
            "diagnosticos": [{"code": "M17.1", "label": "Gonartrosis primaria, unilateral"}],
            "medicamentos_propuestos": ["Ibuprofeno 400 mg cada 8 h 7 días", "Paracetamol 1 g cada 8 h"],
            "alergias_mencionadas": [],
            "pendientes": ["Radiografía de rodilla derecha AP y lateral", "INR en 2 semanas", "Fisioterapia"],
            "signos_vitales": {"ta": "130/82", "fc": "70"},
        },
        "vitals": {"ta": "130/82", "fc": "70"},
    },
    {
        "id": "C-DEMO4", "patient_id": "P-DEMO4",
        "motivo": "Cefalea tensional",
        "transcript": "Tengo dolor de cabeza casi diario desde hace un mes, como una banda "
                      "apretada, peor en la tarde. Duermo cinco horas por el trabajo. "
                      "No vomito ni veo luces.",
        "soap": {
            "S": "Cefalea opresiva bilateral casi diaria de 1 mes, vespertina, sin náusea, fotofobia ni aura. Privación de sueño (5 h) y estrés laboral.",
            "O": "TA 118/76, FC 70. Exploración neurológica normal. Fondo de ojo normal. Contractura cervical.",
            "A": "Cefalea tensional episódica frecuente.",
            "P": "Paracetamol 1 g cada 8 h por razón necesaria, máximo 3 días a la semana. Higiene del sueño, pausas activas. Diario de cefalea. Control en 4 semanas.",
        },
        "facts": {
            "diagnosticos": [{"code": "G44.2", "label": "Cefalea de tipo tensión"}],
            "medicamentos_propuestos": ["Paracetamol 1 g cada 8 h PRN"],
            "alergias_mencionadas": [],
            "pendientes": ["Diario de cefalea", "Higiene del sueño", "Control en 4 semanas"],
            "signos_vitales": {"ta": "118/76", "fc": "70"},
        },
        "vitals": {"ta": "118/76", "fc": "70"},
    },
]

# ------------------------------------------- catálogo aprobado e interacciones
MEDICATIONS = [
    ("amoxicilina", ["amoxil"], "Penicilina", "oral", "500 mg", "cada 8 h", "3 g"),
    ("azitromicina", [], "Macrólido", "oral", "500 mg", "cada 24 h", "500 mg"),
    ("claritromicina", [], "Macrólido", "oral", "500 mg", "cada 12 h", "1 g"),
    ("cefalexina", [], "Cefalosporina", "oral", "500 mg", "cada 6 h", "4 g"),
    ("paracetamol", ["acetaminofén", "tempra"], "Analgésico", "oral", "500 mg-1 g", "cada 8 h", "3 g"),
    ("ibuprofeno", ["advil", "motrin"], "AINE", "oral", "400 mg", "cada 8 h", "2.4 g"),
    ("naproxeno", ["flanax"], "AINE", "oral", "250 mg", "cada 12 h", "1 g"),
    ("warfarina", ["coumadin"], "Anticoagulante", "oral", "5 mg", "cada 24 h", "según INR"),
    ("metoprolol", [], "Betabloqueador", "oral", "50 mg", "cada 12 h", "200 mg"),
    ("losartán", ["losartan"], "ARA II", "oral", "50 mg", "cada 24 h", "100 mg"),
    ("omeprazol", [], "IBP", "oral", "20 mg", "cada 24 h", "40 mg"),
    ("metformina", [], "Biguanida", "oral", "850 mg", "cada 12 h", "2.55 g"),
    ("tramadol", [], "Opioide", "oral", "50 mg", "cada 8 h", "400 mg"),
]
INTERACTIONS = [
    ("ibuprofeno", "warfarina", "grave",
     "Los AINE inhiben la función plaquetaria y lesionan la mucosa gástrica; potencian el sangrado con anticoagulantes.",
     "Evitar la combinación; usar paracetamol para el dolor y, si es imprescindible un AINE, vigilar INR y signos de sangrado."),
    ("naproxeno", "warfarina", "grave",
     "Mismo mecanismo que otros AINE: riesgo aumentado de hemorragia.",
     "Evitar; preferir paracetamol."),
    ("claritromicina", "warfarina", "grave",
     "Inhibición de CYP3A4/CYP2C9: aumenta el efecto anticoagulante.",
     "Evitar o monitorizar INR estrechamente; considerar azitromicina."),
    ("losartán", "naproxeno", "moderada",
     "Los AINE reducen el efecto antihipertensivo y aumentan el riesgo de daño renal con ARA II.",
     "Usar el AINE el menor tiempo posible y vigilar TA y función renal."),
    ("losartán", "ibuprofeno", "moderada",
     "Los AINE reducen el efecto antihipertensivo y aumentan el riesgo de daño renal con ARA II.",
     "Usar el AINE el menor tiempo posible y vigilar TA y función renal."),
    ("metoprolol", "ibuprofeno", "leve",
     "Los AINE pueden atenuar el efecto del betabloqueador.",
     "Vigilar TA si el uso es prolongado."),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _J(v) -> str:
    return json.dumps(v, ensure_ascii=False)


def seed(password: str) -> None:
    init_db()
    # 1) Médico de demo (admin para que también pueda entrar a Administración).
    with db() as conn:
        exists = conn.execute("SELECT 1 FROM users WHERE username = ?", (USER,)).fetchone()
    if exists:
        set_password(USER, password)
    else:
        create_admin(USER, NAME, password, must_change=False)

    with db() as conn:
        # 2) Limpieza SOLO de ids demo (idempotencia).
        conn.execute("DELETE FROM review_events WHERE consultation_id LIKE 'C-DEMO%'")
        conn.execute("DELETE FROM exports WHERE consultation_id LIKE 'C-DEMO%'")
        conn.execute("DELETE FROM soap_patches WHERE consultation_id LIKE 'C-DEMO%'")
        conn.execute("DELETE FROM appointments WHERE patient_id LIKE 'P-DEMO%'")
        conn.execute("DELETE FROM consultations WHERE id LIKE 'C-DEMO%'")
        conn.execute("DELETE FROM patients WHERE id LIKE 'P-DEMO%'")

        # 3) Pacientes.
        for p in PATIENTS:
            conn.execute(
                """INSERT INTO patients (id, name, short, curp, nss, age, sex, time, status,
                       reason, last, allergies, chronic, scheduled_date, kind, created_at,
                       email, phone, birthdate, doctor_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (p["id"], p["name"], p["short"], p["curp"], p["nss"], p["age"], p["sex"],
                 "", "terminada", p["reason"], "Consulta de hoy",
                 _J(p["allergies"]), _J(p["chronic"]), None, "espontaneo", _iso(120),
                 "", "", None, USER),
            )

        # 4) Consultas previas aprobadas (medicación activa).
        for c in PREVIOUS:
            started = _iso(c["days_ago"])
            conn.execute(
                """INSERT INTO consultations (id, patient_id, status, started_at, updated_at,
                       doctor_id, motivo, transcript, soap, final_soap, finalized_at,
                       approved_soap, prescription, dx_codes, approved_by, approved_at, vitals)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (c["id"], c["patient_id"], "approved", started, started, USER, c["motivo"],
                 "", _J(c["soap"]), _J(c["soap"]), started, _J(c["soap"]), _J(c["rx"]),
                 _J(c["dx"]), NAME, started, _J(c["vitals"])),
            )
            conn.execute(
                "INSERT INTO review_events (consultation_id, kind, payload, actor, created_at) VALUES (?,?,?,?,?)",
                (c["id"], "approve", _J({"rx_list": c["rx"], "selected_dx": c["dx"]}), NAME, started),
            )

        # 5) Consultas de hoy, consolidadas y pendientes de revisión.
        for c in TODAY:
            started = _iso(0, 9)
            conn.execute(
                """INSERT INTO consultations (id, patient_id, status, started_at, updated_at,
                       doctor_id, motivo, transcript, soap, final_soap, clinical_facts,
                       validation_flags, finalized_at, vitals)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (c["id"], c["patient_id"], "in_review", started, _now(), USER, c["motivo"],
                 c["transcript"], _J(c["soap"]), _J(c["soap"]), _J(c["facts"]),
                 _J({"status": "requires_review", "official_note": False, "flags": [], "warnings": []}),
                 _now(), _J(c["vitals"])),
            )
            conn.execute(
                "INSERT INTO review_events (consultation_id, kind, payload, actor, created_at) VALUES (?,?,?,?,?)",
                (c["id"], "soap_finalize", _J({"status": "done", "clinical_status": "requires_review"}), "system", _now()),
            )

        # 6) Catálogo e interacciones aprobados (el rx-check solo lee 'aprobado').
        for gen, sin, clase, via, dosis, freq, maxd in MEDICATIONS:
            conn.execute(
                """INSERT OR IGNORE INTO medications (generico, sinonimos, clase, via, dosis_habitual,
                       frecuencia_habitual, dosis_max_dia, precauciones, n_recetas, fuente,
                       estado, aprobado_por, aprobado_en, created_at)
                   VALUES (?,?,?,?,?,?,?,?,0,'manual','aprobado',?,?,?)""",
                (gen, _J(sin), clase, via, dosis, freq, maxd, "", USER, _now(), _now()),
            )
            conn.execute("UPDATE medications SET estado='aprobado', aprobado_por=?, aprobado_en=? WHERE generico=?",
                         (USER, _now(), gen))
        for a, b, sev, mec, rec in INTERACTIONS:
            a, b = sorted([a, b])
            conn.execute(
                """INSERT OR IGNORE INTO drug_interactions (farmaco_a, farmaco_b, severidad, mecanismo,
                       recomendacion, fuente, estado, aprobado_por, aprobado_en, created_at)
                   VALUES (?,?,?,?,?,'manual','aprobado',?,?,?)""",
                (a, b, sev, mec, rec, USER, _now(), _now()),
            )
            conn.execute("UPDATE drug_interactions SET estado='aprobado', aprobado_por=? WHERE farmaco_a=? AND farmaco_b=?",
                         (USER, a, b))

    print(f"Demo sembrada: usuario {USER} · {len(PATIENTS)} pacientes · "
          f"{len(TODAY)} consultas a revisar · {len(PREVIOUS)} previas · "
          f"{len(MEDICATIONS)} fármacos · {len(INTERACTIONS)} interacciones")
    print("Ids: " + ", ".join(f"demo-p{i+1}->{p['id']}" for i, p in enumerate(PATIENTS)))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--password", default=DEFAULT_PASSWORD)
    args = ap.parse_args()
    seed(args.password)
