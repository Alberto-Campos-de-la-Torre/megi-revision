"""Autocompletado de rehabilitación y captura de la corrección (routes/rehab.py).

Lo que se protege: que la DIFERENCIA entre lo propuesto y lo firmado quede
registrada con su contexto. Sin ese par (exploración → decisión) el sistema no
puede afinar, y saber que alguien bajó una dosis no enseña nada si no se sabe
ante qué paciente.

El diff se calcula en el servidor a propósito: es el dato que importa y no puede
depender de que el cliente lo mande bien.
"""
import json


def _consulta_rehab(client, auth, consultation):
    """Deja una consulta con SOAP de rehabilitación ya guardado. La fixture
    `consultation` devuelve el objeto completo: el id va dentro."""
    soap = {
        "S": "Derivado por MF. Dolor en hombro derecho, EVA 8/10.",
        "O": "Jobe y Hawkins positivos. Edema en cm. Contractura de trapecio.",
        "A": "Tendinopatia de supraespinoso",
        "P": "TF institucional 10 sesiones.",
    }
    from app.db import db
    with db() as conn:
        conn.execute("UPDATE consultations SET approved_soap = ? WHERE id = ?",
                     (json.dumps(soap, ensure_ascii=False), consultation["id"]))
    return soap


def test_sugiere_protocolo_para_la_consulta(client, auth, consultation):
    _consulta_rehab(client, auth, consultation)
    r = client.get(f"/api/rehab/consulta/{consultation['id']}", headers=auth).json()
    assert r["es_rehabilitacion"]
    assert r["protocolos"][0]["nombre"].startswith("Tendinopatía de supraespinoso")


def test_muestra_las_reglas_que_dispara_la_exploracion(client, auth, consultation):
    """«Edema en cm» y «contractura de trapecio» están en la exploración: sus
    reglas de adaptación deben venir con la sugerencia, no aparte."""
    _consulta_rehab(client, auth, consultation)
    r = client.get(f"/api/rehab/consulta/{consultation['id']}", headers=auth).json()
    hallazgos = [x["hallazgo"] for x in r["reglas"]]
    assert "Edema en cm" in hallazgos
    assert "Contractura de trapecio, espasmo" in hallazgos


def test_registra_el_diff_de_la_correccion(client, auth, consultation):
    _consulta_rehab(client, auth, consultation)
    propuestos = ["CHC a hombro **DERECHO/IZQUIERDO**", "US 1.4 W/cm2", "Codman"]
    aceptados = ["CHC a hombro derecho", "US 1.0 W/cm2", "Codman", "Masaje descontracturante"]
    r = client.post("/api/rehab/aplicar", headers=auth, json={
        "consultation_id": consultation["id"], "protocolo_id": "hombro/tendinopatia",
        "pasos_propuestos": propuestos, "pasos_aceptados": aceptados,
        "lateralidad": "derecho",
    }).json()
    # CHC y US se editaron (cuentan como quitado+añadido), Codman se conservó
    assert r["quitados"] == 2
    assert r["anadidos"] == 3


def test_guarda_la_exploracion_como_contexto_de_la_decision(client, auth, consultation):
    """Sin el contexto, «bajó a 1.0» es ruido; con él, es una regla en potencia."""
    _consulta_rehab(client, auth, consultation)
    client.post("/api/rehab/aplicar", headers=auth, json={
        "consultation_id": consultation["id"], "protocolo_id": "hombro/tendinopatia",
        "pasos_propuestos": ["US 1.4 W/cm2"], "pasos_aceptados": ["US 1.0 W/cm2"],
    })
    from app.db import db
    with db() as conn:   # acotado a ESTA consulta: la base persiste entre pruebas
        fila = conn.execute(
            "SELECT contexto, lateralidad FROM rehab_sugerencias WHERE consultation_id = ?",
            (consultation["id"],)).fetchone()
    ctx = json.loads(fila["contexto"])
    assert "Edema en cm" in ctx["O"]
    assert fila["lateralidad"] is None      # no se inventa lado si no lo mandan


def test_no_registra_una_propuesta_vacia(client, auth, consultation):
    r = client.post("/api/rehab/aplicar", headers=auth, json={
        "consultation_id": consultation["id"], "protocolo_id": "x",
        "pasos_propuestos": [], "pasos_aceptados": []})
    assert r.status_code == 400


def test_no_se_registra_en_consulta_ajena(client, auth, consultation):
    """Misma regla que el resto del expediente: 404, no 403."""
    r = client.post("/api/rehab/aplicar", headers=auth, json={
        "consultation_id": "C-inexistente", "protocolo_id": "x",
        "pasos_propuestos": ["algo"], "pasos_aceptados": []})
    assert r.status_code == 404


def test_el_aprendizaje_acumula_lo_que_se_quita(client, auth, consultation):
    # El resumen agrega por médico, así que parte de cero a propósito.
    from app.db import db
    with db() as conn:
        conn.execute("DELETE FROM rehab_sugerencias")
    _consulta_rehab(client, auth, consultation)
    for _ in range(3):
        client.post("/api/rehab/aplicar", headers=auth, json={
            "consultation_id": consultation["id"], "protocolo_id": "hombro/tendinopatia",
            "pasos_propuestos": ["CHC", "US 1.4 W/cm2", "Codman"],
            "pasos_aceptados": ["CHC", "Codman"]})
    r = client.get("/api/rehab/aprendizaje", headers=auth).json()
    assert r["total_sugerencias"] == 3
    p = r["protocolos"][0]
    assert p["veces"] == 3
    assert p["quitados"][0] == ["US 1.4 W/cm2", 3]   # el paso que siempre se quita


# --- la sugerencia MOSTRADA, no solo la usada -----------------------------
# Hasta ahora solo se guardaba lo insertado, así que «se le propuso esto y no lo
# quiso» no dejaba rastro. El rechazo es la señal más fuerte para corregir el
# ranking y es la única que NO se puede reconstruir después.

def _mostrar(client, auth, cid, pid="hombro/tendinopatia", alternativas=None):
    return client.post("/api/rehab/mostrada", headers=auth, json={
        "consultation_id": cid, "protocolo_id": pid,
        "alternativas": alternativas if alternativas is not None
        else [{"id": pid, "nombre": "Tendinopatía", "score": 4.0, "orden": 0}],
    })


def test_registra_que_la_sugerencia_se_enseno(client, auth, consultation):
    _consulta_rehab(client, auth, consultation)
    assert _mostrar(client, auth, consultation["id"]).status_code == 200
    from app.db import db
    with db() as conn:
        f = conn.execute("SELECT evento, alternativas FROM rehab_sugerencias "
                         "WHERE consultation_id = ?", (consultation["id"],)).fetchone()
    assert f["evento"] == "mostrada"
    assert json.loads(f["alternativas"])[0]["orden"] == 0


def test_mostrar_dos_veces_cuenta_una(client, auth, consultation):
    """El componente se repinta; una sugerencia se enseña UNA vez por consulta y
    protocolo. Sin esto el rechazo saldría inflado."""
    _consulta_rehab(client, auth, consultation)
    for _ in range(4):
        _mostrar(client, auth, consultation["id"])
    from app.db import db
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) n FROM rehab_sugerencias WHERE consultation_id = ? "
                         "AND evento = 'mostrada'", (consultation["id"],)).fetchone()["n"]
    assert n == 1


def test_mostrada_sin_aplicada_es_un_rechazo(client, auth, consultation):
    from app.db import db
    with db() as conn:
        conn.execute("DELETE FROM rehab_sugerencias")
    _consulta_rehab(client, auth, consultation)
    _mostrar(client, auth, consultation["id"])          # se enseñó…
    r = client.get("/api/rehab/aprendizaje", headers=auth).json()   # …y no se usó
    p = r["protocolos"][0]
    assert p["mostradas"] == 1 and p["aplicadas"] == 0
    assert p["rechazos"] == 1
    assert p["tasa_aceptacion"] == 0.0


def test_mostrada_y_aplicada_no_es_rechazo(client, auth, consultation):
    from app.db import db
    with db() as conn:
        conn.execute("DELETE FROM rehab_sugerencias")
    _consulta_rehab(client, auth, consultation)
    _mostrar(client, auth, consultation["id"])
    client.post("/api/rehab/aplicar", headers=auth, json={
        "consultation_id": consultation["id"], "protocolo_id": "hombro/tendinopatia",
        "pasos_propuestos": ["CHC"], "pasos_aceptados": ["CHC"], "elegido_orden": 0})
    p = client.get("/api/rehab/aprendizaje", headers=auth).json()["protocolos"][0]
    assert p["rechazos"] == 0 and p["tasa_aceptacion"] == 1.0


def test_elegir_el_segundo_queda_registrado(client, auth, consultation):
    """Si el médico se salta el primero, el ranking está mal y hay que saberlo."""
    from app.db import db
    with db() as conn:
        conn.execute("DELETE FROM rehab_sugerencias")
    _consulta_rehab(client, auth, consultation)
    client.post("/api/rehab/aplicar", headers=auth, json={
        "consultation_id": consultation["id"], "protocolo_id": "hombro/otro",
        "pasos_propuestos": ["CHC"], "pasos_aceptados": ["CHC"], "elegido_orden": 1})
    p = client.get("/api/rehab/aprendizaje", headers=auth).json()["protocolos"][0]
    assert p["no_era_el_primero"] == 1


def test_no_se_registra_una_impresion_en_consulta_ajena(client, auth):
    assert _mostrar(client, auth, "C-inexistente").status_code == 404


# ---------------------------------------------------------------- insertar desde la consulta en vivo
def _consulta_femur(consultation, lado_texto="derecho"):
    soap = {
        "S": f"Antecedente de fractura de diáfisis de fémur {lado_texto} tratada con osteosíntesis. Dolor y rigidez en el muslo.",
        "O": "Radiografía de control con consolidación ósea completa.",
        "A": "Fractura de diáfisis de fémur consolidada.",
        "P": "Inicio de programa de rehabilitación física y ejercicios de fortalecimiento.",
    }
    from app.db import db
    with db() as conn:
        conn.execute("UPDATE consultations SET soap = ?, approved_soap = NULL, final_soap = NULL WHERE id = ?",
                     (json.dumps(soap, ensure_ascii=False), consultation["id"]))
    return soap


def test_insertar_en_vivo_agrega_al_plan_con_lado_de_la_nota(client, auth, consultation):
    """«fémur derecho» está en la nota: el protocolo entra al Plan con DERECHA
    resuelto, queda registrado como 'aplicada' y la revisión ya no lo propone."""
    _consulta_femur(consultation)
    sug = client.get(f"/api/rehab/consulta/{consultation['id']}", headers=auth).json()
    assert sug["es_rehabilitacion"] and sug["ya_insertado"] is None
    pid = sug["protocolos"][0]["id"]
    r = client.post("/api/rehab/insertar", headers=auth, json={"consultation_id": consultation["id"], "protocolo_id": pid})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["lateralidad"] == "derecho" and b["lateralidad_inferida"] and not b["lado_pendiente"]
    assert b["insertados"] >= 5
    P = b["soap"]["P"]
    assert P.startswith("Inicio de programa")                       # lo previo se conserva
    assert "Rehabilitación · PO fractura de cadera o fémur:" in P
    assert "DERECHA" in P and "DERECHO/IZQUIERDO" not in P and "`" not in P
    # persistido en el SOAP en vivo y registrado para el aprendizaje
    from app.db import db
    with db() as conn:
        row = conn.execute("SELECT soap FROM consultations WHERE id = ?", (consultation["id"],)).fetchone()
        ev = conn.execute("SELECT evento, lateralidad, contexto FROM rehab_sugerencias WHERE consultation_id = ? "
                          "ORDER BY id DESC LIMIT 1", (consultation["id"],)).fetchone()
    assert "Rehabilitación · PO fractura" in json.loads(row["soap"])["P"]
    assert ev["evento"] == "aplicada" and ev["lateralidad"] == "derecho"
    assert json.loads(ev["contexto"])["origen"] == "consulta_en_vivo"
    # idempotente
    r2 = client.post("/api/rehab/insertar", headers=auth, json={"consultation_id": consultation["id"], "protocolo_id": pid}).json()
    assert r2["ya_insertado"] and r2["soap"]["P"].count("Rehabilitación · PO fractura") == 1
    # la revisión sabe que ya está en el Plan
    assert client.get(f"/api/rehab/consulta/{consultation['id']}", headers=auth).json()["ya_insertado"] == pid


def test_insertar_sin_lado_claro_lo_deja_marcado(client, auth, consultation):
    _consulta_femur(consultation, lado_texto="")
    pid = client.get(f"/api/rehab/consulta/{consultation['id']}", headers=auth).json()["protocolos"][0]["id"]
    b = client.post("/api/rehab/insertar", headers=auth, json={"consultation_id": consultation["id"], "protocolo_id": pid}).json()
    assert b["lateralidad"] is None and b["lado_pendiente"]
    assert "DERECHA/IZQUIERDA" in b["soap"]["P"] and "Lado por definir" in b["soap"]["P"]
    # y si el médico lo dice, manda él
    _consulta_femur(consultation, lado_texto="")
    b = client.post("/api/rehab/insertar", headers=auth,
                    json={"consultation_id": consultation["id"], "protocolo_id": pid, "lateralidad": "izquierdo"}).json()
    assert b["lateralidad"] == "izquierdo" and "IZQUIERDA" in b["soap"]["P"]


def test_insertar_protocolo_inexistente_o_ajeno(client, auth, consultation):
    _consulta_femur(consultation)
    r = client.post("/api/rehab/insertar", headers=auth, json={"consultation_id": consultation["id"], "protocolo_id": "no/existe"})
    assert r.status_code == 404
    r = client.post("/api/rehab/insertar", headers=auth, json={"consultation_id": "C-nadie", "protocolo_id": "x"})
    assert r.status_code in (403, 404)


def test_el_cierre_conserva_el_protocolo_insertado_en_vivo(client, auth, consultation, monkeypatch):
    """Insertado en vivo -> el LLM consolida desde el transcript y no lo conoce ->
    la nota final debe traerlo igual, literal y al final del Plan."""
    from app.db import db
    from app.routes import live
    from app.services import asr_client
    _consulta_femur(consultation)
    with db() as conn:
        conn.execute("UPDATE consultations SET transcript = ? WHERE id = ?", ("fractura de fémur derecho, inicia rehabilitación", consultation["id"]))
    pid = client.get(f"/api/rehab/consulta/{consultation['id']}", headers=auth).json()["protocolos"][0]["id"]
    ins = client.post("/api/rehab/insertar", headers=auth, json={"consultation_id": consultation["id"], "protocolo_id": pid}).json()
    bloque_inicio = "Rehabilitación · PO fractura de cadera o fémur:"
    assert bloque_inicio in ins["soap"]["P"]

    monkeypatch.setattr(live, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "soap_finalize", lambda t, cur, cid, paciente=None: {
        "status": "done", "official_note": False,
        "soap": {"S": "s", "O": "o", "A": "a", "P": "Plan consolidado por el LLM sin el protocolo."},
        "clinical_facts": {}, "validation": {"status": "requires_review", "official_note": False, "flags": [], "warnings": []},
        "alertas_seguridad": {"alertas": [], "resumen": {}}})
    r = client.post("/api/soap/finalize", json={"consultation_id": consultation["id"]}, headers=auth).json()
    P = r["soap"]["P"]
    assert P.startswith("Plan consolidado por el LLM") and bloque_inicio in P and "1. CHC a cadera y rodilla DERECHA" in P
    with db() as conn:
        row = conn.execute("SELECT final_soap FROM consultations WHERE id = ?", (consultation["id"],)).fetchone()
    assert bloque_inicio in json.loads(row["final_soap"])["P"]
    assert json.loads(row["final_soap"])["P"].count(bloque_inicio) == 1
