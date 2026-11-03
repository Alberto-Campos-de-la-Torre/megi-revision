"""Expediente consolidado del paciente: lo que el modelo lee para resumir y para
contestar preguntas del médico.

Un solo sitio reúne consultas (nota, diagnósticos, receta, signos vitales),
documentos de envío (referencias, órdenes, incapacidades), informes de
radiología, citas y sellos de exportación. De aquí salen tres cosas:

- `construir()`      -> dict estructurado (lo que ve la interfaz: conteos y listas)
- `texto_para_llm()` -> texto plano etiquetado ([C1], [R1], [D1]…) para que el
                        modelo cite de dónde saca cada afirmación
- `resumen_mock()` y `responder_mock()` -> versión SIN modelo: en modo
                        `local_mock` (y si el servicio MLX se cae) el médico sigue
                        viendo un resumen y respuestas sacadas del expediente,
                        marcadas como simuladas. No inventan: solo reordenan datos.

MEGI resume; el expediente manda. Nada de esto se guarda: se genera al vuelo.
"""
from __future__ import annotations

import json
import re
import unicodedata

_MAX_CONSULTAS_LLM = 12       # las más recientes completas; el resto, solo fecha y dx
_MAX_CAMPO = 700              # caracteres por campo S/O/A/P en el texto del modelo

_DOC_LABEL = {"referencia": "Referencia (envío)", "orden_estudios": "Orden de estudios",
              "incapacidad": "Incapacidad"}
_MODALIDAD = {"radiografia": "Radiografía", "ultrasonido": "Ultrasonido", "tomografia": "Tomografía",
              "resonancia": "Resonancia", "mastografia": "Mastografía", "otro": "Estudio"}


def _j(raw, fallback):
    if not raw:
        return fallback
    try:
        v = json.loads(raw)
    except (TypeError, ValueError):
        return fallback
    return v if isinstance(v, type(fallback)) else fallback


def _fecha(iso: str | None) -> str:
    return (iso or "")[:10]


def _dx_texto(dx) -> str:
    if isinstance(dx, dict):
        code = (dx.get("code") or "").strip()
        label = (dx.get("label") or dx.get("desc") or "").strip()
        return f"{code} {label}".strip()
    return str(dx).strip()


def _rx_texto(item) -> str:
    if isinstance(item, dict):
        partes = [item.get("drug"), item.get("dose"), item.get("freq")]
        return " ".join(str(p).strip() for p in partes if p)
    return str(item).strip()


# --------------------------------------------------------------- construcción
def construir(conn, patient: dict) -> dict:
    """Expediente completo del paciente. `patient` ya viene verificado por
    `owned_patient`: aquí no se vuelve a comprobar pertenencia."""
    pid = patient["id"]
    cons = conn.execute(
        """SELECT id, status, started_at, finalized_at, motivo, soap, final_soap,
                  dx_codes, prescription, vitals, clinical_facts, approved_by
           FROM consultations WHERE patient_id = ? AND status != 'radiologia' ORDER BY started_at DESC""",
        (pid,)).fetchall()
    docs = conn.execute(
        """SELECT id, consultation_id, kind, content, created_by, created_at FROM documents
           WHERE patient_id = ?
              OR consultation_id IN (SELECT id FROM consultations WHERE patient_id = ?)
           ORDER BY id DESC""",
        (pid, pid)).fetchall()
    informes = conn.execute(
        """SELECT id, modalidad, region, indicacion, fecha_estudio, hallazgos, impresion,
                  recomendaciones, status, created_at, signed_at
           FROM informes_radiologia WHERE patient_id = ? ORDER BY created_at DESC""",
        (pid,)).fetchall()
    citas = conn.execute(
        """SELECT id, scheduled_date, time, reason, status FROM appointments
           WHERE patient_id = ? ORDER BY scheduled_date DESC, time DESC""",
        (pid,)).fetchall()
    aportados = conn.execute(
        """SELECT id, consultation_id, nombre_original, formato, origen, created_at
           FROM estudios_aportados WHERE patient_id = ? ORDER BY created_at DESC""",
        (pid,)).fetchall()
    sellos = conn.execute(
        """SELECT e.consultation_id, e.kind, e.signed_at FROM exports e
           JOIN consultations c ON c.id = e.consultation_id
           WHERE c.patient_id = ? ORDER BY e.id DESC""",
        (pid,)).fetchall()

    consultas = []
    for r in cons:
        soap = _j(r["final_soap"] or r["soap"], {})
        vit = _j(r["vitals"], {}) or (_j(r["clinical_facts"], {}).get("signos_vitales") or {})
        consultas.append({
            "id": r["id"],
            "fecha": _fecha(r["finalized_at"] or r["started_at"]),
            "status": r["status"],
            "finalizada": bool(r["final_soap"]),
            "motivo": (r["motivo"] or "").strip(),
            "soap": {k: (soap.get(k) or "").strip() for k in ("S", "O", "A", "P")},
            "dx": [t for t in (_dx_texto(d) for d in _j(r["dx_codes"], [])) if t],
            "receta": [t for t in (_rx_texto(x) for x in _j(r["prescription"], [])) if t],
            "vitals": vit if isinstance(vit, dict) else {},
            "aprobada_por": r["approved_by"],
        })

    documentos = []
    for r in docs:
        c = _j(r["content"], {})
        documentos.append({
            "id": r["id"], "consultation_id": r["consultation_id"], "kind": r["kind"],
            "label": _DOC_LABEL.get(r["kind"], r["kind"] or "Documento"),
            "fecha": _fecha(r["created_at"]),
            "detalle": _doc_detalle(r["kind"], c),
        })

    estudios = [{
        "id": r["id"], "modalidad": r["modalidad"],
        "label": _MODALIDAD.get(r["modalidad"] or "", "Estudio"),
        "region": (r["region"] or "").strip(), "indicacion": (r["indicacion"] or "").strip(),
        "fecha": _fecha(r["fecha_estudio"] or r["created_at"]),
        "hallazgos": (r["hallazgos"] or "").strip(), "impresion": (r["impresion"] or "").strip(),
        "recomendaciones": (r["recomendaciones"] or "").strip(),
        "status": r["status"], "firmado": bool(r["signed_at"]),
    } for r in informes]

    citas_out = [{"id": r["id"], "fecha": r["scheduled_date"], "hora": r["time"],
                  "motivo": (r["reason"] or "").strip(), "status": r["status"]} for r in citas]
    sellos_out = [{"consultation_id": r["consultation_id"], "kind": r["kind"],
                   "fecha": _fecha(r["signed_at"])} for r in sellos]

    aportados_out = [{"id": r["id"], "consultation_id": r["consultation_id"], "nombre": r["nombre_original"],
                      "formato": r["formato"], "origen": r["origen"], "fecha": _fecha(r["created_at"])}
                     for r in aportados]

    return {
        "paciente": {
            "id": pid, "name": patient.get("name"), "age": patient.get("age"),
            "sex": patient.get("sex"), "reason": patient.get("reason"),
            "allergies": patient.get("allergies") or [], "chronic": patient.get("chronic") or [],
            "created_at": _fecha(patient.get("created_at")),
        },
        "consultas": consultas, "documentos": documentos, "estudios": estudios,
        "aportados": aportados_out, "citas": citas_out, "sellos": sellos_out,
        "conteos": {
            "consultas": len(consultas), "estudios": len(estudios), "aportados": len(aportados_out),
            "envios": sum(1 for d in documentos if d["kind"] == "referencia"),
            "documentos": len(documentos), "citas": len(citas_out), "sellos": len(sellos_out),
        },
    }


def _doc_detalle(kind: str, c: dict) -> str:
    if kind == "referencia":
        return " · ".join(str(c.get(k)).strip() for k in ("servicio", "motivo") if c.get(k))
    if kind == "orden_estudios":
        return " · ".join(str(c.get(k)).strip() for k in ("tipo", "estudios", "justificacion") if c.get(k))
    if kind == "incapacidad":
        dias = c.get("dias")
        base = f"{dias} días" if dias else ""
        return " · ".join(x for x in (base, c.get("ramo"), c.get("observaciones")) if x)
    return ", ".join(f"{k}: {v}" for k, v in c.items() if isinstance(v, (str, int)) and str(v).strip())[:200]


# ------------------------------------------------------------- texto del modelo
def texto_para_llm(exp: dict) -> str:
    """Expediente en texto plano con etiquetas citables. Compacto a propósito:
    gemma 4 trabaja con contexto limitado y el médico quiere un resumen, no el
    expediente entero otra vez."""
    p = exp["paciente"]
    sexo = "femenino" if p.get("sex") == "F" else "masculino"
    L = [
        f"PACIENTE: {p.get('name')} · {p.get('age')} años · {sexo} · alta en MEGI {p.get('created_at') or '?'}",
        f"Motivo de alta: {p.get('reason') or '—'}",
        f"Alergias: {', '.join(p.get('allergies') or []) or 'ninguna conocida'}",
        f"Crónicos: {', '.join(p.get('chronic') or []) or 'ninguno registrado'}",
        "",
        f"CONSULTAS ({len(exp['consultas'])}, de la más reciente a la más antigua):",
    ]
    for i, c in enumerate(exp["consultas"], 1):
        estado = "nota final" if c["finalizada"] else f"estado {c['status']}"
        L.append(f"[C{i}] {c['fecha']} · {estado}" + (f" · motivo: {c['motivo']}" if c["motivo"] else ""))
        if i <= _MAX_CONSULTAS_LLM:
            for k in ("S", "O", "A", "P"):
                if c["soap"].get(k):
                    L.append(f"  {k}: {c['soap'][k][:_MAX_CAMPO]}")
            if c["vitals"]:
                L.append("  Signos vitales: " + ", ".join(f"{k} {v}" for k, v in c["vitals"].items() if v))
        if c["dx"]:
            L.append("  Dx: " + "; ".join(c["dx"]))
        if c["receta"]:
            L.append("  Receta: " + "; ".join(c["receta"]))
    if not exp["consultas"]:
        L.append("  (sin consultas registradas)")

    L += ["", f"ESTUDIOS DE IMAGEN ({len(exp['estudios'])}):"]
    for i, e in enumerate(exp["estudios"], 1):
        L.append(f"[R{i}] {e['fecha']} · {e['label']} de {e['region'] or '?'} · "
                 f"{'firmado' if e['firmado'] else 'borrador'}"
                 + (f" · indicación: {e['indicacion']}" if e["indicacion"] else ""))
        if e["impresion"]:
            L.append(f"  Impresión: {e['impresion'][:_MAX_CAMPO]}")
        elif e["hallazgos"]:
            L.append(f"  Hallazgos: {e['hallazgos'][:_MAX_CAMPO]}")
        if e["recomendaciones"]:
            L.append(f"  Recomendaciones: {e['recomendaciones'][:300]}")
    if not exp["estudios"]:
        L.append("  (sin estudios registrados)")

    L += ["", f"ESTUDIOS QUE TRAJO EL PACIENTE ({len(exp.get('aportados', []))}, archivos sin leer por MEGI):"]
    for i, e in enumerate(exp.get("aportados", []), 1):
        L.append(f"[E{i}] {e['fecha']} · {e['formato'].upper()} «{e['nombre'] or 'sin nombre'}» · desde {e['origen']}")
    if not exp.get("aportados"):
        L.append("  (ninguno)")

    L += ["", f"ENVÍOS Y DOCUMENTOS ({len(exp['documentos'])}):"]
    for i, d in enumerate(exp["documentos"], 1):
        L.append(f"[D{i}] {d['fecha']} · {d['label']}" + (f": {d['detalle']}" if d["detalle"] else ""))
    if not exp["documentos"]:
        L.append("  (sin referencias, órdenes ni incapacidades)")

    L += ["", f"CITAS ({len(exp['citas'])}):"]
    for i, a in enumerate(exp["citas"][:10], 1):
        L.append(f"[A{i}] {a['fecha']} {a['hora'] or ''} · {a['status']}" + (f" · {a['motivo']}" if a["motivo"] else ""))
    if not exp["citas"]:
        L.append("  (sin citas)")
    if exp["sellos"]:
        L += ["", "SELLOS DE EXPORTACIÓN: " + "; ".join(f"{s['kind']} {s['fecha']}" for s in exp["sellos"][:10])]
    return "\n".join(L)


# ----------------------------------------------------------------- sin modelo
def secciones(exp: dict) -> list[dict]:
    """Lectura del expediente POR TEMAS, determinista (sin modelo). Cada sección:
    {clave, titulo, texto, items}. La interfaz las pinta separadas y con su
    título; `resumen_mock` las une en texto corrido para el modo sin modelo."""
    p = exp["paciente"]
    sexo = "mujer" if p.get("sex") == "F" else "hombre"
    S = []

    alergias = ", ".join(p.get("allergies") or []) or "sin alergias conocidas"
    cronicos = ", ".join(p.get("chronic") or []) or "sin padecimientos crónicos registrados"
    S.append({"clave": "paciente", "titulo": "Paciente y antecedentes",
              "texto": f"{p.get('name')}, {sexo} de {p.get('age')} años. Motivo de alta: {p.get('reason') or 'no registrado'}.",
              "items": [f"Alergias: {alergias}", f"Crónicos: {cronicos}"]})

    cons = exp["consultas"]
    if cons:
        u = cons[0]
        texto = f"{len(cons)} consulta{'s' if len(cons) != 1 else ''} registrada{'s' if len(cons) != 1 else ''}; la última el {u['fecha']}"
        texto += (f" por {u['motivo']}." if u["motivo"] else ".")
        items = []
        if u["soap"].get("A"):
            items.append(f"Última valoración: {u['soap']['A'][:220].rstrip('. ')}")
        dxs = []
        for c in cons:
            for d in c["dx"]:
                if d not in dxs:
                    dxs.append(d)
        if dxs:
            items.append("Diagnósticos en el expediente: " + "; ".join(dxs[:6]))
        rx = next((c["receta"] for c in cons if c["receta"]), None)
        if rx:
            items.append("Último tratamiento indicado: " + "; ".join(rx[:5]))
        if u["vitals"]:
            items.append("Signos vitales de la última consulta: " + ", ".join(f"{k} {v}" for k, v in u["vitals"].items() if v))
        S.append({"clave": "consultas", "titulo": "Historial de consultas", "texto": texto, "items": items})
    else:
        S.append({"clave": "consultas", "titulo": "Historial de consultas", "texto": "No tiene consultas registradas en MEGI.", "items": []})

    est = exp["estudios"]
    if est:
        items = []
        for e in est[:6]:
            txt = f"{e['label']} de {e['region'] or 'región no indicada'} ({e['fecha']})"
            if e["impresion"]:
                txt += f": {e['impresion'][:160]}"
            items.append(txt)
        S.append({"clave": "estudios", "titulo": "Estudios de imagen en MEGI", "texto": f"{len(est)} estudio{'s' if len(est) != 1 else ''}.", "items": items})
    else:
        S.append({"clave": "estudios", "titulo": "Estudios de imagen en MEGI", "texto": "Sin estudios de imagen registrados.", "items": []})

    ap = exp.get("aportados", [])
    if ap:
        por_fmt = {}
        for e in ap:
            por_fmt[e["formato"].upper()] = por_fmt.get(e["formato"].upper(), 0) + 1
        S.append({"clave": "aportados", "titulo": "Estudios que trajo el paciente",
                  "texto": f"{len(ap)} archivo{'s' if len(ap) != 1 else ''} ({', '.join(f'{n} {f}' for f, n in por_fmt.items())}); el último el {ap[0]['fecha']}. "
                           "Son archivos adjuntos: MEGI no ha leído su contenido.",
                  "items": [f"{e['fecha']} · {e['formato'].upper()} · {e['nombre'] or 'sin nombre'}" for e in ap[:6]]})

    docs = exp["documentos"]
    if docs:
        por_tipo = {}
        for d in docs:
            por_tipo.setdefault(d["label"], []).append(d)
        items = []
        for label, lst in por_tipo.items():
            detalle = next((x["detalle"] for x in lst if x["detalle"]), "")
            items.append(f"{len(lst)} {label.lower()}" + (f": {detalle[:90]}" if detalle else ""))
        S.append({"clave": "envios", "titulo": "Envíos y documentos", "texto": "", "items": items})
    else:
        S.append({"clave": "envios", "titulo": "Envíos y documentos", "texto": "Sin referencias, órdenes de estudio ni incapacidades.", "items": []})

    pend = [a for a in exp["citas"] if a["status"] == "pendiente"]
    if pend:
        a = sorted(pend, key=lambda x: (x["fecha"] or "", x["hora"] or ""))[0]
        S.append({"clave": "citas", "titulo": "Citas", "texto": f"Próxima cita pendiente: {a['fecha']} {a['hora'] or ''}".rstrip()
                  + (f" ({a['motivo']})." if a["motivo"] else "."), "items": []})
    elif exp["citas"]:
        S.append({"clave": "citas", "titulo": "Citas", "texto": f"{len(exp['citas'])} cita{'s' if len(exp['citas']) != 1 else ''} en agenda, ninguna pendiente.", "items": []})
    else:
        S.append({"clave": "citas", "titulo": "Citas", "texto": "Sin citas en agenda.", "items": []})
    return S


def resumen_mock(exp: dict) -> str:
    """Resumen determinista en texto corrido: las secciones unidas. Se usa en
    `local_mock` y como red si el servicio MLX no responde."""
    partes = []
    for sec in secciones(exp):
        cuerpo = " ".join(x for x in [sec["texto"]] + [f"{i}." if not i.endswith(".") else i for i in sec["items"]] if x)
        partes.append(f"{sec['titulo']}: {cuerpo}")
    return "\n\n".join(partes)


def _normaliza(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s)


_STOP = {"que", "cual", "cuales", "como", "cuando", "donde", "tiene", "tenia", "tuvo", "paciente", "sobre",
         "para", "este", "esta", "estos", "estas", "hay", "del", "las", "los", "una", "uno", "con", "sin",
         "fue", "han", "sus", "algo", "alguna", "algun", "dime", "sabes", "existe", "registro", "registros"}

_SINONIMOS = {
    "medicamento": ["receta", "tratamiento"], "medicamentos": ["receta", "tratamiento"],
    "medicina": ["receta"], "medicinas": ["receta"], "farmaco": ["receta"], "farmacos": ["receta"],
    "receta": ["tratamiento"], "tratamiento": ["receta"],
    "antibiotico": ["receta", "tratamiento"], "antibioticos": ["receta", "tratamiento"],
    "tomaba": ["receta"], "toma": ["receta"], "tomar": ["receta"], "tomando": ["receta"],
    "antes": ["c1", "c2", "c3", "c4", "c5"], "anterior": ["c1", "c2", "c3"], "anteriores": ["c1", "c2", "c3"],
    "previa": ["c1", "c2", "c3"], "previas": ["c1", "c2", "c3"], "pasada": ["c1", "c2", "c3"], "pasadas": ["c1", "c2", "c3"],
    "estomago": ["gastritis", "gastro", "epigastr", "abdominal"], "panza": ["abdominal", "gastro"],
    "dosis": ["receta"], "pastilla": ["receta"], "pastillas": ["receta"], "indico": ["receta", "plan"], "indicaron": ["receta", "plan"],
    "nota": ["soap", "subjetivo", "objetivo", "valoracion", "plan"], "omite": ["transcripcion", "subjetivo"],
    "transcripcion": ["transcripcion"], "dijo": ["transcripcion"], "fiebre": ["temp", "signos", "transcripcion"],
    "alergia": ["alergias"], "alergico": ["alergias"], "alergias": ["alergia"],
    "cronico": ["cronicos"], "cronicos": ["cronico"], "enfermedad": ["cronicos", "dx"],
    "diagnostico": ["dx", "valoracion"], "diagnosticos": ["dx", "valoracion"],
    "radiografia": ["estudio", "imagen"], "radiografias": ["estudio", "imagen"], "estudio": ["imagen"],
    "estudios": ["imagen", "estudio"], "placa": ["estudio", "imagen"], "imagen": ["estudio"],
    "envio": ["referencia"], "envios": ["referencia"], "referencia": ["referencia"], "referido": ["referencia"],
    "cita": ["cita"], "citas": ["cita"], "incapacidad": ["incapacidad"],
    "presion": ["ta", "signos"], "tension": ["ta", "signos"], "temperatura": ["temp", "signos"],
    "fiebre": ["temp", "signos"], "signos": ["signos"], "vitales": ["signos"],
    "ultima": ["consulta"], "ultimo": ["consulta"], "consulta": ["consulta"], "consultas": ["consulta"],
}


def _hechos(exp: dict) -> list[tuple[str, str]]:
    """Frases atómicas (etiqueta, texto) sobre las que se busca la pregunta."""
    p = exp["paciente"]
    H = [("Paciente", f"{p.get('name')}, {p.get('age')} años, {'femenino' if p.get('sex') == 'F' else 'masculino'}; motivo de alta: {p.get('reason') or '—'}"),
         ("Alergias", "alergias: " + (", ".join(p.get("allergies") or []) or "ninguna conocida")),
         ("Crónicos", "padecimientos crónicos: " + (", ".join(p.get("chronic") or []) or "ninguno registrado"))]
    for i, c in enumerate(exp["consultas"], 1):
        tag = f"Consulta {c['fecha']}"
        if c["motivo"]:
            H.append((tag, f"consulta por {c['motivo']}"))
        for k, nombre in (("S", "subjetivo"), ("O", "objetivo"), ("A", "valoración"), ("P", "plan")):
            if c["soap"].get(k):
                H.append((tag, f"{nombre}: {c['soap'][k]}"))
        if c["dx"]:
            H.append((tag, "dx diagnóstico: " + "; ".join(c["dx"])))
        if c["receta"]:
            H.append((tag, "receta tratamiento: " + "; ".join(c["receta"])))
        if c["vitals"]:
            H.append((tag, "signos vitales: " + ", ".join(f"{k} {v}" for k, v in c["vitals"].items() if v)))
    for e in exp["estudios"]:
        tag = f"{e['label']} {e['fecha']}"
        txt = f"estudio imagen {e['label'].lower()} de {e['region'] or '?'} ({'firmado' if e['firmado'] else 'borrador'})"
        if e["indicacion"]:
            txt += f", indicación: {e['indicacion']}"
        if e["impresion"]:
            txt += f". Impresión: {e['impresion']}"
        elif e["hallazgos"]:
            txt += f". Hallazgos: {e['hallazgos']}"
        H.append((tag, txt))
    for e in exp.get("aportados", []):
        H.append((f"Archivo {e['fecha']}", f"estudio archivo aportado por el paciente {e['formato']} «{e['nombre']}» desde {e['origen']}"))
    for d in exp["documentos"]:
        H.append((f"{d['label']} {d['fecha']}", f"{d['label'].lower()}" + (f": {d['detalle']}" if d["detalle"] else "")))
    for a in exp["citas"]:
        H.append((f"Cita {a['fecha']}", f"cita {a['status']} {a['fecha']} {a['hora'] or ''}" + (f" por {a['motivo']}" if a["motivo"] else "")))
    return H


def responder_mock(exp: dict, pregunta: str) -> str:
    """Respuesta SIN modelo: busca en el expediente las frases que comparten
    palabras con la pregunta y las devuelve tal cual, citando su origen. Si no
    hay coincidencias lo dice; nunca rellena."""
    palabras = [w for w in _normaliza(pregunta).split() if len(w) >= 3 and w not in _STOP]
    claves = set(palabras)
    for w in palabras:
        claves.update(_SINONIMOS.get(w, []))
    if not claves:
        return "Formula la pregunta con algún dato concreto (síntoma, medicamento, estudio, fecha) y busco en el expediente."
    puntuados = []
    for tag, texto in _hechos(exp):
        nt = _normaliza(tag + " " + texto)
        n = sum(1 for k in claves if k in nt)
        if n:
            puntuados.append((n, tag, texto))
    if not puntuados:
        return "No encuentro nada sobre eso en el expediente del paciente."
    puntuados.sort(key=lambda x: -x[0])
    lineas = [f"• {tag}: {texto[:260]}" for _, tag, texto in puntuados[:5]]
    return "Lo que hay en el expediente sobre eso:\n" + "\n".join(lineas)
