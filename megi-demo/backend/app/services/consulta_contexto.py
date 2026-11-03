"""Contexto que Megi IA puede ver al revisar UNA consulta.

Solo este paciente y solo lo clínico: transcripción original, SOAP automático,
SOAP limpio (el aprobado/final o el que el médico está editando ahora),
diagnósticos, receta, signos vitales, estudios aportados con su lectura y
pre-diagnóstico, y las consultas previas del mismo paciente en breve. Nada de
identificadores internos, usuarios, sellos ni otros pacientes. Cada bloque va
etiquetado ([T], [SA], [SL], [DX], [RX], [SV], [E#], [C#]) para que la
respuesta cite de dónde sale cada cosa.
"""
from __future__ import annotations

import json
import re
import unicodedata

from ..config import REAL_ASR
from . import analisis_estudios
from .expediente import _STOP, _SINONIMOS, _normaliza, construir

_MAX_TRANSCRIPT = 9000
_MAX_PREVIAS = 10


def _j(raw, fallback):
    if not raw:
        return fallback
    try:
        v = json.loads(raw)
    except (TypeError, ValueError):
        return fallback
    return v if isinstance(v, type(fallback)) else fallback


def _soap_txt(soap: dict) -> str:
    return "\n".join(f"  {k}: {str(soap.get(k) or '').strip()}" for k in ("S", "O", "A", "P") if soap.get(k))


def _dx_txt(dx) -> str:
    out = []
    for d in dx or []:
        if isinstance(d, dict):
            out.append(f"{(d.get('code') or '').strip()} {(d.get('label') or '').strip()}".strip())
        elif isinstance(d, str) and d.strip():
            out.append(d.strip())
    return "; ".join(x for x in out if x)


def _rx_txt(rx) -> str:
    out = []
    for r in rx or []:
        if isinstance(r, dict):
            out.append(" ".join(str(r.get(k)).strip() for k in ("drug", "dose", "freq", "indication") if r.get(k)))
        elif isinstance(r, str) and r.strip():
            out.append(r.strip())
    return "; ".join(x for x in out if x)


def construir_contexto(conn, consultation_id: str, soap_editado: dict | None = None,
                       dx_editados: list | None = None, rx_editados: list | None = None) -> str:
    c = conn.execute("SELECT * FROM consultations WHERE id = ?", (consultation_id,)).fetchone()
    if not c:
        raise KeyError(consultation_id)
    p = conn.execute("SELECT * FROM patients WHERE id = ?", (c["patient_id"],)).fetchone()
    pac = {"id": p["id"], "name": p["name"], "age": p["age"], "sex": p["sex"], "reason": p["reason"],
           "allergies": _j(p["allergies"], []), "chronic": _j(p["chronic"], []), "created_at": p["created_at"]}
    sexo = "femenino" if pac["sex"] == "F" else "masculino"
    L = [f"PACIENTE: {pac['name']} · {pac['age']} años · {sexo}",
         f"Alergias: {', '.join(pac['allergies']) or 'ninguna conocida'}",
         f"Crónicos: {', '.join(pac['chronic']) or 'ninguno registrado'}", "",
         f"CONSULTA EN REVISIÓN · {(c['finalized_at'] or c['started_at'] or '')[:10]} · motivo: {(c['motivo'] or '').strip() or '—'}"]

    transcript = (c["transcript"] or "").strip()
    L += ["", "[T] TRANSCRIPCIÓN ORIGINAL DE LA CONSULTA:", (transcript[:_MAX_TRANSCRIPT] or "  (sin transcripción)")]
    soap_auto = _j(c["soap"], {})
    L += ["", "[SA] SOAP AUTOMÁTICO (generado por MEGI durante la consulta):", _soap_txt(soap_auto) or "  (vacío)"]
    limpio = soap_editado if isinstance(soap_editado, dict) and any((soap_editado.get(k) or "").strip() for k in ("S", "O", "A", "P")) \
        else (_j(c["approved_soap"], {}) or _j(c["final_soap"], {}))
    origen_limpio = "en edición por el médico ahora" if soap_editado and limpio is soap_editado else "aprobado/final"
    L += ["", f"[SL] SOAP LIMPIO ({origen_limpio}):", _soap_txt(limpio) or "  (todavía sin nota limpia)"]
    dx = dx_editados if dx_editados is not None else _j(c["dx_codes"], [])
    rx = rx_editados if rx_editados is not None else _j(c["prescription"], [])
    L += ["", f"[DX] DIAGNÓSTICOS: {_dx_txt(dx) or '(ninguno capturado)'}",
          f"[RX] RECETA: {_rx_txt(rx) or '(ninguna capturada)'}"]
    vit = _j(c["vitals"], {}) or (_j(c["clinical_facts"], {}).get("signos_vitales") or {})
    if isinstance(vit, dict) and vit:
        L.append("[SV] SIGNOS VITALES: " + ", ".join(f"{k} {v}" for k, v in vit.items() if v))

    # Estudios de ESTA consulta (lectura de los modelos + pre-diagnóstico vigente)
    try:
        est = analisis_estudios.contexto_preguntas(conn, consultation_id)
        if "(" not in est.splitlines()[1] if len(est.splitlines()) > 1 else False:
            pass
        L += ["", est]
    except Exception:
        pass

    # Consultas previas del MISMO paciente, en breve (sin ids): fecha, motivo, dx, receta
    exp = construir(conn, pac)
    previas = [x for x in exp["consultas"] if x["id"] != consultation_id][:_MAX_PREVIAS]
    L += ["", f"CONSULTAS PREVIAS DEL PACIENTE ({len(previas)} de {max(0, len(exp['consultas']) - 1)}):"]
    for i, x in enumerate(previas, 1):
        linea = f"[C{i}] {x['fecha']}" + (f" · motivo: {x['motivo']}" if x["motivo"] else "")
        if x["soap"].get("A"):
            linea += f" · valoración: {x['soap']['A'][:200]}"
        if x["dx"]:
            linea += f" · dx: {'; '.join(x['dx'][:4])}"
        if x["receta"]:
            linea += f" · receta: {'; '.join(x['receta'][:4])}"
        L.append(linea)
    if not previas:
        L.append("  (ninguna)")
    if exp["estudios"]:
        L += ["", "ESTUDIOS DE IMAGEN PREVIOS EN MEGI:"]
        for i, e in enumerate(exp["estudios"][:6], 1):
            L.append(f"[R{i}] {e['fecha']} · {e['label']} de {e['region'] or '?'}" + (f" · impresión: {e['impresion'][:200]}" if e["impresion"] else ""))
    return "\n".join(L)


def responder_mock(contexto: str, pregunta: str) -> str:
    """Sin modelo: líneas del contexto que comparten palabras con la pregunta.
    Nunca sale de ese contexto; si no hay nada, lo dice."""
    palabras = [w for w in _normaliza(pregunta).split() if len(w) >= 3 and w not in _STOP]
    claves = set(palabras)
    for w in palabras:
        claves.update(_SINONIMOS.get(w, []))
    if not claves:
        return "Pregunta por un medicamento, un diagnóstico, un dato de la nota o un antecedente concreto y busco en esta consulta."
    puntuadas = []
    for l in contexto.splitlines():
        t = l.strip()
        if not t or t.endswith(":") or t.isupper():
            continue
        n = sum(1 for k in claves if k in _normaliza(t))
        if n:
            puntuadas.append((n, t))
    if not puntuadas:
        return "No está en la información disponible de esta consulta ni del expediente de este paciente."
    puntuadas.sort(key=lambda x: -x[0])
    return "En esta consulta y en el expediente del paciente:\n" + "\n".join(f"• {t[:320]}" for _, t in puntuadas[:6])


def preguntar(conn, consultation_id: str, pregunta: str, historial: list, soap_editado=None, dx=None, rx=None) -> dict:
    contexto = construir_contexto(conn, consultation_id, soap_editado, dx, rx)
    if REAL_ASR:
        from . import asr_client
        try:
            r = asr_client.consulta_preguntar(contexto, pregunta, historial)
            if (r.get("respuesta") or "").strip():
                return {"respuesta": r["respuesta"].strip(), "fuentes": r.get("fuentes") or [], "fuente": "llm", "modelo": r.get("model")}
            error = r.get("error") or "respuesta vacía"
        except Exception as e:
            error = str(e)
        return {"respuesta": responder_mock(contexto, pregunta), "fuentes": [], "fuente": "sin_modelo", "error": error}
    return {"respuesta": responder_mock(contexto, pregunta), "fuentes": [], "fuente": "mock"}
