"""MEGI backend (FastAPI). Mocks con la misma forma que usará el sistema real."""
from contextlib import asynccontextmanager

from fastapi.responses import FileResponse
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import phi_at_rest
from .config import ALLOWED_ORIGINS, FRONTEND_DIST
from .db import init_db
from .security import require_user
from .seed import seed_if_empty
from .routes import (
    appointments,
    asr_proxy,
    audio,
    auth,
    calculo,
    cie10,
    config,
    consultations,
    documents,
    estudios,
    expediente,
    export,
    guidelines,
    health,
    identifiers,
    live,
    me,
    medications,
    mesa_proxy,
    patients,
    radiologia,
    rehab,
    review,
    safety,
    stats,
    subida,
    transcribe,
    users,
    voice,
)
from .routes.users import seed_users


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_if_empty()
    seed_users()
    # PHI en claro en backend/data/: avisar si el disco no está cifrado (#7).
    phi_at_rest.warn_if_unprotected()
    yield


app = FastAPI(title="MEGI backend", version="0.1.0", lifespan=lifespan)

# El dev usa el proxy /api de Vite (sin CORS), pero permitimos el origen del
# dev server para curl/tests directos.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Contrato de acceso (v0.0.1):
#  - Públicos: health, auth (login).
#  - Todo lo clínico exige usuario autenticado (token firmado).
#  - 'users' además exige rol admin (impuesto por ruta en routes/users.py).
#  - asr_proxy es un WebSocket que valida el token él mismo (query param), por
#    lo que NO puede llevar la dependencia Header de require_user (el navegador
#    no puede mandar Authorization en new WebSocket()); va sin dependencia.
_PUBLIC = {health, auth, asr_proxy, subida}
for module in (health, auth, config, calculo, patients, expediente, estudios, subida, consultations, transcribe, identifiers, review, export, audio, live, stats, users, guidelines, documents, safety, cie10, radiologia, rehab, appointments, voice, medications, me, asr_proxy):
    deps = [] if module in _PUBLIC else [Depends(require_user)]
    app.include_router(module.router, prefix="/api", dependencies=deps)

# La mesa del anestesiólogo embebida: /mesa/* se reenvía a su servidor (ver
# routes/mesa_proxy.py). Sin /api y sin dependencia: la mesa exige su propio
# pase. Va ANTES del montaje del frontend para que no lo tape el fallback SPA.
app.include_router(mesa_proxy.router)


# --------------------------------------------------------------- frontend build
# Empaquetado (Fase 1): en producción el backend sirve el build de Vite, así que
# el dev server desaparece y todo queda en un solo origen (:8000). El montaje va
# DESPUÉS de los routers para que `/api/*` siga teniendo prioridad; `html=True`
# da el fallback SPA. En desarrollo esto no estorba: si no hay `dist/`, no se
# monta nada y se sigue usando Vite en :5173.
class _FrontendFiles(StaticFiles):
    """StaticFiles con la política de caché que exige un build con hash.

    Vite renombra cada bundle con un hash y BORRA el anterior. Sin cabeceras,
    el navegador cachea `index.html` por heurística, y tras un `megi update` ese
    HTML viejo pide un `/assets/index-XXXX.js` que ya no existe: 404, el módulo
    no carga y la app se queda EN BLANCO. Pasó al abrir una pestaña nueva tras
    reconstruir, y desde fuera parece que el servidor está caído.

    - index.html  -> `no-cache`: se revalida siempre (barato, es 1 KB).
    - /assets/*   -> `immutable` un año: el hash cambia si cambia el contenido,
                     así que nunca hay que revalidarlos.
    """

    async def get_response(self, path: str, scope):
        resp = await super().get_response(path, scope)
        if path.startswith("assets/") and resp.status_code == 200:
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            resp.headers["Cache-Control"] = "no-cache"
        return resp


if FRONTEND_DIST.is_dir():
    # La página del teléfono (/subir/<código>) es una ruta de la SPA: StaticFiles
    # no la conoce y daría 404, así que se devuelve el index y React la pinta.
    @app.get("/subir/{token}", include_in_schema=False)
    def _pagina_subida(token: str):
        return FileResponse(str(FRONTEND_DIST / "index.html"), headers={"Cache-Control": "no-cache"})

    app.mount("/", _FrontendFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
else:
    print(
        f"[megi] frontend sin construir ({FRONTEND_DIST}); sirviendo solo /api. "
        "Para producción: cd frontend && npm run build  (o `megi update`).",
        flush=True,
    )
