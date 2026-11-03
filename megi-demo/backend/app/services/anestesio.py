"""Catálogo de MEGI Anestesiología: los modelos del proyecto `electros/anestesio`
tal como están registrados en su `modelos/registro/modelos.json` (revisión del
5-oct-2026 y altas posteriores hasta el 11-oct-2026).

Es PRESENTACIÓN: aquí no corre ningún modelo. Los estados vienen del registro y
de `NOMBRES_MODELOS.md` del proyecto, sin maquillar: «experimental», «alpha»,
«prototipo» o «reglas» significan exactamente eso, y ninguno acredita
validación clínica. El acceso a esta sección está restringido por usuario
(`users.acceso_anestesio`); los administradores siempre lo tienen.
"""
from __future__ import annotations

AVISO_RESTRINGIDO = (
    "Sección restringida. Estos modelos trabajan sobre señales de quirófano y decisiones críticas en el tiempo "
    "(hipotensión, ventilación, profundidad anestésica, electrolitos, extubación). Usados fuera de contexto o sin "
    "formación pueden inducir decisiones peligrosas. Por eso solo un número reducido de médicos tiene acceso, "
    "ninguno opera en lazo cerrado, y todos son apoyo con humano en el lazo: el anestesiólogo decide."
)

# tipo: aprendido | reglas. estado: experimental | alpha | prototipo | reglas | cerrado
CATALOGO = [
    # ----------------------------------------------------------- aprendidos
    {"clave": "hipotension", "nombre": "Megi_Hipotension_anex", "tipo": "aprendido", "area": "Hemodinamia", "estado": "experimental",
     "variantes": ["H5 (5 min)", "H15 (15 min)"],
     "que_hace": "Predice hipotensión intraoperatoria a 5 y 15 minutos a partir de la onda de la línea arterial más el contexto del caso (GBM). Dos modelos, uno por horizonte.",
     "datos": "VitalDB (línea arterial, Seúl). Documentada la trampa metodológica del HPI de Edwards.",
     "limites": "Experimental; sin validación prospectiva ni local."},
    {"clave": "hipotension_arterial", "nombre": "Megi_Hipotension_anex_only_art", "tipo": "aprendido", "area": "Hemodinamia", "estado": "experimental",
     "variantes": ["H5 (5 min)", "H15 (15 min)"],
     "que_hace": "Misma predicción de hipotensión, pero solo con la onda arterial, sin contexto clínico: sirve para medir cuánto aporta la onda por sí sola.",
     "datos": "VitalDB.", "limites": "Experimental; comparación de referencia, no producto."},
    {"clave": "bis", "nombre": "Megi_BIS_anex", "tipo": "aprendido", "area": "Profundidad anestésica", "estado": "experimental",
     "variantes": ["1 min", "2 min", "5 min"],
     "que_hace": "Tendencia del índice biespectral (BIS) a 1, 2 y 5 minutos a partir de la historia de infusión y del propio BIS (GRU).",
     "datos": "VitalDB (BIS + EEG + bombas TCI de propofol y remifentanilo).", "limites": "Experimental; cadena de limpieza auditada, sin uso clínico."},
    {"clave": "cal_ecg", "nombre": "Megi_cal_ecg_anex", "tipo": "aprendido", "area": "ECG perioperatorio", "estado": "experimental",
     "que_hace": "Calidad de la señal de ECG de monitor: decide si un segmento es legible antes de que lo lea cualquier otro modelo. Componente separado.",
     "datos": "VitalDB.", "limites": "Experimental."},
    {"clave": "ecg_v1", "nombre": "Megi_ecg_v1_anex", "tipo": "aprendido", "area": "ECG perioperatorio", "estado": "experimental",
     "que_hace": "Lector de ECG de monitor de 2 derivaciones (II/V5, o solo II), destilado del ensamble de 12 derivaciones megi-ecg-v0.5 (38 hallazgos).",
     "datos": "Destilación del motor ECG; VitalDB.", "limites": "Experimental; hereda la calibración del maestro como aproximación."},
    {"clave": "multi_ecg", "nombre": "Megi_multi_ecg_v1_anex", "tipo": "aprendido", "area": "ECG perioperatorio", "estado": "experimental",
     "que_hace": "Variante de 4 derivaciones (I/II/V4/V5) del lector de monitor. Se activa explícitamente.",
     "datos": "VitalDB.", "limites": "Reutiliza la calibración de ecg_v1; no tiene calibración propia."},
    {"clave": "st", "nombre": "Megi_ST_v1", "tipo": "aprendido", "area": "ECG perioperatorio", "estado": "experimental",
     "que_hace": "Detector aprendido de cambio del segmento ST en el monitor (isquemia intraoperatoria).",
     "datos": "VitalDB.", "limites": "Experimental."},
    {"clave": "extubacion72", "nombre": "Megi_extubacion72_light_alpha", "tipo": "aprendido", "area": "Ventilación / UCI", "estado": "alpha",
     "variantes": ["ensamble LGB + TabDPT a 72 h", "prototipo anterior LR5 a 48 h (motor/extubacion.py)"],
     "que_hace": "Riesgo de fallo de extubación a 72 horas con variables tabulares (ensamble LightGBM + TabDPT). Convive con el prototipo previo de regresión logística a 48 h.",
     "datos": "Evaluación fuera de pliegue (OOF); MIMIC-IV pendiente de credencial para escala.", "limites": "Prototipo OOF; sin despliegue clínico."},
    {"clave": "electrolitos_ecg", "nombre": "Megi_Electrolitos_ECG_sueco_alpha", "tipo": "aprendido", "area": "Electrolitos desde ECG", "estado": "alpha",
     "que_hace": "Estima potasio y calcio desde el ECG de 12 derivaciones con extractores suecos congelados y salidas ajustadas localmente.",
     "datos": "310 pares reales de 68 pacientes (MIMIC) para el ajuste; 800 035 ondas MIMIC-IV-ECG disponibles sin enlazar aún.",
     "limites": "Potasio mejora puntualmente frente a controles constantes; el calcio no los supera. Solo investigación."},
    {"clave": "electrolitos_monitor", "nombre": "Megi_Electrolitos_monitor_alpha", "tipo": "aprendido", "area": "Electrolitos desde ECG", "estado": "alpha",
     "que_hace": "Potasio y calcio ionizado desde el ECG II/V5 del monitor de quirófano, en adultos.",
     "datos": "VitalDB: 8 208 extracciones de 3 071 pacientes.",
     "limites": "K alto AUC 0.708 en prueba con seis positivos; sin superioridad robusta de MAE frente a la mediana. Investigación; no integrado en alarmas."},
    {"clave": "potasio_enecg", "nombre": "Megi_Potasio_EnECG_sueco_alpha", "tipo": "aprendido", "area": "Electrolitos desde ECG", "estado": "alpha",
     "que_hace": "Clasificador binario de hiperkalemia desde ECG basado en la referencia EnECG.",
     "datos": "Pesos suecos; referencia del autor no verificada por completo.", "limites": "Prototipo de investigación."},
    {"clave": "potasio_finetune", "nombre": "Megi_Potasio_sueco_finetune_alpha", "tipo": "aprendido", "area": "Electrolitos desde ECG", "estado": "alpha",
     "que_hace": "Variante del anterior con ajuste fino parcial sobre datos locales.",
     "datos": "Como el anterior.", "limites": "Referencias EnECG no verificadas por completo; investigación."},
    {"clave": "lactato", "nombre": "Megi_Lactato_monitor_alpha", "tipo": "aprendido", "area": "Perfusión", "estado": "alpha",
     "que_hace": "Probabilidad de que el siguiente lactato sea ≥ 2 o ≥ 4 mmol/L a partir del monitor intraoperatorio (GBM).",
     "datos": "VitalDB.",
     "limites": "AUROC 0.926 / 0.986 en prueba, pero el último lactato conocido solo ya da 0.917 / 0.987: el monitor casi no añade señal. Sin uso clínico."},
    # ----------------------------------------------------------- reglas y cálculos (deterministas)
    {"clave": "gasometria", "nombre": "Megi_Gasometria_reglas", "tipo": "reglas", "area": "Gasometría", "estado": "reglas",
     "que_hace": "Interpretación ácido-base completa: trastorno primario, compensación esperada (Winter y resto), brecha aniónica corregida por albúmina, delta ratio, gap osmolar, Stewart (SIDa, SIDe, SIG), exceso de base, gradiente A-a, P/F, CaO₂; alfa-stat/pH-stat; perfiles de embarazo y de Ciudad de México a 2 240 m.",
     "datos": "Fórmulas publicadas; validación con casos tipo y gasometrías de VitalDB.", "limites": "Determinista: MEGI IA explica, nunca calcula. Venosa→arterial solo con intervalos."},
    {"clave": "electrolitos", "nombre": "Megi_Electrolitos_reglas", "tipo": "reglas", "area": "Electrolitos", "estado": "reglas",
     "que_hace": "Reglas de sodio, potasio, calcio y magnesio con semáforo perioperatorio; Adrogué-Madias, déficit de agua libre, límites de corrección, pautas de hiperkalemia con cambios ECG.",
     "datos": "Guías ESE 2022/2026, UKKA 2023.", "limites": "Determinista; las pautas citan su guía."},
    {"clave": "ventilacion", "nombre": "Megi_Ventilacion_reglas", "tipo": "reglas", "area": "Ventilación", "estado": "reglas",
     "que_hace": "Mecánica respiratoria: peso predicho, driving pressure, compliance, resistencia, constante de tiempo, potencia mecánica, ventilatory ratio, ROX, espacio muerto; metas por escenario (intraop, unipulmonar, obeso, pediátrico, SDRA, destete, CNAF) y alarmas AARC 2024.",
     "datos": "Validado recalculando sobre el ventilador Primus de VitalDB.", "limites": "Determinista; nunca lazo cerrado."},
    {"clave": "arterial", "nombre": "Megi_Arterial_reglas", "tipo": "reglas", "area": "Hemodinamia", "estado": "reglas",
     "que_hace": "Mediciones y calidad de la onda de línea arterial: presiones, variación de presión de pulso (PPV) con banderas de validez, amortiguación.",
     "datos": "VitalDB.", "limites": "Determinista."},
    {"clave": "perioperatorio", "nombre": "Megi_Riesgo_perioperatorio", "tipo": "reglas", "area": "Riesgo perioperatorio", "estado": "reglas",
     "que_hace": "Scores perioperatorios publicados: RCRI, SORT, ARISCAT, LAS VEGAS y reglas asociadas.",
     "datos": "Fórmulas publicadas con su referencia.", "limites": "Sin recalibración local todavía (falta cohorte mexicana con desenlace)."},
    {"clave": "asincronia", "nombre": "Megi_Asincronia_reglas", "tipo": "reglas", "area": "Ventilación", "estado": "reglas",
     "que_hace": "Patrones exploratorios de asincronía paciente-ventilador sobre ondas de presión y flujo (reglas tipo ventmap).",
     "datos": "CCVW-ICU, Kaggle Ventilator, ondas de VitalDB.", "limites": "Sin modelo aprendido; el 1D-CNN está pendiente de etiquetado propio."},
    {"clave": "tiva", "nombre": "Megi_TIVA_PKPD", "tipo": "reglas", "area": "TIVA", "estado": "reglas",
     "que_hace": "Simulación farmacocinética/farmacodinámica de propofol y remifentanilo con los modelos publicados: Marsh, Schnider, Eleveld, Minto, Hannivoort, Bouillon.",
     "datos": "Modelos publicados; contraste con bombas TCI de VitalDB.", "limites": "Simulación; no controla bombas."},
    {"clave": "gasto", "nombre": "Megi_Gasto_tendencia", "tipo": "reglas", "area": "Hemodinamia", "estado": "cerrado",
     "que_hace": "Índices y tendencia del contorno de pulso como aproximación al gasto cardíaco.",
     "datos": "VitalDB contra Vigilance.", "limites": "Estudio de medición cerrado el 1-oct-2026: ningún baseline superó gasto constante; sin predictor entrenado."},
]

TOTAL_MODELOS = 26        # 21 familias: hipotensión ×2 horizontes ×2 familias, BIS ×3 horizontes, extubación 72 h + prototipo 48 h


def catalogo() -> dict:
    return {"aviso": AVISO_RESTRINGIDO, "familias": len(CATALOGO), "total_modelos": TOTAL_MODELOS,
            "registro": "electros/anestesio/modelos/registro/modelos.json (cambio 20261005_nombres_megi + altas 6, 7, 8 y 11-oct-2026)",
            "modelos": CATALOGO}
