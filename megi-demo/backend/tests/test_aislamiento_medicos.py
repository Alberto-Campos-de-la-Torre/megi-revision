"""Aislamiento entre médicos — criterio de aceptación de la multi-tenencia.

El servidor pasa a alojar pacientes de médicos independientes. Este test crea DOS
médicos con un paciente y una consulta cada uno y comprueba que **A no alcanza
nada de B** por ninguna ruta clínica.

Existe porque hay ~69 consultas a tablas clínicas repartidas en 11 archivos: la
única forma de no dejarse una es que algo falle cuando ocurra. Si añades una ruta
que devuelva datos de paciente, **añádela aquí**.

Ver `docs/plan_multi_medico.md`.
"""
import io
import wave

import pytest


def _wav(ms: int = 200) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"\x00\x00" * int(16000 * ms / 1000))
    return buf.getvalue()


def _medico(client, auth, username: str):
    """Crea un médico y devuelve su cabecera de sesión (ya con la contraseña
    cambiada, para que el token no venga con el flag de cambio forzado)."""
    inicial, nueva = "inicial12345", "definitiva12345"
    client.post("/api/users", json={"username": username, "password": inicial,
                                    "role": "medico", "name": username}, headers=auth)
    tok = client.post("/api/auth/login",
                      json={"username": username, "password": inicial}).json()["token"]
    r = client.post("/api/auth/change-password",
                    json={"current_password": inicial, "new_password": nueva},
                    headers={"Authorization": f"Bearer {tok}"})
    return {"Authorization": "Bearer %s" % r.json()["token"]}


@pytest.fixture(scope="module")
def dos_medicos(client, admin_token):
    """Dr. A y Dr. B, cada uno con paciente y consulta propios."""
    auth = {"Authorization": f"Bearer {admin_token}"}
    a, b = _medico(client, auth, "dra_ana"), _medico(client, auth, "dr_beto")
    out = {}
    for nombre, h in (("a", a), ("b", b)):
        p = client.post("/api/patients", json={
            "name": f"Paciente de {nombre}", "age": 40, "sex": "F",
            "reason": "control", "kind": "espontaneo",
        }, headers=h).json()
        c = client.post("/api/consultations", json={"patient_id": p["id"]}, headers=h).json()
        out[nombre] = {"h": h, "patient": p["id"], "consult": c["id"]}
    return out


# --------------------------------------------------------------- lo propio sí
def test_cada_medico_ve_lo_suyo(client, dos_medicos):
    for quien in ("a", "b"):
        d = dos_medicos[quien]
        assert client.get(f"/api/patients/{d['patient']}", headers=d["h"]).status_code == 200
        assert client.get(f"/api/consultations/{d['consult']}", headers=d["h"]).status_code == 200


def test_la_agenda_solo_muestra_los_propios(client, dos_medicos):
    for quien, otro in (("a", "b"), ("b", "a")):
        d, o = dos_medicos[quien], dos_medicos[otro]
        ids = [p["id"] for p in client.get("/api/patients", headers=d["h"]).json()]
        assert d["patient"] in ids
        assert o["patient"] not in ids, "la agenda filtra pacientes de otro médico"


# ------------------------------------------------------------ lo ajeno, nunca
@pytest.mark.parametrize("plantilla", [
    "/api/patients/{patient}",
    "/api/patients/{patient}/consultations",
    "/api/patients/{patient}/vitals",
    "/api/patients/{patient}/appointments",
    "/api/patients/{patient}/preconsulta",
    "/api/consultations/{consult}",
    "/api/consultations/{consult}/audit",
    "/api/consultations/{consult}/documents",
    "/api/consultations/{consult}/fhir",
    "/api/consultations/{consult}/audio.wav",
    "/api/export/consultation/{consult}",
    "/api/soap/{consult}",
])
def test_no_se_lee_el_expediente_ajeno(client, dos_medicos, plantilla):
    a, b = dos_medicos["a"], dos_medicos["b"]
    url = plantilla.format(patient=b["patient"], consult=b["consult"])
    r = client.get(url, headers=a["h"])
    assert r.status_code == 404, f"{url} expone datos de otro médico ({r.status_code})"


def test_no_se_escribe_sobre_el_expediente_ajeno(client, dos_medicos):
    a, b = dos_medicos["a"], dos_medicos["b"]
    casos = [
        ("patch", f"/api/patients/{b['patient']}/profile", {"allergies": ["hackeada"], "chronic": []}),
        ("patch", f"/api/consultations/{b['consult']}", {"status": "approved"}),
        ("post", "/api/review/save", {"consultation_id": b["consult"], "soap": {"S": "x"}}),
        ("post", "/api/review/approve", {"consultation_id": b["consult"], "soap": {"S": "x"}}),
        ("post", "/api/review/event", {"consultation_id": b["consult"], "kind": "voice_edit", "payload": {}}),
        ("post", "/api/documents", {"consultation_id": b["consult"], "patient_id": b["patient"],
                                    "kind": "referencia", "content": {}}),
        ("post", "/api/appointments", {"patient_id": b["patient"], "scheduled_date": "2026-09-01",
                                       "time": "10:00", "reason": "x"}),
        ("post", "/api/soap/update", {"consultation_id": b["consult"], "new_confirmed_text": "x",
                                      "current_soap": {}}),
        ("post", "/api/soap/finalize", {"consultation_id": b["consult"], "transcript": "x"}),
        ("post", "/api/live/pendientes", {"consultation_id": b["consult"], "motivo": "tos"}),
        ("post", "/api/radiologia/informes", {"patient_id": b["patient"], "modalidad": "radiografia"}),
    ]
    for metodo, url, body in casos:
        r = getattr(client, metodo)(url, json=body, headers=a["h"])
        assert r.status_code == 404, f"{metodo.upper()} {url} deja escribir en expediente ajeno ({r.status_code})"


def test_no_se_sube_audio_a_la_consulta_ajena(client, dos_medicos):
    a, b = dos_medicos["a"], dos_medicos["b"]
    for ruta in ("/api/audio/upload", "/api/audio/chunk"):
        r = client.post(ruta, files={"file": ("x.wav", _wav(), "audio/wav")},
                        data={"consultation_id": b["consult"], "chunk_idx": "0"}, headers=a["h"])
        assert r.status_code == 404, f"{ruta} acepta audio para una consulta ajena ({r.status_code})"


def test_no_se_descarga_el_audio_ajeno(client, dos_medicos):
    """El audio es el dato más sensible: se sube a la consulta propia y se
    comprueba que el otro médico no puede bajarlo por id."""
    a, b = dos_medicos["a"], dos_medicos["b"]
    r = client.post("/api/audio/upload", files={"file": ("x.wav", _wav(), "audio/wav")},
                    data={"consultation_id": b["consult"]}, headers=b["h"])
    assert r.status_code == 200, r.text
    audio_id = r.json()["audio_id"]
    assert client.get(f"/api/audio/{audio_id}", headers=b["h"]).status_code == 200
    assert client.get(f"/api/audio/{audio_id}", headers=a["h"]).status_code == 404


def test_las_estadisticas_no_suman_pacientes_ajenos(client, dos_medicos):
    a = dos_medicos["a"]
    s = client.get("/api/stats", headers=a["h"]).json()
    assert s["patients_total"] == 1, f"cuenta pacientes de otros médicos: {s}"
    assert s["consultations_total"] == 1, f"cuenta consultas de otros médicos: {s}"


def test_el_admin_no_abre_expedientes_ajenos(client, auth, dos_medicos):
    """El admin gestiona usuarios y catálogos, no lee expedientes: que exista un
    rol capaz de verlo todo es justo el riesgo que se está cerrando."""
    b = dos_medicos["b"]
    assert client.get(f"/api/patients/{b['patient']}", headers=auth).status_code == 404
    assert client.get(f"/api/consultations/{b['consult']}", headers=auth).status_code == 404


# ------------------------------------------ identidad profesional por médico
def test_cada_medico_imprime_con_su_propia_cedula(client, dos_medicos):
    """La cédula profesional va en recetas, referencias, órdenes e incapacidades:
    son documentos legales y la cédula identifica a quien responde por ellos.
    Antes salía de `seed.json`, única para toda la instalación — con dos médicos
    eso significaba imprimir la cédula de otra persona."""
    a, b = dos_medicos["a"], dos_medicos["b"]
    client.patch("/api/me", json={"name": "Dra. Ana Ruiz", "cedula": "1111111",
                                  "specialty": "Medicina Interna"}, headers=a["h"])
    client.patch("/api/me", json={"name": "Dr. Beto Lara", "cedula": "2222222",
                                  "specialty": "Pediatría"}, headers=b["h"])

    da = client.get("/api/config", headers=a["h"]).json()["doctor"]
    db_ = client.get("/api/config", headers=b["h"]).json()["doctor"]
    assert da["cedula"] == "1111111" and da["name"] == "Dra. Ana Ruiz"
    assert db_["cedula"] == "2222222" and db_["specialty"] == "Pediatría"
    assert da["cedula"] != db_["cedula"], "dos médicos comparten cédula"


def test_el_perfil_incompleto_no_se_rellena_con_el_de_otro(client, auth, admin_token):
    """Sin cédula propia se devuelve vacío y `complete: False` para que la UI
    avise: imprimir en blanco es malo, imprimir la cédula de otro es peor."""
    h = _medico(client, auth, "dr_sincedula")
    d = client.get("/api/me", headers=h).json()
    assert d["cedula"] == ""
    assert d["complete"] is False
    assert "Claudia" not in (d.get("name") or ""), "hereda el perfil global del seed"


def test_nadie_edita_el_perfil_de_otro(client, dos_medicos):
    a, b = dos_medicos["a"], dos_medicos["b"]
    client.patch("/api/me", json={"cedula": "9999999"}, headers=a["h"])
    assert client.get("/api/me", headers=b["h"]).json()["cedula"] != "9999999"


def test_los_informes_de_radiologia_tampoco_se_cruzan(client, dos_medicos):
    a, b = dos_medicos["a"], dos_medicos["b"]
    informe = client.post("/api/radiologia/informes",
                          json={"patient_id": b["patient"], "modalidad": "tomografia"},
                          headers=b["h"]).json()

    # Ni se lee, ni se edita, ni se firma el informe de un paciente ajeno.
    assert client.get(f"/api/radiologia/informes/{informe['id']}", headers=a["h"]).status_code == 404
    assert client.patch(f"/api/radiologia/informes/{informe['id']}",
                        json={"hallazgos": "x"}, headers=a["h"]).status_code == 404
    assert client.post(f"/api/radiologia/informes/{informe['id']}/firmar",
                       headers=a["h"]).status_code == 404

    # Y la lista general solo trae los de los pacientes propios.
    mios = client.get("/api/radiologia/informes", headers=a["h"]).json()
    assert informe["id"] not in [x["id"] for x in mios]
    suyos = client.get("/api/radiologia/informes", headers=b["h"]).json()
    assert informe["id"] in [x["id"] for x in suyos]
