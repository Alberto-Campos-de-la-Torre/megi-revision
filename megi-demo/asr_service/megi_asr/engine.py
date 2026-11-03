"""Motor MLX: whisper, normalizador, resolver de identificadores y streaming.

Aquí viven los imports que fallan ruidosamente si el venv o `MEGI_ENGINE_DIR`
no son correctos; el resto del servicio los consume ya resueltos."""
import sys

import numpy as np

from .config import (
    DEFAULT_CLINICAL_PROMPT,
    GENERAL_MODEL,
    METAL_CACHE_LIMIT,
    POSTROLL_S,
    WARMUP_S,
    _VAD_MIN_SILENCE_MS,
)

import mlx_whisper  # noqa: E402

try:
    import mlx.core as mx  # noqa: E402
    if METAL_CACHE_LIMIT > 0:
        _set_limit = getattr(mx, "set_cache_limit", None) or getattr(mx.metal, "set_cache_limit")
        _set_limit(METAL_CACHE_LIMIT)
except Exception as e:  # pragma: no cover
    print(f"[asr] aviso: no se pudo fijar metal cache limit: {e}", file=sys.stderr)

try:
    from normalization.core import normalize_text  # noqa: E402
except Exception as e:  # pragma: no cover
    normalize_text = None
    print(f"[asr] aviso: normalizer no disponible: {e}", file=sys.stderr)

from identifiers.resolver.resolver import resolve_text  # noqa: E402,F401

import difflib  # noqa: E402,F401
try:
    from streaming.engine import StreamingEngine, EngineConfig  # noqa: E402
except Exception as e:  # pragma: no cover
    StreamingEngine = None
    EngineConfig = None
    print(f"[asr] aviso: StreamingEngine no disponible: {e}", file=sys.stderr)

def make_stream_engine():
    """EngineConfig de streaming = config de producción del webui (prompt clínico +
    thresholds permisivos + VAD afinable)."""
    return StreamingEngine(EngineConfig(
        model_path=GENERAL_MODEL,
        window_s=6.0,
        overlap_s=2.0,
        initial_clinical_prompt=DEFAULT_CLINICAL_PROMPT,
        vad_min_silence_ms=_VAD_MIN_SILENCE_MS,
        logprob_threshold=-1.0,
        no_speech_threshold=0.7,
        safety_s=0.2,
        numunit_safety_s=0.5,
    ))


def stream_warmup(eng) -> None:
    """Warm-up sintético (6s silencio) + reset del contador de speech: evita perder
    las primeras palabras por cold-start (replica el webui)."""
    import numpy as _np
    eng.push_audio(_np.zeros(int(WARMUP_S * 16000), dtype=_np.float32))
    try:
        eng._speech_samples_acc = 0
    except Exception:
        pass


def stream_postroll(eng) -> None:
    """Post-roll (4s silencio) para gatillar VAD speech_end y commitear el último
    segmento (el 'final'). Reemplaza al force_flush, que alucinaba en silencio."""
    import numpy as _np
    eng.push_audio(_np.zeros(int(POSTROLL_S * 16000), dtype=_np.float32))


# ------------------------------------------------- seguridad local (rev. 2026-07-12)
# Hallazgo #4: sin esto, cualquier proceso local podía pedir transcribir/embeber
# cualquier archivo legible. Dos capas independientes:
#   1) audio_path restringido a MEGI_ASR_AUDIO_DIRS (default: backend/data).
def _transcribe(audio: np.ndarray, model_path: str, initial_prompt: str | None = None) -> dict:
    return mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=model_path,
        language="es",
        task="transcribe",
        verbose=False,
        word_timestamps=False,
        initial_prompt=initial_prompt,
        condition_on_previous_text=False,
    )


# Re-exportados a propósito: los routers los consumen desde aquí para no
# repetir el arranque del motor en cada módulo.
__all__ = [
    "EngineConfig", "StreamingEngine", "_transcribe", "difflib",
    "make_stream_engine", "normalize_text", "resolve_text",
    "stream_postroll", "stream_warmup",
]
