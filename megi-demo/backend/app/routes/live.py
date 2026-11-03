"""Chunked-batch (fuente de verdad) + SOAP agéntico incremental.

Flujo: el frontend envía segmentos de ~10s (con solape) -> ASR v1.5 batch por chunk
-> stitch (dedup overlap) -> transcript confirmado acumulado -> gemma actualiza SOAP.
El SOAP consume SOLO texto confirmado por chunked-batch (nunca el rolling-window).
"""
from __future__ import annotations

import json
import re
import subprocess
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..audio_meta import audit_meta
from ..config import REAL_ASR, load_seed
from ..ownership import owned_consultation
from ..uploads import MAX_CHUNK_AUDIO_BYTES, read_capped, safe_session_dir, safe_suffix
from ..db import db
from ..security import require_user
from ..services import (asr_client, consult_gaps, dx_reconciler,
                        facts_validator, med_reconciler, rehab, speaker_profile)
from ..services.wake_scrub import scrub_wake_phrases

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm(w: str) -> str:
    w = unicodedata.normalize("NFKD", w.lower())
    w = "".join(c for c in w if not unicodedata.combining(c))
    return re.sub(r"[^\w]", "", w)


# alucinaciones típicas de Whisper en silencio (al cerrar un chunk)
_HALLUCINATIONS = {"gracias", "graciasporver", "subtitulosrealizadosporlacomunidaddeamaraorg",
                   "muchasgracias", "graciasporveryhastalaproxima"}


def _clean_chunk(text: str) -> str:
    """Quita alucinaciones de Whisper al final del chunk (silencio -> 'Gracias.')."""
    text = (text or "").strip()
    # quita frases finales tipo "Subtítulos realizados por..."
    text = re.sub(r"\b[Ss]ubt[íi]tulos?\b.*$", "", text).strip()
    parts = re.split(r"(?<=[.!?])\s+", text)
    while parts and _norm(parts[-1]) in _HALLUCINATIONS:
        parts.pop()
    return " ".join(parts).strip()


_NUMWORDS = {"cero": "0", "uno": "1", "una": "1", "dos": "2", "tres": "3", "cuatro": "4",
             "cinco": "5", "seis": "6", "siete": "7", "ocho": "8", "nueve": "9", "diez": "10"}


def _norm_num(sent: str) -> str:
    """Normaliza para comparar dedup: minúsculas, sin acentos/puntuación y números
    en palabra -> dígito ('cuatro'->'4'), para que 'de las 4' == 'de las cuatro'."""
    return "".join(_norm(_NUMWORDS.get(w.lower(), w)) for w in sent.split())


def _collapse_dups(text: str) -> str:
    """Colapsa oraciones consecutivas casi idénticas (el ASR repite el solape distinto:
    'de las 4' vs 'de las cuatro', 'Deambulación' vs 'Embolación independiente')."""
    import difflib
    sents = re.split(r"(?<=[.!?])\s+", text)
    out = []
    for s in sents:
        ns = _norm_num(s)
        if out and ns and difflib.SequenceMatcher(a=_norm_num(out[-1]), b=ns).ratio() >= 0.8:
            if len(s) > len(out[-1]):   # conserva la oración más completa
                out[-1] = s
            continue
        out.append(s)
    return " ".join(out).strip()


def stitch(acc: str, new: str) -> str:
    """Une transcript acumulado + nuevo chunk eliminando el solape repetido."""
    acc = (acc or "").strip()
    new = _clean_chunk(new)
    if not acc:
        return _collapse_dups(new)
    if not new:
        return acc
    a, b = acc.split(), new.split()
    na, nb = [_norm(x) for x in a], [_norm(x) for x in b]
    max_ov = min(len(na), len(nb), 25)
    best = 0
    for k in range(max_ov, 0, -1):
        if na[-k:] == nb[:k]:
            best = k
            break
    return _collapse_dups((acc + " " + " ".join(b[best:])).strip())


def _to_wav16k(src: Path, dst: Path) -> None:
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-ar", "16000", "-ac", "1", str(dst)],
        capture_output=True,
    )
    if proc.returncode != 0 or not dst.exists():
        raise HTTPException(status_code=500, detail=f"ffmpeg fallo: {proc.stderr.decode()[-200:]}")


@router.post("/audio/chunk")
async def audio_chunk(
    file: UploadFile = File(...),
    consultation_id: str = Form(...),
    chunk_idx: int = Form(0),
    user: dict = Depends(require_user),
):
    with db() as conn:
        owned_consultation(conn, consultation_id, user)   # no se graba en consulta ajena
    aid = f"chunk-{chunk_idx:04d}-" + uuid.uuid4().hex[:6]
    # El id lo elige el cliente: validado y contenido en SESSIONS_DIR (ver uploads.py).
    dest = safe_session_dir(consultation_id, "chunks", aid)
    dest.mkdir(parents=True, exist_ok=True)
    ext = safe_suffix(file.filename, default=".wav")
    orig = dest / f"original{ext}"
    orig.write_bytes(await read_capped(file, MAX_CHUNK_AUDIO_BYTES, "El fragmento de audio"))
    wav = dest / "chunk_16k.wav"
    _to_wav16k(orig, wav)

    # Fase 10B: si el médico tiene huella enrolada, los segmentos del chunk se
    # puntúan contra ella y se etiquetan MÉDICO/OTRO (el transcript plano que
    # alimenta al SOAP NO cambia; las etiquetas viajan en paralelo).
    profile = speaker_profile.load_profile(user.get("username")) if REAL_ASR else None
    speaker_segments = None
    if REAL_ASR:
        try:
            r = asr_client.transcribe_file(str(wav), consultation_id,
                                           speaker_ref=(profile or {}).get("embedding"))
            chunk_text = (r.get("normalized_text") or r.get("transcript") or "").strip()
            status, model = "done", r.get("model")
            if profile and isinstance(r.get("segments"), list):
                speaker_segments = [{
                    "start": s.get("start"), "end": s.get("end"), "text": s.get("text"),
                    "speaker": speaker_profile.label_for_score(profile, s.get("speaker_score")),
                    "score": s.get("speaker_score"),
                } for s in r["segments"]]
        except Exception as e:
            chunk_text, status, model = "", "error", None
            r = {"error": str(e)}
    else:
        seed = load_seed()
        lines = [l["text"] for l in seed["TRANSCRIPT"]]
        chunk_text = lines[chunk_idx % len(lines)]
        status, model = "mock", "mock"

    # Airbag (Fase 7): frases de comando "MEGI, ..." se filtran ANTES del stitch,
    # así jamás entran al transcript confirmado ni al LLM del SOAP. El transcript
    # CRUDO del chunk se conserva en la fila de audio (auditoría).
    raw_chunk_text = chunk_text
    chunk_text, wake_hits = scrub_wake_phrases(chunk_text)

    with db() as conn:
        row = conn.execute("SELECT transcript FROM consultations WHERE id = ?", (consultation_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="consulta no encontrada (créala primero)")
        acc = row["transcript"] or ""
        new_acc = stitch(acc, chunk_text)
        added = new_acc[len(acc):].strip()
        conn.execute("UPDATE consultations SET transcript = ?, updated_at = ? WHERE id = ?",
                     (new_acc, _now(), consultation_id))
        classification = audit_meta("chunk", uploaded_by=user.get("username"))
        conn.execute(
            """INSERT INTO audio (id, consultation_id, audio_kind, asr_wav_path,
               transcription_status, transcript, model, asr_mode, created_at,
               uploaded_by, purpose, retention, speaker_segments)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (aid, consultation_id, "chunk", str(wav), status, raw_chunk_text, model,
             "real" if REAL_ASR else "mock", _now(),
             classification["uploaded_by"], classification["purpose"], classification["retention"],
             json.dumps(speaker_segments, ensure_ascii=False) if speaker_segments else None),
        )
    return {"chunk_idx": chunk_idx, "chunk_text": chunk_text, "added_text": added,
            "transcript": new_acc, "status": status, "wake_scrubbed": wake_hits > 0,
            "speaker_segments": speaker_segments}


def _frases(texto: str) -> list:
    return [f for f in re.split(r"(?<=[.!?])\s+", (texto or "").strip()) if f]


def _sin_repetidas(previo: str, nuevo: str) -> str:
    """Al ANEXAR, el escriba a veces reenvía frases que la sección ya tiene (medido:
    volvió a mandar el Subjetivo entero en el chunk siguiente y la nota lo mostraba
    dos veces). Se descartan las frases ya presentes, comparando sin acentos,
    mayúsculas ni puntuación; una frase nueva de verdad sí entra."""
    vistas = {_norm_num(f) for f in _frases(previo)}
    keep = []
    for f in _frases(nuevo):
        k = _norm_num(f)
        if k and k not in vistas:
            vistas.add(k)
            keep.append(f)
    return " ".join(keep).strip()


def _apply_patch(soap: dict, patches: list) -> dict:
    soap = dict(soap or {"S": "", "O": "", "A": "", "P": ""})
    for p in patches:
        sec = p.get("section")
        txt = (p.get("text") or "").strip()
        if sec not in ("S", "O", "A", "P") or not txt:
            continue
        if p.get("action") == "upsert" or not soap.get(sec):
            soap[sec] = txt
        else:
            nuevo = _sin_repetidas(soap[sec], txt)
            if nuevo:
                soap[sec] = (soap[sec] + " " + nuevo).strip()
    return soap


@router.post("/soap/update")
def soap_update(body: dict, user: dict = Depends(require_user)):
    cid = body.get("consultation_id")
    new_text = (body.get("new_confirmed_text") or "").strip()
    chunk_idx = body.get("chunk_idx")
    with db() as conn:
        owned_consultation(conn, cid, user)
        row = conn.execute("SELECT soap FROM consultations WHERE id = ?", (cid,)).fetchone()
    cur = json.loads(row["soap"]) if row and row["soap"] else {"S": "", "O": "", "A": "", "P": ""}

    if not REAL_ASR:
        return {"status": "not_configured", "soap": cur, "warnings": ["MEGI_REAL_ASR=false"]}
    if not new_text:
        return {"status": "done", "soap": cur, "patches": [], "warnings": []}
    try:
        res = asr_client.soap_update(new_text, cur, cid, paciente=_ficha_de(cid))
    except Exception as e:
        return {"status": "error", "soap": cur, "warnings": [str(e)]}

    status = res.get("status", "done")
    patches = res.get("soap_patch", []) if status == "done" else []
    warnings_asr = list(res.get("warnings", []))
    if status == "invalid_json" and res.get("raw"):
        # Lo que el LLM contestó se guarda con el parche: sin esto un chunk perdido
        # no se puede diagnosticar después (pasó y no había nada que mirar).
        warnings_asr.append("raw_llm: " + str(res["raw"])[-800:])
    # Citas con id ÚNICO por consulta: el ASR numera S1… por llamada, y la nota
    # acumulada mezclaba chunks (el [S1] de un chunk apuntaba a la fuente de otro).
    sources, patches = _renumerar_citas(cid, res.get("sources", []), patches)
    new_soap = _apply_patch(cur, patches)
    retrieval = res.get("retrieval", {})
    rag_context = json.dumps({"sources": sources, "retrieval": retrieval}, ensure_ascii=False)
    with db() as conn:
        conn.execute("UPDATE consultations SET soap = ?, updated_at = ? WHERE id = ?",
                     (json.dumps(new_soap, ensure_ascii=False), _now(), cid))
        conn.execute(
            "INSERT INTO soap_patches (consultation_id, chunk_idx, patch, warnings, status, rag_context, created_at) VALUES (?,?,?,?,?,?,?)",
            (cid, chunk_idx, json.dumps(patches, ensure_ascii=False),
             json.dumps(warnings_asr, ensure_ascii=False), status, rag_context, _now()),
        )
    return {"status": status, "soap": new_soap, "patches": patches,
            "warnings": res.get("warnings", []), "sources": sources, "retrieval": retrieval,
            "latency_ms": res.get("latency_ms"), "gaps": _gaps_de(cid, new_soap),
            "rehabilitacion": _rehab_de(new_soap),
            "alertas_fda": _alertas_en_vivo(cid)}


def _alertas_en_vivo(cid: str) -> dict:
    """Alertas de seguridad CONFORME AVANZA la consulta: el verificador FDA
    (tabla de contraindicaciones, sin LLM, < 10 ms) recibe la transcripción
    acumulada y la ficha del paciente. Detecta los fármacos MENCIONADOS (no solo
    los recetados: "podría darle prednisona" ya avisa) y las condiciones dichas
    en voz alta, además de crónicos y alergias del expediente. Viaja en la misma
    respuesta que los huecos: cero peticiones extra. Apoyo: si falla, la
    consulta sigue sin enterarse."""
    try:
        with db() as conn:
            row = conn.execute("SELECT transcript FROM consultations WHERE id = ?", (cid,)).fetchone()
        transcript = (row["transcript"] or "").strip() if row else ""
        if not transcript:
            return {"alertas": [], "resumen": {}}
        p = _ficha_de(cid)
        r = asr_client.drugs_check([], conditions=p.get("cronicos") or [], allergies=p.get("alergias") or [],
                                   age=p.get("edad"), sex=p.get("sexo"), context_text=transcript)
        if r.get("status") != "done":
            return {"alertas": [], "resumen": {}, "error": r.get("error")}
        return {"alertas": r.get("alertas", []), "resumen": r.get("resumen", {}),
                "farmacos_detectados": r.get("farmacos_detectados", [])}
    except Exception as e:
        return {"alertas": [], "resumen": {}, "error": str(e)}


_CITA_RE = re.compile(r"\[(S\d+(?:\s*,\s*S\d+)*)\]")


def _registro_citas(cid: str) -> dict:
    """citation (texto) -> id global ("S7") a partir de las fuentes YA guardadas en
    los parches previos de esta consulta, en orden de aparición."""
    reg = {}
    try:
        with db() as conn:
            rows = conn.execute("SELECT rag_context FROM soap_patches WHERE consultation_id = ? ORDER BY id",
                                (cid,)).fetchall()
        for r in rows:
            try:
                for s in (json.loads(r["rag_context"] or "{}").get("sources") or []):
                    if s.get("citation") and s.get("citation_id") and s["citation"] not in reg:
                        reg[s["citation"]] = s["citation_id"]
            except Exception:
                continue
    except Exception:
        pass
    return reg


def _renumerar_citas(cid: str, sources: list, patches: list) -> tuple:
    """Reasigna los S# locales del ASR a ids globales de la consulta y los
    reescribe dentro del texto de cada parche. Una fuente ya citada conserva
    su id; una nueva toma el siguiente. Ids que no correspondan a ninguna
    fuente se eliminan del texto (la validación del ASR ya los descarta)."""
    if not sources and not patches:
        return sources, patches
    reg = _registro_citas(cid)
    usados = set(reg.values())
    mapa, out_sources = {}, []
    for s in sources:
        local, cita = s.get("citation_id"), s.get("citation")
        if not local or not cita:
            continue
        if cita in reg:
            gid = reg[cita]
        else:
            n = len(usados) + 1
            while f"S{n}" in usados:
                n += 1
            gid = f"S{n}"
            reg[cita] = gid
            usados.add(gid)
        mapa[local] = gid
        out_sources.append({**s, "citation_id": gid})

    def _rw(m):
        ids = [mapa[x.strip()] for x in m.group(1).split(",") if x.strip() in mapa]
        return f"[{', '.join(dict.fromkeys(ids))}]" if ids else ""

    out_patches = []
    for p in patches:
        p = dict(p)
        if isinstance(p.get("text"), str):
            p["text"] = re.sub(r"\s+([.,;])", r"\1", _CITA_RE.sub(_rw, p["text"])).strip()
        if isinstance(p.get("citations"), list):
            p["citations"] = [mapa[c] for c in p["citations"] if c in mapa]
        out_patches.append(p)
    return out_sources, out_patches


_BLOQUE_REHAB = re.compile(
    r"(?m)^Rehabilitación · [^\n]*:\n(?:\d+\. [^\n]*\n?)+(?:\(Lado por definir[^\n]*\)\n?)?")


def _conservar_bloques_rehab(en_vivo: dict, final: dict) -> dict:
    """Bloques 'Rehabilitación · <protocolo>:' que están en el Plan en vivo y no en
    el consolidado se anexan al final del Plan consolidado, literales."""
    try:
        P_vivo = str((en_vivo or {}).get("P") or "")
        bloques = [b.strip() for b in _BLOQUE_REHAB.findall(P_vivo)]
        if not bloques:
            return final
        out = dict(final or {})
        P = str(out.get("P") or "").rstrip()
        for b in bloques:
            if b.splitlines()[0] not in P:
                P = f"{P}\n\n{b}" if P else b
        out["P"] = P
        return out
    except Exception:
        return final


def _rehab_de(soap: dict) -> dict:
    """¿La consulta va de rehabilitación? Si sí, qué protocolo aplica. Viaja en la
    misma respuesta que los huecos: sin botones, sin que el médico declare de qué
    trata su consulta. Determinista y en memoria, así que no añade latencia."""
    try:
        return rehab.analizar(soap)
    except Exception:
        return {"es_rehabilitacion": False, "confianza": 0.0, "senales": {}, "protocolos": []}


def _ficha_de(cid: str) -> dict:
    """Ficha del paciente para el escriba. Ya está en el expediente desde antes
    de que empiece la consulta; hasta ahora no se le pasaba y ordenaba la nota
    sin saber a quién atendía."""
    try:
        with db() as conn:
            r = conn.execute(
                "SELECT p.age, p.sex, p.reason, p.chronic, p.allergies, c.motivo "
                "FROM consultations c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?",
                (cid,)).fetchone()
        if not r:
            return {}
        return {
            "edad": r["age"], "sexo": r["sex"],
            # El de HOY manda; el del alta es el respaldo.
            "motivo": (r["motivo"] or r["reason"] or ""),
            "cronicos": json.loads(r["chronic"] or "[]"),
            "alergias": json.loads(r["allergies"] or "[]"),
        }
    except Exception:
        return {}


def _gaps_de(cid: str, soap: dict) -> list:
    """Huecos de interrogatorio para el SOAP acumulado. Viaja en la respuesta de
    /soap/update, que el frontend ya pide en cada chunk: cero peticiones extra y
    cero sondeo. Es apoyo — si algo falla, la consulta sigue sin enterarse."""
    try:
        with db() as conn:
            row = conn.execute(
                "SELECT p.* FROM patients p JOIN consultations c ON c.patient_id = p.id "
                "WHERE c.id = ?", (cid,)).fetchone()
        if not row:
            return []
        patient = dict(row)
        allergies = json.loads(patient.get("allergies") or "[]")
        chronic = json.loads(patient.get("chronic") or "[]")
        patient["allergies"], patient["chronic"] = allergies, chronic
        return consult_gaps.detect(soap, allergies, chronic)
    except Exception:
        return []


@router.post("/live/pendientes")
def pendientes_en_vivo(body: dict, user: dict = Depends(require_user)):
    """Qué falta preguntar, según lo que YA se dijo en la consulta.

    Determinista y sin LLM: no toca la GPU, así que se puede llamar en cada
    chunk sin robarle tiempo a la transcripción. Va aparte del SOAP a propósito
    —si gemma falla o está caído, el médico sigue viendo sus recordatorios—.

    El motivo viaja en el CUERPO, como en la pre-consulta: en la URL acabaría en
    los registros de acceso.
    """
    from ..services import age_engine, cobertura, motivo_engine

    cid = body.get("consultation_id")
    if not cid:
        raise HTTPException(status_code=400, detail="consultation_id requerido")
    with db() as conn:
        row = owned_consultation(conn, cid, user)
        pac = conn.execute("SELECT * FROM patients WHERE id = ?", (row["patient_id"],)).fetchone()
        transcript = row["transcript"] or ""

    paciente = dict(pac) if pac else {}
    for campo in ("chronic", "allergies"):
        if isinstance(paciente.get(campo), str):
            try:
                paciente[campo] = json.loads(paciente[campo])
            except Exception:
                paciente[campo] = []

    sugerencias = motivo_engine.sugerencias_por_motivo(body.get("motivo"))["sugerencias"]
    if not sugerencias:
        # Sin motivo reconocido se vigila lo que traiga claves del motor de edad
        # (hoy, ninguna): la lista sale vacía en vez de inventarse un seguimiento.
        sugerencias = age_engine.preconsulta_base(paciente, [])["sugerencias"]

    # Preguntas que el modelo propuso en la pre-consulta sobre el motivo. Las
    # manda el cliente porque la consulta no existía cuando se generaron (se
    # crea al empezar a grabar). Pasan por el mismo filtro que al generarse:
    # texto, categoría válida y claves cortas; nada más se acepta del cuerpo.
    extra = motivo_engine.desde_llm(body.get("preguntas_motivo"), body.get("motivo") or "", sugerencias)

    return cobertura.pendientes(sugerencias + extra, transcript)


@router.post("/soap/finalize")
def soap_finalize(body: dict, user: dict = Depends(require_user)):
    cid = body.get("consultation_id")
    if not cid:
        raise HTTPException(status_code=400, detail="consultation_id requerido")
    with db() as conn:
        owned_consultation(conn, cid, user)
        row = conn.execute("SELECT transcript, soap FROM consultations WHERE id = ?", (cid,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="consulta no encontrada")
    transcript = (row["transcript"] or "").strip()
    cur = json.loads(row["soap"]) if row["soap"] else {"S": "", "O": "", "A": "", "P": ""}
    if not transcript:
        return {"status": "error", "soap": cur, "clinical_facts": {},
                "validation": {"status": "requires_review", "official_note": False,
                               "flags": [], "warnings": ["Transcripcion vacia; no se puede consolidar."]},
                "warnings": ["Transcripcion vacia; no se puede consolidar."]}
    if not REAL_ASR:
        return {"status": "not_configured", "soap": cur, "clinical_facts": {},
                "validation": {"status": "requires_review", "official_note": False,
                               "flags": [], "warnings": ["MEGI_REAL_ASR=false"]},
                "warnings": ["MEGI_REAL_ASR=false"]}
    # Ficha del paciente: alergias/crónicos para la reconciliación de abajo y,
    # junto con edad/sexo, para el verificador de contraindicaciones FDA del cierre.
    allergies, chronic, paciente = [], [], {}
    try:
        with db() as conn:
            prow = conn.execute(
                "SELECT p.allergies, p.chronic, p.age, p.sex FROM patients p "
                "JOIN consultations c ON c.patient_id = p.id WHERE c.id = ?", (cid,)).fetchone()
        if prow:
            allergies = json.loads(prow["allergies"] or "[]")
            chronic = json.loads(prow["chronic"] or "[]")
            paciente = {"alergias": allergies, "cronicos": chronic,
                        "edad": prow["age"], "sexo": prow["sex"]}
    except Exception:
        pass

    try:
        res = asr_client.soap_finalize(transcript, cur, cid, paciente)
    except Exception as e:
        return {"status": "error", "soap": cur, "clinical_facts": {},
                "validation": {"status": "requires_review", "official_note": False,
                               "flags": [], "warnings": [str(e)]},
                "warnings": [str(e)]}

    # El ASR pone en `status` el VEREDICTO CLÍNICO de la validación ("ready",
    # "requires_review", "draft_only"), que ya viaja en `validation.status`. La
    # pantalla espera un estado de TRANSPORTE ("done" = hay nota) y con "ready"
    # daba la nota por no generada —justo en el mejor caso—. Aquí se separan:
    # `status` dice si se consolidó; `clinical_status` conserva el veredicto.
    if res.get("status") not in ("error", "not_configured") and res.get("soap"):
        res["clinical_status"] = res.get("status")
        res["status"] = "done"

    final_soap = res.get("soap") or cur
    # Lo que el médico AGREGÓ a mano en vivo (protocolo de rehabilitación) no sale
    # del transcript, así que la consolidación no lo conoce y lo dejaba fuera de
    # la nota final. Se conserva tal cual al final del Plan.
    final_soap = _conservar_bloques_rehab(cur, final_soap)
    res["soap"] = final_soap
    clinical_facts = res.get("clinical_facts") or {}
    validation = res.get("validation") or {}

    # Reconciliación de medicamentos contra el catálogo real + rx-check (módulo de
    # seguridad). Enriquece los fármacos (en_catalogo/genérico) y añade alertas de
    # interacción/alergia sobre lo que el paciente toma/tomará.
    try:
        clinical_facts = facts_validator.validate(clinical_facts)                   # defensa presentes/negados/alarmas
        clinical_facts = dx_reconciler.reconcile(clinical_facts)["clinical_facts"]  # CIE-10 desde catálogo
        rec = med_reconciler.reconcile(clinical_facts, allergies, chronic)
        clinical_facts = rec["clinical_facts"]
        # Alertas del verificador FDA (tabla de contraindicaciones): se guardan con
        # los hechos para que la pantalla de revisión las muestre con su cita.
        if res.get("alertas_seguridad"):
            clinical_facts["alertas_seguridad"] = res["alertas_seguridad"]
        res["clinical_facts"] = clinical_facts
        if rec["med_alerts"]:
            res["med_alerts"] = rec["med_alerts"]
            validation.setdefault("warnings", [])
            for a in rec["med_alerts"]:
                if a["severity"] == "blocker":
                    validation["warnings"] = list(dict.fromkeys(validation["warnings"] + [a["message"]]))
            res["validation"] = validation
    except Exception:
        pass  # la reconciliación es apoyo; su fallo no debe romper la finalización

    with db() as conn:
        conn.execute(
            """UPDATE consultations
               SET final_soap = ?, clinical_facts = ?, validation_flags = ?,
                   finalized_at = ?, updated_at = ?
               WHERE id = ?""",
            (json.dumps(final_soap, ensure_ascii=False),
             json.dumps(clinical_facts, ensure_ascii=False),
             json.dumps(validation, ensure_ascii=False),
             _now(), _now(), cid),
        )
        conn.execute(
            "INSERT INTO review_events (consultation_id, kind, payload, actor, created_at) VALUES (?,?,?,?,?)",
            # Las alertas FDA del cierre van en la auditoría, no en la nota: queda
            # constancia de qué se avisó (fármaco, contra qué, severidad y cita).
            (cid, "soap_finalize", json.dumps({"status": res.get("status"),
                                               "clinical_status": res.get("clinical_status"),
                                               "validation": validation,
                                               "alertas_seguridad": res.get("alertas_seguridad") or {}},
                                              ensure_ascii=False),
             "system", _now()),
        )
    return res


@router.get("/soap/{consultation_id}")
def get_soap(consultation_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        row = conn.execute(
            "SELECT transcript, soap, final_soap, clinical_facts, validation_flags FROM consultations WHERE id = ?",
            (consultation_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="consulta no encontrada")
    return {"transcript": row["transcript"] or "",
            "soap": json.loads(row["soap"]) if row["soap"] else {"S": "", "O": "", "A": "", "P": ""},
            "final_soap": json.loads(row["final_soap"]) if row["final_soap"] else None,
            "clinical_facts": json.loads(row["clinical_facts"]) if row["clinical_facts"] else None,
            "validation": json.loads(row["validation_flags"]) if row["validation_flags"] else None}
