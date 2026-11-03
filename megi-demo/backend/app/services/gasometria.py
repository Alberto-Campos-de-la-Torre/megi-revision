"""Calculadoras de gasometría, equilibrio ácido-base y electrolitos.

DETERMINISTAS a propósito (mismo patrón que `age_engine.py` y `safety.py`): son
aritmética con reglas, así que van en código y con pruebas. **Nunca dependen del
LLM** — que gemma "calcule" una fórmula de Winter y se equivoque en un paciente
crítico es exactamente lo que no puede pasar.

Unidades (las de uso corriente en México):
    pH adimensional · PCO₂/PO₂ en mmHg · HCO₃⁻, Na⁺, Cl⁻, K⁺ en mEq/L
    albúmina en g/dL · glucosa en mg/dL · calcio en mg/dL · lactato en mmol/L

MEGI SUGIERE, NO DECIDE: la interpretación se redacta como «compatible con» y
siempre acompañada de la fórmula usada, para que el médico pueda comprobarla.
"""
from __future__ import annotations

# Rangos de referencia (sangre arterial).
PH_NORMAL = (7.35, 7.45)
PCO2_NORMAL = (35.0, 45.0)
HCO3_NORMAL = (22.0, 26.0)
AG_NORMAL = (8.0, 12.0)

AVISO = ("Cálculo determinista de apoyo. Requiere correlación clínica y con el "
         "resto del cuadro; no sustituye el juicio del médico.")

# Límites de plausibilidad: fuera de esto no se interpreta, se rechaza. Una
# gasometría mal tecleada tiene que fallar de forma ruidosa, no producir una
# lectura con aire de certeza.
_LIMITES = {
    "ph": (6.5, 8.0), "pco2": (5.0, 150.0), "hco3": (1.0, 60.0),
    "na": (90.0, 200.0), "cl": (50.0, 160.0), "k": (1.0, 10.0),
    "albumina": (0.5, 7.0), "glucosa": (10.0, 1500.0), "calcio": (2.0, 20.0),
    "pao2": (20.0, 700.0), "fio2": (0.21, 1.0), "lactato": (0.1, 30.0),
}


class DatoFueraDeRango(ValueError):
    """Un valor no es fisiológicamente plausible (probable error de captura)."""


def _num(nombre: str, valor, obligatorio: bool = False) -> float | None:
    if valor is None or valor == "":
        if obligatorio:
            raise DatoFueraDeRango(f"falta {nombre}")
        return None
    try:
        v = float(valor)
    except (TypeError, ValueError):
        raise DatoFueraDeRango(f"{nombre}: '{valor}' no es un número") from None
    lo, hi = _LIMITES[nombre]
    if not (lo <= v <= hi):
        raise DatoFueraDeRango(
            f"{nombre} = {v} está fuera de lo plausible ({lo}–{hi}); revisa la captura")
    return v


def _r(x: float, n: int = 1) -> float:
    return round(x + 0.0, n)


# --------------------------------------------------------------------- Winter
def winter(hco3: float) -> dict:
    """PCO₂ que CABE ESPERAR si la compensación respiratoria es adecuada.

    Winter: PCO₂ esperada = 1.5 × HCO₃⁻ + 8 ± 2. Válida para acidosis
    metabólica; se usa para detectar un trastorno respiratorio añadido.
    """
    hco3 = _num("hco3", hco3, obligatorio=True)
    esperado = 1.5 * hco3 + 8
    return {"esperado": _r(esperado), "min": _r(esperado - 2), "max": _r(esperado + 2),
            "formula": "PCO₂ esperada = 1.5 × HCO₃⁻ + 8 ± 2 (Winter)"}


def _compensacion_esperada(primario: str, hco3: float, pco2: float) -> dict | None:
    """Rango esperado del parámetro compensador según el trastorno primario."""
    if primario == "acidosis metabólica":
        w = winter(hco3)
        return {"parametro": "PCO₂", "min": w["min"], "max": w["max"], "formula": w["formula"]}
    if primario == "alcalosis metabólica":
        e = 0.7 * hco3 + 21
        return {"parametro": "PCO₂", "min": _r(e - 2), "max": _r(e + 2),
                "formula": "PCO₂ esperada = 0.7 × HCO₃⁻ + 21 ± 2"}
    if primario == "acidosis respiratoria":
        # No sabemos si es aguda o crónica: se da el rango que las abarca.
        d = (pco2 - 40) / 10.0
        return {"parametro": "HCO₃⁻", "min": _r(24 + 1.0 * d), "max": _r(24 + 3.5 * d),
                "formula": "HCO₃⁻ esperado = 24 + (1 aguda a 3.5 crónica) × (PCO₂−40)/10"}
    if primario == "alcalosis respiratoria":
        d = (40 - pco2) / 10.0
        return {"parametro": "HCO₃⁻", "min": _r(24 - 4.0 * d), "max": _r(24 - 2.0 * d),
                "formula": "HCO₃⁻ esperado = 24 − (2 aguda a 4 crónica) × (40−PCO₂)/10"}
    return None


# ---------------------------------------------------------------- anión gap
def anion_gap(na: float, cl: float, hco3: float, albumina: float | None = None) -> dict:
    """AG = Na⁺ − (Cl⁻ + HCO₃⁻). Corregido por albúmina: +2.5 por cada g/dL < 4.

    La corrección importa: en un paciente crítico hipoalbuminémico un AG
    "normal" puede esconder una acidosis con AG elevado.
    """
    na = _num("na", na, obligatorio=True)
    cl = _num("cl", cl, obligatorio=True)
    hco3 = _num("hco3", hco3, obligatorio=True)
    alb = _num("albumina", albumina)
    ag = na - (cl + hco3)
    out = {"valor": _r(ag), "normal": list(AG_NORMAL),
           "formula": "AG = Na⁺ − (Cl⁻ + HCO₃⁻); normal 8–12 mEq/L"}
    usado = ag
    if alb is not None:
        corregido = ag + 2.5 * (4.0 - alb)
        out["corregido"] = _r(corregido)
        out["formula_correccion"] = "AG corregido = AG + 2.5 × (4 − albúmina g/dL)"
        usado = corregido
    out["elevado"] = usado > AG_NORMAL[1]
    out["usado"] = _r(usado)
    return out


def delta_delta(ag_usado: float, hco3: float) -> dict:
    """(AG − 12) / (24 − HCO₃⁻): descubre un SEGUNDO trastorno metabólico
    escondido detrás de una acidosis con AG elevado."""
    denom = 24.0 - hco3
    if denom <= 0:
        return {"aplica": False, "motivo": "HCO₃⁻ no está bajo: no aplica"}
    ratio = (ag_usado - 12.0) / denom
    if ratio < 1:
        lectura = "sugiere acidosis metabólica con AG normal (hiperclorémica) añadida"
    elif ratio > 2:
        lectura = "sugiere alcalosis metabólica o acidosis respiratoria crónica añadida"
    else:
        lectura = "compatible con acidosis con AG elevado aislada"
    return {"aplica": True, "ratio": _r(ratio, 2), "lectura": lectura,
            "formula": "Δ/Δ = (AG − 12) / (24 − HCO₃⁻)"}


# ------------------------------------------------------------- electrolitos
def sodio_corregido(na: float, glucosa: float) -> dict:
    """Na⁺ real detrás de una hiperglucemia: +1.6 mEq/L por cada 100 mg/dL de
    glucosa por encima de 100 (Katz). Algunos autores usan 2.4 (Hillier); se
    devuelven ambos porque cambian la conducta en el paciente diabético."""
    na = _num("na", na, obligatorio=True)
    glu = _num("glucosa", glucosa, obligatorio=True)
    exceso = max(0.0, glu - 100.0) / 100.0
    return {"katz": _r(na + 1.6 * exceso), "hillier": _r(na + 2.4 * exceso),
            "formula": "Na⁺ corregido = Na⁺ + 1.6 (o 2.4) × (glucosa − 100)/100"}


def calcio_corregido(calcio: float, albumina: float) -> dict:
    """Ca²⁺ corregido = Ca + 0.8 × (4 − albúmina). Sin corregir, el crítico
    hipoalbuminémico parece hipocalcémico cuando no lo está."""
    ca = _num("calcio", calcio, obligatorio=True)
    alb = _num("albumina", albumina, obligatorio=True)
    return {"valor": _r(ca + 0.8 * (4.0 - alb), 2),
            "formula": "Ca corregido = Ca + 0.8 × (4 − albúmina g/dL)"}


# ------------------------------------------------------------- oxigenación
def pafi(pao2: float, fio2: float) -> dict:
    """PaO₂/FiO₂. FiO₂ en fracción (0.21–1.0). Clasificación de Berlín."""
    po2 = _num("pao2", pao2, obligatorio=True)
    fi = _num("fio2", fio2, obligatorio=True)
    valor = po2 / fi
    if valor <= 100:
        clas = "compatible con SDRA grave"
    elif valor <= 200:
        clas = "compatible con SDRA moderado"
    elif valor <= 300:
        clas = "compatible con SDRA leve"
    else:
        clas = "sin criterio de SDRA por PaO₂/FiO₂"
    return {"valor": _r(valor), "clasificacion": clas,
            "formula": "PaO₂/FiO₂ (Berlín: ≤300 leve, ≤200 moderado, ≤100 grave)"}


# ----------------------------------------------------------- interpretación
def _primario(ph: float, pco2: float, hco3: float) -> tuple[str, str, str]:
    """(trastorno primario, motivo, certeza). Certeza 'probable' cuando el pH
    está en rango: ahí el primario se deduce, no se lee."""
    acidemia = ph < PH_NORMAL[0]
    alcalemia = ph > PH_NORMAL[1]
    met_ac, met_al = hco3 < HCO3_NORMAL[0], hco3 > HCO3_NORMAL[1]
    resp_ac, resp_al = pco2 > PCO2_NORMAL[1], pco2 < PCO2_NORMAL[0]

    if acidemia:
        if met_ac and resp_ac:
            return "acidosis mixta", "acidemia con HCO₃⁻ bajo y PCO₂ alto a la vez", "clara"
        if met_ac:
            return "acidosis metabólica", "acidemia con HCO₃⁻ bajo", "clara"
        if resp_ac:
            return "acidosis respiratoria", "acidemia con PCO₂ alto", "clara"
        return "acidemia sin patrón claro", "revisar la captura o buscar trastorno mixto", "baja"
    if alcalemia:
        if met_al and resp_al:
            return "alcalosis mixta", "alcalemia con HCO₃⁻ alto y PCO₂ bajo a la vez", "clara"
        if met_al:
            return "alcalosis metabólica", "alcalemia con HCO₃⁻ alto", "clara"
        if resp_al:
            return "alcalosis respiratoria", "alcalemia con PCO₂ bajo", "clara"
        return "alcalemia sin patrón claro", "revisar la captura o buscar trastorno mixto", "baja"

    if not (met_ac or met_al or resp_ac or resp_al):
        return "sin trastorno ácido-base", "pH, PCO₂ y HCO₃⁻ dentro de rango", "clara"

    # pH en rango pero con HCO₃⁻/PCO₂ alterados: es justo donde MÁS sirve el
    # cálculo de compensación (delata el segundo trastorno), así que no nos
    # rendimos. El primario se deduce del lado al que se inclina el pH: la
    # compensación nunca sobrepasa el punto neutro, así que 7.40 justo se lee
    # como lado ácido.
    lado_acido = ph <= 7.40
    motivo = ("pH normal con HCO₃⁻/PCO₂ alterados: el pH normal NO descarta un "
              "trastorno ácido-base (compensado o mixto)")
    if lado_acido:
        if met_ac:
            return "acidosis metabólica", motivo, "probable"
        if resp_ac:
            return "acidosis respiratoria", motivo, "probable"
    else:
        if met_al:
            return "alcalosis metabólica", motivo, "probable"
        if resp_al:
            return "alcalosis respiratoria", motivo, "probable"
    # El parámetro alterado empuja al lado contrario del que se inclina el pH:
    # solo cabe describirlo.
    return "pH normal con parámetros alterados", motivo, "baja"


def interpretar(ph, pco2, hco3, na=None, cl=None, albumina=None, glucosa=None,
                calcio=None, pao2=None, fio2=None, lactato=None, k=None) -> dict:
    """Lectura completa de una gasometría. Solo pH, PCO₂ y HCO₃⁻ son
    obligatorios; lo demás enriquece el resultado si está disponible."""
    ph = _num("ph", ph, obligatorio=True)
    pco2 = _num("pco2", pco2, obligatorio=True)
    hco3 = _num("hco3", hco3, obligatorio=True)
    lac = _num("lactato", lactato)
    kal = _num("k", k)

    primario, motivo, certeza = _primario(ph, pco2, hco3)
    out = {
        "valores": {"ph": ph, "pco2": pco2, "hco3": hco3},
        "trastorno_primario": primario,
        "motivo": motivo,
        "certeza": certeza,
        "hallazgos": [],
        "formulas": [],
        "aviso": AVISO,
    }
    if certeza == "probable":
        out["hallazgos"].append(motivo)

    comp = _compensacion_esperada(primario, hco3, pco2)
    if comp:
        medido = pco2 if comp["parametro"] == "PCO₂" else hco3
        dentro = comp["min"] <= medido <= comp["max"]
        comp.update({"medido": _r(medido), "adecuada": dentro})
        if dentro:
            comp["lectura"] = "compensación adecuada para el trastorno primario"
        elif medido > comp["max"]:
            comp["lectura"] = ("compensación insuficiente o trastorno añadido: "
                               + ("acidosis respiratoria concomitante"
                                  if comp["parametro"] == "PCO₂" else
                                  "alcalosis metabólica concomitante"))
        else:
            comp["lectura"] = ("trastorno añadido: "
                               + ("alcalosis respiratoria concomitante"
                                  if comp["parametro"] == "PCO₂" else
                                  "acidosis metabólica concomitante"))
        out["compensacion"] = comp
        out["formulas"].append(comp["formula"])
        out["hallazgos"].append(comp["lectura"])

    if na is not None and cl is not None:
        ag = anion_gap(na, cl, hco3, albumina)
        out["anion_gap"] = ag
        out["formulas"].append(ag["formula"])
        if "formula_correccion" in ag:
            out["formulas"].append(ag["formula_correccion"])
        if ag["elevado"]:
            out["hallazgos"].append(f"anión gap elevado ({ag['usado']} mEq/L)")
            if primario in ("acidosis metabólica", "acidosis mixta"):
                dd = delta_delta(ag["usado"], hco3)
                out["delta_delta"] = dd
                if dd.get("aplica"):
                    out["formulas"].append(dd["formula"])
                    out["hallazgos"].append(dd["lectura"])
        elif primario in ("acidosis metabólica", "acidosis mixta"):
            out["hallazgos"].append(
                f"anión gap normal ({ag['usado']} mEq/L): compatible con acidosis "
                "hiperclorémica (pérdidas digestivas, renales o dilucional)")

    correcciones = {}
    if na is not None and glucosa is not None:
        correcciones["sodio"] = sodio_corregido(na, glucosa)
        out["formulas"].append(correcciones["sodio"]["formula"])
    if calcio is not None and albumina is not None:
        correcciones["calcio"] = calcio_corregido(calcio, albumina)
        out["formulas"].append(correcciones["calcio"]["formula"])
    if correcciones:
        out["correcciones"] = correcciones

    if pao2 is not None and fio2 is not None:
        ox = pafi(pao2, fio2)
        out["oxigenacion"] = ox
        out["formulas"].append(ox["formula"])
        out["hallazgos"].append(f"PaO₂/FiO₂ {ox['valor']}: {ox['clasificacion']}")

    if lac is not None:
        out["valores"]["lactato"] = lac
        if lac >= 4:
            out["hallazgos"].append(f"lactato {lac} mmol/L: hipoperfusión franca")
        elif lac > 2:
            out["hallazgos"].append(f"lactato {lac} mmol/L: elevado")
    if kal is not None:
        out["valores"]["k"] = kal
        if kal < 3.5:
            out["hallazgos"].append(f"K⁺ {kal} mEq/L: hipopotasemia")
        elif kal > 5.5:
            out["hallazgos"].append(f"K⁺ {kal} mEq/L: hiperpotasemia")

    return out


# -------------------------------------------------------- gasometrías seriadas
_OBJETIVO = {"ph": 7.40, "pco2": 40.0, "hco3": 24.0}


def tendencia(serie: list) -> dict:
    """Evolución de una SERIE de gasometrías del mismo paciente crítico.

    Una gasometría aislada dice poco en el crítico: lo que orienta es hacia
    dónde va. Se compara la primera con la última y se dice, por parámetro, si
    se acerca o se aleja de lo normal (en lactato, si baja o sube).
    """
    if not isinstance(serie, list) or len(serie) < 2:
        return {"suficiente": False,
                "motivo": "hacen falta al menos dos gasometrías para hablar de tendencia"}

    def _val(m, k):
        try:
            return float(m[k]) if m.get(k) not in (None, "") else None
        except (TypeError, ValueError, AttributeError):
            return None

    primera, ultima = serie[0], serie[-1]
    params = {}
    for k, objetivo in _OBJETIVO.items():
        a, b = _val(primera, k), _val(ultima, k)
        if a is None or b is None:
            continue
        da, db = abs(a - objetivo), abs(b - objetivo)
        if abs(db - da) < 1e-9:
            direccion = "estable"
        else:
            direccion = "mejora" if db < da else "empeora"
        params[k] = {"inicial": _r(a, 2), "actual": _r(b, 2),
                     "cambio": _r(b - a, 2), "direccion": direccion}

    a_lac, b_lac = _val(primera, "lactato"), _val(ultima, "lactato")
    if a_lac is not None and b_lac is not None:
        direccion = "estable" if abs(b_lac - a_lac) < 1e-9 else (
            "mejora" if b_lac < a_lac else "empeora")
        params["lactato"] = {"inicial": _r(a_lac, 2), "actual": _r(b_lac, 2),
                             "cambio": _r(b_lac - a_lac, 2), "direccion": direccion}

    empeoran = [k for k, v in params.items() if v["direccion"] == "empeora"]
    mejoran = [k for k, v in params.items() if v["direccion"] == "mejora"]
    if empeoran:
        resumen = "empeora: " + ", ".join(empeoran)
    elif mejoran:
        resumen = "mejora: " + ", ".join(mejoran)
    else:
        resumen = "sin cambios relevantes entre la primera y la última"

    return {"suficiente": True, "n": len(serie), "parametros": params,
            "resumen": resumen, "aviso": AVISO}
