"""Catálogo de medicamentos (Etapa 2 del plan de catálogo).

Sembrado desde la práctica real (farmacos_minados de notas_imss.db) y aprobado
por el médico: solo las entradas 'aprobado' alimentarán el rx-check y las
pick-lists de prescripción (Etapas 3-4). Editar un campo clínico de una entrada
aprobada la regresa a 'borrador' (re-aprobación obligatoria). La aprobación
firma con el usuario AUTENTICADO (token), nunca con texto libre.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..config import REAL_ASR
from ..db import db
from ..security import current_user
from ..services import asr_client
from .safety import _n, load_catalog_rules

router = APIRouter()

# Campos clínicos: cambiarlos en una entrada aprobada exige re-aprobación.
CLINICAL_FIELDS = ("generico", "clase", "via", "dosis_habitual",
                   "frecuencia_habitual", "dosis_max_dia", "precauciones")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(r) -> dict:
    d = dict(r)
    try:
        d["sinonimos"] = json.loads(d.get("sinonimos") or "[]")
    except Exception:
        d["sinonimos"] = []
    return d


class MedicationCreate(BaseModel):
    generico: str
    clase: Optional[str] = ""
    via: Optional[str] = ""
    dosis_habitual: Optional[str] = ""
    frecuencia_habitual: Optional[str] = ""
    dosis_max_dia: Optional[str] = ""
    precauciones: Optional[str] = ""
    sinonimos: Optional[list] = None


class MedicationPatch(BaseModel):
    generico: Optional[str] = None
    clase: Optional[str] = None
    via: Optional[str] = None
    dosis_habitual: Optional[str] = None
    frecuencia_habitual: Optional[str] = None
    dosis_max_dia: Optional[str] = None
    precauciones: Optional[str] = None
    sinonimos: Optional[list] = None


@router.get("/medications")
def list_medications(estado: Optional[str] = None):
    q = "SELECT * FROM medications"
    args: tuple = ()
    if estado:
        q += " WHERE estado = ?"
        args = (estado,)
    q += " ORDER BY n_recetas DESC, generico"
    with db() as conn:
        rows = conn.execute(q, args).fetchall()
    return [_public(r) for r in rows]


@router.post("/medications")
def create_medication(body: MedicationCreate, user: dict = Depends(current_user)):
    g = body.generico.strip().lower()
    if not g:
        raise HTTPException(status_code=422, detail="genérico vacío")
    with db() as conn:
        if conn.execute("SELECT 1 FROM medications WHERE generico = ?", (g,)).fetchone():
            raise HTTPException(status_code=409, detail=f"'{g}' ya existe en el catálogo")
        cur = conn.execute(
            """INSERT INTO medications (generico, sinonimos, clase, via, dosis_habitual,
               frecuencia_habitual, dosis_max_dia, precauciones, n_recetas, fuente,
               estado, created_at) VALUES (?,?,?,?,?,?,?,?,0,'manual','borrador',?)""",
            (g, json.dumps(body.sinonimos or [], ensure_ascii=False), body.clase, body.via,
             body.dosis_habitual, body.frecuencia_habitual, body.dosis_max_dia,
             body.precauciones, _now()),
        )
        r = conn.execute("SELECT * FROM medications WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _public(r)


@router.patch("/medications/{med_id}")
def patch_medication(med_id: int, body: MedicationPatch, user: dict = Depends(current_user)):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not fields:
        raise HTTPException(status_code=422, detail="nada que actualizar")
    if "sinonimos" in fields:
        fields["sinonimos"] = json.dumps(fields["sinonimos"], ensure_ascii=False)
    if "generico" in fields:
        fields["generico"] = fields["generico"].strip().lower()
    with db() as conn:
        row = conn.execute("SELECT * FROM medications WHERE id = ?", (med_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="medicamento no encontrado")
        # Cambios clínicos sobre una entrada aprobada -> vuelve a borrador.
        if row["estado"] == "aprobado" and any(k in CLINICAL_FIELDS for k in fields):
            fields["estado"] = "borrador"
            fields["aprobado_por"] = None
            fields["aprobado_en"] = None
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE medications SET {sets} WHERE id = ?", (*fields.values(), med_id))
        r = conn.execute("SELECT * FROM medications WHERE id = ?", (med_id,)).fetchone()
    return _public(r)


@router.post("/medications/{med_id}/approve")
def approve_medication(med_id: int, user: dict = Depends(current_user)):
    with db() as conn:
        row = conn.execute("SELECT * FROM medications WHERE id = ?", (med_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="medicamento no encontrado")
        # Firma SIEMPRE con el usuario autenticado del token.
        conn.execute(
            "UPDATE medications SET estado = 'aprobado', aprobado_por = ?, aprobado_en = ? WHERE id = ?",
            (user["username"], _now(), med_id),
        )
        r = conn.execute("SELECT * FROM medications WHERE id = ?", (med_id,)).fetchone()
    return _public(r)


@router.delete("/medications/{med_id}")
def delete_medication(med_id: int, user: dict = Depends(current_user)):
    with db() as conn:
        row = conn.execute("SELECT estado FROM medications WHERE id = ?", (med_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="medicamento no encontrado")
        if row["estado"] == "aprobado":
            raise HTTPException(status_code=409, detail="una entrada aprobada no se borra; edítala (vuelve a borrador) y luego bórrala")
        conn.execute("DELETE FROM medications WHERE id = ?", (med_id,))
    return {"deleted": med_id}


# ---------------------------------------------------------------- interacciones (Etapa 3)
def _pair(a: str, b: str) -> tuple:
    a, b = a.strip().lower(), b.strip().lower()
    return (a, b) if a < b else (b, a)


@router.get("/drug-interactions")
def list_interactions(estado: Optional[str] = None):
    q = "SELECT * FROM drug_interactions"
    args: tuple = ()
    if estado:
        q += " WHERE estado = ?"
        args = (estado,)
    q += " ORDER BY CASE severidad WHEN 'grave' THEN 0 WHEN 'moderada' THEN 1 ELSE 2 END, farmaco_a"
    with db() as conn:
        return [dict(r) for r in conn.execute(q, args).fetchall()]


@router.post("/drug-interactions/generate")
def generate_interactions(user: dict = Depends(current_user)):
    """Propone interacciones entre pares del catálogo APROBADO (gemma). Cada
    par nuevo entra en 'borrador'; nada se activa sin aprobación del médico.
    Idempotente: no re-propone pares ya registrados."""
    if not REAL_ASR:
        raise HTTPException(status_code=503, detail="Generación no disponible (MEGI_REAL_ASR=false).")
    with db() as conn:
        meds = [dict(r) for r in conn.execute(
            "SELECT generico, clase FROM medications WHERE estado = 'aprobado' ORDER BY n_recetas DESC"
        ).fetchall()]
        seen = {(r["farmaco_a"], r["farmaco_b"]) for r in conn.execute(
            "SELECT farmaco_a, farmaco_b FROM drug_interactions").fetchall()}
    if len(meds) < 2:
        raise HTTPException(status_code=422, detail="Aprueba al menos 2 medicamentos primero.")

    now = _now()
    nuevas = 0
    genericos = {m["generico"] for m in meds}
    for i, m in enumerate(meds):
        candidatos = [x for x in meds if x["generico"] != m["generico"]]
        try:
            r = asr_client.drug_interactions(m["generico"], m.get("clase") or "", candidatos)
        except Exception:
            continue
        if r.get("status") != "done":
            continue
        with db() as conn:
            for it in r.get("interacciones") or []:
                con = (it.get("con") or "").strip().lower()
                if con not in genericos:
                    continue
                a, b = _pair(m["generico"], con)
                if (a, b) in seen:
                    continue
                seen.add((a, b))
                conn.execute(
                    """INSERT OR IGNORE INTO drug_interactions
                       (farmaco_a, farmaco_b, severidad, mecanismo, recomendacion,
                        fuente, estado, created_at) VALUES (?,?,?,?,?,'gemma_propuesta','borrador',?)""",
                    (a, b, it.get("severidad"), it.get("mecanismo"), it.get("recomendacion"), now),
                )
                nuevas += 1
    return {"generadas": nuevas, "medicamentos_revisados": len(meds)}


class InteractionPatch(BaseModel):
    severidad: Optional[str] = None
    mecanismo: Optional[str] = None
    recomendacion: Optional[str] = None


@router.patch("/drug-interactions/{ix_id}")
def patch_interaction(ix_id: int, body: InteractionPatch, user: dict = Depends(current_user)):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not fields:
        raise HTTPException(status_code=422, detail="nada que actualizar")
    with db() as conn:
        row = conn.execute("SELECT estado FROM drug_interactions WHERE id = ?", (ix_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="interacción no encontrada")
        if row["estado"] == "aprobado":
            fields["estado"] = "borrador"       # editar re-abre a borrador
            fields["aprobado_por"] = None
            fields["aprobado_en"] = None
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE drug_interactions SET {sets} WHERE id = ?", (*fields.values(), ix_id))
        r = conn.execute("SELECT * FROM drug_interactions WHERE id = ?", (ix_id,)).fetchone()
    return dict(r)


@router.post("/drug-interactions/{ix_id}/approve")
def approve_interaction(ix_id: int, user: dict = Depends(current_user)):
    with db() as conn:
        if not conn.execute("SELECT 1 FROM drug_interactions WHERE id = ?", (ix_id,)).fetchone():
            raise HTTPException(status_code=404, detail="interacción no encontrada")
        conn.execute(
            "UPDATE drug_interactions SET estado='aprobado', aprobado_por=?, aprobado_en=? WHERE id=?",
            (user["username"], _now(), ix_id),
        )
        r = conn.execute("SELECT * FROM drug_interactions WHERE id = ?", (ix_id,)).fetchone()
    return dict(r)


@router.delete("/drug-interactions/{ix_id}")
def delete_interaction(ix_id: int, user: dict = Depends(current_user)):
    with db() as conn:
        if not conn.execute("SELECT 1 FROM drug_interactions WHERE id = ?", (ix_id,)).fetchone():
            raise HTTPException(status_code=404, detail="interacción no encontrada")
        conn.execute("DELETE FROM drug_interactions WHERE id = ?", (ix_id,))
    return {"deleted": ix_id}


# ---------------------------------------------------------------- consultor de fármacos
def _detect_drugs(text: str, rx_context: list, catalog: list) -> list:
    """Genéricos del catálogo mencionados en la pregunta o en la receta actual."""
    hay = _n(text) + " " + " ".join(_n(x) for x in (rx_context or []))
    found = []
    for c in catalog:
        if any(t in hay for t in c["terms"]):
            found.append(c["generico"])
    # de la receta, aunque no estén en el catálogo, conservar el nombre
    for x in (rx_context or []):
        nx = _n(x)
        if not any(_n(g) in nx for g in found):
            found.append(x)
    return found[:8]


class DrugConsult(BaseModel):
    question: str
    rx_context: Optional[list] = None   # fármacos de la receta/consulta actual


@router.post("/drugs/consult")
def drugs_consult(body: DrugConsult, user: dict = Depends(current_user)):
    """Consulta libre sobre fármacos/interacciones (RAG catálogo + FDA). Para que
    el médico resuelva dudas antes/durante la consulta. No persiste ni prescribe."""
    if not REAL_ASR:
        raise HTTPException(status_code=503, detail="Consultor no disponible (MEGI_REAL_ASR=false).")
    q = (body.question or "").strip()
    if not q:
        raise HTTPException(status_code=422, detail="pregunta vacía")
    catalog, interactions = load_catalog_rules()
    drugs = _detect_drugs(q, body.rx_context, catalog)
    # reglas aprobadas relevantes: las que tocan alguno de los fármacos detectados
    gen_set = {_n(d) for d in drugs}
    rules = [ix for (a, b), ix in interactions.items()
             if _n(a) in gen_set or _n(b) in gen_set
             or any(_n(a) in _n(d) or _n(d) in _n(a) for d in drugs)]
    try:
        r = asr_client.drugs_consult(q, drugs, rules)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"consultor no disponible: {e}")
    if r.get("status") != "done":
        raise HTTPException(status_code=502, detail=r.get("error", "consultor no disponible"))
    return {"answer": r.get("answer", ""), "drugs_detectados": drugs,
            "reglas_usadas": len(rules),
            "nota": "Apoyo con base en tu catálogo + fichas FDA. El médico decide."}


class DrugCheck(BaseModel):
    rx_list: list                        # nombres (o dicts {nombre, dosis}) de la receta
    conditions: Optional[list] = None    # diagnósticos / hallazgos de la consulta
    allergies: Optional[list] = None
    age: Optional[int] = None
    sex: Optional[str] = None
    embarazo: Optional[bool] = None
    patient_id: Optional[str] = None     # si viene, completa alergias/crónicos/edad/sexo del expediente
    context_text: Optional[str] = None   # transcripción en vivo: fármacos/condiciones mencionados


@router.post("/drugs/check")
def drugs_check(body: DrugCheck, user: dict = Depends(current_user)):
    """Verificador de recetas sobre la tabla de contraindicaciones FDA (paquete
    FDA_movil, 2 248 fármacos): alertas fármaco–condición, fármaco–fármaco y alergia,
    cada una con cita textual de la etiqueta y su origen (`es` validado /
    `en_sin_validar`). Determinista, sin LLM. Complementa al rx-check del catálogo
    (safety.py), no lo sustituye. Apoyo: el médico decide. No persiste nada."""
    if not REAL_ASR:
        raise HTTPException(status_code=503, detail="Verificador FDA no disponible (MEGI_REAL_ASR=false).")
    rx = [x for x in (body.rx_list or []) if x]
    if not rx and not (body.context_text or "").strip():
        raise HTTPException(status_code=422, detail="receta vacía")
    conditions = list(body.conditions or [])
    allergies = list(body.allergies or [])
    age, sex = body.age, body.sex
    if body.patient_id:
        with db() as conn:
            prow = conn.execute("SELECT allergies, chronic, age, sex FROM patients WHERE id = ?",
                                (body.patient_id,)).fetchone()
        if prow:
            try:
                allergies += [a for a in json.loads(prow["allergies"] or "[]") if a not in allergies]
                conditions += [c for c in json.loads(prow["chronic"] or "[]") if c not in conditions]
            except Exception:
                pass
            age = age if age is not None else prow["age"]
            sex = sex or prow["sex"]
    try:
        r = asr_client.drugs_check(rx, conditions, allergies, age, sex, body.embarazo,
                                   context_text=body.context_text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"verificador no disponible: {e}")
    if r.get("status") != "done":
        raise HTTPException(status_code=502, detail=r.get("error", "verificador no disponible"))
    return {"farmacos_detectados": r.get("farmacos_detectados", []),
            "alertas": r.get("alertas", []), "resumen": r.get("resumen", {}),
            "alertas_altas": r.get("alertas_altas", 0),
            "nota": "Apoyo con etiquetas FDA (EE.UU.); puede diferir de COFEPRIS. Cita obligatoria. El médico decide."}


class DrugAlternatives(BaseModel):
    rx_list: list                        # nombres de fármacos de la receta
    farmaco_a: str
    farmaco_b: str
    severidad: Optional[str] = "grave"
    mecanismo: Optional[str] = ""


@router.post("/drugs/alternatives")
def drugs_alternatives(body: DrugAlternatives, user: dict = Depends(current_user)):
    """Sugerencias para resolver una interacción de alto riesgo, priorizando el
    catálogo aprobado. El médico las revisa e itera; nada se aplica solo."""
    if not REAL_ASR:
        raise HTTPException(status_code=503, detail="Sugerencias no disponibles (MEGI_REAL_ASR=false).")
    with db() as conn:
        catalogo = [r["generico"] for r in conn.execute(
            "SELECT generico FROM medications WHERE estado = 'aprobado' ORDER BY n_recetas DESC")]
    try:
        r = asr_client.drugs_alternatives(
            [str(x) for x in body.rx_list],
            {"farmaco_a": body.farmaco_a, "farmaco_b": body.farmaco_b,
             "severidad": body.severidad, "mecanismo": body.mecanismo},
            catalogo)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"sugerencias no disponibles: {e}")
    if r.get("status") != "done":
        raise HTTPException(status_code=502, detail=r.get("error", "sugerencias no disponibles"))
    return {"resumen": r.get("resumen", ""), "sugerencias": r.get("sugerencias", []),
            "nota": "Sugerencias de apoyo; el médico valora y decide."}


@router.post("/medications/{med_id}/gpc-suggest")
def gpc_suggest(med_id: int, user: dict = Depends(current_user)):
    """Sugerencia de dosis máxima y precauciones combinando DOS fuentes: GPC IMSS
    (RAG, contexto MX) y la ficha FDA traducida (vademécum, cubre lo que la GPC
    piloto no). No persiste nada: el médico copia/edita y aprueba. La FDA es
    contenido regulatorio de EE.UU. traducido — se etiqueta como tal."""
    if not REAL_ASR:
        raise HTTPException(status_code=503, detail="Sugerencias no disponibles (MEGI_REAL_ASR=false).")
    with db() as conn:
        row = conn.execute("SELECT generico FROM medications WHERE id = ?", (med_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="medicamento no encontrado")
    gen = row["generico"]

    gpc_text, gpc_fuentes = "", []
    try:
        r = asr_client.guidelines_chat(
            f"¿Cuál es la dosis máxima diaria de {gen} en adultos y qué precauciones o "
            f"contraindicaciones relevantes tiene?", k=5)
        gpc_text = r.get("answer") or ""
        gpc_fuentes = r.get("sources") or []
    except Exception:
        pass

    try:
        fda = asr_client.vademecum_enrich(gen)
    except Exception:
        fda = {}

    return {
        "generico": gen,
        "gpc": {"sugerencia": gpc_text, "fuentes": gpc_fuentes},
        "fda": {
            "dosis_max_dia": fda.get("dosis_max_dia") or "",
            "precauciones": fda.get("precauciones") or "",
            "matched": fda.get("matched"),
            "secciones": fda.get("secciones") or [],
        },
        # Campos aplicables directo: FDA prioriza dosis máx (ficha técnica); GPC da contexto MX.
        "dosis_max_dia": fda.get("dosis_max_dia") or "",
        "precauciones": fda.get("precauciones") or "",
        "nota": "GPC IMSS (contexto MX) + ficha FDA/EE.UU. traducida. Verifica antes de aprobar.",
    }