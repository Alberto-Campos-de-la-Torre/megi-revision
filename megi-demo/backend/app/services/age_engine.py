"""Motor de edad + reglas de interrogatorio por grupo (SOAP dinámico).

Dado un paciente (fecha de nacimiento o edad), calcula la edad exacta y el grupo
etario, y devuelve las SUGERENCIAS de qué preguntar/revisar antes de la consulta.

Reglas DETERMINISTAS y transparentes (patrón safety.py): la edad activa un
bloque base de interrogatorio + tamizajes/vacunas que "tocan"; el historial del
paciente añade o prioriza (crónicos, alergias, medicación previa). Fuente
normativa MX primero (Cartillas Nacionales de Salud, GPC IMSS) con referencia
internacional (Bright Futures/AAP, USPSTF, CDC). MEGI SUGIERE; el médico decide.
"""
from __future__ import annotations

from datetime import date, datetime


def _today() -> date:
    return datetime.now().date()


def fecha_contradice_edad(birthdate: str | None, years: int | None) -> bool:
    """¿La fecha de nacimiento y la edad en años se contradicen?

    Pasó en producción (21-sep-2026): un paciente de 25 años con
    `birthdate` = el día del alta —el selector de fecha se quedó con «hoy» y el
    médico escribió la edad a mano—. Como la fecha tenía preferencia, el motor
    lo trataba como lactante y el LLM preparaba una consulta de bebé. Regla:
    la fecha manda SOLO si cuadra con la edad (±1 año, por el cumpleaños); si
    no, la edad escrita a propósito vale más que una fecha que pudo colarse.
    """
    if not birthdate or years is None:
        return False
    try:
        bd = datetime.strptime(str(birthdate)[:10], "%Y-%m-%d").date()
        y_fecha = (_today() - bd).days // 365
        return abs(y_fecha - int(years)) > 1
    except (ValueError, TypeError):
        return True                      # fecha ilegible: tampoco se usa


def compute_age(birthdate: str | None, fallback_years: int | None,
                gestacional_semanas: int | None = None) -> dict:
    """Edad exacta desde birthdate (YYYY-MM-DD); si falta —o contradice la
    edad en años—, usa los años enteros. Calcula edad corregida en prematuros
    (<37 sem) hasta los 2 años."""
    if birthdate and not fecha_contradice_edad(birthdate, fallback_years):
        try:
            bd = datetime.strptime(birthdate[:10], "%Y-%m-%d").date()
            days = (_today() - bd).days
            years = days // 365
            months = days // 30
            out = {"exacta": True, "age_days": days, "age_months": months,
                   "age_years": years, "birthdate": birthdate[:10]}
            if gestacional_semanas and gestacional_semanas < 37 and days < 730:
                corr_days = days - (40 - gestacional_semanas) * 7
                out["edad_corregida_meses"] = max(0, corr_days) // 30
                out["prematuro"] = True
            return out
        except (ValueError, TypeError):
            pass
    y = fallback_years or 0
    out = {"exacta": False, "age_days": y * 365, "age_months": y * 12, "age_years": y}
    if birthdate:
        out["birthdate_ignorada"] = str(birthdate)[:10]   # para que se vea por qué
    return out


def edad_texto(age: dict) -> str:
    """«25 años», «7 meses», «12 días»: lo que se le dice al LLM además del
    grupo, para que no tenga que deducir la edad de una etiqueta."""
    y, m, d = age.get("age_years", 0), age.get("age_months", 0), age.get("age_days", 0)
    if age.get("exacta") and y < 2:
        return f"{m} meses" if m >= 1 else f"{d} días"
    return f"{y} años"


def age_group(age: dict) -> tuple[str, str]:
    """(clave, etiqueta legible) del grupo etario."""
    d, m, y = age["age_days"], age["age_months"], age["age_years"]
    if d <= 28:
        return "neonatal", "Neonato (0–28 días)"
    if m < 3:
        return "lactante_temprano", "Lactante temprano (1–2 meses)"
    if m < 12:
        return "lactante", "Lactante (3–11 meses)"
    if y < 3:
        return "toddler", "Primera infancia (1–2 años)"
    if y <= 5:
        return "preescolar", "Preescolar (3–5 años)"
    if y <= 11:
        return "escolar", "Escolar (6–11 años)"
    if y <= 17:
        return "adolescente", "Adolescente (12–17 años)"
    if y <= 39:
        return "adulto_joven", "Adulto joven (18–39 años)"
    if y <= 64:
        return "adulto_medio", "Adulto medio (40–64 años)"
    return "adulto_mayor", "Adulto mayor (65+ años)"


def _s(texto, razon, fuente, categoria="interrogatorio", prioridad="media"):
    return {"categoria": categoria, "texto": texto, "razon": razon,
            "fuente": fuente, "prioridad": prioridad}


# Reglas base por grupo: qué preguntar/revisar antes de la consulta. Enfocado en
# el INTERROGATORIO pre-consulta + tamizajes/vacunas que tocan por edad.
BF = "Bright Futures/AAP · Cartilla Nacional 0–9"
CN_ADO = "Cartilla Nacional Adolescentes 10–19"
CN_ADU = "Cartilla Nacional 20–59 · USPSTF"
CN_MAY = "Cartilla Nacional 60+ · USPSTF"

_RULES: dict[str, list] = {
    "neonatal": [
        _s("¿Quién da la historia? (madre/padre/tutor)", "Neonato", BF, prioridad="alta"),
        _s("Embarazo, parto, edad gestacional y peso al nacer", "Neonato", BF, prioridad="alta"),
        _s("Alimentación: pecho/fórmula, frecuencia, succión", "Neonato", BF, prioridad="alta"),
        _s("Ictericia, color de piel, evacuaciones y pañales mojados", "Neonato", BF, prioridad="alta"),
        _s("Fiebre ≥38°C: bandera roja, requiere valoración inmediata", "Neonato con fiebre = alto riesgo", "AAP/NICE", "interrogatorio", "alta"),
        _s("Tamiz neonatal metabólico y auditivo (¿realizados?)", "Neonato", "Cartilla Nacional", "tamizaje", "alta"),
    ],
    "lactante_temprano": [
        _s("Alimentación, reflujo, cólico, sueño y patrón de pañales", "Lactante 1–2 meses", BF, prioridad="alta"),
        _s("Fiebre ≥38°C: valoración especial en <3 meses", "Lactante pequeño", "AAP", "interrogatorio", "alta"),
        _s("Vacunas de los 2 meses (¿al corriente?)", "Toca esquema de 2 meses", "Cartilla Nacional", "vacuna", "alta"),
        _s("Tamiz de depresión de la madre/cuidador", "Bright Futures", BF, prioridad="media"),
        _s("Sueño seguro, desarrollo inicial (sonrisa, fija mirada)", "Lactante", BF),
    ],
    "lactante": [
        _s("Alimentación complementaria, atragantamiento, dientes", "Lactante 6–11 m", BF, prioridad="alta"),
        _s("Hitos: sostén cefálico, sedestación, pinza, balbuceo", "Tamiz de desarrollo", "AAP (tamiz 9 m)", "interrogatorio", "alta"),
        _s("Vacunas del semestre (¿al corriente?)", "Toca esquema", "Cartilla Nacional", "vacuna", "alta"),
        _s("Seguridad en casa (caídas, tóxicos), alimentación", "Lactante mayor", BF),
    ],
    "toddler": [
        _s("Lenguaje, marcha, conducta, control de esfínteres", "1–2 años", BF, prioridad="alta"),
        _s("Tamiz de autismo (18 y 24 meses)", "AAP: autismo 18/24 m", "AAP", "tamizaje", "alta"),
        _s("Vacunas de 12/18 meses; anemia/plomo por riesgo", "Toca esquema", "Cartilla Nacional", "vacuna", "alta"),
        _s("Alimentación selectiva, sueño, pantallas, dental", "Primera infancia", BF),
    ],
    "preescolar": [
        _s("Lenguaje, conducta, preescolar, sueño, pantallas", "Preescolar", BF, prioridad="alta"),
        _s("Visión y audición (tamiz al menos una vez 3–5 años)", "USPSTF: visión 3–5 a", "USPSTF", "tamizaje", "alta"),
        _s("Presión arterial (desde los 3 años)", "AAP: TA anual ≥3 a", "AAP", "exploracion", "media"),
        _s("Vacunas 4–6 años, salud dental, seguridad", "Toca refuerzo", "Cartilla Nacional", "vacuna"),
    ],
    "escolar": [
        _s("Rendimiento escolar, conducta, bullying, sueño, actividad", "Escolar", BF, prioridad="alta"),
        _s("IMC por edad/sexo y presión arterial", "Tamiz nutricional/CV", "AAP/USPSTF", "exploracion", "media"),
        _s("Visión/audición, dieta, lesiones deportivas", "Escolar", BF),
    ],
    "adolescente": [
        _s("Entrevista CONFIDENCIAL (parte sin tutor)", "Adolescente", "Bright Futures", "interrogatorio", "alta"),
        _s("HEADSSS: hogar, escuela, actividades, drogas, sexualidad, suicidio/ánimo, seguridad", "Adolescente", CN_ADO, "interrogatorio", "alta"),
        _s("Tamiz de depresión y riesgo suicida (12–18 años)", "USPSTF: depresión 12–18", "USPSTF", "tamizaje", "alta"),
        _s("Salud sexual, ITS/embarazo por riesgo; menstruación", "Adolescente", CN_ADO, "interrogatorio", "media"),
        _s("Vacunas del adolescente (VPH, Tdpa, etc.)", "Toca esquema", CN_ADO, "vacuna", "media"),
    ],
    "adulto_joven": [
        _s("Tabaco, alcohol, drogas; actividad, dieta, sueño", "Adulto joven", CN_ADU, prioridad="media"),
        _s("Salud sexual/reproductiva y anticoncepción", "Adulto joven", CN_ADU),
        _s("Tamiz de depresión y ansiedad", "USPSTF: depresión en adultos", "USPSTF", "tamizaje", "media"),
        _s("Presión arterial, IMC; riesgo cardiometabólico", "Adulto", CN_ADU, "exploracion", "media"),
    ],
    "adulto_medio": [
        _s("Riesgo cardiovascular: TA, tabaco, dieta, ejercicio", "Adulto medio", CN_ADU, prioridad="alta"),
        _s("Tamiz de diabetes si sobrepeso/obesidad (35–70)", "USPSTF: DM 35–70 con IMC alto", "USPSTF", "tamizaje", "alta"),
        _s("Tamiz de cáncer colorrectal desde los 45", "USPSTF: CCR 45–75", "USPSTF", "tamizaje", "alta"),
        _s("Mastografía 40–74 (según sexo/riesgo); cervical si aplica", "USPSTF", "USPSTF", "tamizaje", "media"),
        _s("Depresión, alcohol, sueño", "Adulto medio", CN_ADU),
    ],
    "adulto_mayor": [
        _s("Caídas en el último año y factores de riesgo", "Adulto mayor", CN_MAY, "interrogatorio", "alta"),
        _s("Cognición/memoria y estado de ánimo", "Geriatría", CN_MAY, "interrogatorio", "alta"),
        _s("Funcionalidad (ABVD/AIVD): baño, vestido, comer, finanzas", "Geriatría", CN_MAY, "interrogatorio", "alta"),
        _s("Polifarmacia: revisar TODOS los medicamentos y deprescribir", "Adulto mayor", CN_MAY, "interrogatorio", "alta"),
        _s("Audición/visión, soporte social, voluntades anticipadas", "Geriatría", CN_MAY),
        _s("Osteoporosis (mujeres ≥65), vacunas del adulto mayor", "USPSTF", CN_MAY, "tamizaje", "media"),
    ],
}


def _history_suggestions(patient: dict, consultas: list) -> list:
    """Sugerencias derivadas del HISTORIAL (no de la edad): crónicos, alergias,
    medicación previa, primera visita, dx recurrentes."""
    out = []
    chronic = [c for c in (patient.get("chronic") or []) if c]
    allergies = [a for a in (patient.get("allergies") or []) if a]
    if chronic:
        out.append(_s(
            f"Control y adherencia de: {', '.join(chronic)} (cifras en casa, síntomas, apego al tratamiento)",
            "Padecimientos crónicos registrados", "Historial del paciente", "interrogatorio", "alta"))
    if allergies:
        out.append(_s(
            f"Confirmar alergias antes de prescribir: {', '.join(allergies)}",
            "Alergias registradas", "Historial del paciente", "interrogatorio", "alta"))
    if not consultas:
        out.append(_s(
            "Primera consulta: historia clínica completa (antecedentes heredofamiliares, personales patológicos, quirúrgicos, gineco-obstétricos)",
            "Sin consultas previas en MEGI", "Historial del paciente", "interrogatorio", "alta"))
    else:
        # medicación de la última consulta -> preguntar continuidad
        ultima = consultas[0]
        rx = ultima.get("prescription") or ultima.get("rx_list") or []
        drugs = [r.get("drug") for r in rx if isinstance(r, dict) and r.get("drug")]
        if drugs:
            out.append(_s(
                f"¿Continúa con lo indicado la vez pasada? ({', '.join(drugs[:5])}) — efectos, adherencia",
                "Medicación de la consulta previa", "Historial del paciente", "interrogatorio", "alta"))
    return out


def preconsulta_base(patient: dict, consultas: list) -> dict:
    """Sugerencias deterministas: edad + grupo + reglas base + historial."""
    age = compute_age(patient.get("birthdate"), patient.get("age"),
                      patient.get("gestacional_semanas"))
    clave, etiqueta = age_group(age)
    sugerencias = list(_RULES.get(clave, []))
    if age.get("prematuro"):
        sugerencias.insert(0, _s(
            f"Prematuro ({patient.get('gestacional_semanas')} sem): usar edad corregida "
            f"(~{age.get('edad_corregida_meses')} meses) para desarrollo y crecimiento",
            "Nació prematuro", "AAP", "interrogatorio", "alta"))
    sugerencias += _history_suggestions(patient, consultas)
    return {"edad": age, "grupo": clave, "grupo_label": etiqueta, "sugerencias": sugerencias}
