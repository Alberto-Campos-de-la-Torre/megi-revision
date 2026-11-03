"""Motivo de ESTA consulta, y que no se pierda al salir y volver.

`patients.reason` es el motivo del alta y se queda congelado ahí: quien se
registró por lumbalgia en marzo puede volver en julio por otra cosa. Si el
sistema usa el viejo, prepara al LLM para la consulta equivocada.

Y lo que el médico escribe tiene que sobrevivir a una interrupción: salir,
recargar o atender una llamada no puede costarle volver a teclearlo.
"""
import json


def _crear(client, auth, pid, motivo=None):
    cuerpo = {"patient_id": pid}
    if motivo is not None:
        cuerpo["motivo"] = motivo
    r = client.post("/api/consultations", json=cuerpo, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def test_guarda_el_motivo_de_hoy(client, auth, patient):
    c = _crear(client, auth, patient["id"], "diarrea de dos dias")
    assert c["motivo"] == "diarrea de dos dias"
    assert c["retomada"] is False


def test_volver_retoma_la_misma_consulta(client, auth, patient):
    """Se sale y vuelve: misma consulta, mismo motivo, sin reescribir nada."""
    a = _crear(client, auth, patient["id"], "diarrea de dos dias")
    b = _crear(client, auth, patient["id"])          # vuelve sin escribir
    assert b["id"] == a["id"]
    assert b["motivo"] == "diarrea de dos dias"
    assert b["retomada"] is True


def test_un_motivo_nuevo_pisa_al_anterior(client, auth, patient):
    a = _crear(client, auth, patient["id"], "diarrea")
    b = _crear(client, auth, patient["id"], "dolor de garganta")
    assert b["id"] == a["id"]
    assert b["motivo"] == "dolor de garganta"


def test_no_acumula_borradores_vacios(client, auth, patient):
    for _ in range(4):
        _crear(client, auth, patient["id"], "diarrea")
    from app.db import db
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) n FROM consultations WHERE patient_id = ?",
                         (patient["id"],)).fetchone()["n"]
    assert n == 1


def test_una_consulta_con_audio_no_se_retoma(client, auth, patient):
    """Un borrador que ya tiene transcripción es una consulta en curso de verdad:
    volver a entrar abre una NUEVA, no pisa la que se estaba grabando."""
    a = _crear(client, auth, patient["id"], "diarrea")
    from app.db import db
    with db() as conn:
        conn.execute("UPDATE consultations SET transcript = 'ya hay audio' WHERE id = ?", (a["id"],))
    b = _crear(client, auth, patient["id"], "otra cosa")
    assert b["id"] != a["id"]


def test_sin_motivo_lo_toma_de_la_cita_agendada(client, auth, patient):
    """Agendar ya exige motivo: no hay que pedírselo otra vez al médico."""
    from app.db import db
    from datetime import datetime, timezone
    hoy = datetime.now(timezone.utc).date().isoformat()
    with db() as conn:
        conn.execute(
            "INSERT INTO appointments (patient_id, scheduled_date, time, reason, status, "
            "created_by, created_at) VALUES (?,?,?,?,'pendiente','king',?)",
            (patient["id"], hoy, "10:00", "control de neuropatia", hoy))
    c = _crear(client, auth, patient["id"])
    assert c["motivo"] == "control de neuropatia"


def test_la_preconsulta_usa_el_motivo_de_hoy(client, auth, patient):
    """El LLM de «Antes de empezar» tiene que recibir el motivo de hoy. Viaja
    como parámetro directo: la consulta se crea de forma diferida y cuando esa
    pantalla se pinta puede no existir todavía.

    Va por POST y no en la query string: el motivo es dato clínico del paciente
    y en la URL acabaría en los registros de acceso del servidor y del túnel.
    """
    r = client.post(f"/api/patients/{patient['id']}/preconsulta",
                    json={"motivo": "diarrea aguda", "personalizar": False},
                    headers=auth).json()
    assert r["motivo_de_hoy"] == "diarrea aguda"


def test_el_motivo_no_viaja_en_la_url(client, auth, patient):
    """Guardia de privacidad: si alguien vuelve a colgar el motivo del GET,
    esta prueba lo detecta. El GET sigue existiendo, pero sin motivo."""
    r = client.get(f"/api/patients/{patient['id']}/preconsulta?motivo=diarrea+aguda",
                   headers=auth).json()
    assert r["motivo_de_hoy"] == ""


def test_sin_motivo_por_ningun_lado_se_rechaza(client, auth):
    """Es obligatorio: sin motivo, MEGI prepara la consulta a ciegas. El mensaje
    dice qué hacer, no solo que falló."""
    from app.db import db
    # Paciente de otro día, sin cita: ninguna fuente puede aportar el motivo.
    with db() as conn:
        conn.execute(
            "INSERT INTO patients (id, name, age, sex, reason, allergies, chronic, "
            "doctor_id, created_at) VALUES ('P-VIEJO','Antiguo',50,'M','lumbalgia de 2024',"
            "'[]','[]','king','2024-01-15T10:00:00+00:00')")
    r = client.post("/api/consultations", json={"patient_id": "P-VIEJO"}, headers=auth)
    assert r.status_code == 400
    assert "motivo" in r.json()["detail"].lower()
    assert "expediente" in r.json()["detail"].lower()   # dice por dónde resolverlo


def test_el_borrador_manda_sobre_el_motivo_del_alta(client, auth, patient):
    """Orden de resolución: lo que el médico escribió para ESTA consulta va antes
    que `patients.reason`. Tenerlo detrás hacía que volver a entrar pisara el
    motivo de hoy con el del alta."""
    a = _crear(client, auth, patient["id"], "diarrea de dos dias")
    b = _crear(client, auth, patient["id"])
    assert b["id"] == a["id"]
    assert b["motivo"] == "diarrea de dos dias"        # no "prueba", que es el del alta


def test_solo_retomar_devuelve_el_borrador_abierto(client, auth, patient):
    """Tras un refresco, el frontend se reengancha al borrador de hoy y recupera
    su motivo del backend, que es la fuente de verdad."""
    a = _crear(client, auth, patient["id"], "cefalea y dolor de cuello")
    r = client.post("/api/consultations", json={"patient_id": patient["id"], "solo_retomar": True},
                    headers=auth)
    assert r.status_code == 200
    assert r.json()["id"] == a["id"]
    assert r.json()["motivo"] == "cefalea y dolor de cuello"


def test_solo_retomar_nunca_crea(client, auth, patient):
    """Un refresco no puede fabricar consultas: sin borrador abierto, 404 —
    aunque el respaldo de «paciente dado de alta hoy» tuviera motivo que dar."""
    r = client.post("/api/consultations", json={"patient_id": patient["id"], "solo_retomar": True},
                    headers=auth)
    assert r.status_code == 404
    from app.db import db
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) n FROM consultations WHERE patient_id = ?",
                         (patient["id"],)).fetchone()["n"]
    assert n == 0


def test_la_agenda_expone_el_motivo_de_hoy(client, auth, patient):
    """La agenda pintaba `reason` (el del alta) aunque hubiera un borrador abierto
    con otro motivo. /patients tiene que traer el de hoy y el id del borrador,
    para mostrarlo y para poder CONTINUAR sin volver a preguntar."""
    _crear(client, auth, patient["id"], "granos en herida, muslo derecho")
    fila = next(p for p in client.get("/api/patients", headers=auth).json() if p["id"] == patient["id"])
    assert fila["motivo_hoy"] == "granos en herida, muslo derecho"
    assert fila["consulta_abierta_id"]
    assert fila["reason"] == "prueba"          # el del alta sigue ahí, sin pisarse


def test_sin_borrador_ni_cita_el_motivo_de_hoy_va_vacio(client, auth, patient):
    fila = next(p for p in client.get("/api/patients", headers=auth).json() if p["id"] == patient["id"])
    assert fila["motivo_hoy"] == ""
    assert fila["consulta_abierta_id"] is None
