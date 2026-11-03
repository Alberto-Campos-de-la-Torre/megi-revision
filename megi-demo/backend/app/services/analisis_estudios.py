"""Análisis automático de los estudios que trae el paciente.

Cadena, por cada archivo subido (escritorio o teléfono):

1. IDENTIFICAR qué es. Imágenes: el clasificador de tipo de estudio del visor
   typesafe (`POST /api/clasificar`, RAD-DINO + sonda; tórax / columna /
   abdomen / ECG en papel / otro, con abstención). PDF: se extrae el texto
   (pypdf); sin texto es un escaneo y queda «pdf_escaneado».
2. ANALIZAR con los modelos que APLICAN a ese tipo. `ANALIZADORES` es el
   registro: cada entrada dice a qué tipos aplica y cómo se corre. Un modelo
   nuevo (ECG, laboratorio, rodilla…) se suma añadiendo una entrada; nada más
   cambia. Cada corrida queda en `estudios_analisis` con modelo, versión,
   resumen legible y el JSON completo (sin la imagen).
3. PRE-DIAGNÓSTICO de la consulta: todos los hechos de todos los estudios ->
   gemma redacta (servicio MLX) citando [E1], [E2]…; en `local_mock` o sin
   servicio, un ordenamiento determinista de los mismos hechos, marcado.
   Se guarda versionado en `prediagnosticos`: cada regeneración es una fila.

Es APOYO: el visor y los modelos ya avisan de lo que no está validado
(abdomen experimental, columna «posible»…), y eso se conserva en el texto.
Nada entra a la nota SOAP solo; el médico copia lo que decide en revisión.
"""
from __future__ import annotations

import base64
import io
import json
import os
import time
from datetime import datetime, timezone

import httpx

from ..config import REAL_ASR
from ..db import db
from . import ecg_senal, laboratorio

ECO_URL = os.environ.get("MEGI_ECO_URL", "").strip().rstrip("/")
AVISO_EXPERIMENTAL = "EXPERIMENTAL · Investigación, sin uso comercial. No validado clínicamente; requiere revisión del radiólogo."

TYPESAFE_URL = os.environ.get("MEGI_TYPESAFE_URL", "").strip().rstrip("/")
_TIMEOUT = 180.0
_MAX_TEXTO_PDF = 6000

TIPOS_LABEL = {
    "ecografia_mama": "Ecografía de mama (selección manual)", "ecografia_tiroides": "Ecografía de tiroides (selección manual)",
    "torax": "Radiografía de tórax", "columna": "Radiografía de columna", "abdomen": "Radiografía de abdomen (KUB)",
    "ecg": "Electrocardiograma en papel", "no_reconocido": "No reconocido como estudio conocido",
    "pdf_texto": "Documento PDF con texto", "pdf_escaneado": "PDF escaneado (sin texto legible)",
    "documento_foto": "Foto de documento (leída por OCR)", "documento_csv": "Tabla CSV de resultados",
    "descartado": "Descartado en el triaje",
    "ecg_senal": "Electrocardiograma en señal (registro)", "ecg_senal_parte": "Archivo de señal de ECG (parte de un registro)",
    "sin_vista": "Imagen sin vista previa (no se pudo leer)", "sin_clasificar": "Sin clasificar (servicio de modelos no disponible)",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def typesafe_disponible() -> bool:
    if not TYPESAFE_URL:
        return False
    try:
        r = httpx.get(f"{TYPESAFE_URL}/api/estado", timeout=5.0)
        return r.status_code == 200
    except Exception:
        return False


def eco_disponible() -> bool:
    if not ECO_URL:
        return False
    try:
        r = httpx.get(f"{ECO_URL}/api/estado", timeout=3.0)
        return r.status_code == 200 and r.json().get("disponible") is True
    except Exception:
        return False


def _correr_eco(vista_png: bytes, _raw: bytes, ctx: dict) -> dict:
    if not ECO_URL:
        raise RuntimeError("MEGI_ECO_URL sin configurar")
    config = ctx.get("eco_config") or {}
    if config.get("organo") not in ("mama", "tiroides") or not config.get("caja_xyxy"):
        raise ValueError("Selecciona el órgano y marca el nódulo con una caja")
    r = httpx.post(f"{ECO_URL}/api/eco/analizar", json={**config, "datos": base64.b64encode(vista_png).decode()}, timeout=_TIMEOUT)
    r.raise_for_status()
    d = r.json()
    if d.get("error"):
        raise RuntimeError(d["error"])
    return {"modelo": d["nombre_modelo"], "version": d.get("version"),
            "resumen": d["resumen"], "resultado": _sin_imagen(d),
            "eco_vista_png": base64.b64decode(d["imagen"], validate=True) if d.get("imagen") else None}


def _post_typesafe(path: str, body: dict) -> dict:
    r = httpx.post(f"{TYPESAFE_URL}{path}", json=body, timeout=_TIMEOUT)
    r.raise_for_status()
    d = r.json()
    if isinstance(d, dict) and d.get("error") and len(d) <= 2:
        raise RuntimeError(d["error"])
    return d


def _sin_imagen(d: dict) -> dict:
    """El visor devuelve la imagen anotada en base64 y mapas por píxel: no se
    guardan en la base (pesan y ya está el original en disco)."""
    out = {}
    for k, v in d.items():
        if k in ("imagen", "mapa", "mapas", "marcas_originales"):
            continue
        if k == "hallazgos" and isinstance(v, list):
            out[k] = [{kk: vv for kk, vv in h.items() if kk != "mapa"} for h in v if isinstance(h, dict)]
        else:
            out[k] = v
    return out


# ------------------------------------------------------------- identificación
def texto_pdf(raw: bytes) -> str:
    try:
        from pypdf import PdfReader
        lector = PdfReader(io.BytesIO(raw))
        partes = []
        for pagina in lector.pages[:12]:
            partes.append(pagina.extract_text() or "")
        return "\n".join(partes).strip()[:_MAX_TEXTO_PDF]
    except Exception:
        return ""


def _ocr_si_documento(vista_png: bytes, base: dict) -> dict:
    """Una imagen que el clasificador no reconoce como radiografía puede ser una
    hoja de laboratorio fotografiada: se pasa por OCR y, si hay texto, se trata
    como documento. Si no, se queda como estaba (no reconocido)."""
    txt = laboratorio.ocr_imagen(vista_png)
    if txt and laboratorio.parece_laboratorio(txt):
        return {"tipo": "documento_foto", "p": 1.0, "detalle": {**base.get("detalle", {}), "ocr_caracteres": len(txt)},
                "fuente": "tesseract", "texto": txt}
    if txt and len(txt) > 200:
        base["detalle"] = {**base.get("detalle", {}), "ocr_caracteres": len(txt)}
        base["texto"] = txt
    return base


def identificar(formato: str, raw_original: bytes, vista_png: bytes | None) -> dict:
    """{tipo, p, detalle, fuente}. Nunca lanza: si algo falla, el tipo lo dice."""
    if formato == "pdf":
        txt = texto_pdf(raw_original)
        if txt:
            return {"tipo": "pdf_texto", "p": 1.0, "detalle": {"caracteres": len(txt)}, "fuente": "pypdf", "texto": txt}
        return {"tipo": "pdf_escaneado", "p": 1.0, "detalle": {}, "fuente": "pypdf"}
    if formato == "wfdb_hea":
        return {"tipo": "ecg_senal", "p": 1.0, "detalle": {"formato": "WFDB"}, "fuente": "local"}
    if formato in ("wfdb_dat", "wfdb_anot"):
        return {"tipo": "ecg_senal_parte", "p": 1.0, "detalle": {"formato": "WFDB"}, "fuente": "local"}
    if formato == "csv":
        if ecg_senal.leer_csv(raw_original):
            return {"tipo": "ecg_senal", "p": 1.0, "detalle": {"formato": "CSV"}, "fuente": "local"}
        txt = raw_original.decode("utf-8", "ignore")
        return {"tipo": "documento_csv", "p": 1.0, "detalle": {"caracteres": len(txt)}, "fuente": "local",
                "texto": txt.replace(";", " ").replace(",", " ")}
    if not vista_png:
        return {"tipo": "sin_vista", "p": 0.0, "detalle": {}, "fuente": "local"}
    if not TYPESAFE_URL:
        return _ocr_si_documento(vista_png, {"tipo": "sin_clasificar", "p": 0.0, "detalle": {"error": "MEGI_TYPESAFE_URL sin definir"}, "fuente": "local"})
    try:
        r = _post_typesafe("/api/clasificar", {"datos": base64.b64encode(vista_png).decode(), "nombre": "vista.png"})
        out = {"tipo": r.get("tipo") or "no_reconocido", "p": float((r.get("p") or {}).get(r.get("clase_bruta"), 0.0)),
               "detalle": {"p": r.get("p"), "distancia": r.get("distancia"), "clase_bruta": r.get("clase_bruta"),
                           "umbral_p": r.get("umbral_p"), "umbral_distancia": r.get("umbral_distancia")},
               "fuente": r.get("nombre_modelo") or "typesafe"}
    except Exception as e:
        out = {"tipo": "sin_clasificar", "p": 0.0, "detalle": {"error": str(e)}, "fuente": "typesafe"}
    if out["tipo"] in ("no_reconocido", "sin_clasificar"):
        out = _ocr_si_documento(vista_png, out)
    return out


# ------------------------------------------------------------- analizadores
def _frase(txt, n: int = 320) -> str:
    """Recorta un aviso largo en un límite de frase, no a media palabra."""
    t = str(txt or "").strip()
    if len(t) <= n:
        return t
    corte = t[:n]
    punto = max(corte.rfind(". "), corte.rfind("; "))
    return (corte[:punto + 1] if punto > n // 2 else corte.rsplit(" ", 1)[0] + "…").strip()


def _pct(p) -> str:
    try:
        return f"{float(p) * 100:.0f} %"
    except (TypeError, ValueError):
        return "?"


def _correr_torax(vista_png: bytes, _raw: bytes, _ctx: dict) -> dict:
    r = _post_typesafe("/api/analizar", {"datos": base64.b64encode(vista_png).decode(), "nombre": "vista.png"})
    h = r.get("hallazgos") or []
    presentes = [x for x in h if x.get("estado") == "presente"]
    posibles = [x for x in h if x.get("estado") == "posible"]
    partes = []
    if presentes:
        partes.append("Presente: " + "; ".join(f"{x['nombre']} ({_pct(x.get('p'))})" for x in presentes))
    if posibles:
        partes.append("Posible (no concluyente): " + "; ".join(f"{x['nombre']} ({_pct(x.get('p'))})" for x in posibles[:6]))
    if not presentes and not posibles:
        partes.append("Sin hallazgos afirmados por encima de sus umbrales calibrados")
    vista = r.get("vista_modelo") or r.get("vista_usada")
    if vista:
        partes.append(f"proyección {vista}")
    return {"modelo": r.get("nombre_modelo") or "Megi_torax_one", "version": r.get("corrida"),
            "resumen": ". ".join(partes) + ".", "resultado": _sin_imagen(r)}


def _correr_columna(vista_png: bytes, _raw: bytes, _ctx: dict) -> dict:
    r = _post_typesafe("/api/columna/analizar", {"datos": base64.b64encode(vista_png).decode(), "nombre": "vista.png"})
    partes = [f"Región {r.get('region', '?')} ({_pct(r.get('p_region'))}), proyección {r.get('vista', '?')} ({_pct(r.get('p_vista'))})"]
    pres = [q for q in (r.get("preguntas") or []) if str(q.get("estado", "")).lower() == "presente"]
    pos = [q for q in (r.get("preguntas") or []) if str(q.get("estado", "")).lower() == "posible"]
    if pres:
        partes.append("Presente: " + "; ".join(f"{q.get('nombre', q.get('clave'))} ({_pct(q.get('p'))})" for q in pres))
    if pos:
        partes.append("Posible: " + "; ".join(f"{q.get('nombre', q.get('clave'))} ({_pct(q.get('p'))})" for q in pos))
    curv = r.get("curvatura") or {}
    if curv.get("texto") or curv.get("nombre"):
        partes.append(f"Curvatura: {curv.get('texto') or curv.get('nombre')}")
    exp = r.get("experimentales") or []
    if exp:
        partes.append("Experimental, sin estado clínico: " + "; ".join(f"{x.get('nombre')} ({_pct(x.get('p'))})" for x in exp[:3]))
    if r.get("aviso"):
        partes.append(_frase(r["aviso"]))
    return {"modelo": r.get("nombre_modelo") or "Megi_columna_preguntas_combinadas", "version": r.get("version_puntos"),
            "resumen": ". ".join(partes) + ".", "resultado": _sin_imagen(r)}


def _correr_abdomen(vista_png: bytes, _raw: bytes, _ctx: dict) -> dict:
    r = _post_typesafe("/api/abdomen/analizar", {"datos": base64.b64encode(vista_png).decode(), "nombre": "vista.png"})
    partes = []
    for m in r.get("modelos") or []:
        partes.append(f"{m.get('nombre')}: probabilidad de cálculo urinario {_pct(m.get('p'))} (corte experimental {m.get('umbral_experimental', 0.5)})")
    marcas = r.get("marcas") or []
    partes.append(f"{len(marcas)} candidato{'s' if len(marcas) != 1 else ''} señalado{'s' if len(marcas) != 1 else ''} en la región urinaria")
    if r.get("advertencia"):
        partes.append(_frase(r["advertencia"]))
    return {"modelo": r.get("nombre_localizador") or "Megi_abdomen_calculos_localizador", "version": r.get("modo"),
            "resumen": ". ".join(partes) + ".", "resultado": _sin_imagen(r)}


def _correr_laboratorio(_vista: bytes | None, raw: bytes, ctx: dict) -> dict:
    """Resultados de laboratorio en PDF, foto (OCR) o CSV: analitos, referencia,
    guías del índice y, con servicio MLX, consulta al modelo sobre esas guías."""
    est = ctx.get("estudio") or {}
    txt = ctx.get("texto") or (texto_pdf(raw) if est.get("formato") == "pdf" else raw.decode("utf-8", "ignore"))
    consultar = None
    if REAL_ASR:
        from . import asr_client
        consultar = lambda pregunta: asr_client.guidelines_chat(pregunta, 6)  # noqa: E731
    r = laboratorio.leer(txt, ctx.get("contexto_paciente") or {}, consultar)
    return {"modelo": "Lectura de laboratorio (referencia + GPC IMSS" + (" + Megi-LLM" if consultar else "") + ")",
            "version": "v1", "resumen": r["resumen"],
            "resultado": {"analitos": r["analitos"], "anormales": r["anormales"], "guias": r["guias"],
                          "consulta_guias": r["consulta_guias"], "texto": txt[:_MAX_TEXTO_PDF]}}


def _correr_ecg_senal(_vista: bytes | None, raw: bytes, ctx: dict) -> dict:
    """Registro WFDB (.hea + .dat de la misma consulta) o CSV: derivaciones,
    duración, FC orientativa y trazo de vista previa. Sin modelo de ECG aún."""
    est = ctx.get("estudio") or {}
    conn = ctx.get("conn")
    if est.get("formato") == "csv":
        info = ecg_senal.leer_csv(raw)
        if not info:
            raise RuntimeError("el CSV no contiene una señal numérica")
        completo = True
    else:
        dat = None
        if conn is not None:
            stem = os.path.splitext(est.get("nombre_original") or "")[0].lower()
            for r in conn.execute("SELECT * FROM estudios_aportados WHERE consultation_id = ? AND formato = 'wfdb_dat'",
                                  (est["consultation_id"],)).fetchall():
                if os.path.splitext(r["nombre_original"] or "")[0].lower() == stem:
                    p_dat, _ = _rutas(dict(r))
                    if p_dat.is_file():
                        dat = p_dat.read_bytes()
                        break
        info = ecg_senal.leer_wfdb(raw, dat, est.get("nombre_original") or "registro.hea")
        completo = dat is not None
    fc = ecg_senal.frecuencia_cardiaca(info["senal"], info["fs"], info["derivaciones"]) if info.get("senal") is not None else None
    vista = ecg_senal.vista_previa(info["senal"], info["fs"], info["derivaciones"]) if info.get("senal") is not None else None
    resultado = {k: v for k, v in info.items() if k != "senal"}
    resultado["frecuencia_cardiaca"] = fc
    resultado["registro_completo"] = completo
    return {"modelo": "Lectura básica de señal (wfdb)", "version": "v1", "resumen": ecg_senal.resumen(info, fc, completo),
            "resultado": resultado, "vista_png": vista}


# Registro: clave, nombre, tipos a los que aplica, función. Para sumar un modelo
# nuevo basta una entrada aquí (y su servicio). `necesita_vista` marca los que
# leen la imagen; los de documento reciben el original.
ANALIZADORES = [
    {"clave": "megi_eco", "nombre": "Megi_eco_mama_consenso / Megi_eco_tiroides_multimascara", "tipos": ("ecografia_mama", "ecografia_tiroides"), "correr": _correr_eco, "necesita_vista": True},
    {"clave": "typesafe_torax", "nombre": "Megi_torax_one + localizadores", "tipos": ("torax",), "correr": _correr_torax, "necesita_vista": True},
    {"clave": "typesafe_columna", "nombre": "Megi_columna (preguntas + puntos)", "tipos": ("columna",), "correr": _correr_columna, "necesita_vista": True},
    {"clave": "typesafe_abdomen", "nombre": "Megi_abdomen (cálculos urinarios)", "tipos": ("abdomen",), "correr": _correr_abdomen, "necesita_vista": True},
    {"clave": "laboratorio", "nombre": "Lectura de laboratorio (referencia + GPC)", "tipos": ("pdf_texto", "documento_foto", "documento_csv"),
     "correr": _correr_laboratorio, "necesita_vista": False},
    {"clave": "ecg_senal", "nombre": "Lectura básica de señal de ECG", "tipos": ("ecg_senal",), "correr": _correr_ecg_senal, "necesita_vista": False},
    # Próximos: {"clave": "ecg_modelo", "tipos": ("ecg", "ecg_senal"), ...} cuando se adapte el modelo del proyecto electros.
]

SIN_MODELO_AUN = {"ecg": "Electrocardiograma en papel reconocido; todavía no hay modelo de ECG conectado.",
                  "ecg_senal_parte": "Archivo de señal recibido: se lee junto con su cabecera .hea del mismo nombre.",
                  "no_reconocido": "Tipo no reconocido. Si es una ecografía de mama o tiroides, abre Megi Eco, elige el órgano y marca el nódulo.",
                  "pdf_escaneado": "PDF sin texto legible: habría que fotografiar o escribir sus valores.",
                  "sin_vista": "No se pudo leer la imagen.", "sin_clasificar": "Sin servicio de modelos: no se analizó."}


# Catálogo que ve el médico en Radiología: los modelos conectados y los que
# vienen en camino. Lo que se corre sale de ANALIZADORES; esto es presentación.
MODELOS_RADIOLOGIA = [
    {"clave": "torax", "nombre": "Megi Tórax", "modelo": "Megi_torax_one + localizadores", "analizador": "typesafe_torax",
     "estudios": "Radiografía de tórax (PA/AP)", "estado": "disponible",
     "que_hace": "20 hallazgos calibrados con abstención (cardiomegalia, derrame, consolidación, nódulo, neumotórax…) y mapa de localización."},
    {"clave": "columna", "nombre": "Megi Columna", "modelo": "Megi_columna (preguntas + puntos)", "analizador": "typesafe_columna",
     "estudios": "Radiografía de columna cervical y lumbar (AP/lateral)", "estado": "disponible",
     "que_hace": "Región y proyección, rotación e inclinación, curvatura cervical, puntos vertebrales y ángulos; listesis experimental."},
    {"clave": "abdomen", "nombre": "Megi Abdomen", "modelo": "Megi_abdomen (cálculos urinarios)", "analizador": "typesafe_abdomen",
     "estudios": "Radiografía simple de abdomen (KUB)", "estado": "disponible",
     "que_hace": "Búsqueda de cálculos urinarios: probabilidad por dos modelos y candidatos señalados en la región urinaria. Experimental."},
    {"clave": "ecografia", "nombre": "Megi Eco", "modelo": "Megi_eco_mama_consenso / Megi_eco_tiroides_multimascara", "analizador": "megi_eco",
     "estudios": "Ecografía de mama y tiroides · órgano y caja manuales", "estado": "disponible",
     "que_hace": "Mama: consenso de dos segmentadores, medidas y clasificación experimental. Tiroides: un segmentador y clasificación opcional. Sin escala, medidas en píxeles. Investigación sin uso comercial."},
    {"clave": "resonancia", "nombre": "Megi Resonancia", "modelo": "Megi_rm_craneo (en desarrollo)", "analizador": None,
     "estudios": "Resonancia magnética de cráneo", "estado": "en_camino",
     "que_hace": "Preprocesado y segmentación 3D de RM de cráneo. Los estudios se guardan desde ya y se analizarán cuando el modelo esté conectado."},
]


def catalogo_modelos() -> dict:
    vivo = typesafe_disponible()
    eco_vivo = eco_disponible()
    out = []
    for m in MODELOS_RADIOLOGIA:
        d = dict(m)
        d["conectado"] = bool(m["analizador"]) and (eco_vivo if m["analizador"] == "megi_eco" else vivo)
        d.update(experimental=True, uso_comercial=False, aviso=AVISO_EXPERIMENTAL)
        out.append(d)
    return {"modelos": out, "servicio_modelos": {"url": bool(TYPESAFE_URL), "disponible": vivo},
            "aviso": AVISO_EXPERIMENTAL, "servicio_eco": {"disponible": eco_vivo},
            "clasificador": "Megi_tipo_estudio (tórax / columna / abdomen / ECG en papel / otro, con abstención). Ecografía: selección manual del órgano y caja; sin detección automática"}


def analizadores_para(tipo: str) -> list:
    return [a for a in ANALIZADORES if tipo in a["tipos"]]


# ------------------------------------------------------------- por estudio
def _rutas(estudio: dict):
    from ..routes.estudios import estudio_dir
    from . import estudios_archivo as ea
    d = estudio_dir(estudio["consultation_id"], estudio["id"])
    return d / f"original{ea.EXTENSION[estudio['formato']]}", d / "vista.png"


def analizar_estudio(conn, estudio_id: str) -> dict:
    """Identifica y corre los analizadores que aplican. Devuelve el estudio con
    su tipo y la lista de análisis. Borra los análisis previos del mismo estudio
    (es una re-lectura, no una versión)."""
    r = conn.execute("SELECT * FROM estudios_aportados WHERE id = ?", (estudio_id,)).fetchone()
    if not r:
        raise KeyError(estudio_id)
    est = dict(r)
    p_orig, p_vista = _rutas(est)
    raw = p_orig.read_bytes() if p_orig.is_file() else b""
    vista = p_vista.read_bytes() if (est.get("tiene_vista") and p_vista.is_file()) else None

    detalle_previo = json.loads(est.get("tipo_detalle") or "{}")
    eco_config = detalle_previo.get("eco_manual")
    if eco_config:
        ident = {"tipo": "ecografia_" + eco_config["organo"], "p": None,
                 "fuente": "seleccion_manual", "detalle": {"eco_manual": eco_config}}
    else:
        ident = identificar(est["formato"], raw, vista)
    conn.execute("UPDATE estudios_aportados SET tipo = ?, tipo_p = ?, tipo_detalle = ?, analisis_estado = ? WHERE id = ?",
                 (ident["tipo"], ident["p"], json.dumps({"fuente": ident["fuente"], **ident["detalle"]}, ensure_ascii=False),
                  "analizando", estudio_id))
    conn.execute("DELETE FROM estudios_analisis WHERE estudio_id = ?", (estudio_id,))

    cp = conn.execute("""SELECT c.motivo, p.age, p.sex FROM consultations c JOIN patients p ON p.id = c.patient_id
                         WHERE c.id = ?""", (est["consultation_id"],)).fetchone()
    contexto_paciente = {"motivo": (cp["motivo"] if cp else "") or "", "edad": cp["age"] if cp else None,
                         "sexo": ("femenino" if cp and cp["sex"] == "F" else "masculino") if cp else None,
                         "sexo_codigo": cp["sex"] if cp else None}
    ctx = {"eco_config": eco_config, "texto": ident.get("texto"), "estudio": est, "conn": conn, "contexto_paciente": contexto_paciente}
    analisis = []
    aplican = analizadores_para(ident["tipo"])
    if not aplican:
        conn.execute("INSERT INTO estudios_analisis (estudio_id, consultation_id, analizador, modelo, status, resumen, created_at) "
                     "VALUES (?,?,?,?,?,?,?)",
                     (estudio_id, est["consultation_id"], "ninguno", None, "sin_modelo",
                      SIN_MODELO_AUN.get(ident["tipo"], "Sin modelo para este tipo de estudio."), _now()))
    for a in aplican:
        t0 = time.time()
        try:
            if a["necesita_vista"] and not vista:
                raise RuntimeError("sin vista previa de la imagen")
            out = a["correr"](vista, raw, ctx)
            if out.get("eco_vista_png"):
                (p_vista.parent / "eco.png").write_bytes(out["eco_vista_png"])
            if out.get("vista_png"):
                _, p_vista = _rutas(est)
                p_vista.write_bytes(out["vista_png"])
                conn.execute("UPDATE estudios_aportados SET tiene_vista = 1 WHERE id = ?", (estudio_id,))
            fila = (estudio_id, est["consultation_id"], a["clave"], out.get("modelo"), out.get("version"), "done",
                    out["resumen"], json.dumps(out.get("resultado"), ensure_ascii=False), None,
                    int((time.time() - t0) * 1000), _now())
        except Exception as e:
            fila = (estudio_id, est["consultation_id"], a["clave"], a["nombre"], None, "error", None, None,
                    f"{type(e).__name__}: {e}"[:300], int((time.time() - t0) * 1000), _now())
        conn.execute("INSERT INTO estudios_analisis (estudio_id, consultation_id, analizador, modelo, version, status, "
                     "resumen, resultado, error, latency_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", fila)
    estado = "listo" if all(x["status"] != "error" for x in _analisis_de(conn, estudio_id)) else "error"
    conn.execute("UPDATE estudios_aportados SET analisis_estado = ? WHERE id = ?", (estado, estudio_id))
    analisis = _analisis_de(conn, estudio_id)
    return {"estudio_id": estudio_id, "tipo": ident["tipo"], "analisis": analisis}


def _analisis_de(conn, estudio_id: str) -> list:
    rows = conn.execute("SELECT * FROM estudios_analisis WHERE estudio_id = ? ORDER BY id", (estudio_id,)).fetchall()
    return [analisis_publico(r) for r in rows]


def analisis_publico(r) -> dict:
    return {"id": r["id"], "estudio_id": r["estudio_id"], "analizador": r["analizador"], "modelo": r["modelo"],
            "version": r["version"], "status": r["status"], "resumen": r["resumen"], "error": r["error"],
            "latency_ms": r["latency_ms"], "created_at": r["created_at"]}


# ------------------------------------------------------------- pre-diagnóstico
def hechos_consulta(conn, consultation_id: str) -> list:
    """Un hecho por análisis hecho, con su etiqueta [E#] para que el texto cite."""
    rows = conn.execute(
        """SELECT e.id, e.nombre_original, e.formato, e.origen, e.tipo, e.tipo_p, a.analizador, a.modelo, a.status, a.resumen, a.error
           FROM estudios_aportados e LEFT JOIN estudios_analisis a ON a.estudio_id = e.id
           WHERE e.consultation_id = ? AND COALESCE(e.analisis_estado, '') != 'descartado'
           ORDER BY e.created_at, a.id""", (consultation_id,)).fetchall()
    hechos, etiquetas = [], {}
    for r in rows:
        if r["id"] not in etiquetas:
            etiquetas[r["id"]] = f"E{len(etiquetas) + 1}"
        hechos.append({"etiqueta": etiquetas[r["id"]], "estudio_id": r["id"], "archivo": r["nombre_original"],
                       "tipo": r["tipo"], "tipo_label": TIPOS_LABEL.get(r["tipo"] or "", r["tipo"] or "pendiente"),
                       "analizador": r["analizador"], "modelo": r["modelo"], "status": r["status"],
                       "resumen": r["resumen"] or (f"error: {r['error']}" if r["error"] else None)})
    return hechos


def hechos_texto(hechos: list, contexto: dict) -> str:
    L = [f"PACIENTE: {contexto.get('edad', '?')} años, {contexto.get('sexo', '?')}. Motivo de hoy: {contexto.get('motivo') or '—'}.", ""]
    for h in hechos:
        L.append(f"[{h['etiqueta']}] {h['archivo']} · {h['tipo_label']}" + (f" · {h['modelo']}" if h.get("modelo") else ""))
        if h.get("resumen"):
            L.append(f"   {h['resumen']}")
    return "\n".join(L)


def prediagnostico_mock(hechos: list, contexto: dict) -> str:
    por_estudio = {}
    for h in hechos:
        por_estudio.setdefault((h["etiqueta"], h["archivo"], h["tipo_label"]), []).append(h)
    if not por_estudio:
        return "No hay estudios analizados en esta consulta."
    partes = [f"Pre-diagnóstico de los estudios aportados ({len(por_estudio)} archivo{'s' if len(por_estudio) != 1 else ''}), ordenado sin modelo de lenguaje:"]
    for (et, archivo, tipo), lst in por_estudio.items():
        res = [x["resumen"] for x in lst if x.get("resumen")]
        partes.append(f"[{et}] {archivo} — {tipo}. " + (" ".join(res) if res else "Sin análisis todavía."))
    partes.append("Todos los modelos son experimentales, para investigación sin uso comercial. Los estados «posible» no afirman ni descartan. "
                  "Correlacionar con la clínica: el médico decide.")
    return "\n\n".join(partes)


def generar_prediagnostico(conn, consultation_id: str) -> dict:
    c = conn.execute("""SELECT c.motivo, p.age, p.sex FROM consultations c JOIN patients p ON p.id = c.patient_id
                        WHERE c.id = ?""", (consultation_id,)).fetchone()
    contexto = {"motivo": (c["motivo"] if c else "") or "", "edad": c["age"] if c else None,
                "sexo": ("femenino" if c and c["sex"] == "F" else "masculino") if c else None}
    hechos = hechos_consulta(conn, consultation_id)
    modelos = [{"etiqueta": h["etiqueta"], "estudio_id": h["estudio_id"], "analizador": h["analizador"], "modelo": h["modelo"]}
               for h in hechos if h.get("analizador") and h["analizador"] != "ninguno"]
    texto, fuente, error = None, "mock", None
    if REAL_ASR and hechos:
        from . import asr_client
        try:
            r = asr_client.prediagnostico(hechos_texto(hechos, contexto), contexto)
            if r.get("status") == "done" and (r.get("texto") or "").strip():
                texto, fuente = r["texto"].strip(), "llm"
            else:
                error = r.get("error") or "respuesta vacía"
        except Exception as e:
            error = str(e)
        if texto is None:
            fuente = "sin_modelo"
    if texto is None:
        texto = prediagnostico_mock(hechos, contexto)
    n = conn.execute("SELECT COALESCE(MAX(version), 0) FROM prediagnosticos WHERE consultation_id = ?",
                     (consultation_id,)).fetchone()[0] + 1
    conn.execute("INSERT INTO prediagnosticos (consultation_id, version, texto, fuente, modelos, hechos, error, created_at) "
                 "VALUES (?,?,?,?,?,?,?,?)",
                 (consultation_id, n, texto, fuente, json.dumps(modelos, ensure_ascii=False),
                  json.dumps(hechos, ensure_ascii=False), error, _now()))
    return ultimo_prediagnostico(conn, consultation_id)


def ultimo_prediagnostico(conn, consultation_id: str) -> dict | None:
    r = conn.execute("SELECT * FROM prediagnosticos WHERE consultation_id = ? ORDER BY version DESC LIMIT 1",
                     (consultation_id,)).fetchone()
    if not r:
        return None
    return {"id": r["id"], "consultation_id": r["consultation_id"], "version": r["version"], "texto": r["texto"],
            "fuente": r["fuente"], "modelos": json.loads(r["modelos"] or "[]"), "hechos": json.loads(r["hechos"] or "[]"),
            "error": r["error"], "created_at": r["created_at"],
            "aviso": AVISO_EXPERIMENTAL + " Pre-diagnóstico automático: no sustituye la valoración del médico."}


def procesar_estudio(estudio_id: str) -> None:
    """Tarea de fondo tras cada subida: analiza el archivo y rehace el
    pre-diagnóstico de su consulta. Nunca lanza (correría fuera de la petición)."""
    try:
        with db() as conn:
            est = conn.execute("SELECT analisis_estado FROM estudios_aportados WHERE id = ?", (estudio_id,)).fetchone()
            if not est or est["analisis_estado"] == "descartado":
                return
            r = analizar_estudio(conn, estudio_id)
            fila = conn.execute("SELECT consultation_id, formato, nombre_original FROM estudios_aportados WHERE id = ?",
                                (estudio_id,)).fetchone()
            cid = fila
            # Un .dat/.atr completa el registro de su .hea: se vuelve a leer la cabecera.
            if fila and fila["formato"] in ("wfdb_dat", "wfdb_anot"):
                stem = os.path.splitext(fila["nombre_original"] or "")[0].lower()
                for h in conn.execute("SELECT id, nombre_original FROM estudios_aportados WHERE consultation_id = ? AND formato = 'wfdb_hea'",
                                      (fila["consultation_id"],)).fetchall():
                    if os.path.splitext(h["nombre_original"] or "")[0].lower() == stem:
                        analizar_estudio(conn, h["id"])
        with db() as conn:
            if cid:
                generar_prediagnostico(conn, cid["consultation_id"])
        _ = r
    except Exception as e:  # pragma: no cover - diagnóstico en el log del servidor
        print(f"[megi] análisis de {estudio_id} falló: {type(e).__name__}: {e}", flush=True)
        try:
            with db() as conn:
                conn.execute("UPDATE estudios_aportados SET analisis_estado = 'error' WHERE id = ?", (estudio_id,))
        except Exception:
            pass


# ------------------------------------------------------------- preguntas sobre lo analizado
def contexto_preguntas(conn, consultation_id: str) -> str:
    """Lo que Megi IA puede consultar: hechos de los modelos y el pre-diagnóstico
    vigente, etiquetados igual que en pantalla ([E1]…)."""
    c = conn.execute("""SELECT c.motivo, p.age, p.sex FROM consultations c JOIN patients p ON p.id = c.patient_id
                        WHERE c.id = ?""", (consultation_id,)).fetchone()
    contexto = {"motivo": (c["motivo"] if c else "") or "", "edad": c["age"] if c else None,
                "sexo": ("femenino" if c and c["sex"] == "F" else "masculino") if c else None}
    hechos = hechos_consulta(conn, consultation_id)
    pre = ultimo_prediagnostico(conn, consultation_id)
    txt = "ESTUDIOS ANALIZADOS EN ESTA CONSULTA:\n" + hechos_texto(hechos, contexto)
    if pre:
        txt += f"\n\nPRE-DIAGNOSTICO VIGENTE (v{pre['version']}, {pre['fuente']}):\n{pre['texto']}"
    desc = conn.execute("""SELECT nombre_original, triaje FROM estudios_aportados
                           WHERE consultation_id = ? AND analisis_estado = 'descartado' ORDER BY created_at""",
                        (consultation_id,)).fetchall()
    if desc:
        txt += "\n\nARCHIVOS DESCARTADOS EN EL TRIAJE (no analizados):\n" + "\n".join(
            f"- {r['nombre_original']}: descartado, {(json.loads(r['triaje'] or '{}').get('motivo') or 'sin motivo')}" for r in desc)
    return txt


def responder_mock_estudios(conn, consultation_id: str, pregunta: str) -> str:
    """Sin modelo: devuelve las líneas de los hechos y del pre-diagnóstico que
    comparten palabras con la pregunta; si ninguna, lo dice."""
    from .expediente import _normaliza, _STOP, _SINONIMOS
    palabras = [w for w in _normaliza(pregunta).split() if len(w) >= 3 and w not in _STOP]
    claves = set(palabras)
    for w in palabras:
        claves.update(_SINONIMOS.get(w, []))
    lineas = [l.strip() for l in contexto_preguntas(conn, consultation_id).splitlines() if l.strip()]
    if not claves:
        return "Pregunta por un estudio, un hallazgo o un valor concreto y busco en lo analizado."
    puntuadas = []
    for l in lineas:
        nl = _normaliza(l)
        n = sum(1 for k in claves if k in nl)
        if n and not l.startswith(("ESTUDIOS ANALIZADOS", "PRE-DIAGNOSTICO", "PACIENTE:")):
            puntuadas.append((n, l))
    if not puntuadas:
        return "No encuentro eso en los estudios analizados de esta consulta."
    puntuadas.sort(key=lambda x: -x[0])
    return "En lo analizado:\n" + "\n".join(f"• {l[:300]}" for _, l in puntuadas[:5])


def preguntar_estudios(conn, consultation_id: str, pregunta: str, historial: list) -> dict:
    if REAL_ASR:
        from . import asr_client
        try:
            r = asr_client.expediente_preguntar(contexto_preguntas(conn, consultation_id), pregunta, historial)
            if r.get("status") == "done" and (r.get("respuesta") or "").strip():
                return {"respuesta": r["respuesta"].strip(), "fuente": "llm", "modelo": r.get("model")}
            error = r.get("error") or "respuesta vacía"
        except Exception as e:
            error = str(e)
        return {"respuesta": responder_mock_estudios(conn, consultation_id, pregunta), "fuente": "sin_modelo", "error": error}
    return {"respuesta": responder_mock_estudios(conn, consultation_id, pregunta), "fuente": "mock"}
