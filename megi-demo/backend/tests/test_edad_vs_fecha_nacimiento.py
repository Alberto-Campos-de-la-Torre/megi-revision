"""Fecha de nacimiento que contradice la edad (visto en producción, 21-sep-2026).

Un paciente de 25 años se dio de alta con `birthdate` = el día del alta (el
selector de fecha se quedó con «hoy» y el médico escribió la edad a mano). Como
la fecha tenía preferencia, el motor lo trataba como «Lactante temprano» y el
LLM preparaba una consulta de bebé para un adulto con dolor testicular.

Regla en tres capas: el motor desconfía de la fecha si no cuadra con la edad,
el alta no guarda la contradicción, y los registros ya guardados se reparan al
arrancar."""
from datetime import date, timedelta

from app.services import age_engine as ae


def _hace(anios: int, dias: int = 0) -> str:
    return (date.today() - timedelta(days=anios * 365 + dias)).isoformat()


# ------------------------------------------------------------------ motor
def test_fecha_de_hoy_con_25_anios_no_convierte_en_lactante():
    age = ae.compute_age(date.today().isoformat(), 25)
    assert age["age_years"] == 25 and age["exacta"] is False
    assert age["birthdate_ignorada"] == date.today().isoformat()
    assert ae.age_group(age)[0] == "adulto_joven"
    assert ae.edad_texto(age) == "25 años"


def test_fecha_coherente_sigue_mandando():
    age = ae.compute_age(_hace(25, 100), 25)
    assert age["exacta"] is True and age["age_years"] == 25 and "birthdate_ignorada" not in age


def test_tolera_un_anio_de_diferencia_por_el_cumpleanos():
    assert not ae.fecha_contradice_edad(_hace(25, 300), 24)     # cumple en poco
    assert not ae.fecha_contradice_edad(_hace(25, 300), 26)
    assert ae.fecha_contradice_edad(_hace(25, 300), 23)
    assert ae.fecha_contradice_edad(_hace(0, 40), 25)           # el caso real


def test_bebe_de_verdad_sigue_siendo_bebe():
    age = ae.compute_age(_hace(0, 40), 0)
    assert age["exacta"] and ae.age_group(age)[0] == "lactante_temprano"
    assert ae.edad_texto(age) == "1 meses"


def test_sin_edad_la_fecha_no_se_cuestiona_y_una_fecha_rota_se_ignora():
    assert not ae.fecha_contradice_edad(_hace(3), None)
    assert ae.fecha_contradice_edad("no-es-fecha", 30)
    assert ae.compute_age("no-es-fecha", 30)["age_years"] == 30


# ------------------------------------------------------------------ alta
def test_el_alta_no_guarda_una_fecha_que_contradice_la_edad(client, auth):
    r = client.post("/api/patients", json={
        "name": "Adulto Con Fecha De Hoy", "age": 25, "sex": "M", "reason": "dolor testicular",
        "kind": "espontaneo", "birthdate": date.today().isoformat(),
    }, headers=auth)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["age"] == 25 and p["birthdate"] is None

    pre = client.post(f"/api/patients/{p['id']}/preconsulta",
                      json={"motivo": "dolor testicular", "personalizar": False}, headers=auth).json()
    assert pre["grupo"] == "adulto_joven" and pre["edad"]["age_years"] == 25


def test_el_alta_conserva_una_fecha_coherente(client, auth):
    r = client.post("/api/patients", json={
        "name": "Bebé Coherente", "age": 0, "sex": "F", "reason": "control", "kind": "espontaneo",
        "birthdate": _hace(0, 40),
    }, headers=auth).json()
    assert r["birthdate"] == _hace(0, 40)
    pre = client.post(f"/api/patients/{r['id']}/preconsulta", json={"personalizar": False}, headers=auth).json()
    assert pre["grupo"] == "lactante_temprano"


# ------------------------------------------------------------------ reparación
def test_los_registros_viejos_se_reparan_al_arrancar(client, auth):
    from app.db import db, _quitar_fechas_de_nacimiento_contradictorias
    p = client.post("/api/patients", json={"name": "Viejo Mal Guardado", "age": 40, "sex": "M",
                                           "reason": "x", "kind": "espontaneo"}, headers=auth).json()
    bueno = client.post("/api/patients", json={"name": "Viejo Bien Guardado", "age": 40, "sex": "M",
                                               "reason": "x", "kind": "espontaneo",
                                               "birthdate": _hace(40, 10)}, headers=auth).json()
    with db() as conn:   # se cuela como antes del arreglo: directo en la base
        conn.execute("UPDATE patients SET birthdate = ? WHERE id = ?", (date.today().isoformat(), p["id"]))
    with db() as conn:
        _quitar_fechas_de_nacimiento_contradictorias(conn)
        _quitar_fechas_de_nacimiento_contradictorias(conn)   # idempotente
        malo = conn.execute("SELECT birthdate FROM patients WHERE id = ?", (p["id"],)).fetchone()
        ok = conn.execute("SELECT birthdate FROM patients WHERE id = ?", (bueno["id"],)).fetchone()
    assert malo["birthdate"] is None
    assert ok["birthdate"] == _hace(40, 10)


# ------------------------------------------------------------------ LLM
def test_el_llm_recibe_la_edad_explicita_no_solo_el_grupo(client, auth, monkeypatch):
    from app.services import asr_client
    import app.config as cfg
    monkeypatch.setattr(cfg, "REAL_ASR", True)
    visto = {}

    def falso(ctx, base):
        visto.update(ctx)
        return {"status": "done", "resumen": "", "prioridad": [], "preguntas_motivo": []}
    monkeypatch.setattr(asr_client, "preconsulta_personalize", falso)

    p = client.post("/api/patients", json={"name": "Ramón Prueba", "age": 25, "sex": "M", "reason": "x",
                                           "kind": "espontaneo", "birthdate": date.today().isoformat()},
                    headers=auth).json()
    client.post(f"/api/patients/{p['id']}/preconsulta", json={"motivo": "dolor testicular"}, headers=auth)
    assert visto["edad"] == "25 años" and visto["edad_label"].startswith("Adulto joven")
    assert visto["sexo"] == "M" and visto["motivo_de_hoy"] == "dolor testicular"
