import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..db import db
from ..ownership import doctor_of, owned_patient
from ..schemas import PatientCreate, PatientProfileUpdate
from ..security import require_user

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_patient(r) -> dict:
    d = dict(r)
    d["allergies"] = json.loads(d["allergies"] or "[]")
    d["chronic"] = json.loads(d["chronic"] or "[]")
    return d


def _load_json(raw, fallback):
    """JSON de una columna TEXT, tolerante: devuelve `fallback` si viene vacío,
    mal formado o con un tipo que no es el esperado."""
    if not raw:
        return fallback
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        return fallback
    return value if isinstance(value, type(fallback)) else fallback


def _drug_names(rx_list) -> list:
    """Nombres de los fármacos de una receta. La receta puede traer dicts o
    cadenas sueltas — misma tolerancia que routes/safety.py:compute_alerts."""
    names = []
    for item in rx_list or []:
        name = item.get("drug") if isinstance(item, dict) else item
        if isinstance(name, str) and name.strip():
            names.append(name.strip())
    return names


def _short_name(name: str) -> str:
    parts = name.split()
    if len(parts) <= 2:
        return name
    return f"{parts[0]} {parts[1][0]}. {parts[-2]}"


@router.get("/patients")
def list_patients(user: dict = Depends(require_user)):
    with db() as conn:
        # Solo la agenda de ESTE médico (multi-tenencia). Espontáneos (sin hora)
        # al final; el resto por hora de cita.
        rows = conn.execute(
            "SELECT * FROM patients WHERE doctor_id = ? "
            "ORDER BY (time IS NULL OR time = ''), time",
            (doctor_of(user),),
        ).fetchall()
        # Motivo de HOY para la agenda. `reason` es el del alta y se queda ahí para
        # siempre; la agenda lo mostraba aunque el médico ya hubiera escrito otro
        # al abrir la consulta. Se toma del borrador abierto de hoy y, si no lo
        # hay, de la cita pendiente. Sin nada de eso, cadena vacía: la UI decide
        # qué enseñar y cómo etiquetarlo.
        hoy = _now()[:10]
        abiertos = {r["patient_id"]: (r["id"], r["motivo"] or "") for r in conn.execute(
            "SELECT patient_id, id, motivo FROM consultations "
            "WHERE status = 'draft' AND substr(started_at, 1, 10) = ? "
            "ORDER BY started_at", (hoy,))}
        citas = {r["patient_id"]: r["reason"] or "" for r in conn.execute(
            "SELECT patient_id, reason FROM appointments "
            "WHERE status = 'pendiente' AND scheduled_date = ? ORDER BY time", (hoy,))}
    out = []
    for r in rows:
        d = _row_to_patient(r)
        cid, motivo = abiertos.get(d["id"], (None, ""))
        d["consulta_abierta_id"] = cid
        d["motivo_hoy"] = motivo or citas.get(d["id"], "")
        out.append(d)
    return out


@router.post("/patients")
def create_patient(body: PatientCreate, user: dict = Depends(require_user)):
    from ..services.age_engine import fecha_contradice_edad

    pid = "P-" + uuid.uuid4().hex[:6].upper()
    is_cita = body.kind == "cita"
    time = (body.time or "") if is_cita else ""
    scheduled = body.scheduled_date if is_cita else None
    # Una fecha de nacimiento que contradice la edad escrita no se guarda: el
    # selector de fecha puede quedarse con «hoy» sin que nadie lo elija, y con
    # la fecha guardada todo el sistema trataría al adulto como lactante.
    birthdate = None if fecha_contradice_edad(body.birthdate, body.age) else body.birthdate
    with db() as conn:
        conn.execute(
            """INSERT INTO patients
               (id, name, short, curp, nss, age, sex, time, status, reason, last,
                allergies, chronic, scheduled_date, kind, created_at, email, phone,
                birthdate, gestacional_semanas, doctor_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                pid, body.name, _short_name(body.name), body.curp or "", body.nss or "",
                body.age, body.sex, time, "esperando", body.reason, "Primera vez",
                json.dumps([], ensure_ascii=False), json.dumps([], ensure_ascii=False),
                scheduled, body.kind, _now(), body.email or "", body.phone or "",
                birthdate, body.gestacional_semanas, doctor_of(user),
            ),
        )
        r = conn.execute("SELECT * FROM patients WHERE id = ?", (pid,)).fetchone()
    return _row_to_patient(r)


@router.get("/patients/{patient_id}")
def get_patient(patient_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        r = owned_patient(conn, patient_id, user)
    return _row_to_patient(r)


@router.get("/patients/{patient_id}/consultations")
def patient_consultations(patient_id: str, user: dict = Depends(require_user)):
    """Historial de consultas del paciente (más reciente primero), con su nota."""
    with db() as conn:
        owned_patient(conn, patient_id, user)
        rows = conn.execute(
            """SELECT id, status, started_at, finalized_at, final_soap, soap
               FROM consultations WHERE patient_id = ? AND status != 'radiologia'
               ORDER BY started_at DESC""",
            (patient_id,),
        ).fetchall()
    out = []
    for r in rows:
        raw = r["final_soap"] or r["soap"]
        out.append({
            "id": r["id"],
            "status": r["status"],
            "started_at": r["started_at"],
            "finalized_at": r["finalized_at"],
            "finalized": bool(r["final_soap"]),
            "soap": json.loads(raw) if raw else None,
        })
    return out


@router.get("/patients/{patient_id}/vitals")
def patient_vitals(patient_id: str, user: dict = Depends(require_user)):
    """Tendencia de signos vitales del paciente a lo largo de sus consultas."""
    with db() as conn:
        owned_patient(conn, patient_id, user)
        rows = conn.execute(
            """SELECT id, started_at, finalized_at, vitals, clinical_facts
               FROM consultations WHERE patient_id = ? AND status != 'radiologia' ORDER BY started_at DESC""",
            (patient_id,),
        ).fetchall()
    out = []
    for r in rows:
        v = None
        if r["vitals"]:
            v = json.loads(r["vitals"])
        elif r["clinical_facts"]:
            cf = json.loads(r["clinical_facts"])
            v = cf.get("signos_vitales") or None
        if v:
            out.append({"consultation_id": r["id"], "date": r["finalized_at"] or r["started_at"], "vitals": v})
    return out


@router.patch("/patients/{patient_id}/profile")
def update_patient_profile(patient_id: str, body: PatientProfileUpdate,
                           user: dict = Depends(require_user)):
    """Actualiza el perfil médico (alergias/crónicos). Se llama tras la consulta
    cuando el médico aprueba la nota: su aprobación es el visto bueno para
    persistir lo escuchado al expediente del paciente."""
    with db() as conn:
        owned_patient(conn, patient_id, user)
        sets, vals = [], []
        if body.allergies is not None:
            sets.append("allergies = ?")
            vals.append(json.dumps(body.allergies, ensure_ascii=False))
        if body.chronic is not None:
            sets.append("chronic = ?")
            vals.append(json.dumps(body.chronic, ensure_ascii=False))
        if sets:
            vals.append(patient_id)
            conn.execute(f"UPDATE patients SET {', '.join(sets)} WHERE id = ?", vals)
        r = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    return _row_to_patient(r)


class PreconsultaReq(BaseModel):
    """Motivo de la visita. Va en el CUERPO y no en la URL a propósito: es
    información clínica del paciente y en la query string acabaría en los
    registros de acceso (los del servidor y los del túnel de Cloudflare).

    `consultation_id` sí puede viajar por GET: es un identificador, no PHI."""
    motivo: str | None = None
    consultation_id: str = ""
    personalizar: bool = True


@router.post("/patients/{patient_id}/preconsulta")
def preconsulta_con_motivo(patient_id: str, body: PreconsultaReq,
                           user: dict = Depends(require_user)):
    """Igual que el GET, pero afinando por el MOTIVO que el médico acaba de
    escribir: quien llega por dolor de rodilla no debe recibir las mismas
    sugerencias que quien llega por tos. Es la vía que usa la app."""
    return _preconsulta(patient_id, 1 if body.personalizar else 0,
                        body.motivo, body.consultation_id, user)


@router.get("/patients/{patient_id}/preconsulta")
def preconsulta(patient_id: str, personalizar: int = 1, consultation_id: str = "",
                user: dict = Depends(require_user)):
    """Sugerencias de qué preguntar/revisar ANTES de la consulta, según edad e
    historial (motor de edad determinista + Gemma redacta/prioriza). MEGI
    sugiere; el médico decide. `personalizar=0` devuelve solo el motor base.

    Sin motivo escrito: se resuelve el de la consulta o el de la cita. Para
    mandar un motivo, se usa el POST (no la URL)."""
    return _preconsulta(patient_id, personalizar, None, consultation_id, user)


def _preconsulta(patient_id: str, personalizar: int, motivo: str | None,
                 consultation_id: str, user: dict):
    from ..config import REAL_ASR
    from ..services import age_engine, asr_client, motivo_engine

    with db() as conn:
        r = owned_patient(conn, patient_id, user)
        # Ventana de historial reciente: es lo que alimenta las sugerencias y el
        # "último dx / última receta". Cinco basta y acota el prompt.
        cons = conn.execute(
            """SELECT status, final_soap, soap, prescription, dx_codes
               FROM consultations WHERE patient_id = ? AND status != 'radiologia' ORDER BY started_at DESC LIMIT 5""",
            (patient_id,),
        ).fetchall()
        # El TOTAL se cuenta aparte. Usar len() de la ventana le decía
        # "5 consultas previas" al LLM a cualquier paciente con historial largo.
        total_consultas = conn.execute(
            "SELECT COUNT(*) AS n FROM consultations WHERE patient_id = ? AND status != 'radiologia'",
            (patient_id,),
        ).fetchone()["n"]
        # Motivo de HOY. `patients.reason` es el del alta y puede tener meses:
        # preparar al LLM con el motivo viejo es prepararlo para otra consulta.
        # El motivo puede llegar de tres sitios, por orden de cercanía a HOY:
        # lo que el médico acaba de escribir, la consulta ya creada, o la cita.
        # El primero es imprescindible: la consulta se crea de forma DIFERIDA
        # (solo al empezar a grabar), así que cuando esta pantalla se pinta
        # todavía no existe y `consultation_id` viene vacío.
        motivo_hoy = (motivo or "").strip()
        if not motivo_hoy and consultation_id:
            f = conn.execute("SELECT motivo FROM consultations WHERE id = ? AND patient_id = ?",
                             (consultation_id, patient_id)).fetchone()
            motivo_hoy = (f["motivo"] if f else "") or ""
        if not motivo_hoy:
            f = conn.execute(
                "SELECT reason FROM appointments WHERE patient_id = ? AND status = 'pendiente' "
                "ORDER BY scheduled_date, time LIMIT 1", (patient_id,)).fetchone()
            motivo_hoy = (f["reason"] if f else "") or ""
    patient = _row_to_patient(r)
    # Un campo corrupto no debe descartar la consulta entera: si se cae la más
    # reciente, `ultimo_dx`/`ultima_rx` pasan a ser los de una consulta más vieja
    # sin que se note, y un paciente con historial puede aparecer como primera
    # visita (age_engine sugiere "historia clínica completa" cuando no hay ninguna).
    consultas = [
        {
            "soap": _load_json(c["final_soap"] or c["soap"], {}),
            "prescription": _load_json(c["prescription"], []),
            "dx_codes": _load_json(c["dx_codes"], []),
        }
        for c in cons
    ]

    base = age_engine.preconsulta_base(patient, consultas)

    # El motivo manda sobre la edad: lo que trae hoy al paciente va primero, y
    # dentro de eso las banderas rojas. Un motivo no reconocido no aporta nada
    # (mejor eso que inventar preguntas sobre un texto que no entendemos).
    # Se usa `motivo_hoy` y no el parámetro crudo: así el motivo que viene de la
    # consulta ya creada o de la cita también dispara sus banderas rojas.
    por_motivo = motivo_engine.sugerencias_por_motivo(motivo_hoy)
    if por_motivo["sugerencias"]:
        base["sugerencias"] = por_motivo["sugerencias"] + base["sugerencias"]

    # Preguntas que el MODELO propone sobre el motivo escrito (21-sep). Antes,
    # un motivo fuera de las 17 guías de `motivo_engine` no aportaba nada y el
    # médico veía solo lo de edad: parecía que el panel ignoraba lo que escribió.
    # Van en lista APARTE y con fuente propia: las banderas rojas deterministas
    # siguen mandando y estas se presentan como propuesta, no como guía.
    resumen = None
    preguntas_motivo: list = []
    if personalizar and REAL_ASR:
        try:
            # Edad explícita además del grupo: el LLM no debe deducirla de una
            # etiqueta (y así se ve enseguida si el motor la calculó mal).
            ctx = {
                "edad": age_engine.edad_texto(base["edad"]),
                "edad_label": base["grupo_label"],
                "sexo": patient.get("sex"),
                "motivo_de_hoy": motivo_hoy or patient.get("reason") or "",
                "cronicos": patient.get("chronic") or [],
                "alergias": patient.get("allergies") or [],
                "consultas_previas": total_consultas,
                "ultimo_dx": (consultas[0]["dx_codes"] if consultas else []),
                "ultima_rx": (_drug_names(consultas[0]["prescription"]) if consultas else []),
            }
            base_txt = [f"- {s['texto']} ({s['razon']})" for s in base["sugerencias"]]
            r2 = asr_client.preconsulta_personalize(ctx, base_txt)
            if r2.get("status") == "done":
                resumen = r2.get("resumen")
                if r2.get("prioridad"):
                    base["prioridad_llm"] = r2["prioridad"]
                if motivo_hoy:
                    preguntas_motivo = motivo_engine.desde_llm(
                        r2.get("preguntas_motivo"), motivo_hoy, base["sugerencias"])
        except Exception:
            pass

    return {
        "paciente": {"id": patient["id"], "name": patient["name"], "sex": patient.get("sex")},
        "edad": base["edad"], "grupo": base["grupo"], "grupo_label": base["grupo_label"],
        "sugerencias": base["sugerencias"],
        "preguntas_motivo": preguntas_motivo,
        "motivo_de_hoy": motivo_hoy,
        "motivo": por_motivo["motivo"],
        "motivo_reconocido": por_motivo["etiquetas"],
        "resumen": resumen,
        "nota": "Sugerencias por edad e historial (Cartillas Nacionales/GPC/USPSTF). El médico decide qué preguntar.",
    }
