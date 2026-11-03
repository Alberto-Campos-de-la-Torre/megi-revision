"""Usuarios visibles solo para un administrador (27-sep-2026).

Con dos administradores, el dueño del sistema da de alta a un médico que el
otro admin no debe ver. Agenda, expediente y sesiones ya eran por médico; la
lista de usuarios era el único sitio donde aparecía. Un oculto es, para los
demás admins, un 404 en todo (ni 403: eso diría que existe)."""
import pytest


def _admin(client, auth, username):
    inicial, nueva = "inicial12345", "definitiva12345"
    client.post("/api/users", json={"username": username, "password": inicial, "role": "admin",
                                    "name": username}, headers=auth)
    tok = client.post("/api/auth/login", json={"username": username, "password": inicial}).json()["token"]
    r = client.post("/api/auth/change-password", json={"current_password": inicial, "new_password": nueva},
                    headers={"Authorization": f"Bearer {tok}"})
    return {"Authorization": "Bearer %s" % r.json()["token"]}


@pytest.fixture(scope="module")
def otro_admin(client, admin_token):
    return _admin(client, {"Authorization": f"Bearer {admin_token}"}, "otro_admin")


def _nombres(client, h):
    return {u["username"] for u in client.get("/api/users", headers=h).json()}


def test_creado_como_solo_visible_para_mi_no_lo_ve_el_otro_admin(client, auth, otro_admin):
    r = client.post("/api/users", json={"username": "sofia_oculta", "password": "clave12345", "role": "medico",
                                        "name": "Sofía", "solo_visible_para_mi": True}, headers=auth)
    assert r.status_code == 200 and r.json()["visible_para"] == "king"
    assert "sofia_oculta" in _nombres(client, auth)
    assert "sofia_oculta" not in _nombres(client, otro_admin)
    # Para el otro admin no existe: ni borrar ni cambiarle la visibilidad.
    assert client.delete("/api/users/sofia_oculta", headers=otro_admin).status_code == 404
    assert client.patch("/api/users/sofia_oculta/visibilidad", json={"solo_visible_para_mi": False},
                        headers=otro_admin).status_code == 404
    # Pero la cuenta funciona: puede iniciar sesión.
    assert client.post("/api/auth/login", json={"username": "sofia_oculta", "password": "clave12345"}).status_code == 200


def test_el_dueno_puede_ocultar_y_volver_a_mostrar_un_usuario_existente(client, auth, otro_admin):
    client.post("/api/users", json={"username": "medico_normal", "password": "clave12345", "role": "medico"}, headers=auth)
    assert "medico_normal" in _nombres(client, otro_admin)

    r = client.patch("/api/users/medico_normal/visibilidad", json={"solo_visible_para_mi": True}, headers=auth)
    assert r.status_code == 200 and r.json()["visible_para"] == "king"
    assert "medico_normal" not in _nombres(client, otro_admin)
    assert "medico_normal" in _nombres(client, auth)

    r = client.patch("/api/users/medico_normal/visibilidad", json={"solo_visible_para_mi": False}, headers=auth)
    assert r.json()["visible_para"] is None
    assert "medico_normal" in _nombres(client, otro_admin)


def test_no_se_ocultan_admins_ni_protegidos_ni_uno_mismo(client, auth):
    assert client.patch("/api/users/otro_admin/visibilidad", json={"solo_visible_para_mi": True}, headers=auth).status_code == 400
    assert client.patch("/api/users/king/visibilidad", json={"solo_visible_para_mi": True}, headers=auth).status_code == 400


def test_un_medico_no_toca_la_visibilidad(client, auth):
    from tests.test_aislamiento_medicos import _medico
    med = _medico(client, auth, "medico_sin_permiso")
    assert client.patch("/api/users/medico_normal/visibilidad", json={"solo_visible_para_mi": True},
                        headers=med).status_code in (401, 403)
    assert client.get("/api/users", headers=med).status_code in (401, 403)
