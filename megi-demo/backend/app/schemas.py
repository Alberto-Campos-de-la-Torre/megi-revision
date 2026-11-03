"""Modelos Pydantic v2 de request/response (paridad de forma demo/mock/real)."""
from typing import Any, Literal, Optional

from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str
    password: str
    name: Optional[str] = ""
    role: Literal["admin", "medico"] = "medico"
    # Oculto para los demás administradores: solo lo ve y administra quien lo crea.
    solo_visible_para_mi: bool = False


class SetupRequest(BaseModel):
    """Primer arranque: crea el primer administrador (solo si no existe ninguno)."""
    username: str
    password: str
    name: Optional[str] = ""


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class PatientCreate(BaseModel):
    name: str
    age: int
    sex: Literal["M", "F"]
    reason: str
    curp: Optional[str] = ""
    nss: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    kind: Literal["cita", "espontaneo"] = "cita"
    scheduled_date: Optional[str] = None   # YYYY-MM-DD (solo si kind == 'cita')
    time: Optional[str] = None             # HH:MM (solo si kind == 'cita')
    birthdate: Optional[str] = None        # YYYY-MM-DD (motor de edad)
    gestacional_semanas: Optional[int] = None  # edad gestacional al nacer


class PatientProfileUpdate(BaseModel):
    # Perfil médico que el médico confirma tras la consulta (su visto bueno).
    allergies: Optional[list] = None
    chronic: Optional[list] = None


class AppointmentCreate(BaseModel):
    patient_id: str
    consultation_id: Optional[str] = None
    scheduled_date: str               # YYYY-MM-DD
    time: Optional[str] = None
    reason: Optional[str] = "Control / seguimiento"


class RxCheckRequest(BaseModel):
    rx_list: Optional[list] = None
    allergies: Optional[list] = None
    chronic: Optional[list] = None


class DocumentCreate(BaseModel):
    consultation_id: str
    patient_id: Optional[str] = None
    kind: str                      # referencia | orden_estudios | incapacidad
    content: dict = {}


class ConsultationCreate(BaseModel):
    patient_id: str
    motivo: Optional[str] = None   # motivo de ESTA consulta; si falta, se busca en la agenda
    # Solo volver a engancharse al borrador abierto de hoy (tras un refresco de
    # la página). NUNCA crea: si no hay borrador, 404. Sin esto, un simple
    # refresco podía fabricar una consulta nueva por el respaldo de «paciente
    # dado de alta hoy».
    solo_retomar: bool = False


class ConsultationPatch(BaseModel):
    status: Optional[str] = None


class TranscribeRequest(BaseModel):
    consultation_id: Optional[str] = None
    audio_ref: Optional[str] = None
    asr_text: Optional[str] = None


class IdentifierResolveRequest(BaseModel):
    consultation_id: Optional[str] = None
    field: Literal["curp", "nss"]
    raw_value: str = ""


class ReviewSaveRequest(BaseModel):
    consultation_id: Optional[str] = None
    soap: Optional[dict] = None
    selected_dx: Optional[list] = None
    rx_list: Optional[list] = None
    notes: Optional[str] = None
    identifiers: Optional[list] = None


class DoctorProfileUpdate(BaseModel):
    """Perfil profesional del médico (lo que se imprime en documentos legales)."""
    name: Optional[str] = None
    specialty: Optional[str] = None
    cedula: Optional[str] = None
    cedula_esp: Optional[str] = None
    institution: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    equipo: Optional[list] = None   # modalidades disponibles en su consultorio


class AsrTicketRequest(BaseModel):
    """Ticket de streaming: la consulta es opcional y solo sirve para auditoría."""
    consultation_id: Optional[str] = None


class ReviewEventRequest(BaseModel):
    """Auditoría de un cambio hecho por voz (Fase 4). Se persiste en review_events."""
    consultation_id: str
    kind: Optional[str] = "voice_edit"
    payload: dict


class ReviewApproveRequest(BaseModel):
    consultation_id: Optional[str] = None
    actor: Optional[str] = None           # IGNORADO: quien firma sale del token

    soap: Optional[dict] = None          # nota final del médico (con ediciones)
    selected_dx: Optional[list] = None
    rx_list: Optional[list] = None
    notes: Optional[str] = None
    safety_alerts: Optional[list] = None  # alertas de seguridad mostradas al aprobar
    safety_ack: Optional[bool] = None     # el médico confirmó a pesar de alertas
    vitals: Optional[dict] = None         # signos vitales estructurados confirmados
    allergies: Optional[list] = None      # para recalcular seguridad en el backend
    chronic: Optional[list] = None


# Respuestas se devuelven como dict para máxima flexibilidad en Sprint 1;
# los contratos clave (resolver, export) están documentados en services/.
ResolverState = Literal["VALUE", "MULTI_CANDIDATE", "ABSTAIN", "INVALID"]
