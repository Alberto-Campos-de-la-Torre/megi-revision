"""Resolver de identificadores MOCK con los 4 estados del contrato v1.6A.

Política (deja preparado resolver_v1.1, aunque simulado):
  - RAW y RESOLVED salen del mismo candidate_base (no inventa caracteres).
  - NO adivina la "B/V pelona": ante ambigüedad emite MULTI_CANDIDATE.
  - Prefiere ABSTAIN/INVALID antes que un VALUE dudoso (falsos disparos controlados).

Estados: VALUE | MULTI_CANDIDATE | ABSTAIN | INVALID
"""
import re

CURP_RE = re.compile(r"^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$")


def resolve(field: str, raw_value: str) -> dict:
    raw = (raw_value or "").strip()
    upper = raw.upper()

    # ABSTAIN: sin señal suficiente
    if not raw or raw == "???":
        return {
            "field": field, "raw_value": raw, "state": "ABSTAIN",
            "reason": "audio_insuficiente", "requires_confirmation": True,
        }

    # MULTI_CANDIDATE: B/V pelona deletreada ("be", "ve", "uve") -> no se decide solo
    if re.search(r"\b(be|ve|uve)\b", raw, re.IGNORECASE):
        base_b = re.sub(r"\b(BE|VE|UVE)\b", "B", upper, flags=re.IGNORECASE).replace(" ", "")
        base_v = re.sub(r"\b(BE|VE|UVE)\b", "V", upper, flags=re.IGNORECASE).replace(" ", "")
        return {
            "field": field, "raw_value": raw, "state": "MULTI_CANDIDATE",
            "candidates": [
                {"value": base_b, "confidence": 0.52, "rationale": "interpretación con B"},
                {"value": base_v, "confidence": 0.48, "rationale": "interpretación con V"},
            ],
            "requires_confirmation": True, "reason": "bv_pelona_ambiguous",
        }

    compact = re.sub(r"\s+", "", upper)

    if field == "curp":
        if not CURP_RE.match(compact):
            return {
                "field": field, "raw_value": raw, "state": "INVALID",
                "reason": "estructura_curp_invalida", "value": compact,
            }
        return {
            "field": field, "raw_value": raw, "state": "VALUE",
            "value": compact, "normalized": compact, "confidence": 0.95,
            "requires_confirmation": False,
        }

    if field == "nss":
        digits = re.sub(r"\D", "", compact)
        if len(digits) != 11:
            return {
                "field": field, "raw_value": raw, "state": "INVALID",
                "reason": "longitud_nss_invalida", "value": compact,
            }
        return {
            "field": field, "raw_value": raw, "state": "VALUE",
            "value": digits, "normalized": digits, "confidence": 0.96,
            "requires_confirmation": False,
        }

    return {
        "field": field, "raw_value": raw, "state": "VALUE",
        "value": compact, "normalized": compact, "confidence": 0.9,
        "requires_confirmation": False,
    }
