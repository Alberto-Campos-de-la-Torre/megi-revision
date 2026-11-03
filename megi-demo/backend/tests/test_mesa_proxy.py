"""La mesa del anestesiólogo embebida: /mesa/* reenvía al servidor de la mesa y
adapta lo justo para que funcione bajo el prefijo. Sin servidor real: se
sustituye el envío por respuestas falsas."""
import httpx
import pytest

from app.routes import mesa_proxy


class _Resp:
    def __init__(self, status=200, headers=None, content=b""):
        self.status_code = status; self.content = content
        self.headers = httpx.Headers(headers or [])


@pytest.fixture()
def falso(monkeypatch):
    visto = {}
    async def _enviar(metodo, ruta, cabeceras, cuerpo):
        visto.update(metodo=metodo, ruta=ruta, cabeceras=cabeceras, cuerpo=cuerpo)
        return visto["respuesta"]
    monkeypatch.setattr(mesa_proxy, "_enviar", _enviar)
    return visto


def test_html_pasa_por_el_prefijo(client, falso):
    falso["respuesta"] = _Resp(200, [("content-type", "text/html; charset=utf-8"), ("content-length", "999")],
                               b'<!doctype html><html><head><title>m</title></head><body><a href="/tiva-stream">t</a><img src="//cdn/x.png"></body></html>')
    r = client.get("/mesa/?pase=abc#x")                      # sin sesión de MEGI: la mesa decide
    assert r.status_code == 200
    assert falso["metodo"] == "GET" and falso["ruta"] == "/?pase=abc"
    assert falso["cabeceras"]["X-Forwarded-Prefix"] == "/mesa" and falso["cabeceras"]["X-Forwarded-Proto"] in ("http", "https")
    assert "host" not in {k.lower() for k in falso["cabeceras"]}
    assert '<head><script>(function(){var p="/mesa";' in r.text        # script justo tras <head>
    assert 'href="/mesa/tiva-stream"' in r.text and 'src="//cdn/x.png"' in r.text   # absolutas sí, protocolo-relativas no
    assert r.headers["content-length"] == str(len(r.content))


def test_redireccion_y_cookie_del_pase(client, falso):
    falso["respuesta"] = _Resp(302, [("location", "/"), ("set-cookie", "megi_mesa=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800"), ("cache-control", "no-store")])
    r = client.get("/mesa/?pase=tok", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/mesa/"
    assert r.headers["set-cookie"] == "megi_mesa=abc; Path=/mesa; HttpOnly; SameSite=Lax; Max-Age=28800"
    assert r.headers["cache-control"] == "no-store"


def test_json_y_post_pasan_tal_cual(client, falso):
    falso["respuesta"] = _Resp(200, [("content-type", "application/json; charset=utf-8")], b'{"ok": true, "ruta": "/salud"}')
    r = client.post("/mesa/gasometria", json={"datos": {"ph": 7.3}}, headers={"Cookie": "megi_mesa=abc"})
    assert r.status_code == 200 and r.json() == {"ok": True, "ruta": "/salud"}        # el JSON no se reescribe
    assert falso["metodo"] == "POST" and falso["ruta"] == "/gasometria" and b'"ph":7.3' in falso["cuerpo"]
    assert falso["cabeceras"]["cookie"] == "megi_mesa=abc"                              # la sesión de la mesa viaja


def test_403_de_la_mesa_se_respeta(client, falso):
    falso["respuesta"] = _Resp(403, [("content-type", "application/json; charset=utf-8")], b'{"error": "acceso solo desde MEGI"}')
    r = client.get("/mesa/modelos")
    assert r.status_code == 403 and "solo desde MEGI" in r.text


def test_mesa_caida_503_con_aviso(client, monkeypatch):
    async def _enviar(*a):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(mesa_proxy, "_enviar", _enviar)
    r = client.get("/mesa/")
    assert r.status_code == 503 and "no está disponible" in r.text and "com.megi.anestesio" in r.text


def test_adaptar_html_sin_head():
    out = mesa_proxy.adaptar_html(b"<p>hola</p>")
    assert out.startswith(b"<script>") and out.endswith(b"<p>hola</p>")
