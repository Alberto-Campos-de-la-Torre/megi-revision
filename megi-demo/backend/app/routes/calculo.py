"""Calculadoras clínicas deterministas (gasometría, ácido-base, electrolitos).

SIN ESTADO a propósito: no reciben paciente, no consultan la base y no guardan
nada. Son aritmética pura sobre valores que el médico teclea, así que no abren
superficie nueva de PHI ni necesitan las guardas de pertenencia. Exigen usuario
autenticado como todo lo clínico (lo impone `main.py`).

Los cálculos viven en `services/gasometria.py`; aquí solo se validan y exponen.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import gasometria

router = APIRouter()


class GasometriaReq(BaseModel):
    ph: float
    pco2: float
    hco3: float
    na: float | None = None
    cl: float | None = None
    k: float | None = None
    albumina: float | None = None
    glucosa: float | None = None
    calcio: float | None = None
    pao2: float | None = None
    fio2: float | None = None
    lactato: float | None = None


class SerieReq(BaseModel):
    serie: list[dict]


@router.post("/calculo/gasometria")
def calcular_gasometria(req: GasometriaReq):
    """Lectura completa: trastorno primario, compensación (Winter y las demás),
    anión gap corregido, Δ/Δ, correcciones de Na/Ca, PaO₂/FiO₂, lactato y K⁺."""
    try:
        return gasometria.interpretar(**req.model_dump())
    except gasometria.DatoFueraDeRango as e:
        # 400 y no 500: es un dato mal capturado, y el médico tiene que verlo.
        raise HTTPException(status_code=400, detail=str(e)) from None


@router.post("/calculo/gasometria/tendencia")
def calcular_tendencia(req: SerieReq):
    """Evolución de gasometrías SERIADAS del mismo paciente crítico: una
    aislada dice poco, lo que orienta es hacia dónde va."""
    return gasometria.tendencia(req.serie)
