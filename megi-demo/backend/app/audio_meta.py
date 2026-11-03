"""Taxonomía y política de retención del audio almacenado (v0.0.1).

DECISIÓN: todo audio que entra a MEGI se RETIENE (no hay purga automática).
El audio es evidencia de auditoría de cómo se generó la nota, la receta o un
cambio por comando de voz. Para que una auditoría pueda reconstruir los hechos,
cada audio queda clasificado igual en dos lugares:

  1. la fila de la tabla `audio` (uploaded_by, purpose, retention), y
  2. el `meta.json` junto al archivo (legible sin la base de datos).

`audio_kind` dice QUÉ es el audio; `purpose` dice PARA QUÉ se usó. Cualquier
ruta que guarde audio debe clasificarlo con `audit_meta()` — no inventar
valores sueltos por ruta.
"""
from __future__ import annotations

RETENTION_POLICY = "retain_all"  # sin purga automática; borrar es decisión manual/institucional

# audio_kind -> qué es y para qué se usó (texto que verá un auditor).
AUDIO_KINDS = {
    "general_consultation": {
        "label": "Audio de consulta (grabación completa)",
        "purpose": "Transcripción clínica para generar la nota SOAP de la consulta.",
    },
    "chunk": {
        "label": "Fragmento de consulta en vivo",
        "purpose": "Transcripción incremental durante la consulta (SOAP en vivo).",
    },
    "identifier_slot": {
        "label": "Dictado de identificador del paciente",
        "purpose": "Captura de un identificador (CURP/NSS/INE/RFC) dictado, para el expediente.",
    },
    "voice_command": {
        "label": "Comando de voz a la interfaz",
        "purpose": "Orden hablada a MEGI (navegar/proponer ediciones); no forma parte de la nota clínica.",
    },
}


def audit_meta(audio_kind: str, uploaded_by: str | None = None) -> dict:
    """Bloque de clasificación auditable para un audio recién guardado."""
    info = AUDIO_KINDS.get(audio_kind) or {"label": audio_kind, "purpose": "(sin clasificar)"}
    return {
        "audio_kind": audio_kind,
        "audio_kind_label": info["label"],
        "purpose": info["purpose"],
        "uploaded_by": uploaded_by,
        "retention": RETENTION_POLICY,
    }
