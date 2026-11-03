"""Motivo de consulta -> qué preguntar HOY.

El motor de edad (`age_engine.py`) sabe qué toca por edad e historial, pero no
por qué VIENE el paciente: quien llega por dolor de rodilla recibía las mismas
sugerencias que quien llega por tos. Este módulo cubre ese hueco.

DETERMINISTA y transparente, igual que `age_engine.py` y `safety.py`: el motivo
se normaliza y se buscan patrones; cada patrón aporta preguntas dirigidas y, lo
importante, las **banderas rojas** que no se deben olvidar. Lo que el LLM hace
después es redactar y priorizar, nunca decidir qué es una alarma.

MEGI SUGIERE, NO DECIDE. Un motivo no reconocido no inventa nada: devuelve lista
vacía y el médico se queda con las sugerencias por edad, como antes.
"""
from __future__ import annotations

import re
import unicodedata

MAX_MOTIVO = 300


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def _s(texto, razon, fuente, categoria="interrogatorio", prioridad="media", claves=()):
    """Misma forma que las sugerencias de `age_engine` (el panel las pinta igual).

    `claves` son las palabras que, dichas EN LA CONSULTA, indican que el tema ya
    se tocó. Sirven para el seguimiento en vivo (`services/cobertura.py`): no
    describen la sugerencia, describen cómo suena la conversación.
    """
    return {"categoria": categoria, "texto": texto, "razon": razon,
            "fuente": fuente, "prioridad": prioridad, "claves": list(claves)}


GPC = "GPC IMSS · motivo de consulta"
ALARMA = "alarma"          # categoría propia: el panel la destaca en rojo

# Cada entrada: (clave, regex del motivo, etiqueta legible, sugerencias).
# El orden importa poco salvo que un motivo dispare varios patrones: entonces se
# acumulan y las alarmas se quedan siempre arriba.
_PATRONES: list[tuple[str, str, str, list]] = [
    ("dolor_toracico",
     r"dolor (de |en el |al )?(pecho|torax|toracico)|dolor toracico|opresion (en el )?pecho|angina|"
     r"duele (el |la )?(pecho|torax)",
     "dolor torácico", [
         _s("Descartar síndrome coronario: inicio, duración, irradiación a brazo o mandíbula, "
            "diaforesis, náusea, relación con el esfuerzo", "Dolor torácico", GPC, ALARMA, "alta", claves=["irradia", "brazo", "mandíbula", "diafores", "sudor", "esfuerzo"]),
         _s("Factores de riesgo cardiovascular: HAS, diabetes, tabaquismo, dislipidemia, antecedente familiar",
            "Dolor torácico", GPC, "interrogatorio", "alta", claves=["presión alta", "hipertens", "diabet", "fuma", "tabaqu", "colesterol", "triglicérid"]),
         _s("Disnea, síncope o palpitaciones acompañantes; signos de TEP (dolor pleurítico, inmovilización reciente)",
            "Dolor torácico", GPC, ALARMA, "alta", claves=["falta de aire", "disnea", "desmay", "síncope", "palpitac", "pleurític", "inmoviliz"]),
         _s("Tomar TA en ambos brazos, FC, saturación y valorar ECG", "Dolor torácico", GPC, "exploracion", "alta", claves=["presión", "tensión", "electro", "ecg", "saturac", "frecuencia cardiaca"]),
     ]),
    ("disnea",
     r"disnea|falta de aire|dificultad (para )?respirar|ahogo|no puede respirar",
     "disnea", [
         _s("Tiempo de evolución, si es de esfuerzo o de reposo, ortopnea y disnea paroxística nocturna",
            "Disnea", GPC, "interrogatorio", "alta", claves=["almohada", "ortopnea", "acostad", "esfuerzo", "reposo", "en la noche"]),
         _s("Saturación de O₂, FR, uso de músculos accesorios y cianosis: valorar urgencia",
            "Disnea", GPC, ALARMA, "alta", claves=["saturac", "oxímetr", "frecuencia respiratoria", "tiraje", "músculos accesorios", "cianosis", "morad"]),
         _s("Antecedente de asma, EPOC, insuficiencia cardiaca o tabaquismo", "Disnea", GPC, claves=["asma", "epoc", "insuficiencia cardiaca", "fuma", "tabaqu"]),
         _s("Fiebre, dolor torácico, edema de miembros inferiores", "Disnea", GPC, claves=["fiebre", "edema", "hinchaz", "piernas", "dolor de pecho"]),
     ]),
    ("tos",
     r"\btos\b|tosiendo|catarro|resfriado|gripa",
     "tos", [
         _s("Duración (¿más de 2 semanas?), seca o con expectoración, color y si hay hemoptisis",
            "Tos", GPC, "interrogatorio", "alta", claves=["semana", "flema", "expectora", "esputo", "seca", "sangre", "hemopt", "amarill", "verde"]),
         _s("Tos de más de 2 semanas con pérdida de peso, fiebre o sudoración nocturna: descartar tuberculosis",
            "Tos prolongada", "GPC/NOM-006 (TB)", ALARMA, "alta", claves=["tuberculosis", "bajado de peso", "pérdida de peso", "sudorac", "en la noche", "baciloscopia"]),
         _s("Fiebre, disnea, dolor torácico o sibilancias acompañantes", "Tos", GPC, claves=["fiebre", "falta de aire", "disnea", "silbid", "sibilanc"]),
         _s("Tabaquismo, exposición a humo de leña, contactos enfermos", "Tos", GPC, claves=["fuma", "tabaqu", "leña", "humo", "contacto", "enfermo en casa"]),
     ]),
    ("fiebre",
     r"fiebre|calentura|temperatura|febril",
     "fiebre", [
         _s("Días de evolución, cifra máxima medida, patrón y respuesta a antipiréticos",
            "Fiebre", GPC, "interrogatorio", "alta", claves=["grados", "termómetro", "paracetamol", "antipirétic", "38", "39", "cuántos días"]),
         _s("Foco infeccioso: vías respiratorias, urinario, digestivo, piel, oídos",
            "Fiebre", GPC, "interrogatorio", "alta", claves=["garganta", "oído", "orina", "urinario", "tos", "diarrea", "piel"]),
         _s("Datos de alarma: exantema, rigidez de nuca, confusión, dificultad respiratoria, "
            "petequias o mala perfusión", "Fiebre", GPC, ALARMA, "alta", claves=["exantema", "rigidez de nuca", "confus", "dificultad respiratoria", "petequia", "manchas", "somnolien"]),
         _s("Viajes recientes y zona endémica: dengue, paludismo (según región)", "Fiebre", GPC, claves=["viaj", "dengue", "paludismo", "zona endémica"]),
     ]),
    ("cefalea",
     r"cefalea|dolor de cabeza|migrana|jaqueca|duele (la )?cabeza",
     "cefalea", [
         _s("Banderas rojas: inicio súbito «en trueno», el peor dolor de su vida, fiebre con rigidez de "
            "nuca, déficit neurológico, edad >50 de novo o empeoramiento progresivo",
            "Cefalea", GPC, ALARMA, "alta", claves=["trueno", "súbito", "peor dolor", "rigidez de nuca", "debilidad", "visión", "pérdida de fuerza", "progresiv"]),
         _s("Características: localización, tipo, duración, aura, náusea, foto/fonofobia",
            "Cefalea", GPC, "interrogatorio", "alta", claves=["punzante", "opresiv", "aura", "náusea", "luz", "fotofobia", "ruido", "fonofobia"]),
         _s("Frecuencia, consumo de analgésicos (cefalea por abuso) y desencadenantes", "Cefalea", GPC, claves=["cuántas veces", "frecuencia", "analgésic", "paracetamol", "ibuprofen", "desencaden"]),
         _s("Tomar TA y valorar exploración neurológica básica", "Cefalea", GPC, "exploracion", claves=["presión", "tensión", "neurológic", "fondo de ojo"]),
     ]),
    ("dolor_abdominal",
     r"dolor (de |en el )?(abdomen|abdominal|estomago|panza|vientre)|colico|dolor epigastrico|"
     r"duele (el |la )?(estomago|abdomen|panza|vientre|barriga)",
     "dolor abdominal", [
         _s("Localización, irradiación, tiempo, relación con alimentos y evolución",
            "Dolor abdominal", GPC, "interrogatorio", "alta", claves=["dónde", "localiz", "irradia", "comida", "aliment", "empeora"]),
         _s("Abdomen agudo: dolor intenso de inicio súbito, rebote, rigidez, ausencia de evacuaciones "
            "y gases, vómito persistente o sangrado", "Dolor abdominal", GPC, ALARMA, "alta", claves=["rebote", "rigid", "no evacua", "gases", "vómito", "sangre", "súbito", "duro"]),
         _s("Fiebre, vómito, cambios en evacuaciones, síntomas urinarios", "Dolor abdominal", GPC, claves=["fiebre", "vómito", "evacuac", "diarrea", "orina"]),
         _s("En mujer en edad fértil: fecha de última menstruación y posibilidad de embarazo",
            "Dolor abdominal", GPC, "interrogatorio", "alta", claves=["regla", "menstruac", "embaraz", "última regla", "prueba de embarazo"]),
     ]),
    ("diarrea",
     r"diarrea|evacuaciones (liquidas|sueltas)|gastroenteritis|vomito|vomitando",
     "diarrea o vómito", [
         _s("Número de evacuaciones/vómitos al día, tiempo, sangre o moco", "Diarrea/vómito", GPC,
            "interrogatorio", "alta", claves=["cuántas veces", "al día", "sangre", "moco", "líquid"]),
         _s("Datos de deshidratación: sed intensa, orina escasa u oscura, mucosas secas, "
            "somnolencia, llanto sin lágrimas en el niño", "Diarrea/vómito", GPC, ALARMA, "alta", claves=["sed", "orina", "boca seca", "mucosas", "somnol", "lágrimas", "deshidrat"]),
         _s("Alimentos sospechosos, agua, viajes, otros enfermos en casa", "Diarrea/vómito", GPC, claves=["comió", "aliment", "agua", "viaj", "enfermo en casa"]),
         _s("Tolerancia a la vía oral y uso de suero de rehidratación", "Diarrea/vómito", GPC, claves=["tolera", "suero", "vida suero", "líquidos", "vomita todo"]),
     ]),
    ("urinario",
     r"disuria|ardor al orinar|infeccion urinaria|orina|ivu\b|cistitis",
     "síntomas urinarios", [
         _s("Disuria, frecuencia, urgencia, hematuria y dolor lumbar", "Síntomas urinarios", GPC,
            "interrogatorio", "alta", claves=["ardor", "orinar", "frecuen", "urgencia", "sangre", "hematur", "lumbar"]),
         _s("Fiebre con dolor lumbar o vómito: sospecha de pielonefritis", "Síntomas urinarios", GPC,
            ALARMA, "alta", claves=["fiebre", "lumbar", "espalda", "vómito", "escalofrí", "puñopercusión"]),
         _s("Episodios previos, embarazo, diabetes, sondas o instrumentación", "Síntomas urinarios", GPC, claves=["antes", "previo", "embaraz", "diabet", "sonda"]),
     ]),
    ("lumbalgia",
     r"lumbalgia|dolor (de |en la )?espalda|dolor lumbar|espalda baja|ciatica|"
     r"duele (la )?espalda|duele (la )?cintura",
     "lumbalgia", [
         _s("Banderas rojas: trauma, fiebre, pérdida de peso, cáncer previo, déficit neurológico, "
            "retención urinaria o anestesia en silla de montar", "Lumbalgia", GPC, ALARMA, "alta", claves=["trauma", "golpe", "fiebre", "pérdida de peso", "cáncer", "tumor", "fuerza", "retenci", "silla de montar", "adormec"]),
         _s("Tiempo, irradiación a la pierna, relación con el esfuerzo y actividad laboral",
            "Lumbalgia", GPC, "interrogatorio", "alta", claves=["irradia", "pierna", "esfuerzo", "trabajo", "carga", "desde hace"]),
         _s("Tratamientos previos y limitación funcional", "Lumbalgia", GPC, claves=["tratamiento", "tomó", "fisioterapia", "limitac", "analgésic"]),
     ]),
    ("mareo",
     r"mareo|vertigo|desmayo|sincope|se desmayo",
     "mareo o síncope", [
         _s("Distinguir vértigo (giro), presíncope y desequilibrio; duración y desencadenantes",
            "Mareo", GPC, "interrogatorio", "alta", claves=["vueltas", "giro", "vértigo", "desequilibri", "al pararse", "cuánto dura"]),
         _s("Síncope con esfuerzo, palpitaciones previas o antecedente de muerte súbita familiar: "
            "descartar causa cardiaca", "Síncope", GPC, ALARMA, "alta", claves=["esfuerzo", "palpitac", "muerte súbita", "familiar", "electro", "corazón"]),
         _s("Fármacos (antihipertensivos, hipoglucemiantes), TA de pie y acostado", "Mareo", GPC, claves=["medicament", "pastilla", "presión", "de pie", "acostad"]),
     ]),
    ("faringitis",
     r"dolor de garganta|odinofagia|faringitis|amigdalas|anginas|duele (la )?garganta|"
     r"duele al (pasar|tragar)",
     "dolor de garganta", [
         _s("Fiebre, exudado amigdalino, adenopatías y ausencia de tos (criterios de Centor)",
            "Faringitis", GPC, "interrogatorio", "alta", claves=["fiebre", "placas", "exudad", "ganglio", "amígdal", "tos"]),
         _s("Dificultad para respirar o tragar saliva, trismus, voz apagada: valoración urgente",
            "Faringitis", GPC, ALARMA, "alta", claves=["respirar", "tragar", "saliva", "trismus", "voz", "babea"]),
     ]),
    ("control_cronico",
     r"control (de )?(presion|hipertension|diabetes|azucar)|revision (de )?rutina|chequeo|"
     r"seguimiento|receta|resurtir|control mensual",
     "control de enfermedad crónica", [
         _s("Cifras que trae registradas en casa y adherencia real al tratamiento",
            "Control de crónico", GPC, "interrogatorio", "alta", claves=["cifras", "registro", "medici", "presión", "glucosa", "olvid", "toma el medicamento"]),
         _s("Efectos adversos, olvidos de dosis y costo del tratamiento", "Control de crónico", GPC, claves=["efecto", "molestia", "olvid", "costo", "precio", "surtir"]),
         _s("Estudios de control vigentes y órganos blanco (pies, fondo de ojo, riñón en diabetes)",
            "Control de crónico", GPC, "tamizaje", "alta", claves=["estudios", "laboratorio", "pies", "fondo de ojo", "riñón", "creatinina", "glucosilada", "a1c"]),
     ]),
    ("embarazo",
     r"embaraz|prenatal|gestacion|control de embarazo",
     "control prenatal", [
         _s("Semanas de gestación, FUM, número de embarazos y control previo", "Embarazo", GPC,
            "interrogatorio", "alta", claves=["semanas", "última regla", "embarazos", "control prenatal", "gesta"]),
         _s("Datos de alarma obstétrica: sangrado, cefalea intensa, visión borrosa, edema súbito, "
            "disminución de movimientos fetales o salida de líquido", "Embarazo", GPC, ALARMA, "alta", claves=["sangrado", "dolor de cabeza", "visión", "edema", "hinchaz", "movimientos", "líquido"]),
         _s("Ácido fólico, hierro, vacunas y estudios del trimestre", "Embarazo", GPC, "tamizaje", claves=["ácido fólico", "hierro", "vacuna", "ultrasonido", "estudios"]),
     ]),
    ("animo",
     r"ansiedad|depresion|triste|animo|insomnio|estres|panico|no puede dormir",
     "estado de ánimo", [
         _s("Tiempo, impacto en el funcionamiento, sueño y apetito", "Salud mental", GPC,
            "interrogatorio", "alta", claves=["desde hace", "dormir", "sueño", "apetito", "trabajo", "ánimo", "ganas"]),
         _s("Ideación suicida: preguntar de forma directa", "Salud mental", GPC, ALARMA, "alta", claves=["suicid", "quitarse la vida", "hacerse daño", "no quiere vivir", "morir"]),
         _s("Consumo de alcohol y otras sustancias; red de apoyo", "Salud mental", GPC, claves=["alcohol", "droga", "fuma", "apoyo", "familia"]),
     ]),
    ("trauma",
     r"golpe|caida|se cayo|trauma|fractura|esguince|accidente|herida|quemadura",
     "lesión o trauma", [
         _s("Mecanismo, hora del evento y si hubo pérdida del estado de alerta",
            "Trauma", GPC, "interrogatorio", "alta", claves=["cómo fue", "se cayó", "golpe", "altura", "hora", "conocimiento", "desmay"]),
         _s("Deformidad, imposibilidad de apoyar o mover, déficit neurovascular distal: valorar imagen",
            "Trauma", GPC, ALARMA, "alta", claves=["deformidad", "apoyar", "mover", "radiograf", "pulso", "adormec", "morad"]),
         _s("Esquema de toxoide tetánico", "Trauma", "Cartilla Nacional", "vacuna", claves=["toxoide", "tétano", "vacuna"]),
     ]),
    ("dermatosis",
     r"roncha|salpullido|erupcion|comezon|prurito|mancha en la piel|dermatitis|rash",
     "lesión en piel", [
         _s("Tiempo, distribución, si da comezón y qué la desencadena", "Dermatosis", GPC,
            "interrogatorio", "alta", claves=["desde hace", "dónde", "comezón", "prurito", "cuerpo", "desencaden"]),
         _s("Fiebre con exantema, ampollas, afectación de mucosas o lesión que avanza rápido",
            "Dermatosis", GPC, ALARMA, "alta", claves=["fiebre", "ampolla", "boca", "mucosa", "avanza", "rápido"]),
         _s("Contacto con nuevos productos, fármacos recientes, casos en casa", "Dermatosis", GPC, claves=["crema", "jabón", "producto", "medicament", "contacto"]),
     ]),
    ("palpitaciones",
     r"palpitacion|taquicardia|late (muy )?rapido|corazon acelerado",
     "palpitaciones", [
         _s("Inicio y fin (súbito o gradual), duración, regularidad y desencadenantes",
            "Palpitaciones", GPC, "interrogatorio", "alta", claves=["súbito", "gradual", "cuánto dura", "rápido", "irregular", "desencaden"]),
         _s("Con síncope, dolor torácico o disnea: valoración urgente y ECG",
            "Palpitaciones", GPC, ALARMA, "alta", claves=["desmay", "síncope", "dolor", "falta de aire", "electro", "ecg"]),
         _s("Café, energizantes, tiroides, anemia y fármacos", "Palpitaciones", GPC, claves=["café", "energiz", "tiroid", "anemia", "medicament"]),
     ]),
]

_COMPILADOS = [(clave, re.compile(rx), etiqueta, sugs) for clave, rx, etiqueta, sugs in _PATRONES]


def sugerencias_por_motivo(motivo: str | None) -> dict:
    """Sugerencias dirigidas por el motivo de la visita.

    Devuelve `{"motivo", "reconocidos", "etiquetas", "sugerencias"}`. Si el
    motivo no coincide con nada conocido, `sugerencias` va vacía a propósito:
    inventar preguntas a partir de un texto que no entendemos sería peor que no
    aportar nada.
    """
    texto = (motivo or "").strip()[:MAX_MOTIVO]
    if not texto:
        return {"motivo": "", "reconocidos": [], "etiquetas": [], "sugerencias": []}

    norm = _norm(texto)
    reconocidos, etiquetas, sugerencias = [], [], []
    for clave, rx, etiqueta, sugs in _COMPILADOS:
        if rx.search(norm):
            reconocidos.append(clave)
            etiquetas.append(etiqueta)
            sugerencias.extend(sugs)

    # Las alarmas primero: son lo que no se puede pasar por alto.
    sugerencias.sort(key=lambda s: 0 if s["categoria"] == ALARMA else 1)
    return {"motivo": texto, "reconocidos": reconocidos,
            "etiquetas": etiquetas, "sugerencias": sugerencias}


# ------------------------------------------------ preguntas propuestas por el LLM
FUENTE_LLM = "MEGI · propuesta del modelo"
_CATEGORIAS_LLM = ("interrogatorio", ALARMA, "exploracion")
MAX_PREGUNTAS_LLM = 6


# Palabras que aparecen en casi cualquier pregunta clínica y no distinguen una
# de otra: sin quitarlas, «¿Desde cuándo tiene fiebre?» y «¿Desde cuándo tiene
# tos?» parecerían la misma.
_VACIAS = {"desde", "cuando", "como", "donde", "tiene", "tener", "hubo", "algun", "alguna",
           "algo", "sobre", "para", "cual", "cuales", "esta", "estan", "siente", "presenta",
           "hace", "cuanto", "cuanta", "veces", "ultimamente", "actualmente", "paciente"}


def _huella(texto: str) -> set:
    """Palabras significativas, para detectar una pregunta repetida aunque
    cambie la redacción."""
    return {w for w in re.findall(r"[a-z0-9]{4,}", _norm(texto)) if w not in _VACIAS}


def desde_llm(items, motivo: str, ya_listadas: list | None = None) -> list:
    """Convierte las `preguntas_motivo` del LLM al formato del panel y del
    seguimiento en vivo, con las mismas defensas que el resto de sugerencias:

    - solo texto, categoría válida y claves cortas (lo demás se tira);
    - fuente propia y visible (`FUENTE_LLM`): el médico sabe que es propuesta,
      no guía; nunca se mezclan con las de `_PATRONES`;
    - se descartan las que repiten una sugerencia ya listada (por solape de
      palabras), para no ver dos veces la misma alarma;
    - las alarmas van primero y la lista se acota a `MAX_PREGUNTAS_LLM`.

    Las claves las propone el modelo: son las palabras que se DIRÍAN en la
    consulta al tocar el tema, y `cobertura.py` las usa igual que las nuestras.
    """
    motivo = (motivo or "").strip()[:MAX_MOTIVO]
    if not motivo or not isinstance(items, list):
        return []
    huellas = [_huella(s.get("texto", "")) for s in (ya_listadas or [])]
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        texto = str(it.get("texto") or "").strip()[:220]
        if not texto:
            continue
        h = _huella(texto)
        if any(h and len(h & prev) >= max(3, len(h) // 2) for prev in huellas):
            continue                                   # ya está, con otras palabras
        huellas.append(h)
        cat = str(it.get("categoria") or "interrogatorio").strip().lower()
        cat = cat if cat in _CATEGORIAS_LLM else "interrogatorio"
        claves = [_norm(str(c))[:40] for c in (it.get("claves") or []) if str(c).strip()][:4]
        out.append(_s(texto, f"Sobre el motivo: {motivo}", FUENTE_LLM, categoria=cat,
                      prioridad="alta" if cat == ALARMA else "media", claves=claves))
    out.sort(key=lambda s: 0 if s["categoria"] == ALARMA else 1)
    return out[:MAX_PREGUNTAS_LLM]
