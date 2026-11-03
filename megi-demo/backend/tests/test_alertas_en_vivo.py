"""Alertas de seguridad CONFORME AVANZA la consulta (verificador FDA en /soap/update).

El backend manda al ASR la transcripción acumulada + la ficha del paciente y
devuelve `alertas_fda` en la misma respuesta que los huecos. Si el verificador
falla, la consulta sigue: `alertas_fda` viene vacío con `error`."""


def _fake_soap_update(new_text, cur, cid, paciente=None):
    return {"status": "done", "soap_patch": [{"section": "S", "text": new_text, "action": "upsert"}],
            "warnings": [], "sources": [], "retrieval": {"needs_rag": False}}


def test_soap_update_devuelve_alertas_fda_con_transcripcion_y_ficha(client, auth, patient, consultation, monkeypatch):
    from app.db import db
    from app.routes import live
    from app.services import asr_client

    client.patch(f"/api/patients/{patient['id']}/profile",
                 json={"allergies": ["penicilina"], "chronic": ["insuficiencia renal"]}, headers=auth)
    with db() as conn:
        conn.execute("UPDATE consultations SET transcript = ? WHERE id = ?",
                     ("podría darle prednisona e ibuprofeno para la mano", consultation["id"]))
    captured = {}

    def fake_check(rx_list, conditions=None, allergies=None, age=None, sex=None, embarazo=None, context_text=None):
        captured.update(rx=rx_list, conditions=conditions, allergies=allergies, age=age, sex=sex, ctx=context_text)
        return {"status": "done", "farmacos_detectados": ["ibuprofen", "prednisone"], "resumen": {"mayor": 1},
                "alertas": [{"tipo_alerta": "farmaco_condicion", "farmaco": "ibuprofen", "condicion": "insuficiencia renal",
                             "objeto": "insuficiencia renal", "seccion": "DRUG INTERACTIONS", "severidad": "mayor",
                             "evidencias": 2, "cita": "…", "fuente": "es"}]}

    monkeypatch.setattr(live, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "soap_update", _fake_soap_update)
    monkeypatch.setattr(asr_client, "drugs_check", fake_check)
    r = client.post("/api/soap/update", json={"consultation_id": consultation["id"],
                                              "new_confirmed_text": "para la mano", "chunk_idx": 0}, headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["alertas_fda"]["alertas"][0]["farmaco"] == "ibuprofen"
    assert body["alertas_fda"]["farmacos_detectados"] == ["ibuprofen", "prednisone"]
    assert captured["rx"] == [] and "prednisona" in captured["ctx"]
    assert captured["conditions"] == ["insuficiencia renal"] and captured["allergies"] == ["penicilina"]
    assert captured["age"] == patient["age"] and captured["sex"] == patient["sex"]

    # el verificador se cae -> la consulta sigue y lo dice
    def boom(*a, **k):
        raise RuntimeError("asr caído")
    monkeypatch.setattr(asr_client, "drugs_check", boom)
    r = client.post("/api/soap/update", json={"consultation_id": consultation["id"],
                                              "new_confirmed_text": "sigue", "chunk_idx": 1}, headers=auth)
    assert r.status_code == 200
    assert r.json()["alertas_fda"] == {"alertas": [], "resumen": {}, "error": "asr caído"}


def test_finalize_guarda_alertas_en_metadatos_y_auditoria_no_en_la_nota(client, auth, patient, consultation, monkeypatch):
    """El médico pidió que las alertas NO aparezcan en el texto del Plan: quedan en
    `clinical_facts.alertas_seguridad` y en la auditoría del cierre como constancia."""
    import json
    from app.db import db
    from app.routes import live
    from app.services import asr_client

    with db() as conn:
        conn.execute("UPDATE consultations SET transcript = ? WHERE id = ?", ("dolor de rodilla", consultation["id"]))
    alerta = {"tipo_alerta": "farmaco_condicion", "farmaco": "ketorolac", "condicion": "pacientes de edad avanzada",
              "objeto": "pacientes de edad avanzada", "seccion": "BOXED WARNING", "severidad": "absoluta",
              "evidencias": 3, "cita": "Elderly patients are at greater risk", "fuente": "en_sin_validar"}

    def fake_finalize(transcript, cur, cid, paciente=None):
        return {"status": "done", "official_note": False,
                "soap": {"S": "s", "O": "o", "A": "a", "P": "Ketorolaco 10 mg cada 8 h."},
                "clinical_facts": {"medicamentos": [{"nombre": "ketorolaco", "rol": "indicado"}]},
                "validation": {"status": "requires_review", "official_note": False, "flags": [],
                               "warnings": ["Seguridad de la receta (FDA): 1 alerta(s) de severidad absoluta/mayor; revísalas en el panel de alertas."]},
                "alertas_seguridad": {"alertas": [alerta], "resumen": {"absoluta": 1}, "farmacos_detectados": ["ketorolac"]}}

    monkeypatch.setattr(live, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "soap_finalize", fake_finalize)
    r = client.post("/api/soap/finalize", json={"consultation_id": consultation["id"]}, headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "Alertas de seguridad" not in body["soap"]["P"]                    # nada en la nota
    assert body["clinical_facts"]["alertas_seguridad"]["alertas"][0]["farmaco"] == "ketorolac"
    with db() as conn:
        row = conn.execute("SELECT final_soap, clinical_facts FROM consultations WHERE id = ?", (consultation["id"],)).fetchone()
        ev = conn.execute("SELECT payload FROM review_events WHERE consultation_id = ? AND kind = 'soap_finalize' "
                          "ORDER BY id DESC LIMIT 1", (consultation["id"],)).fetchone()
    assert "Alertas de seguridad" not in json.loads(row["final_soap"])["P"]
    assert json.loads(row["clinical_facts"])["alertas_seguridad"]["resumen"] == {"absoluta": 1}
    registro = json.loads(ev["payload"])["alertas_seguridad"]
    assert registro["alertas"][0]["cita"] == "Elderly patients are at greater risk"   # constancia de que se avisó


def test_citas_con_id_global_entre_chunks(client, auth, consultation, monkeypatch):
    """Cada llamada al ASR numera S1… desde cero. En la nota acumulada el [S1] del
    segundo chunk debe convertirse en S2 (fuente nueva) o conservar el id si es la
    misma fuente que antes; la lista de fuentes devuelve los ids globales."""
    from app.routes import live
    from app.services import asr_client

    llamadas = {"n": 0}
    def fake_update(new_text, cur, cid, paciente=None):
        llamadas["n"] += 1
        if llamadas["n"] == 1:
            return {"status": "done", "soap_patch": [{"section": "A", "text": "Lumbalgia mecánica [S1].", "citations": ["S1"], "action": "upsert"}],
                    "warnings": [], "sources": [{"citation_id": "S1", "citation": "GPC 045 Lumbalgia, pág. 11", "source_id": "gpc045", "chunk_id": "c1", "page": 11, "score": 0.8}],
                    "retrieval": {"needs_rag": True, "retrieved_count": 1, "cited_count": 1}}
        return {"status": "done", "soap_patch": [{"section": "P", "text": "Reposo relativo [S1] y AINE [S2, S9].", "citations": ["S1", "S2"], "action": "upsert"}],
                "warnings": [], "sources": [{"citation_id": "S1", "citation": "GPC 726 Rehabilitación, pág. 6", "source_id": "gpc726", "chunk_id": "c2", "page": 6, "score": 0.7},
                                            {"citation_id": "S2", "citation": "GPC 045 Lumbalgia, pág. 11", "source_id": "gpc045", "chunk_id": "c1", "page": 11, "score": 0.6}],
                "retrieval": {"needs_rag": True, "retrieved_count": 2, "cited_count": 2}}

    monkeypatch.setattr(live, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "soap_update", fake_update)
    monkeypatch.setattr(asr_client, "drugs_check", lambda *a, **k: {"status": "done", "alertas": [], "resumen": {}})
    r1 = client.post("/api/soap/update", json={"consultation_id": consultation["id"], "new_confirmed_text": "uno", "chunk_idx": 0}, headers=auth).json()
    assert r1["soap"]["A"] == "Lumbalgia mecánica [S1]." and r1["sources"][0]["citation_id"] == "S1"
    r2 = client.post("/api/soap/update", json={"consultation_id": consultation["id"], "new_confirmed_text": "dos", "chunk_idx": 1}, headers=auth).json()
    # la fuente nueva (rehabilitación) toma S2; la ya citada (lumbalgia) conserva S1; S9 no existía y se elimina
    assert r2["soap"]["P"] == "Reposo relativo [S2] y AINE [S1]."
    assert {(s["citation_id"], s["citation"][:7]) for s in r2["sources"]} == {("S2", "GPC 726"), ("S1", "GPC 045")}
    assert r2["patches"][0]["citations"] == ["S2", "S1"]


def test_anexar_no_repite_frases_que_la_seccion_ya_tiene():
    from app.routes.live import _apply_patch
    soap = {"S": "Refiere dolor en el muslo. Refiere rigidez.", "O": "", "A": "", "P": ""}
    out = _apply_patch(soap, [{"section": "S", "action": "append",
                               "text": "Refiere dolor en el muslo. Refiere rigidez. Refiere molestia al orinar."}])
    assert out["S"] == "Refiere dolor en el muslo. Refiere rigidez. Refiere molestia al orinar."
    # acentos/mayúsculas no cuentan como frase nueva; upsert sigue sustituyendo
    out = _apply_patch(out, [{"section": "S", "action": "append", "text": "refiere RIGIDEZ."}])
    assert out["S"].count("rigidez") == 1 and out["S"].count("RIGIDEZ") == 0
    out = _apply_patch(out, [{"section": "S", "action": "upsert", "text": "Nuevo."}])
    assert out["S"] == "Nuevo."


def test_json_invalido_guarda_la_respuesta_cruda_para_diagnostico(client, auth, consultation, monkeypatch):
    from app.db import db
    from app.routes import live
    from app.services import asr_client
    monkeypatch.setattr(live, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "soap_update", lambda *a, **k: {
        "status": "invalid_json", "soap_patch": [], "warnings": ["LLM no devolvió JSON válido"],
        "raw": "Claro, aquí va la nota...", "sources": [], "retrieval": {}})
    monkeypatch.setattr(asr_client, "drugs_check", lambda *a, **k: {"status": "done", "alertas": [], "resumen": {}})
    r = client.post("/api/soap/update", json={"consultation_id": consultation["id"], "new_confirmed_text": "x", "chunk_idx": 0}, headers=auth)
    assert r.status_code == 200 and r.json()["status"] == "invalid_json"
    with db() as conn:
        row = conn.execute("SELECT warnings FROM soap_patches WHERE consultation_id = ? ORDER BY id DESC LIMIT 1",
                           (consultation["id"],)).fetchone()
    assert "raw_llm: Claro, aquí va la nota..." in row["warnings"]
