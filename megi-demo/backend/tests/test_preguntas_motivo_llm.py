"""Preguntas que el MODELO propone sobre el motivo escrito (21-sep-2026).

Antes, un motivo fuera de las 17 guías de `motivo_engine` no aportaba nada y el
panel «Antes de empezar» solo mostraba lo de edad: parecía ignorar lo escrito.
Aquí se prueba la conversión/defensa (`motivo_engine.desde_llm`), que la
pre-consulta las devuelve aparte y con fuente propia, y que el seguimiento en
vivo las vigila por sus claves. El LLM se sustituye: no corre en la suite."""
from app.services import motivo_engine as me

LLM = [
    {"texto": "¿Desde cuándo tiene el dolor de rodilla y cómo empezó?", "categoria": "interrogatorio",
     "claves": ["desde cuándo", "empezó", "Rodilla"]},
    {"texto": "¿Hubo golpe, torcedura o caída?", "categoria": "interrogatorio", "claves": ["golpe", "caída"]},
    {"texto": "Fiebre con rodilla caliente e hinchada (artritis séptica)", "categoria": "alarma",
     "claves": ["fiebre", "caliente", "hinchada"]},
    {"texto": "Explorar derrame, rangos de movimiento y estabilidad ligamentaria", "categoria": "exploracion",
     "claves": ["derrame", "cajón"]},
]


# ------------------------------------------------------------------ desde_llm
def test_convierte_al_formato_del_panel_con_fuente_propia():
    out = me.desde_llm(LLM, "dolor de rodilla derecha")
    assert len(out) == 4
    assert all(s["fuente"] == me.FUENTE_LLM for s in out)
    assert all(s["razon"] == "Sobre el motivo: dolor de rodilla derecha" for s in out)
    assert set(out[0].keys()) == {"categoria", "texto", "razon", "fuente", "prioridad", "claves"}


def test_las_alarmas_van_primero_y_son_prioritarias():
    out = me.desde_llm(LLM, "dolor de rodilla")
    assert out[0]["categoria"] == "alarma" and out[0]["prioridad"] == "alta"
    assert all(s["prioridad"] == "media" for s in out[1:])


def test_las_claves_se_normalizan_y_acotan():
    out = me.desde_llm(LLM, "dolor de rodilla")
    primera = next(s for s in out if s["texto"].startswith("¿Desde cuándo"))
    assert primera["claves"] == ["desde cuando", "empezo", "rodilla"]      # sin acentos, minúsculas
    muchas = [{"texto": "x pregunta", "claves": ["a", "b", "c", "d", "e", "f"]}]
    assert len(me.desde_llm(muchas, "m")[0]["claves"]) == 4


def test_descarta_basura_categorias_raras_y_acota_a_seis():
    items = [{"texto": "", "claves": ["x"]}, "no soy dict", {"claves": ["sin texto"]},
             {"texto": "Pregunta con categoría inventada", "categoria": "diagnostico"}]
    temas = ["sueño", "apetito", "fiebre", "vacunas", "escuela", "deporte", "familia", "viajes", "mascotas"]
    items += [{"texto": f"¿Cómo va con {tema} últimamente?", "claves": [tema]} for tema in temas]
    out = me.desde_llm(items, "motivo")
    assert len(out) == me.MAX_PREGUNTAS_LLM
    assert out[0]["texto"] == "Pregunta con categoría inventada" and out[0]["categoria"] == "interrogatorio"


def test_no_repite_una_sugerencia_ya_listada_aunque_cambie_la_redaccion():
    ya = me.sugerencias_por_motivo("tos")["sugerencias"]
    hemoptisis = next(s for s in ya if "sangre" in s["texto"].lower() or "hemoptisis" in s["texto"].lower())
    repetida = {"texto": hemoptisis["texto"] + " (preguntar siempre)", "categoria": "alarma", "claves": ["sangre"]}
    nueva = {"texto": "¿La tos es seca o con flemas y de qué color?", "claves": ["flemas", "seca"]}
    out = me.desde_llm([repetida, nueva], "tos", ya)
    assert [s["texto"] for s in out] == [nueva["texto"]]


def test_sin_motivo_o_sin_lista_no_inventa():
    assert me.desde_llm(LLM, "") == []
    assert me.desde_llm(None, "dolor") == []
    assert me.desde_llm({"texto": "dict suelto"}, "dolor") == []


# ------------------------------------------------------------------ pre-consulta
def _con_llm(monkeypatch, respuesta):
    from app.routes import patients as rutas
    from app.services import asr_client
    monkeypatch.setattr(rutas, "REAL_ASR", True, raising=False)
    import app.config as cfg
    monkeypatch.setattr(cfg, "REAL_ASR", True)
    llamadas = []

    def falso(ctx, base):
        llamadas.append({"ctx": ctx, "base": base})
        return respuesta
    monkeypatch.setattr(asr_client, "preconsulta_personalize", falso)
    return llamadas


def test_la_preconsulta_devuelve_las_preguntas_del_modelo_aparte(client, auth, patient, monkeypatch):
    llamadas = _con_llm(monkeypatch, {"status": "done", "resumen": "Priorizar el dolor.",
                                      "prioridad": ["¿Desde cuándo?"], "preguntas_motivo": LLM})
    r = client.post(f"/api/patients/{patient['id']}/preconsulta",
                    json={"motivo": "dolor de rodilla derecha al subir escaleras"}, headers=auth)
    assert r.status_code == 200, r.text
    d = r.json()
    assert llamadas and llamadas[0]["ctx"]["motivo_de_hoy"] == "dolor de rodilla derecha al subir escaleras"
    assert d["motivo_reconocido"] == []                       # no está entre las 17 guías…
    assert len(d["preguntas_motivo"]) == 4                    # …pero el modelo sí propone
    assert d["preguntas_motivo"][0]["categoria"] == "alarma"
    assert all(s["fuente"] == me.FUENTE_LLM for s in d["preguntas_motivo"])
    # y NO se mezclan con las de edad/guías
    assert all(s["fuente"] != me.FUENTE_LLM for s in d["sugerencias"])
    assert d["resumen"] == "Priorizar el dolor."


def test_con_motivo_reconocido_el_modelo_complementa_sin_duplicar(client, auth, patient, monkeypatch):
    ya = me.sugerencias_por_motivo("tos")["sugerencias"]
    repetida = {"texto": ya[0]["texto"], "categoria": ya[0]["categoria"], "claves": ["x"]}
    nueva = {"texto": "¿Convive con alguien con tos crónica o tuberculosis?", "claves": ["tuberculosis", "convive"]}
    _con_llm(monkeypatch, {"status": "done", "resumen": "", "prioridad": [], "preguntas_motivo": [repetida, nueva]})
    d = client.post(f"/api/patients/{patient['id']}/preconsulta", json={"motivo": "tos"}, headers=auth).json()
    assert d["motivo_reconocido"]                              # sí está en las guías
    assert [s["texto"] for s in d["preguntas_motivo"]] == [nueva["texto"]]


def test_sin_motivo_el_modelo_no_propone_preguntas(client, auth, patient, monkeypatch):
    _con_llm(monkeypatch, {"status": "done", "resumen": "r", "prioridad": [], "preguntas_motivo": LLM})
    d = client.post(f"/api/patients/{patient['id']}/preconsulta", json={"motivo": ""}, headers=auth).json()
    assert d["motivo_de_hoy"] == "" and d["preguntas_motivo"] == []


def test_si_el_llm_falla_la_preconsulta_sigue(client, auth, patient, monkeypatch):
    from app.services import asr_client
    import app.config as cfg
    monkeypatch.setattr(cfg, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "preconsulta_personalize", lambda *a: (_ for _ in ()).throw(RuntimeError("caído")))
    d = client.post(f"/api/patients/{patient['id']}/preconsulta", json={"motivo": "dolor de rodilla"}, headers=auth).json()
    assert d["preguntas_motivo"] == [] and d["sugerencias"]


def test_sin_personalizar_no_hay_preguntas_del_modelo(client, auth, patient):
    d = client.post(f"/api/patients/{patient['id']}/preconsulta",
                    json={"motivo": "dolor de rodilla", "personalizar": False}, headers=auth).json()
    assert d["preguntas_motivo"] == []


# ------------------------------------------------------------------ en vivo
def test_el_seguimiento_en_vivo_vigila_las_preguntas_del_modelo(client, auth, patient):
    c = client.post("/api/consultations", json={"patient_id": patient["id"]}, headers=auth).json()
    cuerpo = {"consultation_id": c["id"], "motivo": "dolor de rodilla derecha", "preguntas_motivo": LLM}
    r = client.post("/api/live/pendientes", json=cuerpo, headers=auth).json()
    textos = [p["texto"] for p in r["pendientes"]]
    assert LLM[2]["texto"] in textos                            # la alarma, primero
    assert r["pendientes"][0]["texto"] == LLM[2]["texto"]
    assert r["n_seguidas"] == 4

    # Se dice en la consulta → deja de estar pendiente. La alarma pide DOS claves.
    # El transcript solo lo escribe el flujo de audio: se simula directo en la base.
    from app.db import db
    with db() as conn:
        conn.execute("UPDATE consultations SET transcript = ? WHERE id = ?",
                     ("¿tuvo algún golpe o caída? no doctor. y no tengo fiebre ni la siento caliente", c["id"]))
    r2 = client.post("/api/live/pendientes", json=cuerpo, headers=auth).json()
    cubiertos = [p["texto"] for p in r2["cubiertas"]]
    assert LLM[1]["texto"] in cubiertos and LLM[2]["texto"] in cubiertos
    assert LLM[0]["texto"] not in cubiertos


def test_en_vivo_no_se_traga_cualquier_cosa_del_cuerpo(client, auth, patient):
    c = client.post("/api/consultations", json={"patient_id": patient["id"]}, headers=auth).json()
    r = client.post("/api/live/pendientes", json={
        "consultation_id": c["id"], "motivo": "dolor de rodilla",
        "preguntas_motivo": [{"texto": "válida", "claves": ["k"], "fuente": "guía oficial", "prioridad": "alta",
                              "categoria": "vacuna"}, "basura", 42],
    }, headers=auth).json()
    assert len(r["pendientes"]) == 1
    p = r["pendientes"][0]
    assert p["fuente"] == me.FUENTE_LLM and p["categoria"] == "interrogatorio" and p["prioridad"] == "media"
