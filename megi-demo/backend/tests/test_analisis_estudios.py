"""Análisis automático de los estudios aportados: identificación, registro de
analizadores, pre-diagnóstico versionado. El servicio typesafe se simula
(monkeypatch de `_post_typesafe`); el camino del PDF es real (pypdf).
"""
import io
import json

import pytest
from PIL import Image

from app.services import analisis_estudios as an


def _png(color=(120, 120, 120), seed=None, size=(640, 520)) -> bytes:
    """Imagen con textura (el triaje descarta las uniformes y las pequeñas)."""
    import numpy as _np
    # cada llamada sin semilla da una imagen distinta: el triaje rechaza repetidos
    global _N_PNG
    _N_PNG = globals().get("_N_PNG", 0) + 1
    rng = _np.random.default_rng(seed if seed is not None else sum(color) * 1000 + _N_PNG)
    base = rng.integers(30, 220, (8, 7), dtype=_np.uint8)
    im = Image.fromarray(base).resize(size, Image.BICUBIC).convert("RGB")
    b = io.BytesIO(); im.save(b, format="PNG"); return b.getvalue()


def _pdf_con_texto() -> bytes:
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    w = PdfWriter(); page = w.add_blank_page(width=300, height=300)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): w._add_object(font)})})
    stream = DecodedStreamObject(); stream.set_data(b"BT /F1 12 Tf 20 200 Td (GLUCOSA 142 mg/dL) Tj ET")
    page[NameObject("/Contents")] = w._add_object(stream)
    b = io.BytesIO(); w.write(b); return b.getvalue()


@pytest.fixture()
def consulta(client, auth, patient):
    r = client.post("/api/consultations", json={"patient_id": patient["id"], "motivo": "tos de dos semanas"}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture()
def typesafe_simulado(monkeypatch):
    """Clasificador + modelos del visor, sin servicio: la clase la decide el
    color de la imagen (lo pone cada prueba) y el análisis devuelve hallazgos fijos."""
    monkeypatch.setattr(an, "TYPESAFE_URL", "http://typesafe.test")
    llamadas = []

    def fake_post(path, body):
        llamadas.append(path)
        if path == "/api/clasificar":
            return {"tipo": fake_post.tipo, "clase_bruta": fake_post.tipo, "p": {fake_post.tipo: 0.97}, "distancia": 12.0,
                    "umbral_p": 0.9, "umbral_distancia": 54.0, "reconocido": fake_post.tipo != "no_reconocido", "nombre_modelo": "Megi_tipo_estudio"}
        if path == "/api/analizar":
            return {"nombre_modelo": "Megi_torax_one", "corrida": "s1_v2", "vista_modelo": "PA", "imagen": "data:...",
                    "hallazgos": [{"nombre": "Cardiomegalia", "p": 0.61, "estado": "presente", "mapa": [[0.1]]},
                                  {"nombre": "Derrame pleural", "p": 0.22, "estado": "posible", "mapa": [[0.2]]},
                                  {"nombre": "Nódulo", "p": 0.02, "estado": "ausente"}]}
        if path == "/api/columna/analizar":
            return {"nombre_modelo": "Megi_columna_preguntas_combinadas", "region": "lumbar", "vista": "lateral", "p_region": 0.99, "p_vista": 0.95,
                    "preguntas": [{"nombre": "Espondilolistesis", "p": 0.7, "estado": "posible"}], "experimentales": [], "imagen": "x"}
        if path == "/api/abdomen/analizar":
            return {"nombre_localizador": "Megi_abdomen_calculos_localizador", "modo": "abdomen", "imagen": "x",
                    "modelos": [{"nombre": "Megi_abdomen_calculos_localizador", "p": 0.31, "umbral_experimental": 0.5}], "marcas": [1, 2],
                    "advertencia": "Experimental: solo cálculos urinarios."}
        raise AssertionError(path)
    fake_post.tipo = "torax"
    monkeypatch.setattr(an, "_post_typesafe", fake_post)
    monkeypatch.setattr(an, "typesafe_disponible", lambda: True)
    return fake_post, llamadas


def test_registro_de_analizadores():
    assert [a["clave"] for a in an.analizadores_para("torax")] == ["typesafe_torax"]
    assert [a["clave"] for a in an.analizadores_para("pdf_texto")] == ["laboratorio"]
    assert [a["clave"] for a in an.analizadores_para("ecg_senal")] == ["ecg_senal"]
    assert an.analizadores_para("ecg") == [] and an.analizadores_para("no_reconocido") == []


def test_subida_dispara_identificacion_analisis_y_prediagnostico(client, auth, consulta, typesafe_simulado):
    fake, llamadas = typesafe_simulado
    cid = consulta["id"]
    r = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("rx.png", _png(), "image/png")}, headers=auth)
    assert r.status_code == 200, r.text
    # la tarea de fondo ya corrió (TestClient la ejecuta al responder)
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    e = d["estudios"][0]
    assert e["tipo"] == "torax" and e["tipo_label"] == "Radiografía de tórax" and e["analisis_estado"] == "listo"
    assert "/api/clasificar" in llamadas and "/api/analizar" in llamadas
    a = e["analisis"][0]
    assert a["analizador"] == "typesafe_torax" and a["modelo"] == "Megi_torax_one" and a["status"] == "done"
    assert "Cardiomegalia (61 %)" in a["resumen"] and "Posible (no concluyente): Derrame pleural" in a["resumen"]
    pre = d["prediagnostico"]
    assert pre and pre["version"] == 1 and pre["fuente"] == "mock"
    assert "[E1] rx.png" in pre["texto"] and "Cardiomegalia" in pre["texto"]
    assert pre["modelos"][0]["modelo"] == "Megi_torax_one"
    assert d["servicio_modelos"]["disponible"] is True
    assert any(x["clave"] == "typesafe_columna" for x in d["analizadores"])

    # segundo archivo: columna -> el pre-diagnóstico se rehace como v2 con ambos
    fake.tipo = "columna"
    client.post(f"/api/consultations/{cid}/estudios", files={"file": ("col.png", _png((10, 10, 10)), "image/png")}, headers=auth)
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    assert d["estudios"][1]["tipo"] == "columna"
    assert "Región lumbar" in d["estudios"][1]["analisis"][0]["resumen"]
    assert d["prediagnostico"]["version"] == 2 and "[E2] col.png" in d["prediagnostico"]["texto"]

    # el JSON guardado no lleva la imagen ni los mapas
    from app.db import db
    with db() as conn:
        raw = conn.execute("SELECT resultado FROM estudios_analisis WHERE analizador = 'typesafe_torax'").fetchone()["resultado"]
    res = json.loads(raw)
    assert "imagen" not in res and all("mapa" not in h for h in res["hallazgos"])


def test_tipos_sin_modelo_y_abdomen(client, auth, consulta, typesafe_simulado):
    fake, _ = typesafe_simulado
    cid = consulta["id"]
    fake.tipo = "ecg"
    client.post(f"/api/consultations/{cid}/estudios", files={"file": ("ecg.png", _png(), "image/png")}, headers=auth)
    fake.tipo = "no_reconocido"
    client.post(f"/api/consultations/{cid}/estudios", files={"file": ("selfie.png", _png(), "image/png")}, headers=auth)
    fake.tipo = "abdomen"
    client.post(f"/api/consultations/{cid}/estudios", files={"file": ("kub.png", _png(), "image/png")}, headers=auth)
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    por = {e["nombre"]: e for e in d["estudios"]}
    assert por["ecg.png"]["analisis"][0]["status"] == "sin_modelo" and "no hay modelo de ECG" in por["ecg.png"]["analisis"][0]["resumen"]
    assert por["selfie.png"]["tipo"] == "no_reconocido" and por["selfie.png"]["analisis"][0]["status"] == "sin_modelo"
    assert "probabilidad de cálculo urinario 31 %" in por["kub.png"]["analisis"][0]["resumen"]
    assert "2 candidatos" in por["kub.png"]["analisis"][0]["resumen"]
    assert d["prediagnostico"]["version"] == 3 and "Electrocardiograma en papel" in d["prediagnostico"]["texto"]


def test_pdf_con_texto_se_lee_sin_servicio(client, auth, consulta, monkeypatch):
    monkeypatch.setattr(an, "TYPESAFE_URL", "")
    cid = consulta["id"]
    r = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("labs.pdf", _pdf_con_texto(), "application/pdf")}, headers=auth)
    assert r.status_code == 200, r.text
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    e = d["estudios"][0]
    assert e["tipo"] == "pdf_texto" and e["analisis"][0]["analizador"] == "laboratorio"
    assert "glucosa 142 mg/dL (ALTO" in e["analisis"][0]["resumen"]
    assert "Guías relacionadas" in e["analisis"][0]["resumen"] and "diabetes" in e["analisis"][0]["resumen"].lower()
    assert "glucosa 142" in d["prediagnostico"]["texto"]
    # una imagen sin servicio de modelos queda «sin clasificar», no rompe
    client.post(f"/api/consultations/{cid}/estudios", files={"file": ("rx.png", _png(), "image/png")}, headers=auth)
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    assert d["estudios"][1]["tipo"] == "sin_clasificar" and d["servicio_modelos"]["disponible"] is False


def test_servicio_caido_marca_error_y_reanalizar_recupera(client, auth, consulta, monkeypatch):
    monkeypatch.setattr(an, "TYPESAFE_URL", "http://typesafe.test")
    def caido(path, body):
        raise RuntimeError("conexión rechazada")
    monkeypatch.setattr(an, "_post_typesafe", caido)
    cid = consulta["id"]
    r = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("rx.png", _png(), "image/png")}, headers=auth)
    eid = r.json()["id"]
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    assert d["estudios"][0]["tipo"] == "sin_clasificar"

    def vivo(path, body):
        if path == "/api/clasificar":
            return {"tipo": "torax", "clase_bruta": "torax", "p": {"torax": 0.99}, "distancia": 10, "nombre_modelo": "Megi_tipo_estudio"}
        return {"nombre_modelo": "Megi_torax_one", "corrida": "s1_v2", "hallazgos": []}
    monkeypatch.setattr(an, "_post_typesafe", vivo)
    r = client.post(f"/api/consultations/{cid}/estudios/{eid}/analizar", headers=auth).json()
    assert r["tipo"] == "torax" and r["analisis"][0]["status"] == "done" and r["prediagnostico"]["version"] == 2
    assert "Sin hallazgos afirmados" in r["analisis"][0]["resumen"]


def test_prediagnostico_modo_real_y_regenerar(client, auth, consulta, typesafe_simulado, monkeypatch):
    from app.services import asr_client
    monkeypatch.setattr(an, "REAL_ASR", True)
    recibido = {}
    def fake_pre(hechos_txt, contexto):
        recibido["hechos"] = hechos_txt; recibido["ctx"] = contexto
        return {"status": "done", "texto": "Cardiomegalia probable [E1]. ¿Disnea de esfuerzo?", "model": "gemma-test"}
    monkeypatch.setattr(asr_client, "prediagnostico", fake_pre)
    cid = consulta["id"]
    client.post(f"/api/consultations/{cid}/estudios", files={"file": ("rx.png", _png(), "image/png")}, headers=auth)
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    assert d["prediagnostico"]["fuente"] == "llm" and d["prediagnostico"]["texto"].startswith("Cardiomegalia probable [E1]")
    assert "[E1] rx.png · Radiografía de tórax · Megi_torax_one" in recibido["hechos"]
    assert recibido["ctx"]["motivo"] == "tos de dos semanas" and recibido["ctx"]["edad"] == 40

    # servicio caído: cae a «sin_modelo» con el ordenamiento, y queda como versión nueva
    def boom(*a, **k):
        raise RuntimeError("timeout")
    monkeypatch.setattr(asr_client, "prediagnostico", boom)
    p = client.post(f"/api/consultations/{cid}/estudios/prediagnostico", headers=auth).json()
    assert p["version"] == 2 and p["fuente"] == "sin_modelo" and "timeout" in p["error"] and "[E1] rx.png" in p["texto"]


def test_borrar_estudio_borra_sus_analisis(client, auth, consulta, typesafe_simulado):
    cid = consulta["id"]
    eid = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("rx.png", _png(), "image/png")}, headers=auth).json()["id"]
    assert client.delete(f"/api/consultations/{cid}/estudios/{eid}", headers=auth).json()["ok"]
    from app.db import db
    with db() as conn:
        assert conn.execute("SELECT count(*) FROM estudios_analisis WHERE estudio_id = ?", (eid,)).fetchone()[0] == 0



# ------------------------------------------------------------ laboratorio
def test_laboratorio_lee_valores_referencia_y_guias():
    from app.services import laboratorio as lab
    texto = """LABORATORIO CLINICO SAN JOSE        Paciente: X
    BIOMETRIA HEMATICA
    Hemoglobina            11.2 g/dL      12.0 - 15.5
    Leucocitos             7.8  x10^3/uL  4.5 - 11.0
    QUIMICA SANGUINEA
    Glucosa                142 mg/dL      70 - 99
    Creatinina             0.9 mg/dL
    Colesterol total       228 mg/dL
    Trigliceridos          190 mg/dL
    TSH                    6.8 mUI/L
    """
    r = lab.leer(texto, {"edad": 45, "sexo": "femenino", "sexo_codigo": "F", "motivo": "cansancio"})
    por = {a["clave"]: a for a in r["analitos"]}
    assert por["hemoglobina"]["estado"] == "bajo" and por["hemoglobina"]["rango_fuente"] == "laboratorio"
    assert por["glucosa"]["estado"] == "alto" and por["leucocitos"]["estado"] == "normal"
    assert por["creatinina"]["rango_fuente"] == "general" and por["creatinina"]["estado"] == "normal"
    assert por["colesterol_total"]["estado"] == "alto" and por["trigliceridos"]["estado"] == "alto" and por["tsh"]["estado"] == "alto"
    temas = {a["tema"] for a in r["anormales"]}
    assert temas == {"anemia", "diabetes", "dislipidemia", "tiroides"}
    titulos = " ".join(g["title"].lower() for g in r["guias"])
    for esperado in ("anemia", "diabetes", "dislipidemia", "hipotiroidismo"):
        assert esperado in titulos, titulos
    assert "Consulta a las guías con el modelo: pendiente" in r["resumen"]

    # con «modelo»: la pregunta lleva los valores y la respuesta se adjunta con fuentes
    preguntas = []
    def fake(q):
        preguntas.append(q); return {"answer": "Glucosa ≥126 en ayuno sugiere diabetes [S1].", "sources": [{"title": "GPC Diabetes"}]}
    r2 = lab.leer(texto, {"edad": 45, "sexo": "femenino", "sexo_codigo": "F", "motivo": "cansancio"}, fake)
    assert "glucosa 142" in preguntas[0] and "45 años" in preguntas[0]
    assert r2["consulta_guias"]["respuesta"].startswith("Glucosa") and "Consulta a las guías (Megi-LLM)" in r2["resumen"]


def test_laboratorio_sin_valores_y_abreviaturas():
    from app.services import laboratorio as lab
    r = lab.leer("Informe de ultrasonido: higado de tamano normal, sin lesiones.", {})
    assert not r["analitos"] and r["resumen"].startswith("Documento con texto, sin valores")
    # «K» y «Na» solo como palabra entera: «tanKe 5» no es potasio
    r = lab.leer("Na 131 mmol/L\nK 5.7 mmol/L\nTanque 5", {})
    assert {a["clave"]: a["estado"] for a in r["analitos"]} == {"sodio": "bajo", "potasio": "alto"}


def test_foto_de_laboratorio_pasa_por_ocr(client, auth, consulta, typesafe_simulado):
    """El clasificador dice «no reconocido»; el OCR encuentra una hoja de laboratorio."""
    import shutil
    if not shutil.which("tesseract"):
        pytest.skip("sin tesseract")
    from PIL import ImageDraw, ImageFont
    fake, _ = typesafe_simulado
    fake.tipo = "no_reconocido"
    im = Image.new("RGB", (1100, 700), "white"); dr = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 34)
    except Exception:
        font = ImageFont.load_default()
    for i, linea in enumerate(["LABORATORIO CLINICO", "RESULTADOS DE QUIMICA SANGUINEA",
                               "Glucosa        156 mg/dL     70 - 99", "Creatinina     1.9 mg/dL     0.7 - 1.3",
                               "Colesterol     245 mg/dL     < 200"]):
        dr.text((40, 40 + i * 90), linea, fill="black", font=font)
    b = io.BytesIO(); im.save(b, format="PNG")
    cid = consulta["id"]
    client.post(f"/api/consultations/{cid}/estudios", files={"file": ("foto_labs.png", b.getvalue(), "image/png")}, headers=auth)
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    e = d["estudios"][0]
    assert e["tipo"] == "documento_foto", e
    res = e["analisis"][0]["resumen"]
    assert "glucosa 156" in res and "creatinina 1.9" in res and "ALTO" in res
    assert "renal" in res.lower() and "diabetes" in res.lower()


# ------------------------------------------------------------ ECG en señal
def _wfdb_muestra():
    import glob, os
    base = "/private/tmp/claude-501/-Users-davidmedinastudio-megi-final-canvas-megi-ia/429c32d9-b81a-4ca2-8f35-581662bd38b0/scratchpad/ecg"
    hea = os.path.join(base, "s0047lre.hea"); dat = os.path.join(base, "s0047lre.dat")
    if not (os.path.isfile(hea) and os.path.isfile(dat)):
        pytest.skip("sin registro WFDB de muestra")
    return open(hea, "rb").read(), open(dat, "rb").read()


def test_ecg_wfdb_cabecera_y_senal(client, auth, consulta):
    hea, dat = _wfdb_muestra()
    cid = consulta["id"]
    r = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("s0047lre.hea", hea, "text/plain")}, headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["formato"] == "wfdb_hea"
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    e = d["estudios"][0]
    assert e["tipo"] == "ecg_senal" and "falta el archivo .dat" in e["analisis"][0]["resumen"]
    assert "15 derivaciones" in e["analisis"][0]["resumen"] and "1000 Hz" in e["analisis"][0]["resumen"]

    r = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("s0047lre.dat", dat, "application/octet-stream")}, headers=auth)
    assert r.status_code == 200 and r.json()["formato"] == "wfdb_dat"
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    por = {x["nombre"]: x for x in d["estudios"]}
    assert por["s0047lre.dat"]["tipo"] == "ecg_senal_parte"
    hea_e = por["s0047lre.hea"]
    res = hea_e["analisis"][0]["resumen"]
    assert "falta el archivo" not in res and "frecuencia cardiaca estimada" in res and "115 s" in res
    assert hea_e["tiene_vista"] is True
    v = client.get(f"/api/consultations/{cid}/estudios/{hea_e['id']}/vista", headers=auth)
    assert v.status_code == 200 and v.content[:4] == b"\x89PNG"
    assert "Sin modelo de ECG conectado" in d["prediagnostico"]["texto"]


def test_ecg_csv_y_csv_de_laboratorio(client, auth, consulta):
    import numpy as np
    cid = consulta["id"]
    t = np.arange(0, 12, 1 / 250.0)
    senal = np.zeros_like(t)
    for lat in np.arange(0.4, 12, 0.8):                       # 75 lpm sintéticos
        senal += np.exp(-((t - lat) ** 2) / (2 * 0.01 ** 2))
    csv = "tiempo,II,V1\n" + "\n".join(f"{a:.4f},{b:.4f},{b / 2:.4f}" for a, b in zip(t, senal))
    r = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("ecg.csv", csv.encode(), "text/csv")}, headers=auth)
    assert r.status_code == 200 and r.json()["formato"] == "csv"
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    e = d["estudios"][0]
    assert e["tipo"] == "ecg_senal"
    res = e["analisis"][0]["resumen"]
    assert "2 derivaciones (II, V1)" in res and "250 Hz" in res and "frecuencia cardiaca estimada 7" in res

    labs = "Analito,Resultado,Unidad,Referencia\nGlucosa,118,mg/dL,70-99\nHemoglobina,14.1,g/dL,12-15.5\n"
    r = client.post(f"/api/consultations/{cid}/estudios", files={"file": ("labs.csv", labs.encode(), "text/csv")}, headers=auth)
    assert r.status_code == 200
    d = client.get(f"/api/consultations/{cid}/estudios/analisis", headers=auth).json()
    e = {x["nombre"]: x for x in d["estudios"]}["labs.csv"]
    assert e["tipo"] == "documento_csv" and "glucosa 118 mg/dL (ALTO" in e["analisis"][0]["resumen"]
