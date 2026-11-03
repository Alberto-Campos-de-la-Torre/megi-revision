"""Sugerencia de indicaciones de rehabilitación y captura de la corrección.

El autocompletado propone; el médico acepta, quita pasos y edita. Lo que se
guarda aquí es ESA diferencia — propuesta contra lo que realmente firmó — que
es la única señal con la que el sistema puede afinar.

Se registra lo que ocurrió, no una conclusión: qué se propuso, qué se conservó,
qué se añadió a mano y con qué exploración física de fondo. Aprender de eso es
un paso posterior y deliberado; aquí solo se recoge, porque sin haber recogido
desde el primer día no hay de qué aprender después.

La dosimetría NUNCA se reescribe sola: un paso editado se guarda como variante
observada, para revisión humana, igual que los medicamentos minados entran como
`borrador` hasta que alguien los aprueba.
"""
import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..db import db
from ..ownership import doctor_of, owned_consultation
from ..security import require_user
from ..services import rehab
from .me import profile_of

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SugerenciaMostrada(BaseModel):
    consultation_id: str
    protocolo_id: str
    alternativas: list = []          # [{id, nombre, score}] en el orden ofrecido


class SugerenciaAplicada(BaseModel):
    consultation_id: str
    protocolo_id: str
    pasos_propuestos: list = []      # lo que ofreció el catálogo, literal
    pasos_aceptados: list = []       # lo que el médico se quedó (ya editado)
    lateralidad: str | None = None   # "derecho" | "izquierdo" — nunca la elige el sistema
    reglas_mostradas: list = []
    elegido_orden: int | None = None  # 0 = se quedó con el primero de la lista


@router.post("/rehab/mostrada")
def rehab_mostrada(body: SugerenciaMostrada, user: dict = Depends(require_user)):
    """Registra que la sugerencia se ENSEÑÓ, con las alternativas y su orden.

    Es la mitad que faltaba: hasta ahora solo se guardaba lo insertado, así que
    «se le propuso esto y no lo quiso» no dejaba rastro — y el rechazo es la
    señal más fuerte que existe para corregir el ranking. Un protocolo mostrado
    sin su correspondiente 'aplicada' es exactamente eso.

    INSERT OR IGNORE con índice único: el componente puede repintarse varias
    veces y una sugerencia se enseña UNA vez por consulta y protocolo."""
    with db() as conn:
        owned_consultation(conn, body.consultation_id, user)
        conn.execute(
            """INSERT OR IGNORE INTO rehab_sugerencias
               (consultation_id, doctor_id, protocolo_id, evento, alternativas, created_at)
               VALUES (?,?,?,'mostrada',?,?)""",
            (body.consultation_id, doctor_of(user), body.protocolo_id,
             json.dumps(body.alternativas, ensure_ascii=False), _now()),
        )
    return {"ok": True}


@router.get("/rehab/consulta/{consultation_id}")
def rehab_consulta(consultation_id: str, user: dict = Depends(require_user)):
    """Protocolo sugerido para esta consulta, con las reglas que dispara su
    exploración. Se recalcula sobre el SOAP guardado: la pantalla de revisión
    llega después de la consulta en vivo y no tiene el análisis a mano."""
    with db() as conn:
        c = owned_consultation(conn, consultation_id, user)
    soap_raw = c["approved_soap"] or c["final_soap"] or c["soap"]
    try:
        soap = json.loads(soap_raw) if soap_raw else {}
    except (ValueError, TypeError):
        soap = {}
    # El equipo es de QUIEN pregunta: la misma consulta se adapta distinto según
    # lo que haya en su consultorio.
    out = rehab.analizar(soap, equipo=profile_of(user["username"]).get("equipo"))
    # Si ya se insertó un protocolo en el Plan (desde la consulta en vivo), la
    # revisión no debe volver a proponerlo: el médico edita lo que ya está.
    with db() as conn:
        ya = conn.execute(
            "SELECT protocolo_id FROM rehab_sugerencias WHERE consultation_id = ? AND evento = 'aplicada' "
            "ORDER BY id DESC LIMIT 1", (consultation_id,)).fetchone()
    out["ya_insertado"] = ya["protocolo_id"] if ya else None
    return out


class InsertarProtocolo(BaseModel):
    consultation_id: str
    protocolo_id: str
    lateralidad: str | None = None   # "derecho" | "izquierdo"; si falta se intenta leer de la nota


_LIMPIAR = re.compile(r"[`*]")
_LADO = {"derecho": ("DERECHO", "DERECHA"), "izquierdo": ("IZQUIERDO", "IZQUIERDA")}


def _lado_en_la_nota(soap: dict) -> str | None:
    """Lateralidad que la propia nota ya dice («fémur derecho»). Solo si es
    inequívoca: un solo lado mencionado. Si aparecen los dos o ninguno, no se
    adivina: el paso queda con DERECHO/IZQUIERDO para que el médico lo resuelva."""
    t = " ".join(str(soap.get(k) or "") for k in ("S", "O", "A", "P")).lower()
    der = bool(re.search(r"\bderech[oa]s?\b", t))
    izq = bool(re.search(r"\bizquierd[oa]s?\b", t))
    if der and not izq:
        return "derecho"
    if izq and not der:
        return "izquierdo"
    return None


def _paso_texto(texto: str, lado: str | None) -> str:
    t = _LIMPIAR.sub("", texto or "")
    if lado in _LADO:
        m, f = _LADO[lado]
        t = t.replace("DERECHO/IZQUIERDO", m).replace("DERECHA/IZQUIERDA", f)
    return t.strip()


@router.post("/rehab/insertar")
def rehab_insertar(body: InsertarProtocolo, user: dict = Depends(require_user)):
    """Agrega el protocolo al Plan de la nota EN VIVO, en automático: el médico lo
    edita después, al revisar y aprobar. Lo que entra es el texto literal del
    catálogo (dosimetría incluida); la lateralidad se toma de la nota si es
    inequívoca y, si no, queda marcada para resolverla en revisión. Idempotente:
    el mismo protocolo no se pega dos veces. Registra la 'aplicada' para el
    aprendizaje, igual que la inserción desde revisión."""
    with db() as conn:
        c = owned_consultation(conn, body.consultation_id, user)
        soap_raw = c["final_soap"] or c["soap"]
        try:
            soap = json.loads(soap_raw) if soap_raw else {}
        except (ValueError, TypeError):
            soap = {}
        soap = {k: str(soap.get(k) or "") for k in ("S", "O", "A", "P")}

        analisis = rehab.analizar(soap, equipo=profile_of(user["username"]).get("equipo"))
        protocolo = next((p for p in analisis.get("protocolos", []) if p.get("id") == body.protocolo_id), None)
        if protocolo is None:
            protocolo = next((p for p in rehab.catalogo().get("protocolos", []) if p.get("id") == body.protocolo_id), None)
        if protocolo is None:
            raise HTTPException(status_code=404, detail="protocolo no encontrado")

        lado = body.lateralidad if body.lateralidad in _LADO else None
        inferido = False
        if lado is None and protocolo.get("requiere_lateralidad"):
            lado = _lado_en_la_nota(soap)
            inferido = lado is not None
        lado_pendiente = bool(protocolo.get("requiere_lateralidad")) and lado is None

        encabezado = f"Rehabilitación · {protocolo['nombre']}:"
        if encabezado in soap["P"]:
            return {"ok": True, "ya_insertado": True, "soap": soap, "lateralidad": lado,
                    "lado_pendiente": lado_pendiente, "insertados": 0}
        pasos = [p for p in protocolo.get("pasos", []) if p.get("equipo_estado") != "sin_equipo"]
        lineas = [f"{i + 1}. {_paso_texto(p.get('texto', ''), lado)}" for i, p in enumerate(pasos)]
        bloque = encabezado + "\n" + "\n".join(lineas)
        if lado_pendiente:
            bloque += "\n(Lado por definir: revisa DERECHO/IZQUIERDO antes de aprobar.)"
        previo = soap["P"].rstrip()
        soap["P"] = f"{previo}\n\n{bloque}" if previo else bloque

        ahora = _now()
        conn.execute("UPDATE consultations SET soap = ?, updated_at = ? WHERE id = ?",
                     (json.dumps(soap, ensure_ascii=False), ahora, body.consultation_id))
        if c["final_soap"]:
            conn.execute("UPDATE consultations SET final_soap = ? WHERE id = ?",
                         (json.dumps(soap, ensure_ascii=False), body.consultation_id))
        propuestos = [_paso_texto(p.get("texto", ""), lado) for p in protocolo.get("pasos", [])]
        aceptados = [_paso_texto(p.get("texto", ""), lado) for p in pasos]
        conn.execute(
            """INSERT INTO rehab_sugerencias
               (consultation_id, doctor_id, protocolo_id, evento, elegido_orden,
                pasos_propuestos, pasos_aceptados, pasos_quitados, pasos_anadidos,
                lateralidad, reglas_mostradas, contexto, created_at)
               VALUES (?,?,?,'aplicada',0,?,?,?,?,?,?,?,?)""",
            (body.consultation_id, doctor_of(user), body.protocolo_id,
             json.dumps(propuestos, ensure_ascii=False), json.dumps(aceptados, ensure_ascii=False),
             json.dumps([p for p in propuestos if p not in aceptados], ensure_ascii=False), "[]",
             lado, json.dumps(analisis.get("reglas", []), ensure_ascii=False),
             json.dumps({"O": soap["O"], "A": soap["A"], "origen": "consulta_en_vivo",
                         "lateralidad_inferida": inferido}, ensure_ascii=False),
             ahora),
        )
    return {"ok": True, "ya_insertado": False, "soap": soap, "lateralidad": lado,
            "lateralidad_inferida": inferido, "lado_pendiente": lado_pendiente,
            "insertados": len(pasos), "protocolo": protocolo["nombre"]}


@router.post("/rehab/aplicar")
def rehab_aplicar(body: SugerenciaAplicada, user: dict = Depends(require_user)):
    """Registra qué se propuso y qué se quedó. Es el corpus de aprendizaje."""
    if not body.pasos_propuestos:
        raise HTTPException(status_code=400, detail="no hay propuesta que registrar")
    with db() as conn:
        c = owned_consultation(conn, body.consultation_id, user)
        soap_raw = c["approved_soap"] or c["final_soap"] or c["soap"]
        try:
            soap = json.loads(soap_raw) if soap_raw else {}
        except (ValueError, TypeError):
            soap = {}

        propuestos = [p if isinstance(p, str) else p.get("texto", "") for p in body.pasos_propuestos]
        aceptados = [p if isinstance(p, str) else p.get("texto", "") for p in body.pasos_aceptados]
        # El diff se calcula aquí y no en el cliente: es el dato que importa y no
        # debe depender de que el frontend lo mande bien.
        quitados = [p for p in propuestos if p not in aceptados]
        anadidos = [p for p in aceptados if p not in propuestos]

        conn.execute(
            """INSERT INTO rehab_sugerencias
               (consultation_id, doctor_id, protocolo_id, evento, elegido_orden,
                pasos_propuestos, pasos_aceptados,
                pasos_quitados, pasos_anadidos, lateralidad, reglas_mostradas, contexto, created_at)
               VALUES (?,?,?,'aplicada',?,?,?,?,?,?,?,?,?)""",
            (body.consultation_id, doctor_of(user), body.protocolo_id, body.elegido_orden,
             json.dumps(propuestos, ensure_ascii=False),
             json.dumps(aceptados, ensure_ascii=False),
             json.dumps(quitados, ensure_ascii=False),
             json.dumps(anadidos, ensure_ascii=False),
             body.lateralidad,
             json.dumps(body.reglas_mostradas, ensure_ascii=False),
             # La exploración es el CONTEXTO de la decisión: sin ella, saber que
             # se bajó la dosis no enseña nada; con ella, se aprende cuándo.
             json.dumps({"O": soap.get("O", ""), "A": soap.get("A", "")}, ensure_ascii=False),
             _now()),
        )
    return {"ok": True, "quitados": len(quitados), "anadidos": len(anadidos)}


@router.get("/rehab/aprendizaje")
def rehab_aprendizaje(user: dict = Depends(require_user)):
    """Qué se ha observado hasta ahora, por protocolo: cuántas veces se propuso y
    qué pasos se quitan con más frecuencia. Es lectura, no ajusta nada todavía —
    el objetivo es poder MIRAR la señal antes de dejar que mueva el ranking."""
    with db() as conn:
        filas = conn.execute(
            "SELECT protocolo_id, evento, elegido_orden, pasos_quitados, pasos_anadidos "
            "FROM rehab_sugerencias WHERE doctor_id = ?", (doctor_of(user),)).fetchall()

    por_protocolo: dict = {}
    for f in filas:
        e = por_protocolo.setdefault(f["protocolo_id"], {
            "veces": 0, "mostradas": 0, "aplicadas": 0, "no_era_el_primero": 0,
            "quitados": {}, "anadidos": {}})
        if f["evento"] == "mostrada":
            e["mostradas"] += 1
            continue
        e["aplicadas"] += 1
        e["veces"] += 1
        if f["elegido_orden"]:            # 0 o None = se quedó con el primero
            e["no_era_el_primero"] += 1
        for clave, campo in (("quitados", "pasos_quitados"), ("anadidos", "pasos_anadidos")):
            try:
                for paso in json.loads(f[campo] or "[]"):
                    e[clave][paso] = e[clave].get(paso, 0) + 1
            except (ValueError, TypeError):
                pass

    salida = []
    for pid, e in sorted(por_protocolo.items(), key=lambda kv: -kv[1]["veces"]):
        # Rechazo = se enseñó y no se usó. Es lo que dice que el ranking falla,
        # y no se puede deducir de las aplicadas.
        rechazos = max(e["mostradas"] - e["aplicadas"], 0)
        salida.append({
            "protocolo_id": pid, "veces": e["veces"],
            "mostradas": e["mostradas"], "aplicadas": e["aplicadas"],
            "rechazos": rechazos,
            "tasa_aceptacion": round(e["aplicadas"] / e["mostradas"], 2) if e["mostradas"] else None,
            "no_era_el_primero": e["no_era_el_primero"],
            "quitados": sorted(e["quitados"].items(), key=lambda kv: -kv[1])[:5],
            "anadidos": sorted(e["anadidos"].items(), key=lambda kv: -kv[1])[:5],
        })
    return {"protocolos": salida,
            "total_sugerencias": sum(1 for f in filas if f["evento"] != "mostrada"),
            "total_mostradas": sum(1 for f in filas if f["evento"] == "mostrada")}
