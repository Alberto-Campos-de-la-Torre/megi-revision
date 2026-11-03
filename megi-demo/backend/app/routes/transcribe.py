from fastapi import APIRouter

from ..schemas import TranscribeRequest
from ..services import asr

router = APIRouter()


@router.post("/transcribe/general/mock")
def transcribe_general(body: TranscribeRequest):
    return asr.get_asr("general").transcribe(audio_ref=body.audio_ref, asr_text=body.asr_text)


@router.post("/transcribe/identifier/mock")
def transcribe_identifier(body: TranscribeRequest):
    return asr.get_asr("identifier").transcribe(audio_ref=body.audio_ref, asr_text=body.asr_text)
