"""Scrubber de frases de comando en el transcript clínico (Fase 7).

Defensa en profundidad, NO el mecanismo primario: la exclusión real ocurre en el
frontend (sesión única de audio que separa carril clínico y carril de comando).
Este filtro es el airbag: si una frase "MEGI, ..." se cuela a un chunk clínico
(comando dicho sin push-to-command, eco, etc.), se elimina ANTES de hacer stitch
al transcript confirmado — es decir, antes de que el LLM del SOAP pueda verla.

Se elimina desde la palabra de activación hasta el fin de la oración. Variantes
cubiertas: megi / meji / megí (errores típicos del ASR). Un scrub NUNCA falla el
chunk: ante duda se devuelve el texto original.
"""
from __future__ import annotations

import re

# Desde la palabra de activación (con variantes de ASR) hasta el fin de oración.
# El whisper v1.5 real escribe "MEGI" como "Meji" (verificado); se cubren además
# megi/megí/megui/meggi.
_WAKE_PHRASE = re.compile(
    r"(?iu)(?:^|(?<=[\s.,;:!?¡¿\"“”'«»()\[\]-]))me[gj]{1,2}u?[ií]\b[\s,.:;]*[^.!?\n]*[.!?]?",
)


def extract_wake_command(text: str) -> str | None:
    """Fase 8 (manos libres): si el texto contiene la palabra de activación,
    devuelve el COMANDO (desde el wake word hasta el fin de esa oración).
    Devuelve None si no hay wake word — en ese caso el llamador NO debe exponer
    el texto (es habla clínica, no un comando)."""
    if not text:
        return None
    m = _WAKE_PHRASE.search(text)
    if not m:
        return None
    return m.group(0).strip()


def scrub_wake_phrases(text: str) -> tuple[str, int]:
    """Devuelve (texto_limpio, frases_eliminadas). Si no hay wake word, el texto
    regresa intacto (misma instancia)."""
    if not text or "eg" not in text.lower() and "ej" not in text.lower():
        return text, 0
    try:
        scrubbed, hits = _WAKE_PHRASE.subn(" ", text)
        if not hits:
            return text, 0
        scrubbed = re.sub(r"\s{2,}", " ", scrubbed).strip()
        return scrubbed, hits
    except Exception:
        return text, 0
