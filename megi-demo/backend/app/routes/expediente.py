"""Resumen del expediente y preguntas sobre el paciente, con el modelo.

Dos endpoints por paciente, además del expediente estructurado:

- POST /patients/{id}/expediente/resumen   -> resumen redactado del historial,
  consultas, estudios, envíos y citas.
- POST /patients/{id}/expediente/preguntar -> respuesta a una pregunta del
  médico, apoyada SOLO en el expediente.

Con `MEGI_REAL_ASR=true` redacta gemma (servicio MLX) a partir del texto
etiquetado del expediente; si el servicio no responde, o en `local_mock`, se
devuelve la versión determinista de `services/expediente.py`, marcada con
`fuente` para que la interfaz lo diga. Nada se guarda: el resumen es apoyo,
no documento clínico. La pertenencia se valida contra el paciente (404 ajeno).
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..db import db
from ..ownership import owned_patient
from ..security import require_user
from ..services import expediente as exp_srv
from .patients import _row_to_patient

router = APIRouter()

_AVISO = "Resumen generado automáticamente a partir del expediente; verifica en la fuente antes de decidir."
_MAX_HISTORIAL = 6


class PreguntaReq(BaseModel):
    pregunta: str
    # Últimos turnos [{"rol": "medico"|"megi", "texto": "..."}] para seguir el hilo.
    historial: list[dict] = []


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cargar(patient_id: str, user: dict) -> dict:
    with db() as conn:
        r = owned_patient(conn, patient_id, user)
        return exp_srv.construir(conn, _row_to_patient(r))


def _modo_real() -> bool:
    from ..config import REAL_ASR
    return bool(REAL_ASR)


@router.get("/patients/{patient_id}/expediente")
def expediente(patient_id: str, user: dict = Depends(require_user)):
    """Expediente estructurado (sin modelo): lo que alimenta el resumen."""
    return _cargar(patient_id, user)


@router.post("/patients/{patient_id}/expediente/resumen")
def resumen(patient_id: str, user: dict = Depends(require_user)):
    exp = _cargar(patient_id, user)
    base = {"paciente": exp["paciente"], "conteos": exp["conteos"], "secciones": exp_srv.secciones(exp),
            "generado_en": _now(), "aviso": _AVISO}
    if _modo_real():
        from ..services import asr_client
        try:
            r = asr_client.expediente_resumen(exp_srv.texto_para_llm(exp))
            if r.get("status") == "done" and (r.get("resumen") or "").strip():
                return {**base, "resumen": r["resumen"].strip(), "fuente": "llm",
                        "modelo": r.get("model"), "latency_ms": r.get("latency_ms")}
            error = r.get("error") or "respuesta vacía"
        except Exception as e:  # servicio caído: el médico sigue viendo algo útil
            error = str(e)
        return {**base, "resumen": exp_srv.resumen_mock(exp), "fuente": "sin_modelo", "error": error}
    return {**base, "resumen": exp_srv.resumen_mock(exp), "fuente": "mock"}


@router.post("/patients/{patient_id}/expediente/preguntar")
def preguntar(patient_id: str, body: PreguntaReq, user: dict = Depends(require_user)):
    pregunta = (body.pregunta or "").strip()
    if not pregunta:
        return {"respuesta": "", "fuente": "mock", "error": "pregunta vacía"}
    exp = _cargar(patient_id, user)
    historial = [h for h in (body.historial or [])
                 if isinstance(h, dict) and (h.get("texto") or "").strip()][-_MAX_HISTORIAL:]
    base = {"pregunta": pregunta, "generado_en": _now(), "aviso": _AVISO}
    if _modo_real():
        from ..services import asr_client
        try:
            r = asr_client.expediente_preguntar(exp_srv.texto_para_llm(exp), pregunta, historial)
            if r.get("status") == "done" and (r.get("respuesta") or "").strip():
                return {**base, "respuesta": r["respuesta"].strip(), "fuente": "llm",
                        "modelo": r.get("model"), "latency_ms": r.get("latency_ms")}
            error = r.get("error") or "respuesta vacía"
        except Exception as e:
            error = str(e)
        return {**base, "respuesta": exp_srv.responder_mock(exp, pregunta), "fuente": "sin_modelo", "error": error}
    return {**base, "respuesta": exp_srv.responder_mock(exp, pregunta), "fuente": "mock"}
