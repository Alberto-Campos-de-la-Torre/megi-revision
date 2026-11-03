"""Fase 11: sugerencia de documentos — solo se ofrecen los que la consulta amerita."""
import json

from app.services.doc_suggest import heuristic_suggestions, merge_suggestions


def test_incapacidad_detectada_con_dias():
    s = heuristic_suggestions("le voy a dar tres días de incapacidad por enfermedad general")
    assert s["incapacidad"]["aplica"] is True
    assert s["incapacidad"]["dias"] == "3"
    assert s["referencia"]["aplica"] is False


def test_referencia_detectada_con_especialidad():
    s = heuristic_suggestions("lo envío a cardiología para valoración por dolor torácico")
    assert s["referencia"]["aplica"] is True
    assert "ardiolog" in s["referencia"]["servicio"]  # Cardiologia (sin acentos)


def test_orden_detectada_con_estudios():
    s = heuristic_suggestions("solicito biometría hemática y química sanguínea en ayuno")
    assert s["orden_estudios"]["aplica"] is True
    assert "biometria" in s["orden_estudios"]["estudios"]
    assert "quimica sanguinea" in s["orden_estudios"]["estudios"]


def test_consulta_sin_menciones_no_sugiere_nada():
    s = heuristic_suggestions(
        "paciente refiere cefalea de tres días, niega fiebre; se indica paracetamol y control en una semana"
    )
    assert s["incapacidad"]["aplica"] is False
    assert s["referencia"]["aplica"] is False
    assert s["orden_estudios"]["aplica"] is False


def test_reposo_dispara_incapacidad():
    s = heuristic_suggestions("indico reposo relativo por dos días de descanso en casa")
    assert s["incapacidad"]["aplica"] is True
    assert s["incapacidad"]["dias"] == "2"


def test_merge_sesgado_a_recall_y_campos_del_llm():
    heur = heuristic_suggestions("le doy cinco días de incapacidad")
    llm = {"incapacidad": {"aplica": True, "dias": "5", "ramo": "Enfermedad general", "observaciones": "reposo en casa"},
           "referencia": {"aplica": True, "servicio": "Cardiología", "motivo": "valoración"}}
    m = merge_suggestions(heur, llm)
    # Campos del LLM tienen prioridad; la heurística sostiene lo que el LLM no trajo.
    assert m["incapacidad"]["aplica"] is True
    assert m["incapacidad"]["ramo"] == "Enfermedad general"
    # El LLM detectó referencia aunque la heurística no -> aplica (recall).
    assert m["referencia"]["aplica"] is True
    # Sin LLM, la heurística manda.
    m2 = merge_suggestions(heur, None)
    assert m2["incapacidad"]["aplica"] is True and m2["incapacidad"]["dias"] == "5"


def test_endpoint_sugiere_y_cachea(client, auth, consultation):
    cid = consultation["id"]
    # Sembrar transcript directamente (en mock no hay ASR real).
    from app.db import db
    with db() as conn:
        conn.execute("UPDATE consultations SET transcript = ? WHERE id = ?",
                     ("se dan tres días de incapacidad y lo envío a cardiología", cid))

    assert client.get(f"/api/consultations/{cid}/documents/suggestions").status_code == 401
    r = client.get(f"/api/consultations/{cid}/documents/suggestions", headers=auth)
    assert r.status_code == 200
    s = r.json()
    assert s["incapacidad"]["aplica"] is True and s["incapacidad"]["dias"] == "3"
    assert s["referencia"]["aplica"] is True
    assert s["orden_estudios"]["aplica"] is False
    assert s["source"] == "heuristica"  # mock: sin LLM

    # Cacheado: si el transcript cambia, sin refresh devuelve lo mismo.
    with db() as conn:
        conn.execute("UPDATE consultations SET transcript = ? WHERE id = ?", ("sin menciones", cid))
    assert client.get(f"/api/consultations/{cid}/documents/suggestions", headers=auth).json()["incapacidad"]["aplica"] is True
    # refresh=1 recalcula.
    r3 = client.get(f"/api/consultations/{cid}/documents/suggestions?refresh=1", headers=auth)
    assert r3.json()["incapacidad"]["aplica"] is False


def test_endpoint_404_sin_consulta(client, auth):
    assert client.get("/api/consultations/NO-EXISTE/documents/suggestions", headers=auth).status_code == 404
