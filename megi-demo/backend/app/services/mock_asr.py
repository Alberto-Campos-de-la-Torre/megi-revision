"""Implementaciones ASR mock. Devuelven estructuras realistas sin inferencia."""
from ..config import load_seed


class MockGeneralASR:
    route = "general"

    def __init__(self, model_id: str):
        self.model_id = model_id

    def transcribe(self, *, audio_ref=None, asr_text=None) -> dict:
        seed = load_seed()
        return {
            "route": self.route,
            "model_route": "mock_v1.5_general",
            "model_id": self.model_id,
            "transcript": seed["TRANSCRIPT"],
        }


class MockIdentifierASR:
    route = "identifier"

    def __init__(self, model_id: str):
        self.model_id = model_id

    def transcribe(self, *, audio_ref=None, asr_text=None) -> dict:
        # Echo del texto deletreado; el resolver decide el estado.
        return {
            "route": self.route,
            "model_route": "mock_v1.6A_identifier",
            "model_id": self.model_id,
            "resolver": "mock_resolver_v1.1",
            "asr_text": asr_text or "",
        }
