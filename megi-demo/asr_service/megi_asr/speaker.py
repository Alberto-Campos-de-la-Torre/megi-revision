"""Huella vocal: extractor de embeddings (sherpa-onnx + WeSpeaker)."""
import os
from .config import SERVICE_DIR


# ------------------------------------------------ huella vocal (Fase 10)
# Embedding de hablante LOCAL (sherpa-onnx + WeSpeaker CAM++_LM, 29MB, emb512).
# El servicio SOLO calcula el embedding; el enrolamiento, el umbral y la
# decisión de autorización viven en el backend MEGI (comparación local, NIST).
SPEAKER_MODEL = os.environ.get(
    "MEGI_SPEAKER_MODEL",
    str(SERVICE_DIR / "models" / "speaker" / "wespeaker_en_voxceleb_CAMpp_LM.onnx"),
)
_SPK = {"extractor": None, "error": None}


def _get_speaker_extractor():
    if _SPK["extractor"] is None and _SPK["error"] is None:
        try:
            import sherpa_onnx
            cfg = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=SPEAKER_MODEL, num_threads=2)
            _SPK["extractor"] = sherpa_onnx.SpeakerEmbeddingExtractor(cfg)
        except Exception as e:  # pragma: no cover
            _SPK["error"] = str(e)
    return _SPK
