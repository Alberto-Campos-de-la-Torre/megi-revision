import html
import json
import os
import subprocess
import uuid
from datetime import datetime, timezone

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ..ownership import doctor_of, owned_consultation, owned_patient
from ..security import require_user
from ..uploads import safe_session_dir
from ..db import db
from ..schemas import ConsultationCreate, ConsultationPatch

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/consultations")
def create_consultation(body: ConsultationCreate, user: dict = Depends(require_user)):
    cid = "C-" + uuid.uuid4().hex[:8]
    with db() as conn:
        owned_patient(conn, body.patient_id, user)
        motivo = (body.motivo or "").strip()
        # Si el médico ya había empezado esta consulta y volvió (se salió, se
        # recargó la página, atendió una llamada), se RETOMA la misma en vez de
        # crear otra. Solo borradores de HOY y sin transcripción: uno que ya
        # tiene audio es una consulta en curso, no un arranque repetido.
        abierta = conn.execute(
            "SELECT id, motivo FROM consultations "
            "WHERE patient_id = ? AND status = 'draft' "
            "AND (transcript IS NULL OR transcript = '') "
            "AND substr(started_at, 1, 10) = substr(?, 1, 10) "
            "ORDER BY started_at DESC LIMIT 1",
            (body.patient_id, _now()),
        ).fetchone()

        if body.solo_retomar and not abierta:
            raise HTTPException(status_code=404, detail="no hay consulta abierta para retomar")

        # Un borrador VACÍO se corrige, no se duplica (cambiar el motivo antes de
        # grabar es corregirlo). Pero uno que ya tiene nota o estudios subidos
        # está en curso: «Nueva consulta» por cefalea no debe pisarlo (pasó el
        # 11-oct: se sobrescribió el motivo de la consulta de dolor de garganta y
        # sus estudios quedaron colgados de una consulta que ya no era la suya).
        if abierta and not body.solo_retomar:
            en_curso = conn.execute(
                "SELECT (SELECT count(*) FROM estudios_aportados WHERE consultation_id = ?) "
                "+ (SELECT CASE WHEN soap IS NOT NULL AND soap != '' THEN 1 ELSE 0 END FROM consultations WHERE id = ?)",
                (abierta["id"], abierta["id"])).fetchone()[0]
            if en_curso:
                abierta = None

        # Resolución del motivo, de lo más cercano a HOY a lo más lejano. El
        # orden importa: el borrador va ANTES que `patients.reason`, porque es lo
        # que el médico escribió para ESTA consulta. Tenerlo detrás hacía que
        # volver a entrar pisara «diarrea de dos días» con el motivo del alta.
        if not motivo and abierta:
            motivo = (abierta["motivo"] or "")
        if not motivo:
            # Agendar ya exige motivo: si viene de una cita, no se le pregunta otra vez.
            cita = conn.execute(
                "SELECT reason FROM appointments WHERE patient_id = ? AND status = 'pendiente' "
                "ORDER BY scheduled_date, time LIMIT 1", (body.patient_id,)).fetchone()
            motivo = (cita["reason"] if cita else "") or ""
        if not motivo:
            # Un paciente dado de alta HOY viene por el motivo con el que se le
            # registró: ahí `patients.reason` sí es el de hoy. En uno antiguo no
            # — ese es justo el dato viejo que hay que dejar de usar.
            nuevo = conn.execute(
                "SELECT reason FROM patients WHERE id = ? "
                "AND substr(COALESCE(created_at,''), 1, 10) = substr(?, 1, 10)",
                (body.patient_id, _now())).fetchone()
            motivo = (nuevo["reason"] if nuevo else "") or ""
        if not motivo:
            # Sin motivo, MEGI prepara la consulta a ciegas: ni las sugerencias
            # previas ni el encuadre del SOAP tienen de dónde partir.
            raise HTTPException(
                status_code=400,
                detail="Falta el motivo de la consulta. Ábrela desde el expediente "
                       "del paciente para indicar a qué viene hoy.")

        if abierta:
            cid = abierta["id"]
            conn.execute("UPDATE consultations SET motivo = ?, updated_at = ? WHERE id = ?",
                         (motivo, _now(), cid))
        else:
            conn.execute(
                "INSERT INTO consultations (id, patient_id, status, started_at, updated_at, doctor_id, motivo) "
                "VALUES (?,?,?,?,?,?,?)",
                (cid, body.patient_id, "draft", _now(), _now(), doctor_of(user), motivo),
            )
        # La agenda refleja que el paciente está en consulta.
        conn.execute("UPDATE patients SET status = 'en-consulta' WHERE id = ?", (body.patient_id,))
    return {"id": cid, "patient_id": body.patient_id, "status": "draft", "motivo": motivo,
            "retomada": bool(abierta)}


@router.get("/consultations/{consultation_id}")
def get_consultation(consultation_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        r = owned_consultation(conn, consultation_id, user)
    if not r:
        raise HTTPException(status_code=404, detail="consulta no encontrada")
    return dict(r)


@router.patch("/consultations/{consultation_id}")
def patch_consultation(consultation_id: str, body: ConsultationPatch,
                       user: dict = Depends(require_user)):
    with db() as conn:
        r = owned_consultation(conn, consultation_id, user)
        if not r:
            raise HTTPException(status_code=404, detail="consulta no encontrada")
        if body.status:
            conn.execute(
                "UPDATE consultations SET status = ?, updated_at = ? WHERE id = ?",
                (body.status, _now(), consultation_id),
            )
        r = owned_consultation(conn, consultation_id, user)
    return dict(r)


@router.get("/consultations/{consultation_id}/audio.wav")
def consultation_audio(consultation_id: str, user: dict = Depends(require_user)):
    """Audio de la consulta para reproducir: une los segmentos (wav 16k) en orden."""
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        rows = conn.execute(
            "SELECT asr_wav_path FROM audio WHERE consultation_id = ? ORDER BY created_at",
            (consultation_id,),
        ).fetchall()
    paths = [r["asr_wav_path"] for r in rows if r["asr_wav_path"] and os.path.exists(r["asr_wav_path"])]
    if not paths:
        raise HTTPException(status_code=404, detail="sin audio para esta consulta")
    if len(paths) == 1:
        return FileResponse(paths[0], media_type="audio/wav")

    out = safe_session_dir(consultation_id) / "playback.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    # Reconstruir si falta o si cambió el número de segmentos.
    stamp = out.parent / "playback.count"
    cur = str(len(paths))
    if not out.exists() or not stamp.exists() or stamp.read_text() != cur:
        listfile = out.parent / "concat.txt"
        listfile.write_text("".join(f"file '{p}'\n" for p in paths), encoding="utf-8")
        proc = subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listfile),
             "-ar", "16000", "-ac", "1", str(out)],
            capture_output=True,
        )
        if proc.returncode != 0 or not out.exists():
            raise HTTPException(status_code=500, detail="no se pudo unir el audio")
        stamp.write_text(cur)
    return FileResponse(str(out), media_type="audio/wav", filename=f"{consultation_id}.wav")


def _J(v):
    try:
        return json.loads(v) if v else None
    except Exception:
        return None


def _fhir_bundle(c: dict, patient: dict) -> dict:
    """Bundle FHIR R4 (aproximado) de la consulta: base para intercambio /
    NOM-024. Incluye Patient, Encounter, Condition (dx), MedicationRequest (rx),
    Observation (vitales) y Composition (nota SOAP)."""
    ref = "Patient/" + (patient.get("id") or "unknown")
    soap = _J(c.get("approved_soap")) or _J(c.get("final_soap")) or {}
    dx = _J(c.get("dx_codes")) or []
    rx = _J(c.get("prescription")) or []
    vit = _J(c.get("vitals")) or {}

    telecom = []
    if patient.get("email"):
        telecom.append({"system": "email", "value": patient["email"]})
    if patient.get("phone"):
        telecom.append({"system": "phone", "value": patient["phone"]})
    ident = [x for x in [
        {"system": "urn:CURP", "value": patient.get("curp")} if patient.get("curp") else None,
        {"system": "urn:NSS", "value": patient.get("nss")} if patient.get("nss") else None,
    ] if x]

    def _div(text):
        return f'<div xmlns="http://www.w3.org/1999/xhtml">{html.escape(text or "—")}</div>'

    # Bundle 'document' FHIR: la PRIMERA entrada DEBE ser la Composition.
    entries = [
        {"resource": {
            "resourceType": "Composition", "id": "nota-" + c["id"], "status": "final",
            "type": {"text": "Nota médica (SOAP) NOM-004"}, "subject": {"reference": ref},
            "date": c.get("approved_at") or c.get("finalized_at"),
            "author": [{"display": c.get("approved_by") or "MEGI"}], "title": "Nota médica",
            "section": [{"title": k, "text": {"status": "generated", "div": _div(soap.get(k, ""))}} for k in ("S", "O", "A", "P")],
        }},
        {"resource": {
            "resourceType": "Patient", "id": patient.get("id"),
            "name": [{"text": patient.get("name")}],
            "gender": "female" if patient.get("sex") == "F" else "male",
            "identifier": ident, "telecom": telecom,
        }},
        {"resource": {
            "resourceType": "Encounter", "id": c["id"], "status": "finished",
            "subject": {"reference": ref},
            "period": {"start": c.get("started_at"), "end": c.get("finalized_at")},
        }},
    ]
    for i, d in enumerate(dx):
        entries.append({"resource": {
            "resourceType": "Condition", "id": f"dx-{i}", "subject": {"reference": ref},
            "code": {"coding": [{"system": "http://hl7.org/fhir/sid/icd-10", "code": d.get("code"), "display": d.get("label")}], "text": d.get("label")},
        }})
    for i, r in enumerate(rx):
        dosage = " ".join(x for x in [r.get("dose"), r.get("freq")] if x)
        entries.append({"resource": {
            "resourceType": "MedicationRequest", "id": f"rx-{i}", "status": "active", "intent": "order",
            "subject": {"reference": ref}, "medicationCodeableConcept": {"text": r.get("drug")},
            "dosageInstruction": ([{"text": dosage}] if dosage else []),
        }})
    vmap = {"ta": "Tensión arterial", "fc": "Frecuencia cardiaca", "fr": "Frecuencia respiratoria",
            "temp": "Temperatura", "spo2": "Saturación O2", "peso": "Peso", "talla": "Talla", "imc": "IMC"}
    for k, name in vmap.items():
        if vit.get(k):
            entries.append({"resource": {
                "resourceType": "Observation", "id": f"vital-{k}", "status": "final",
                "subject": {"reference": ref}, "code": {"text": name}, "valueString": str(vit[k]),
            }})
    return {"resourceType": "Bundle", "type": "document",
            "timestamp": c.get("approved_at") or c.get("finalized_at"), "entry": entries}


@router.get("/consultations/{consultation_id}/fhir")
def consultation_fhir(consultation_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        c = owned_consultation(conn, consultation_id, user)
        if not c:
            raise HTTPException(status_code=404, detail="consulta no encontrada")
        c = dict(c)
        p = conn.execute("SELECT * FROM patients WHERE id = ?", (c["patient_id"],)).fetchone()
        patient = dict(p) if p else {}
    return _fhir_bundle(c, patient)


@router.get("/consultations/{consultation_id}/audit")
def consultation_audit(consultation_id: str, user: dict = Depends(require_user)):
    """Auditoría completa de una consulta: nota IA vs nota del médico (qué editó),
    receta, dx, quién aprobó/firmó y cuándo, fuentes, validación, línea de tiempo,
    conteos y transcripción."""
    with db() as conn:
        c = owned_consultation(conn, consultation_id, user)
        if not c:
            raise HTTPException(status_code=404, detail="consulta no encontrada")
        c = dict(c)
        p = conn.execute("SELECT name, curp, nss, age, sex FROM patients WHERE id = ?", (c["patient_id"],)).fetchone()
        patient = dict(p) if p else {}
        events = [dict(r) for r in conn.execute(
            "SELECT kind, actor, created_at, payload FROM review_events WHERE consultation_id = ? ORDER BY created_at",
            (consultation_id,)).fetchall()]
        exports = [dict(r) for r in conn.execute(
            "SELECT kind, content_hash, signature, signed_at FROM exports WHERE consultation_id = ? ORDER BY id",
            (consultation_id,)).fetchall()]
        patches = conn.execute(
            "SELECT rag_context FROM soap_patches WHERE consultation_id = ? ORDER BY id",
            (consultation_id,)).fetchall()
        n_audio = conn.execute(
            "SELECT COUNT(*) AS n FROM audio WHERE consultation_id = ?", (consultation_id,)).fetchone()["n"]
        docs = [dict(r) for r in conn.execute(
            "SELECT kind, content_hash, created_by, created_at FROM documents WHERE consultation_id = ? ORDER BY id",
            (consultation_id,)).fetchall()]

    ai = _J(c.get("final_soap")) or {}
    doctor = _J(c.get("approved_soap"))
    edited, changed = None, []
    if doctor is not None:
        edited = False
        for k in ("S", "O", "A", "P"):
            if (ai.get(k) or "").strip() != (doctor.get(k) or "").strip():
                edited = True
                changed.append(k)

    seen, sources = set(), []
    for pr in patches:
        rc = _J(pr["rag_context"]) or {}
        for s in (rc.get("sources") or []):
            key = s.get("citation") or s.get("citation_id")
            if key and key not in seen:
                seen.add(key)
                sources.append(s)

    safety = None
    for e in reversed(events):
        if e["kind"] == "approve":
            pl = _J(e["payload"]) or {}
            safety = {"alerts": pl.get("safety_alerts") or [], "ack": pl.get("safety_ack")}
            break

    # La nota de la aprobación (quién aprobó desde la mesa de revisión, versión
    # revisada, advertencias vigentes) forma parte de la auditoría visible, no
    # solo del payload almacenado: así la identidad real queda a la vista aunque
    # `approved_by` sea una cuenta de servicio.
    def _nota(e):
        if e["kind"] != "approve":
            return None
        pl = _J(e["payload"]) or {}
        n = pl.get("notes")
        return n if isinstance(n, str) and n.strip() else None
    timeline = [{"at": e["created_at"], "kind": e["kind"], "actor": e["actor"],
                 **({"note": _nota(e)} if _nota(e) else {})} for e in events]
    for e in exports:
        timeline.append({"at": e["signed_at"], "kind": "sello_exportacion", "actor": None,
                         "hash": e["content_hash"]})
    timeline.sort(key=lambda x: x["at"] or "")
    seal = exports[-1] if exports else None

    return {
        "consultation": {
            "id": c["id"], "status": c["status"], "started_at": c["started_at"],
            "finalized_at": c["finalized_at"], "approved_at": c.get("approved_at"),
            "approved_by": c.get("approved_by"),
        },
        "patient": {"id": c["patient_id"], "name": patient.get("name"), "curp": patient.get("curp"),
                    "nss": patient.get("nss"), "age": patient.get("age"), "sex": patient.get("sex")},
        "note": {"ai": ai, "doctor": doctor, "edited": edited, "changed_sections": changed},
        "prescription": _J(c.get("prescription")) or [],
        "dx": _J(c.get("dx_codes")) or [],
        "validation": _J(c.get("validation_flags")),
        "clinical_facts": _J(c.get("clinical_facts")),
        "sources": sources,
        "signer": {
            "by": c.get("approved_by"), "at": c.get("approved_at"),
            "seal_hash": seal["content_hash"] if seal else None,
            "seal_at": seal["signed_at"] if seal else None,
            "signature": seal["signature"] if seal else None,
        },
        "documents": docs,
        "safety": safety,
        "timeline": timeline,
        "counts": {"soap_patches": len(patches), "audio_segments": n_audio},
        "transcript": c.get("transcript") or "",
        "has_audio": n_audio > 0,
    }



class PreguntaConsultaReq(BaseModel):
    pregunta: str
    historial: list[dict] = []
    # Lo que el médico está editando ahora en Revisión, para que Megi IA vea la
    # nota «limpia» tal como va quedando (no solo la guardada).
    soap: dict | None = None
    dx: list | None = None
    rx: list | None = None


@router.post("/consultations/{consultation_id}/preguntar")
def preguntar_consulta(consultation_id: str, body: PreguntaConsultaReq, user: dict = Depends(require_user)):
    """Megi IA sobre ESTA consulta y ESTE paciente (revisión): transcripción,
    SOAP automático y limpio, dx, receta, estudios y consultas previas; con el
    servicio MLX, además guías (RAG). Mismas reglas que el chat de guías."""
    from ..services import consulta_contexto
    pregunta = (body.pregunta or "").strip()
    if not pregunta:
        return {"respuesta": "", "fuentes": [], "fuente": "mock", "error": "pregunta vacía"}
    historial = [h for h in (body.historial or []) if isinstance(h, dict) and (h.get("texto") or "").strip()][-6:]
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        r = consulta_contexto.preguntar(conn, consultation_id, pregunta, historial, body.soap, body.dx, body.rx)
    return {"pregunta": pregunta, **r,
            "aviso": "Apoyo a la revisión: solo con los datos de esta consulta, el expediente de este paciente y las guías; el médico decide."}
