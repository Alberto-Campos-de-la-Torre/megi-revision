"""Anestesio: catálogo restringido por usuario; el admin autoriza."""


def _medico(client, auth, username):
    client.post("/api/users", json={"username": username, "password": "clave12345", "role": "medico", "name": username}, headers=auth)
    tok = client.post("/api/auth/login", json={"username": username, "password": "clave12345"}).json()["token"]
    r = client.post("/api/auth/change-password", json={"current_password": "clave12345", "new_password": "clave67890"},
                    headers={"Authorization": f"Bearer {tok}"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_catalogo_para_admin_y_restriccion_para_medico(client, auth):
    d = client.get("/api/anestesio/modelos", headers=auth).json()
    assert d["familias"] == 21 and d["total_modelos"] == 26 and "restringida" in d["aviso"].lower()
    nombres = [m["nombre"] for m in d["modelos"]]
    assert "Megi_Hipotension_anex" in nombres and "Megi_TIVA_PKPD" in nombres and "Megi_Lactato_monitor_alpha" in nombres
    assert {m["tipo"] for m in d["modelos"]} == {"aprendido", "reglas"}
    assert all(m["estado"] in ("experimental", "alpha", "prototipo", "reglas", "cerrado") for m in d["modelos"])

    med = _medico(client, auth, "dr_anest")
    r = client.get("/api/anestesio/modelos", headers=med)
    assert r.status_code == 403 and "restringida" in r.json()["detail"].lower()

    # el admin autoriza; el médico ya entra; y se puede retirar
    r = client.patch("/api/users/dr_anest/anestesio", json={"acceso": True}, headers=auth)
    assert r.status_code == 200 and r.json()["acceso_anestesio"] is True
    assert client.get("/api/anestesio/modelos", headers=med).status_code == 200
    assert any(u["username"] == "dr_anest" and u["acceso_anestesio"] for u in client.get("/api/users", headers=auth).json())
    client.patch("/api/users/dr_anest/anestesio", json={"acceso": False}, headers=auth)
    assert client.get("/api/anestesio/modelos", headers=med).status_code == 403
    # un médico no puede autorizarse a sí mismo
    assert client.patch("/api/users/dr_anest/anestesio", json={"acceso": True}, headers=med).status_code in (401, 403)



def test_ingresar_pide_la_contraseña_y_respeta_el_acceso(client, auth):
    # admin: contraseña mal -> 401; bien -> url de la mesa
    assert client.post("/api/anestesio/ingresar", json={"password": "mala"}, headers=auth).status_code == 401
    d = client.post("/api/anestesio/ingresar", json={"password": "votapan"}, headers=auth).json()
    assert d["ok"] is True and d["url"] == f"/mesa/?pase={d['pase']}" and d["expira_en_s"] == 90   # relativa: la sirve /mesa
    # la mesa valida el pase sin sesión; un solo uso
    v = client.post("/api/anestesio/pase/validar", json={"pase": d["pase"]})
    assert v.status_code == 200 and v.json()["usuario"] == "king" and v.json()["rol"] == "admin"
    assert client.post("/api/anestesio/pase/validar", json={"pase": d["pase"]}).status_code == 404
    assert client.post("/api/anestesio/pase/validar", json={"pase": "inventado"}).status_code == 404
    # caducado
    d2 = client.post("/api/anestesio/ingresar", json={"password": "votapan"}, headers=auth).json()
    from app.db import db
    import time as _t
    with db() as conn:
        conn.execute("UPDATE pases_anestesio SET expires_at = ? WHERE token = ?", (_t.time() - 1, d2["pase"]))
    assert client.post("/api/anestesio/pase/validar", json={"pase": d2["pase"]}).status_code == 404
    # médico sin acceso: 403 aunque la contraseña sea correcta
    med = _medico(client, auth, "dr_mesa")
    assert client.post("/api/anestesio/ingresar", json={"password": "clave67890"}, headers=med).status_code == 403
    client.patch("/api/users/dr_mesa/anestesio", json={"acceso": True}, headers=auth)
    assert client.post("/api/anestesio/ingresar", json={"password": "clave67890"}, headers=med).json()["ok"] is True
