"""Qué queda por preguntar, en vivo, mientras avanza la consulta.

Cruza las sugerencias de la pre-consulta contra el transcript YA CONFIRMADO y
separa lo que ya se tocó de lo que sigue pendiente. Es la capa DETERMINISTA de
las sugerencias en vivo: no llama al LLM y por tanto **no compite por la GPU**
con la transcripción, que es el recurso escaso (Metal serializa el trabajo y ya
medimos que gemma degrada la transcripción simultánea).

Sesgo deliberado hacia el FALSO PENDIENTE: dar por preguntado algo que no se
preguntó esconde una bandera roja; dejar de más en la lista solo hace ruido. Por
eso:

  - Solo se vigila lo que trae `claves` (cómo suena el tema en la conversación).
    Una sugerencia sin claves no se sigue: adivinar sería peor que no seguir.
  - Una **alarma** necesita DOS claves distintas para darse por cubierta; el
    resto, una. Que se mencione "brazo" en una consulta no significa que se haya
    interrogado la irradiación del dolor.
"""
from __future__ import annotations

import unicodedata

CATEGORIA_ALARMA = "alarma"


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def _minimo(sugerencia: dict) -> int:
    """Cuántas claves distintas hacen falta para darla por cubierta."""
    claves = sugerencia.get("claves") or []
    if sugerencia.get("categoria") == CATEGORIA_ALARMA and len(claves) >= 2:
        return 2
    return 1


def pendientes(sugerencias: list, transcript: str, limite: int = 6) -> dict:
    """Separa sugerencias pendientes de cubiertas según el transcript.

    `limite` acota lo que se muestra en vivo: una lista de veinte cosas durante
    la consulta no la lee nadie. Las alarmas van primero y nunca se recortan
    antes que el resto.
    """
    texto = _norm(transcript)
    pend, cubiertas = [], []
    for s in sugerencias or []:
        claves = s.get("claves") or []
        if not claves:
            continue                     # no se vigila lo que no se sabe reconocer
        acertadas = [c for c in claves if _norm(c) in texto]
        item = dict(s)
        item["claves_vistas"] = acertadas
        (cubiertas if len(acertadas) >= _minimo(s) else pend).append(item)

    pend.sort(key=lambda s: (0 if s["categoria"] == CATEGORIA_ALARMA else 1,
                             0 if s.get("prioridad") == "alta" else 1))
    total = len(pend)
    return {
        "pendientes": pend[:limite],
        "n_pendientes": total,
        "n_ocultas": max(0, total - limite),
        "cubiertas": cubiertas,
        "n_cubiertas": len(cubiertas),
        "n_seguidas": total + len(cubiertas),
        "nota": ("Lo que aún no se ha escuchado en la consulta. MEGI sugiere; "
                 "el médico decide qué preguntar."),
    }
