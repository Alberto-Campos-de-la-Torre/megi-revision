from fastapi import APIRouter

from ..db import db
from ..schemas import IdentifierResolveRequest
from ..services import audit_log, mock_resolver

router = APIRouter()


@router.post("/identifier/resolve/mock")
def resolve_identifier(body: IdentifierResolveRequest):
    result = mock_resolver.resolve(body.field, body.raw_value)
    if body.consultation_id:
        with db() as conn:
            audit_log.log_identifier_result(conn, body.consultation_id, result)
    return result
