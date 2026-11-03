"""Helpers de persistencia para trazabilidad (review_events, identifier_results, exports)."""
import json
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_review_event(conn, consultation_id, kind, payload, actor=None) -> None:
    conn.execute(
        "INSERT INTO review_events (consultation_id, kind, payload, actor, created_at) VALUES (?,?,?,?,?)",
        (consultation_id, kind, json.dumps(payload, ensure_ascii=False), actor, _now()),
    )


def log_identifier_result(conn, consultation_id, result: dict) -> None:
    conn.execute(
        """INSERT INTO identifier_results
           (consultation_id, field, raw_value, state, resolved_value, candidates, requires_confirmation, created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (
            consultation_id,
            result.get("field"),
            result.get("raw_value"),
            result.get("state"),
            result.get("value") or result.get("normalized"),
            json.dumps(result.get("candidates"), ensure_ascii=False) if result.get("candidates") else None,
            1 if result.get("requires_confirmation") else 0,
            _now(),
        ),
    )


def log_export(conn, consultation_id, kind, content_hash, payload) -> None:
    conn.execute(
        "INSERT INTO exports (consultation_id, kind, content_hash, signature, signed_at, payload) VALUES (?,?,?,?,?,?)",
        (
            consultation_id, kind, content_hash,
            "mock_not_legal_signature", _now(),
            json.dumps(payload, ensure_ascii=False),
        ),
    )
