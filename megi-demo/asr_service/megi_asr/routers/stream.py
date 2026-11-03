"""Streaming en vivo por WebSocket (shadow del batch, que es la fuente de verdad)."""
import json
import time
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..config import GENERAL_MODEL
from ..engine import StreamingEngine, difflib, _transcribe, make_stream_engine, normalize_text, stream_postroll, stream_warmup
from ..security import ASR_TOKEN, _token_ok
from .transcription import _clean_for_compare

router = APIRouter()

@router.websocket("/v1/stream/general")
async def stream_general(ws: WebSocket):
    """Streaming en vivo: recibe PCM 16k float32 (binario), emite parciales; al recibir
    {"cmd":"stop"} hace finalize + batch del PCM acumulado + comparación (shadow real)."""
    import numpy as _np
    # El middleware http no cubre WebSockets: misma auth compartida aquí.
    if ASR_TOKEN and not _token_ok(ws.headers.get("x-megi-asr-token", "")):
        await ws.close(code=1008)  # policy violation
        return
    await ws.accept()
    if StreamingEngine is None:
        await ws.send_text(json.dumps({"type": "error", "detail": "StreamingEngine no disponible"}))
        await ws.close()
        return

    eng = make_stream_engine()
    stream_warmup(eng)  # warm-up sintético: primera ventana lista, no se pierde el inicio
    pcm = []
    last = ""
    t0 = time.time()
    await ws.send_text(json.dumps({"type": "session_started", "model": Path(GENERAL_MODEL).name}))
    try:
        while True:
            msg = await ws.receive()
            if msg.get("bytes") is not None:
                arr = _np.frombuffer(msg["bytes"], dtype=_np.float32)
                if arr.size:
                    pcm.append(arr)
                    eng.push_audio(arr)
                    txt = eng.get_raw_text()
                    if txt != last:
                        await ws.send_text(json.dumps({"type": "partial", "delta": txt[len(last):], "text": txt}))
                        last = txt
            elif msg.get("text"):
                data = json.loads(msg["text"])
                if data.get("cmd") == "stop":
                    stream_postroll(eng)  # gatilla VAD speech_end -> commit del final
                    txt = eng.get_raw_text()
                    if txt != last:
                        await ws.send_text(json.dumps({"type": "partial", "delta": txt[len(last):], "text": txt}))
                        last = txt
                    stream_final = eng.get_normalized_text().strip()
                    audio = _np.concatenate(pcm) if pcm else _np.zeros(1, dtype=_np.float32)
                    rb = _transcribe(audio, GENERAL_MODEL)
                    batch = (rb.get("text") or "").strip()
                    batch_norm = normalize_text(batch).normalized if normalize_text else batch
                    bc, sc = _clean_for_compare(batch_norm), _clean_for_compare(stream_final)
                    sim = difflib.SequenceMatcher(a=bc.split(), b=sc.split()).ratio()
                    await ws.send_text(json.dumps({
                        "type": "final",
                        "streaming_final": stream_final,
                        "batch": batch_norm,
                        "content_similarity": round(sim, 4),
                        "duration_s": round(len(audio) / 16000, 2),
                        "wall_s": round(time.time() - t0, 1),
                    }))
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:  # pragma: no cover
        try:
            await ws.send_text(json.dumps({"type": "error", "detail": str(e)}))
        except Exception:
            pass
    finally:
        eng.close()
        try:
            await ws.close()
        except Exception:
            pass
