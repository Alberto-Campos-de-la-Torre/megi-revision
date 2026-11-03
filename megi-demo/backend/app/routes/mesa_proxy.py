"""La mesa del anestesiólogo DENTRO de MEGI: todo lo que llega a /mesa/* se
reenvía al servidor de la mesa (electros, `MEGI_ANESTESIO_URL`) y la respuesta
vuelve como si fuera de MEGI.

Por qué un proxy y no un iframe directo: la mesa corre en otro puerto, solo
escucha en el propio servidor y va por http; desde https://megiia.com un iframe
a http://localhost sería contenido mixto (el navegador lo bloquea) y desde otro
equipo ni resolvería. Con el proxy la mesa queda en el mismo origen que MEGI.

El proxy NO autentica: la mesa exige su propio pase (lo emite
`POST /api/anestesio/ingresar` tras volver a teclear la contraseña) y, sin él
o sin su cookie de sesión, responde 403. Delante de todo sigue Cloudflare Access.

La mesa está escrita con rutas absolutas («/analizar», «/modelos»…). Para que
funcione bajo /mesa, cada página HTML que pasa por aquí lleva un pequeño script
que antepone /mesa a `fetch`, `XMLHttpRequest` y `window.open` con rutas
absolutas, y se reescriben `href`/`src`/`action` absolutos, la cabecera
`Location` de las redirecciones y el `Path` de la cookie. Nada de esto toca el
código de electros.
"""
from __future__ import annotations

import re

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import HTMLResponse

from ..config import ANESTESIO_URL

router = APIRouter()
PREFIJO = "/mesa"
_METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
_NO_REENVIAR = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
                "transfer-encoding", "upgrade", "host", "content-length", "accept-encoding", "content-encoding"}
_ABSOLUTOS = re.compile(rb'\b(href|src|action)="/(?!/)')
_INYECCION = (b'<script>(function(){var p="' + PREFIJO.encode() + b'";'
              b'function a(u){return (typeof u==="string"&&u.charAt(0)==="/"&&u.charAt(1)!=="/")?p+u:u;}'
              b'var f=window.fetch.bind(window);window.fetch=function(u,o){return f(a(u),o);};'
              b'var x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){'
              b'var r=[m,a(u)].concat([].slice.call(arguments,2));return x.apply(this,r);};'
              b'var w=window.open;window.open=function(u){var r=[a(u)].concat([].slice.call(arguments,1));return w.apply(window,r);};'
              b'})();</script>')

_cliente: httpx.AsyncClient | None = None


def _cli() -> httpx.AsyncClient:
    global _cliente
    if _cliente is None:
        _cliente = httpx.AsyncClient(base_url=ANESTESIO_URL.rstrip("/"), timeout=httpx.Timeout(600.0, connect=5.0),
                                     follow_redirects=False)
    return _cliente


async def _enviar(metodo: str, ruta: str, cabeceras: dict, cuerpo: bytes) -> httpx.Response:
    """Separado para poder sustituirlo en las pruebas."""
    return await _cli().request(metodo, ruta, content=cuerpo, headers=cabeceras)


def adaptar_html(html: bytes) -> bytes:
    """Inyecta el script del prefijo y reescribe las rutas absolutas del marcado."""
    html = _ABSOLUTOS.sub(rb'\1="' + PREFIJO.encode() + b'/', html)
    i = html.lower().find(b"<head>")
    if i >= 0:
        j = i + len(b"<head>")
        return html[:j] + _INYECCION + html[j:]
    return _INYECCION + html


_NO_DISPONIBLE = """<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Mesa del anestesiólogo</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#f6f1ea;color:#222;display:grid;place-items:center;height:100vh;margin:0}
.c{max-width:520px;background:#fff;border:1px solid #d9cfc2;border-left:6px solid #a05050;border-radius:12px;padding:22px 26px}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;line-height:1.5;margin:6px 0}</style></head>
<body><div class="c"><h1>La mesa del anestesiólogo no está disponible</h1>
<p>El servicio de la mesa no responde en este servidor. Avisa al administrador: debe revisar el servicio <code>com.megi.anestesio</code>.</p></div></body></html>"""


@router.api_route(PREFIJO, methods=_METODOS, include_in_schema=False)
@router.api_route(PREFIJO + "/{ruta:path}", methods=_METODOS, include_in_schema=False)
async def mesa(request: Request, ruta: str = ""):
    destino = "/" + ruta
    if request.url.query:
        destino += "?" + request.url.query
    cabeceras = {k: v for k, v in request.headers.items() if k.lower() not in _NO_REENVIAR}
    cabeceras["X-Forwarded-Prefix"] = PREFIJO
    cabeceras["X-Forwarded-Proto"] = request.headers.get("x-forwarded-proto", request.url.scheme)
    cabeceras["X-Forwarded-For"] = (request.client.host if request.client else "") or ""
    cuerpo = await request.body()
    try:
        r = await _enviar(request.method, destino, cabeceras, cuerpo)
    except httpx.HTTPError:
        return HTMLResponse(_NO_DISPONIBLE, status_code=503)

    contenido = r.content
    tipo = r.headers.get("content-type", "")
    if tipo.startswith("text/html") and request.method != "HEAD":
        contenido = adaptar_html(contenido)
    salida = Response(content=contenido, status_code=r.status_code, media_type=None)
    for k, v in r.headers.multi_items():
        kl = k.lower()
        if kl in _NO_REENVIAR or kl == "content-length":
            continue
        if kl == "location" and v.startswith("/") and not v.startswith("//"):
            v = PREFIJO + v
        if kl == "set-cookie":
            v = re.sub(r"(?i);\s*Path=/(?=;|$)", f"; Path={PREFIJO}", v)
            salida.raw_headers.append((b"set-cookie", v.encode("latin-1")))
            continue
        salida.headers[k] = v
    return salida
