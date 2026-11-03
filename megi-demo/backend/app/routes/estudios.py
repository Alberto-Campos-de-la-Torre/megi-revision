"""Estudios que trae el paciente a la consulta (pantalla previa al SOAP).

Dos vías de entrada y una sola tabla:

- Escritorio: el médico arrastra o elige archivos -> POST /consultations/{id}/estudios.
- Teléfono: el médico genera un ENLACE DE SUBIDA (código aleatorio, 15 minutos,
  atado a esa consulta) que viaja en un QR; la página del teléfono sube por
  `routes/subida.py` sin sesión, solo con ese código.

Los archivos van a `STATE_DIR/estudios/<consulta>/<estudio>/` y nunca se
modifican; `vista.png` es la miniatura. Pertenencia por la consulta (404 ajena).
"""
from __future__ import annotations

import hashlib
import json
import secrets
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Literal

from ..config import PUBLIC_URL, SESSIONS_DIR
from ..db import db
from ..ownership import doctor_of, owned_consultation, owned_patient
from ..security import require_user
from ..services import analisis_estudios as analisis
from ..services import estudios_archivo as ea
from ..services import triaje
from ..uploads import read_capped

router = APIRouter()

ENLACE_TTL_S = 15 * 60
ESTADOS = ("sin_estudios", "con_estudios")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def estudios_dir() -> Path:
    # Al lado de `sessions/` (audio): mismo STATE_DIR, misma copia de seguridad.
    return SESSIONS_DIR.parent / "estudios"


def estudio_dir(consultation_id: str, estudio_id: str) -> Path:
    return estudios_dir() / consultation_id / estudio_id


def publico(r) -> dict:
    return {
        "id": r["id"], "consultation_id": r["consultation_id"], "patient_id": r["patient_id"],
        "nombre": r["nombre_original"], "formato": r["formato"], "bytes": r["bytes"],
        "ancho": r["ancho"], "alto": r["alto"], "tiene_vista": bool(r["tiene_vista"]),
        "origen": r["origen"], "subido_por": r["subido_por"], "nota": r["nota"],
        "created_at": r["created_at"],
        "tipo": r["tipo"] if "tipo" in r.keys() else None,
        "analisis_estado": (r["analisis_estado"] if "analisis_estado" in r.keys() else None) or "pendiente",
        "triaje": (json.loads(r["triaje"]) if ("triaje" in r.keys() and r["triaje"]) else None),
    }


def guardar_estudio(conn, consultation_id: str, patient_id: str, raw: bytes, nombre: str,
                    origen: str, subido_por: str) -> dict:
    """Valida, guarda en disco y registra. Lo comparten escritorio y teléfono."""
    n = conn.execute("SELECT count(*) FROM estudios_aportados WHERE consultation_id = ?",
                     (consultation_id,)).fetchone()[0]
    if n >= ea.MAX_ESTUDIOS_POR_CONSULTA:
        raise HTTPException(status_code=409,
                            detail=f"máximo {ea.MAX_ESTUDIOS_POR_CONSULTA} archivos por consulta")
    try:
        formato = ea.detectar_formato(raw, nombre or "")
        png, ancho, alto = ea.vista_png(raw, formato)
    except ea.ArchivoInvalido as e:
        raise HTTPException(status_code=e.status, detail=e.detail)

    # Triaje en CPU antes de cualquier modelo: repetido -> 409; vacío o foto
    # repetida -> se guarda como «descartado» y no va a la GPU.
    sha = hashlib.sha256(raw).hexdigest()
    t = triaje.triar(conn, consultation_id, patient_id, sha, formato, nombre or "", png, raw)
    if t["accion"] == "rechazar":
        raise HTTPException(status_code=409, detail=t["motivo"])

    estudio_id = "EA-" + uuid.uuid4().hex[:8]
    dest = estudio_dir(consultation_id, estudio_id)
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f"original{ea.EXTENSION[formato]}").write_bytes(raw)
    if png:
        (dest / "vista.png").write_bytes(png)
    descartado = t["accion"] == "descartar"
    conn.execute(
        "INSERT INTO estudios_aportados (id, consultation_id, patient_id, nombre_original, formato, "
        "bytes, sha256, ancho, alto, tiene_vista, origen, subido_por, created_at, phash, triaje, "
        "tipo, analisis_estado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (estudio_id, consultation_id, patient_id, (nombre or "")[:200], formato, len(raw),
         sha, ancho, alto, 1 if png else 0, origen, subido_por, _now(), t.get("phash"),
         json.dumps({"motivo": t["motivo"], "duplicado_de": t.get("duplicado_de"), "calidad": t.get("calidad")}, ensure_ascii=False),
         "descartado" if descartado else None, "descartado" if descartado else None))
    conn.execute("UPDATE consultations SET estudios_estado = 'con_estudios', updated_at = ? WHERE id = ?",
                 (_now(), consultation_id))
    return publico(conn.execute("SELECT * FROM estudios_aportados WHERE id = ?", (estudio_id,)).fetchone())


# ------------------------------------------------------------------ escritorio
@router.get("/consultations/{consultation_id}/estudios")
def listar(consultation_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        c = owned_consultation(conn, consultation_id, user)
        rows = conn.execute("SELECT * FROM estudios_aportados WHERE consultation_id = ? ORDER BY created_at",
                            (consultation_id,)).fetchall()
        return {"estado": c["estudios_estado"], "estudios": [publico(r) for r in rows],
                "max": ea.MAX_ESTUDIOS_POR_CONSULTA}


@router.post("/consultations/{consultation_id}/estudios")
async def subir(consultation_id: str, tareas: BackgroundTasks, file: UploadFile = File(...),
                user: dict = Depends(require_user)):
    with db() as conn:
        c = owned_consultation(conn, consultation_id, user)
    raw = await read_capped(file, ea.MAX_ESTUDIO_BYTES, "El archivo")
    with db() as conn:
        est = guardar_estudio(conn, consultation_id, c["patient_id"], raw, file.filename or "",
                              "escritorio", user["username"])
    # Automático al subir (decisión de producto, 11-oct): identificar, analizar
    # y rehacer el pre-diagnóstico, fuera de la petición para no retener la subida.
    if est["analisis_estado"] != "descartado":
        tareas.add_task(analisis.procesar_estudio, est["id"])
    return est


_PENDIENTE_S = 20


@router.get("/consultations/{consultation_id}/estudios/analisis")
def analisis_consulta(consultation_id: str, tareas: BackgroundTasks, user: dict = Depends(require_user)):
    """Estudios con su tipo identificado y sus análisis, más el último
    pre-diagnóstico. Es lo que la pantalla consulta cada pocos segundos.

    Un archivo que lleve más de 20 s sin identificar (subido con el servidor
    caído, o antes de que existiera el análisis) se encola aquí mismo: la
    pantalla se cura sola sin que el médico tenga que pulsar nada."""
    with db() as conn:
        c = owned_consultation(conn, consultation_id, user)
        rows = conn.execute("SELECT * FROM estudios_aportados WHERE consultation_id = ? ORDER BY created_at",
                            (consultation_id,)).fetchall()
        out = []
        ahora = datetime.now(timezone.utc)
        for r in rows:
            if not r["analisis_estado"] and not r["tipo"]:
                try:
                    edad = (ahora - datetime.fromisoformat(r["created_at"])).total_seconds()
                except Exception:
                    edad = _PENDIENTE_S + 1
                if edad > _PENDIENTE_S:
                    conn.execute("UPDATE estudios_aportados SET analisis_estado = 'analizando' WHERE id = ?", (r["id"],))
                    tareas.add_task(analisis.procesar_estudio, r["id"])
        for r in rows:
            d = publico(r)
            d.update({"tipo": r["tipo"], "tipo_label": analisis.TIPOS_LABEL.get(r["tipo"] or "", None),
                      "tipo_p": r["tipo_p"], "analisis_estado": r["analisis_estado"] or "pendiente",
                      "analisis": analisis._analisis_de(conn, r["id"])})
            out.append(d)
        pre = analisis.ultimo_prediagnostico(conn, consultation_id)
    return {"estado": c["estudios_estado"], "estudios": out, "prediagnostico": pre,
            "servicio_modelos": {"url": bool(analisis.TYPESAFE_URL or analisis.ECO_URL),
                                 "disponible": analisis.typesafe_disponible() or analisis.eco_disponible()},
            "analizadores": [{"clave": a["clave"], "nombre": a["nombre"], "tipos": list(a["tipos"])} for a in analisis.ANALIZADORES]}


@router.post("/consultations/{consultation_id}/estudios/prediagnostico")
def regenerar_prediagnostico(consultation_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        return analisis.generar_prediagnostico(conn, consultation_id)


class SeleccionEco(BaseModel):
    organo: Literal["mama", "tiroides"]
    caja_xyxy: tuple[float, float, float, float]
    mm_por_pixel: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    clasificar_tiroides: bool = False


@router.post("/consultations/{consultation_id}/estudios/{estudio_id}/ecografia")
def configurar_eco(consultation_id: str, estudio_id: str, body: SeleccionEco, tareas: BackgroundTasks,
                   user: dict = Depends(require_user)):
    import math
    from PIL import Image
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        row = conn.execute("SELECT * FROM estudios_aportados WHERE id = ? AND consultation_id = ?",
                           (estudio_id, consultation_id)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="estudio no encontrado")
        if row["analisis_estado"] == "analizando":
            raise HTTPException(status_code=409, detail="Espera a que termine el análisis actual")
        if not row["tiene_vista"] or row["formato"] == "pdf" or row["tipo"] == "descartado":
            raise HTTPException(status_code=422, detail="Selecciona una imagen ecográfica válida")
        _, vista = analisis._rutas(dict(row))
        with Image.open(vista) as im:
            w, h = im.size
        x0, y0, x1, y1 = body.caja_xyxy
        if not all(math.isfinite(x) for x in body.caja_xyxy) or not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h):
            raise HTTPException(status_code=422, detail="Caja inválida o fuera de la imagen completa")
        config = body.model_dump()
        conn.execute("UPDATE estudios_aportados SET tipo = ?, tipo_p = NULL, tipo_detalle = ?, analisis_estado = 'analizando' WHERE id = ?",
                     ("ecografia_" + body.organo, json.dumps({"fuente": "seleccion_manual", "eco_manual": config}), estudio_id))
        conn.execute("DELETE FROM estudios_analisis WHERE estudio_id = ?", (estudio_id,))
        (vista.parent / "eco.png").unlink(missing_ok=True)
    tareas.add_task(analisis.procesar_estudio, estudio_id)
    return {"ok": True, "estado": "analizando", "seleccion": config}


@router.get("/consultations/{consultation_id}/estudios/{estudio_id}/ecografia/vista")
def vista_eco(consultation_id: str, estudio_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        if not conn.execute("SELECT 1 FROM estudios_aportados WHERE id = ? AND consultation_id = ?",
                            (estudio_id, consultation_id)).fetchone():
            raise HTTPException(status_code=404, detail="estudio no encontrado")
    path = estudio_dir(consultation_id, estudio_id) / "eco.png"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Sin segmentación disponible")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/consultations/{consultation_id}/estudios/{estudio_id}/analizar")
def reanalizar(consultation_id: str, estudio_id: str, user: dict = Depends(require_user)):
    """Volver a leer un estudio (p. ej. tras arrancar el servicio de modelos)."""
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        if not conn.execute("SELECT 1 FROM estudios_aportados WHERE id = ? AND consultation_id = ?",
                            (estudio_id, consultation_id)).fetchone():
            raise HTTPException(status_code=404, detail="estudio no encontrado")
        r = analisis.analizar_estudio(conn, estudio_id)
    with db() as conn:
        r["prediagnostico"] = analisis.generar_prediagnostico(conn, consultation_id)
    return r


# Va ANTES de DELETE .../estudios/{estudio_id}: si no, «enlace» se toma por un id.
@router.delete("/consultations/{consultation_id}/estudios/enlace")
def revocar_enlace(consultation_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        conn.execute("UPDATE enlaces_subida SET revoked_at = ? WHERE consultation_id = ? AND revoked_at IS NULL",
                     (_now(), consultation_id))
    return {"ok": True}


@router.delete("/consultations/{consultation_id}/estudios/{estudio_id}")
def borrar(consultation_id: str, estudio_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        r = conn.execute("SELECT * FROM estudios_aportados WHERE id = ? AND consultation_id = ?",
                         (estudio_id, consultation_id)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="estudio no encontrado")
        conn.execute("DELETE FROM estudios_analisis WHERE estudio_id = ?", (estudio_id,))
        conn.execute("DELETE FROM estudios_aportados WHERE id = ?", (estudio_id,))
    d = estudio_dir(consultation_id, estudio_id)
    if d.is_dir():
        for f in d.iterdir():
            f.unlink()
        d.rmdir()
    return {"ok": True}


@router.get("/consultations/{consultation_id}/estudios/{estudio_id}/vista")
def vista(consultation_id: str, estudio_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        r = conn.execute("SELECT tiene_vista FROM estudios_aportados WHERE id = ? AND consultation_id = ?",
                         (estudio_id, consultation_id)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="estudio no encontrado")
    p = estudio_dir(consultation_id, estudio_id) / "vista.png"
    if not r["tiene_vista"] or not p.is_file():
        raise HTTPException(status_code=404, detail="este archivo no tiene vista previa")
    return FileResponse(str(p), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/consultations/{consultation_id}/estudios/{estudio_id}/original")
def original(consultation_id: str, estudio_id: str, user: dict = Depends(require_user)):
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        r = conn.execute("SELECT formato, nombre_original FROM estudios_aportados WHERE id = ? AND consultation_id = ?",
                         (estudio_id, consultation_id)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="estudio no encontrado")
    p = estudio_dir(consultation_id, estudio_id) / f"original{ea.EXTENSION[r['formato']]}"
    if not p.is_file():
        raise HTTPException(status_code=404, detail="archivo no encontrado en disco")
    return FileResponse(str(p), media_type=ea.MIME[r["formato"]],
                        headers={"Content-Disposition": f'inline; filename="{p.name}"',
                                 "Cache-Control": "private, max-age=3600"})


class EstadoReq(BaseModel):
    estado: str


class PreguntaEstudiosReq(BaseModel):
    pregunta: str
    historial: list[dict] = []


@router.post("/consultations/{consultation_id}/estudios/preguntar")
def preguntar_estudios(consultation_id: str, body: PreguntaEstudiosReq, user: dict = Depends(require_user)):
    """Megi IA sobre lo analizado en ESTA consulta (hechos de los modelos y
    pre-diagnóstico vigente). Mismo contrato que el chat del expediente."""
    pregunta = (body.pregunta or "").strip()
    if not pregunta:
        return {"respuesta": "", "fuente": "mock", "error": "pregunta vacía"}
    historial = [h for h in (body.historial or []) if isinstance(h, dict) and (h.get("texto") or "").strip()][-6:]
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        r = analisis.preguntar_estudios(conn, consultation_id, pregunta, historial)
    return {"pregunta": pregunta, **r, "aviso": "Respuesta de apoyo sobre lo que leyeron los modelos; verifica en el estudio original."}


@router.post("/consultations/{consultation_id}/estudios/estado")
def estado(consultation_id: str, body: EstadoReq, user: dict = Depends(require_user)):
    """«Continuar sin estudios» deja constancia; con archivos subidos no se
    puede marcar «sin estudios»."""
    if body.estado not in ESTADOS:
        raise HTTPException(status_code=400, detail="estado inválido")
    with db() as conn:
        owned_consultation(conn, consultation_id, user)
        n = conn.execute("SELECT count(*) FROM estudios_aportados WHERE consultation_id = ?",
                         (consultation_id,)).fetchone()[0]
        if body.estado == "sin_estudios" and n:
            raise HTTPException(status_code=409, detail="la consulta ya tiene estudios subidos")
        conn.execute("UPDATE consultations SET estudios_estado = ?, updated_at = ? WHERE id = ?",
                     (body.estado, _now(), consultation_id))
    return {"ok": True, "estado": body.estado}


# -------------------------------------------------------------- enlace para QR
def _base_publica(request: Request) -> str:
    """Dónde vive la página que abrirá el teléfono. MEGI_PUBLIC_URL manda (en
    desarrollo, la IP del Mac en la Wi-Fi); si no, el origen desde el que el
    médico está usando la app (en producción, https://megiia.com)."""
    if PUBLIC_URL:
        return PUBLIC_URL.rstrip("/")
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


@router.post("/consultations/{consultation_id}/estudios/enlace")
def crear_enlace(consultation_id: str, request: Request, user: dict = Depends(require_user)):
    token = secrets.token_urlsafe(24)
    expires = time.time() + ENLACE_TTL_S
    with db() as conn:
        c = owned_consultation(conn, consultation_id, user)
        # Un enlace vivo por consulta: el anterior se revoca al generar otro.
        conn.execute("UPDATE enlaces_subida SET revoked_at = ? WHERE consultation_id = ? AND revoked_at IS NULL",
                     (_now(), consultation_id))
        conn.execute(
            "INSERT INTO enlaces_subida (token, consultation_id, patient_id, created_by, created_at, expires_at) "
            "VALUES (?,?,?,?,?,?)",
            (token, consultation_id, c["patient_id"], user["username"], _now(), expires))
    return {"token": token, "url": f"{_base_publica(request)}/subir/{token}",
            "expires_at": datetime.fromtimestamp(expires, tz=timezone.utc).isoformat(),
            "expira_en_s": ENLACE_TTL_S}




# ------------------------------------------------------------- Radiología MEGI
@router.get("/radiologia/modelos")
def modelos_radiologia(user: dict = Depends(require_user)):
    """Catálogo de modelos de radiodiagnóstico: los conectados y los que vienen."""
    return analisis.catalogo_modelos()


@router.post("/patients/{patient_id}/radiologia/carpeta")
def carpeta_radiologia(patient_id: str, user: dict = Depends(require_user)):
    """Los estudios de Radiología cuelgan de una «carpeta» del paciente: una
    consulta con status 'radiologia', una por paciente, que NO aparece en su
    historial de consultas ni se confunde con un borrador clínico. Así la
    subida, el QR, la identificación y el análisis son exactamente los mismos
    que en la pantalla previa al SOAP."""
    with db() as conn:
        owned_patient(conn, patient_id, user)
        r = conn.execute("SELECT id FROM consultations WHERE patient_id = ? AND status = 'radiologia' ORDER BY started_at DESC LIMIT 1",
                         (patient_id,)).fetchone()
        if r:
            return {"id": r["id"], "patient_id": patient_id, "nueva": False}
        import uuid as _uuid
        cid = "C-" + _uuid.uuid4().hex[:8]
        conn.execute("INSERT INTO consultations (id, patient_id, status, started_at, updated_at, doctor_id, motivo) VALUES (?,?,?,?,?,?,?)",
                     (cid, patient_id, "radiologia", _now(), _now(), doctor_of(user), "Radiología"))
    return {"id": cid, "patient_id": patient_id, "nueva": True}


# ------------------------------------------------------------- Anestesio (restringido)
@router.get("/anestesio/modelos")
def modelos_anestesio(user: dict = Depends(require_user)):
    """Catálogo de MEGI Anestesiología. Restringido: administradores y médicos
    con `acceso_anestesio`. A los demás se les dice por qué (403), sin catálogo."""
    from ..services import anestesio
    with db() as conn:
        r = conn.execute("SELECT role, acceso_anestesio FROM users WHERE username = ?", (user.get("username"),)).fetchone()
    autorizado = bool(r) and (r["role"] == "admin" or bool(r["acceso_anestesio"]))
    if not autorizado:
        raise HTTPException(status_code=403, detail=anestesio.AVISO_RESTRINGIDO)
    return anestesio.catalogo()


class IngresoAnestesioReq(BaseModel):
    password: str


@router.post("/anestesio/ingresar")
def ingresar_anestesio(body: IngresoAnestesioReq, user: dict = Depends(require_user)):
    """Segundo factor de la sección: el médico vuelve a teclear SU contraseña
    para abrir la mesa del anestesiólogo. Solo con acceso autorizado. Devuelve
    la URL de la mesa (relativa: se sirve dentro de MEGI por /mesa) y la caducidad del pase."""
    from ..services import anestesio
    from . import mesa_proxy
    from .users import verify_user
    with db() as conn:
        r = conn.execute("SELECT role, acceso_anestesio FROM users WHERE username = ?", (user.get("username"),)).fetchone()
    if not (r and (r["role"] == "admin" or bool(r["acceso_anestesio"]))):
        raise HTTPException(status_code=403, detail=anestesio.AVISO_RESTRINGIDO)
    if not verify_user(user.get("username"), body.password or ""):
        raise HTTPException(status_code=401, detail="contraseña incorrecta")
    # Pase de un solo uso (90 s): la mesa lo valida contra MEGI y abre su sesión.
    token = secrets.token_urlsafe(24)
    with db() as conn:
        conn.execute("DELETE FROM pases_anestesio WHERE expires_at < ?", (time.time(),))
        conn.execute("INSERT INTO pases_anestesio (token, username, created_at, expires_at) VALUES (?,?,?,?)",
                     (token, user.get("username"), _now(), time.time() + PASE_TTL_S))
    # La URL es relativa: la mesa se sirve DENTRO de MEGI por /mesa (routes/mesa_proxy.py).
    return {"ok": True, "url": f"{mesa_proxy.PREFIJO}/?pase={token}", "expira_en_s": PASE_TTL_S, "pase": token}


PASE_TTL_S = 90


class PaseReq(BaseModel):
    pase: str
