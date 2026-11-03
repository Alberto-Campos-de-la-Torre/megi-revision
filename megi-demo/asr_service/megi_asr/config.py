"""Configuración y arranque del motor (rutas, modelos, prompts).

Se importa ANTES que nada: inyecta el motor en `sys.path`, así que cualquier
módulo que use `normalization`/`identifiers`/`streaming` debe importar esto
primero (lo hace `megi_asr.engine`)."""
import os
import sys
from pathlib import Path

# --- localizar el repo del motor e inyectarlo en sys.path (sin vendorizar) ---
# FUENTE CANÓNICA DEL MOTOR: el bundle `megi final/models_megi/engine` (§4 de
# la revisión 2026-07-12: había doble copia y divergían). El default histórico
# apuntaba a `~/Desktop/entrenamiento mlx`, que ya no existe: si la ruta no
# está, se falla AQUÍ con instrucciones en vez de reventar más abajo con un
# `ModuleNotFoundError: identifiers` que no dice nada.
ENGINE_DIR = os.environ.get("MEGI_ENGINE_DIR", "").strip()
if not ENGINE_DIR or not Path(ENGINE_DIR).is_dir():
    raise RuntimeError(
        "MEGI_ENGINE_DIR no apunta a un motor válido: %r\n"
        "El motor canónico es el bundle:\n"
        '  export MEGI_ENGINE_DIR="$MEGI_BUNDLE/models_megi/engine"\n'
        "(ver README, sección «Cómo correr»; o usa ./run_asr_service.sh)."
        % (ENGINE_DIR or "<sin definir>",)
    )
if ENGINE_DIR not in sys.path:
    sys.path.insert(0, ENGINE_DIR)

# ASR general (ruta chunked-batch, que es la fuente de verdad del transcript).
# v2.1 = LoRA megi-medical-v2/checkpoint-7340 fusionado sobre whisper-large-v3 a
# escala 0.75. WER 10.79 % frente al 22.77 % de v1.5 sobre las consultas reales
# del barrido (ver merge_info.json del propio modelo). La escala importa: el
# MISMO LoRA a 2.0 (alpha/rank) daba 24.11 %, peor que v1.5.
# Para volver a v1.5 sin tocar código:
#   MEGI_ASR_GENERAL_MODEL="$MEGI_ENGINE_DIR/megi-medical-v1.5-preview-merged"
GENERAL_MODEL = os.environ.get(
    "MEGI_ASR_GENERAL_MODEL", str(Path(ENGINE_DIR) / "megi-medical-v2.1-a075-merged")
)
IDENTIFIER_MODEL = os.environ.get(
    "MEGI_ASR_IDENTIFIER_MODEL",
    str(Path(ENGINE_DIR) / "megi-medical-v1.6A-preview-merged-ckpt750"),
)
METAL_CACHE_LIMIT = int(os.environ.get("MEGI_METAL_CACHE_LIMIT_BYTES", 1024 ** 3))
# Ancla de rutas: el DIRECTORIO DEL SERVICIO (asr_service/), no el del módulo.
# Al partir server.py, todo `__file__` relativo se movió un nivel: sin esto,
# los logs, la allowlist de audio y el modelo de hablante apuntan a rutas que
# no existen (y la allowlist dejaría de proteger lo que debe).
SERVICE_DIR = Path(__file__).resolve().parent.parent
LOG_DIR = Path(os.environ.get("MEGI_ASR_LOG_DIR", str(SERVICE_DIR / "logs")))
LOG_DIR.mkdir(parents=True, exist_ok=True)
IDENTIFIER_PROMPT = (
    "Dictado de identificador mexicano: CURP, NSS, INE, OCR, letras deletreadas, "
    "numeros y clarificadores como be de burro, ve de vaca, uve, i griega."
)

# Prompt clínico del webui de producción (mejora vocabulario médico/administrativo).
DEFAULT_CLINICAL_PROMPT = os.environ.get(
    "MEGI_CLINICAL_PROMPT",
    "Dictado medico. Siglas frecuentes: RAFI, IMSS, ISSSTE, INE, CURP, "
    "EPOC, VIH, SIDA, BNP, NYHA, CIE-10. Vocabulario: farmacos, dosis "
    "en mg/mcg/ml, lateralidad izquierda y derecha. "
    "Contexto administrativo: razon social S.A. de C.V., empresa, NSS, "
    "numeros de identificacion como secuencia continua de digitos sin "
    "separar en grupos. Patronimicos en espanol.",
)
WARMUP_S = 6.0
POSTROLL_S = 4.0

# Prompt para COMANDOS de voz (route="voice_command"): whisper nunca vio la
# palabra "MEGI" en entrenamiento y la escribe "Meji/Megui"; el initial_prompt
# la sesga a la forma canonica. Ejemplos = vocabulario tipico de comandos.
VOICE_COMMAND_PROMPT = os.environ.get(
    "MEGI_COMMAND_PROMPT",
    'Comando de voz para el asistente MEGI. Ejemplos: "MEGI, ir a pacientes." '
    '"MEGI, ir a agenda." "MEGI, pausar escucha." "MEGI, continuar escucha." '
    '"MEGI, finaliza la consulta." "MEGI, abrir paciente." "MEGI, guardar borrador." '
    '"MEGI, cambiar diagnostico principal a I10." "MEGI, agrega a plan."',
)
# VAD min_silence afinable en vivo sin tocar código (webui usa 900ms; en algunos
# audios rápidos 600 recupera más del medio). Probar en vivo y ajustar.
_VAD_MIN_SILENCE_MS = int(os.environ.get("MEGI_STREAM_VAD_MIN_SILENCE_MS", "900"))
