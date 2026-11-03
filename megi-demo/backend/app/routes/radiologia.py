"""Informes radiológicos: dictar, estructurar, revisar y firmar.

Flujo propio, distinto al de consulta: el radiólogo no tiene al paciente
delante, informa un ESTUDIO. Por eso no cuelga de `consultations` sino del
paciente, que es la raíz de la pertenencia en toda la app (`ownership.py`).

Reglas duras:
  - El **dictado crudo se conserva siempre**, se estructure o no. Perder lo
    dictado es mucho peor que no repartirlo en secciones.
  - Un informe **firmado es inmutable**: se sella con sha256 y deja de admitir
    cambios. Para corregir, se hace uno nuevo (adenda), como en la práctica real.
  - No se firma un informe sin hallazgos ni impresión.
  - Las **imágenes del estudio** (hasta 4) se guardan con el informe y su sha256
    entra en el sello: el informe firmado queda atado a lo que se miró. La
    **lectura asistida** del modelo es asistencia —se guarda aparte en
    `analisis_ia` y no forma parte del sello— y solo entra al informe lo que el
    radiólogo copie a mano a hallazgos/impresión.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..config import REAL_ASR, SESSIONS_DIR
from ..db import db
from ..ownership import owned_patient
from ..security import require_user
from ..services import asr_client, radiologia, radiologia_imagen
from ..uploads import MAX_CONSULTATION_AUDIO_BYTES, read_capped, safe_id, safe_session_dir, safe_suffix
from .audio import _to_wav16k

router = APIRouter()

CAMPOS = ("modalidad", "region", "indicacion", "fecha_estudio") + radiologia.SECCIONES


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(r) -> dict:
    d = {k: r[k] for k in r.keys()}
    d["modalidad_label"] = radiologia.MODALIDADES.get(d.get("modalidad") or "", ("", ""))[0]
    # `analisis_ia` se guarda como JSON; al cliente le llega como objeto o None.
    if "analisis_ia" in d:
        try:
            d["analisis_ia"] = json.loads(d["analisis_ia"]) if d["analisis_ia"] else None
        except (TypeError, ValueError):
            d["analisis_ia"] = None
    return d


def _imagen_public(r) -> dict:
    d = {k: r[k] for k in r.keys()}
    try:
        d["dicom_meta"] = json.loads(d["dicom_meta"]) if d.get("dicom_meta") else None
    except (TypeError, ValueError):
        d["dicom_meta"] = None
    return d


def _imagenes(conn, informe_id: str) -> list:
    rows = conn.execute("SELECT * FROM informes_radiologia_imagenes WHERE informe_id = ? "
                        "ORDER BY orden, created_at", (informe_id,)).fetchall()
    return [_imagen_public(r) for r in rows]


def _imagen_dir(informe_id: str, imagen_id: str) -> Path:
    """`sessions/_radiologia/<informe>/imagenes/<img>/`, a prueba de traversal."""
    return safe_session_dir("_radiologia", safe_id(informe_id, "informe_id"), "imagenes",
                            safe_id(imagen_id, "imagen_id"))


def _informe(conn, informe_id: str, user: dict):
    r = conn.execute("SELECT * FROM informes_radiologia WHERE id = ?", (informe_id,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="informe no encontrado")
    owned_patient(conn, r["patient_id"], user)      # 404 si el paciente no es suyo
    return r


class InformeCreate(BaseModel):
    patient_id: str
    modalidad: str = "otro"
    region: str | None = None
    indicacion: str | None = None
    fecha_estudio: str | None = None


class InformePatch(BaseModel):
    region: str | None = None
    indicacion: str | None = None
    fecha_estudio: str | None = None
    tecnica: str | None = None
    comparacion: str | None = None
    hallazgos: str | None = None
    impresion: str | None = None
    recomendaciones: str | None = None


@router.get("/radiologia/modalidades")
def modalidades():
    """Catálogo de estudios con la técnica que se propone por defecto."""
    return [{"id": k, "label": v[0], "tecnica": v[1]} for k, v in radiologia.MODALIDADES.items()]


@router.post("/radiologia/informes")
def crear_informe(body: InformeCreate, user: dict = Depends(require_user)):
    if body.modalidad not in radiologia.MODALIDADES:
        raise HTTPException(status_code=400, detail=f"modalidad inválida: {body.modalidad}")
    base = radiologia.informe_vacio(body.modalidad)
    iid = "IR-" + uuid.uuid4().hex[:8]
    now = _now()
    with db() as conn:
        owned_patient(conn, body.patient_id, user)
        conn.execute(
            """INSERT INTO informes_radiologia
               (id, patient_id, modalidad, region, indicacion, fecha_estudio,
                tecnica, comparacion, hallazgos, impresion, recomendaciones,
                transcript, status, created_by, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (iid, body.patient_id, body.modalidad, body.region, body.indicacion,
             body.fecha_estudio or now[:10], base["tecnica"], "", "", "", "",
             "", "borrador", user["username"], now, now),
        )
        r = conn.execute("SELECT * FROM informes_radiologia WHERE id = ?", (iid,)).fetchone()
    return _public(r)


@router.get("/radiologia/informes")
def listar_informes(patient_id: str | None = None, user: dict = Depends(require_user)):
    with db() as conn:
        if patient_id:
            owned_patient(conn, patient_id, user)
            filas = conn.execute(
                "SELECT * FROM informes_radiologia WHERE patient_id = ? ORDER BY created_at DESC",
                (patient_id,)).fetchall()
        else:
            # Solo los de MIS pacientes: la pertenencia se hereda del paciente.
            filas = conn.execute(
                """SELECT i.* FROM informes_radiologia i
                   JOIN patients p ON p.id = i.patient_id
                   WHERE p.doctor_id = ? ORDER BY i.created_at DESC LIMIT 100""",
                (user.get("username"),)).fetchall()
    return [_public(r) for r in filas]


@router.get("/radiologia/informes/{informe_id}")
def ver_informe(informe_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        out = _public(_informe(conn, informe_id, user))
        out["imagenes"] = _imagenes(conn, informe_id)
        return out


# ------------------------------------------------------------ imágenes del estudio

@router.get("/radiologia/informes/{informe_id}/imagenes")
def listar_imagenes(informe_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        _informe(conn, informe_id, user)
        return _imagenes(conn, informe_id)


@router.post("/radiologia/informes/{informe_id}/imagenes")
async def subir_imagen(informe_id: str, file: UploadFile = File(...),
                       user: dict = Depends(require_user)):
    """Guarda una imagen del estudio (JPG/PNG/WebP/DICOM) y su `vista.png`.

    El formato se decide por los bytes, no por el nombre. Un DICOM comprimido
    que no se pueda decodificar se rechaza con 415 y el motivo, en vez de
    guardarse a medias."""
    with db() as conn:
        r = _informe(conn, informe_id, user)
        if r["status"] == "firmado":
            raise HTTPException(status_code=409, detail="el informe ya está firmado")
        n = conn.execute("SELECT count(*) FROM informes_radiologia_imagenes WHERE informe_id = ?",
                         (informe_id,)).fetchone()[0]
        if n >= radiologia_imagen.MAX_IMAGENES_POR_INFORME:
            raise HTTPException(status_code=409,
                                detail=f"máximo {radiologia_imagen.MAX_IMAGENES_POR_INFORME} imágenes por informe")

    raw = await read_capped(file, radiologia_imagen.MAX_IMAGEN_BYTES, "La imagen")
    try:
        formato = radiologia_imagen.detectar_formato(raw, file.filename or "")
        png, ancho, alto, meta = radiologia_imagen.a_vista_png(raw, formato)
    except radiologia_imagen.ImagenInvalida as e:
        raise HTTPException(status_code=e.status, detail=e.detail)

    imagen_id = "IMG-" + uuid.uuid4().hex[:8]
    dest = _imagen_dir(informe_id, imagen_id)
    dest.mkdir(parents=True, exist_ok=True)
    ext = ".dcm" if formato == "dicom" else f".{formato}"
    (dest / f"original{ext}").write_bytes(raw)
    (dest / "vista.png").write_bytes(png)

    with db() as conn:
        conn.execute(
            "INSERT INTO informes_radiologia_imagenes (id, informe_id, nombre_original, formato, "
            "sha256, ancho, alto, dicom_meta, orden, created_by, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (imagen_id, informe_id, (file.filename or "")[:200], formato,
             hashlib.sha256(raw).hexdigest(), ancho, alto, radiologia_imagen.meta_json(meta),
             n, user["username"], _now()))
        conn.execute("UPDATE informes_radiologia SET updated_at = ? WHERE id = ?", (_now(), informe_id))
        row = conn.execute("SELECT * FROM informes_radiologia_imagenes WHERE id = ?",
                           (imagen_id,)).fetchone()
        return _imagen_public(row)


@router.get("/radiologia/informes/{informe_id}/imagenes/{imagen_id}/vista")
def ver_imagen(informe_id: str, imagen_id: str, user: dict = Depends(require_user)):
    """`vista.png` de la imagen. Va con sesión, como todo lo clínico: el
    frontend la pide con `fetch` + cabecera y la pinta desde un blob."""
    with db() as conn:
        _informe(conn, informe_id, user)
        row = conn.execute("SELECT id FROM informes_radiologia_imagenes WHERE id = ? AND informe_id = ?",
                           (imagen_id, informe_id)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="imagen no encontrada")
    vista = _imagen_dir(informe_id, imagen_id) / "vista.png"
    if not vista.exists():
        raise HTTPException(status_code=404, detail="archivo de imagen no encontrado")
    return FileResponse(str(vista), media_type="image/png",
                        headers={"Cache-Control": "private, no-store"})


@router.delete("/radiologia/informes/{informe_id}/imagenes/{imagen_id}")
def borrar_imagen(informe_id: str, imagen_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        r = _informe(conn, informe_id, user)
        if r["status"] == "firmado":
            raise HTTPException(status_code=409, detail="el informe ya está firmado")
        row = conn.execute("SELECT id FROM informes_radiologia_imagenes WHERE id = ? AND informe_id = ?",
                           (imagen_id, informe_id)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="imagen no encontrada")
        conn.execute("DELETE FROM informes_radiologia_imagenes WHERE id = ?", (imagen_id,))
        # La lectura anterior miraba una imagen que ya no está: se invalida.
        conn.execute("UPDATE informes_radiologia SET analisis_ia = NULL, updated_at = ? WHERE id = ?",
                     (_now(), informe_id))
    d = _imagen_dir(informe_id, imagen_id)
    for f in d.glob("*"):
        f.unlink(missing_ok=True)
    if d.exists():
        d.rmdir()
    return {"ok": True, "id": imagen_id}


@router.post("/radiologia/informes/{informe_id}/analizar")
def analizar_imagenes(informe_id: str, user: dict = Depends(require_user)):
    """Lectura asistida: el modelo mira las `vista.png` del informe con el
    contexto del estudio y propone técnica/hallazgos/impresión/limitaciones.

    Se guarda en `analisis_ia` con el sha256 de cada imagen leída, para saber
    después sobre QUÉ se pronunció. No toca las secciones del informe."""
    # La pertenencia se comprueba ANTES que cualquier otra cosa: un 503 a un
    # médico ajeno le diría que el informe existe.
    with db() as conn:
        r = _informe(conn, informe_id, user)
        if r["status"] == "firmado":
            raise HTTPException(status_code=409, detail="el informe ya está firmado")
        imagenes = _imagenes(conn, informe_id)
    if not REAL_ASR:
        raise HTTPException(status_code=503,
                            detail="ASR no configurado (MEGI_REAL_ASR=false): no hay modelo de imagen")
    if not imagenes:
        raise HTTPException(status_code=400, detail="el informe no tiene imágenes que analizar")
    paths = [str(_imagen_dir(informe_id, im["id"]) / "vista.png") for im in imagenes]
    for p in paths:
        if not Path(p).exists():
            raise HTTPException(status_code=404, detail="falta el archivo de una imagen")

    label = radiologia.MODALIDADES.get(r["modalidad"] or "", ("", ""))[0] or (r["modalidad"] or "")
    try:
        out = asr_client.radiologia_analizar_imagen(paths, label, r["region"] or "", r["indicacion"] or "")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ASR no disponible: {e}")
    if out.get("status") != "done":
        err = str(out.get("error") or "lectura fallida")
        # Sin visión o sin LLM es 503 (no está el servicio), no un error del cliente.
        raise HTTPException(status_code=503, detail=f"no se pudo analizar: {err}")

    analisis = {"lectura": out.get("lectura") or {}, "model": out.get("model"),
                "n_imagenes": len(paths), "imagenes": [im["sha256"] for im in imagenes],
                "latency_ms": out.get("latency_ms"), "at": _now(), "by": user["username"]}
    with db() as conn:
        conn.execute("UPDATE informes_radiologia SET analisis_ia = ?, updated_at = ? WHERE id = ?",
                     (json.dumps(analisis, ensure_ascii=False), _now(), informe_id))
    return analisis


@router.patch("/radiologia/informes/{informe_id}")
def editar_informe(informe_id: str, body: InformePatch, user: dict = Depends(require_user)):
    cambios = {k: v for k, v in body.model_dump().items() if v is not None}
    with db() as conn:
        r = _informe(conn, informe_id, user)
        if r["status"] == "firmado":
            raise HTTPException(status_code=409,
                                detail="el informe está firmado y no se puede modificar; haz una adenda")
        if cambios:
            sets = ", ".join(f"{k} = ?" for k in cambios)
            conn.execute(f"UPDATE informes_radiologia SET {sets}, updated_at = ? WHERE id = ?",
                         (*cambios.values(), _now(), informe_id))
        return _public(conn.execute("SELECT * FROM informes_radiologia WHERE id = ?",
                                    (informe_id,)).fetchone())


@router.post("/radiologia/informes/{informe_id}/dictado")
async def dictar_informe(
    informe_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_user),
):
    """Transcribe el dictado y lo reparte en secciones.

    Dos capas: si el radiólogo nombró los encabezados («técnica…, hallazgos…»)
    se reparte SIN LLM; si no, se pide a gemma que lo estructure. Solo se
    rellenan secciones VACÍAS: lo que el radiólogo ya escribió no se pisa.
    """
    with db() as conn:
        r = _informe(conn, informe_id, user)
        if r["status"] == "firmado":
            raise HTTPException(status_code=409, detail="el informe está firmado")

    if not REAL_ASR:
        raise HTTPException(status_code=503,
                            detail="ASR no configurado (MEGI_REAL_ASR=false): escribe el informe")

    raw = await read_capped(file, MAX_CONSULTATION_AUDIO_BYTES, "El dictado")
    dest = Path(SESSIONS_DIR) / "_radiologia" / informe_id
    dest.mkdir(parents=True, exist_ok=True)
    original = dest / f"dictado{safe_suffix(file.filename)}"
    original.write_bytes(raw)
    wav = dest / "dictado_16k.wav"
    _to_wav16k(original, wav)

    try:
        tr = asr_client.transcribe_file(str(wav), informe_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"no se pudo transcribir: {e}") from None
    transcript = (tr.get("normalized_text") or tr.get("transcript") or "").strip()

    reparto = radiologia.dividir_secciones(transcript)
    secciones, via = reparto["secciones"], "encabezados"
    if not reparto["estructurado"] and transcript:
        try:
            out = asr_client.radiologia_estructurar(transcript)
            if out.get("status") == "done":
                secciones = {k: v for k, v in (out.get("secciones") or {}).items()
                             if k in radiologia.SECCIONES and (v or "").strip()}
                via = "llm"
        except Exception:
            secciones, via = {}, "sin_estructurar"
    if not secciones and transcript:
        # Última red: el dictado entero a hallazgos. Nunca se pierde.
        secciones, via = {"hallazgos": transcript}, "sin_estructurar"

    with db() as conn:
        actual = conn.execute("SELECT * FROM informes_radiologia WHERE id = ?", (informe_id,)).fetchone()
        # Solo secciones vacías: no se pisa lo que el radiólogo ya revisó.
        aplicar = {k: v for k, v in secciones.items() if not (actual[k] or "").strip()}
        previo = actual["transcript"] or ""
        completo = (previo + "\n" + transcript).strip() if previo else transcript
        sets = ", ".join(f"{k} = ?" for k in aplicar)
        sql = "UPDATE informes_radiologia SET transcript = ?, updated_at = ?" + (f", {sets}" if aplicar else "")
        conn.execute(sql + " WHERE id = ?", (completo, _now(), *aplicar.values(), informe_id))
        r = conn.execute("SELECT * FROM informes_radiologia WHERE id = ?", (informe_id,)).fetchone()

    out = _public(r)
    out["dictado"] = {"transcript": transcript, "via": via,
                      "secciones_detectadas": list(secciones), "aplicadas": list(aplicar)}
    return out


@router.post("/radiologia/informes/{informe_id}/firmar")
def firmar_informe(informe_id: str, user: dict = Depends(require_user)):
    """Sella el informe. A partir de aquí es inmutable."""
    with db() as conn:
        r = _informe(conn, informe_id, user)
        if r["status"] == "firmado":
            raise HTTPException(status_code=409, detail="el informe ya está firmado")
        informe = {k: r[k] for k in radiologia.SECCIONES}
        ok, faltan = radiologia.listo_para_firmar(informe)
        if not ok:
            raise HTTPException(status_code=400,
                                detail=f"faltan secciones para firmar: {', '.join(faltan)}")
        # Las imágenes entran al sello por su sha256 (del original, en orden):
        # cambiar o quitar una después de firmar rompería la verificación.
        imagenes = [im["sha256"] for im in _imagenes(conn, informe_id)]
        canonico = json.dumps({**informe, "id": r["id"], "patient_id": r["patient_id"],
                               "modalidad": r["modalidad"], "imagenes": imagenes},
                              ensure_ascii=False, sort_keys=True)
        sello = "sha256:" + hashlib.sha256(canonico.encode("utf-8")).hexdigest()
        ahora = _now()
        conn.execute(
            "UPDATE informes_radiologia SET status='firmado', content_hash=?, signed_at=?, updated_at=? WHERE id=?",
            (sello, ahora, ahora, informe_id))
        return _public(conn.execute("SELECT * FROM informes_radiologia WHERE id = ?",
                                    (informe_id,)).fetchone())
