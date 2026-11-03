"""P1: proxy autenticado del WebSocket de streaming ASR.

El navegador ya NO abre el WS directo contra el microservicio :8010 (que no
valida sesión). Ahora lo abre contra el backend, que:
  1) exige un TICKET de un solo uso y 30 s de vida (`POST /api/asr/ticket`,
     autenticado con la cabecera normal). Antes viajaba el token de sesión en el
     query string, que podía quedar registrado en logs (hallazgo #6);
  2) valida el `Origin` del navegador contra la lista de orígenes permitidos;
  3) reenvía audio/mensajes hacia el ASR aislado en 127.0.0.1:8010,
  4) devuelve al navegador lo que el ASR emite,
  5) deja traza de inicio/fin de streaming en la auditoría.

Así el ASR queda sin tráfico directo del exterior y toda conexión pasa por auth.
"""
import asyncio

import websockets
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from .. import ws_tickets
from ..config import ALLOWED_ORIGINS, ASR_SERVICE_URL, ASR_TOKEN
from ..db import db
from ..schemas import AsrTicketRequest
from ..security import require_user
from ..services import audit_log

router = APIRouter()

# http://localhost:8010 -> ws://localhost:8010/v1/stream/general
_ASR_WS_URL = (
    ASR_SERVICE_URL.replace("https://", "wss://").replace("http://", "ws://").rstrip("/")
    + "/v1/stream/general"
)
# Token compartido backend<->ASR (mismo que asr_client; vacío = ASR abierto).
_ASR_HEADERS = {"X-MEGI-ASR-Token": ASR_TOKEN} if ASR_TOKEN else {}


@router.post("/asr/ticket")
def asr_ticket(body: AsrTicketRequest = None, user: dict = Depends(require_user)):
    """Ticket efímero de un solo uso para abrir el WS de streaming.

    Este router es público a nivel de app (el WS valida por su cuenta), así que
    la dependencia de sesión va aquí, en el endpoint."""
    cid = (body.consultation_id or "") if body else ""
    return ws_tickets.issue(user, cid)


def _origin_allowed(origin: str) -> bool:
    # Sin Origin = cliente no-navegador (tests, CLI local): se permite. Con
    # Origin, tiene que ser uno de los del frontend.
    return not origin or origin in ALLOWED_ORIGINS


def _audit(cid: str, kind: str, actor: str, payload: dict) -> None:
    try:
        with db() as conn:
            if cid and not conn.execute(
                "SELECT 1 FROM consultations WHERE id = ?", (cid,)
            ).fetchone():
                cid = None
            audit_log.log_review_event(conn, cid, kind, payload, actor=actor)
    except Exception:
        pass  # la auditoría nunca debe tumbar el streaming


@router.websocket("/asr/stream/general")
async def asr_stream_proxy(ws: WebSocket):
    # Auth antes de aceptar: ticket de un solo uso + Origin del navegador.
    if not _origin_allowed(ws.headers.get("origin", "")):
        await ws.close(code=1008)  # policy violation
        return
    ctx = ws_tickets.redeem(ws.query_params.get("ticket", ""))
    if not ctx:
        await ws.close(code=1008)
        return
    await ws.accept()

    actor = ctx.get("name") or ctx.get("username")
    cid = ctx.get("consultation_id") or ""
    _audit(cid, "stream_start", actor, {"consultation_id": cid})
    try:
        async with websockets.connect(
            _ASR_WS_URL, max_size=None, additional_headers=_ASR_HEADERS
        ) as upstream:

            async def client_to_asr():
                try:
                    while True:
                        msg = await ws.receive()
                        if msg["type"] == "websocket.disconnect":
                            break
                        if msg.get("bytes") is not None:
                            await upstream.send(msg["bytes"])       # audio PCM
                        elif msg.get("text") is not None:
                            await upstream.send(msg["text"])        # control/JSON
                except (WebSocketDisconnect, RuntimeError):
                    pass
                finally:
                    await upstream.close()

            async def asr_to_client():
                try:
                    async for m in upstream:
                        if isinstance(m, bytes):
                            await ws.send_bytes(m)
                        else:
                            await ws.send_text(m)
                except websockets.ConnectionClosed:
                    pass

            await asyncio.gather(client_to_asr(), asr_to_client())
    except Exception as e:  # ASR caído / handshake fallido
        try:
            await ws.send_json({"type": "error", "detail": f"ASR no disponible: {e}"})
        except Exception:
            pass
    finally:
        _audit(cid, "stream_end", actor, {"consultation_id": cid})
        try:
            await ws.close()
        except Exception:
            pass
