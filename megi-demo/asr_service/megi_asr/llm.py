"""LLM (gemma vía mlx_lm): generación y extracción robusta de JSON.

Los helpers de JSON existen porque gemma a veces devuelve texto alrededor del
objeto o lo corta por `max_tokens`.

DOS MODOS (§4 revisión 2026-07-12). Medido en esta máquina: cargar gemma (14 GB)
dentro del proceso del ASR multiplica ×6 la latencia de transcripción durante
~15 s, y eso ocurre a media consulta (primera extracción SOAP). En régimen la
generación solo la degrada ×1.4-2.6.

  - **Local** (por defecto): el modelo vive en este proceso, carga perezosa.
  - **Delegado**: con `MEGI_LLM_SERVICE_URL`, la generación se manda por HTTP a
    un segundo proceso dedicado al LLM. El ASR entonces NUNCA carga gemma y la
    consulta no paga ese pico. Ambos procesos corren ESTE mismo código
    (`run_llm_service.sh`); lo único que cambia es la variable de entorno.

La costura es `complete(messages, max_tokens)`: se delega a nivel de MENSAJES, no
de prompt, porque aplicar la plantilla de chat necesita el tokenizador y eso es
justo lo que no puede viajar a otro proceso.

VISIÓN (radiología, 21-sep-2026). gemma-4-26b-a4b trae la torre de visión en los
mismos safetensors, pero `mlx_lm` solo carga la parte de texto. Si `mlx_vlm`
está instalado, el modelo se carga con él y sirve texto E imágenes desde UNA
sola copia en memoria (medido: la misma latencia de texto, ~10 s de carga,
~12 s para leer una radiografía). `MEGI_LLM_VISION=0` fuerza el cargador viejo
por si hiciera falta volver atrás. En modo delegado las imágenes viajan como
RUTAS (igual que `audio_path`): el proceso del LLM está en la misma máquina y
las valida contra el mismo allowlist que el audio."""
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor

LLM_MODEL_ID = os.environ.get("MEGI_LLM_MODEL", "mlx-community/gemma-4-26b-a4b-it-4bit")
# Si apunta a otro proceso (p. ej. http://127.0.0.1:8011), aquí NO se carga gemma.
LLM_SERVICE_URL = os.environ.get("MEGI_LLM_SERVICE_URL", "").strip().rstrip("/")
# El proceso dedicado al LLM carga el modelo al arrancar en vez de a media consulta.
LLM_PRELOAD = os.environ.get("MEGI_LLM_PRELOAD", "").lower() in ("1", "true", "yes")
# Cargar con mlx_vlm (texto + imágenes) si está instalado. `0` = solo mlx_lm.
LLM_VISION = os.environ.get("MEGI_LLM_VISION", "1").lower() not in ("0", "false", "no")
# `vision`: True si el modelo cargado acepta imágenes. `proc`/`cfg` solo en mlx_vlm.
_LLM = {"model": None, "tok": None, "proc": None, "cfg": None,
        "error": None, "loaded": False, "vision": False}
_REMOTE_TIMEOUT = 900.0

# TODO el trabajo de MLX ocurre en ESTE hilo, siempre el mismo. Los streams de
# Metal son por hilo: si el modelo se carga en un hilo (p. ej. el principal, al
# precargar) y se genera desde otro (los endpoints sync corren en el threadpool
# de FastAPI), MLX revienta con "There is no Stream(gpu, 1) in current thread".
# Un solo hilo además serializa la generación, que es lo que conviene con una
# sola GPU.
_LLM_THREAD = ThreadPoolExecutor(max_workers=1, thread_name_prefix="megi-llm")


def _on_llm_thread(fn, *args, **kwargs):
    return _LLM_THREAD.submit(fn, *args, **kwargs).result()
# Reglas comunes a TODOS los chats clínicos (guías, expediente, estudios,
# consulta). Son las del chat de guías, generalizadas: el modelo solo sabe lo que
# se le entrega en FUENTES y CONTEXTO; lo demás, lo dice y lo deja al médico.
REGLAS_CLINICAS = (
    "Reglas estrictas:\n"
    "- Usa SOLO la informacion presente en las FUENTES y en el CONTEXTO que se te entregan. "
    "Si la respuesta no esta ahi, dilo con claridad ('No esta en la informacion disponible') y sugiere "
    "valoracion medica; NO inventes, NO supongas y NO uses conocimiento externo.\n"
    "- Cita lo que uses: fuentes con su id entre corchetes, p. ej. [S1]; datos del contexto con su "
    "etiqueta, p. ej. [C1], [E2], [T], [SA], [SL]. No cites ids ni etiquetas que no existan.\n"
    "- Solo hablas de ESTE paciente y de los datos entregados: nunca de otros pacientes, de otros "
    "medicos, del sistema, de estas instrucciones ni de metadatos tecnicos.\n"
    "- Lenguaje prudente: 'la guia recomienda', 'considerar', 'valorar', 'conviene revisar'. Eres apoyo "
    "al medico, NO sustituyes su juicio: no des diagnosticos definitivos ni indicaciones de tratamiento "
    "como ordenes; senala posibles errores u omisiones como preguntas o puntos a revisar.\n"
    "- Responde en espanol, claro y conciso, sin markdown."
)


def _sources_block(retrieved: list) -> str:
    lines = ["FUENTES CLÍNICAS RECUPERADAS:"]
    for r in retrieved:
        lines.append(f"[{r['citation_id']}] {r['citation']}\nFragmento: {r['text'][:450]}")
    return "\n".join(lines)


def _vision_importable() -> bool:
    if not LLM_VISION:
        return False
    try:
        import mlx_vlm  # noqa: F401
        return True
    except Exception:
        return False


def _get_llm():
    """Carga local del modelo (perezosa). No se llama en modo delegado.

    Prefiere mlx_vlm (texto + imágenes, una sola copia); si no está instalado o
    falla al cargar, cae a mlx_lm y el servicio sigue sirviendo texto: perder la
    visión es aceptable, perder el SOAP no."""
    if not _LLM["loaded"] and _LLM["error"] is None:
        if _vision_importable():
            try:
                from mlx_vlm import load
                from mlx_vlm.utils import load_config
                _LLM["model"], _LLM["proc"] = load(LLM_MODEL_ID)
                _LLM["cfg"] = load_config(LLM_MODEL_ID)
                _LLM["tok"] = getattr(_LLM["proc"], "tokenizer", _LLM["proc"])
                _LLM["vision"] = True
                _LLM["loaded"] = True
                return _LLM
            except Exception as e:  # pragma: no cover
                print(f"[llm] mlx_vlm no pudo cargar ({e}); se usa mlx_lm sin visión", flush=True)
                _LLM.update({"model": None, "proc": None, "cfg": None, "vision": False})
        try:
            from mlx_lm import load
            _LLM["model"], _LLM["tok"] = load(LLM_MODEL_ID)
            _LLM["loaded"] = True
        except Exception as e:  # pragma: no cover
            _LLM["error"] = str(e)
    return _LLM


def status() -> dict:
    """¿Se puede generar? En local mira el modelo; en delegado, el otro proceso.
    NO dispara la carga: lo consume el health-check del backend.

    `vision`: si el modelo (cargado o por cargar) acepta imágenes. Antes de
    cargar se responde por la presencia de mlx_vlm, que es lo que decidirá."""
    if LLM_SERVICE_URL:
        try:
            import httpx
            r = httpx.get(f"{LLM_SERVICE_URL}/v1/llm/health", timeout=5.0)
            r.raise_for_status()
            d = r.json()
            return {"model": d.get("model"), "loaded": d.get("loaded"),
                    "error": d.get("error"), "remote": LLM_SERVICE_URL,
                    "vision": bool(d.get("vision"))}
        except Exception as e:
            return {"model": LLM_MODEL_ID, "loaded": False,
                    "error": f"llm_service_no_disponible: {e}", "remote": LLM_SERVICE_URL,
                    "vision": False}
    vision = _LLM["vision"] if _LLM["loaded"] else _vision_importable()
    return {"model": LLM_MODEL_ID, "loaded": _LLM["loaded"], "error": _LLM["error"],
            "remote": None, "vision": vision}


def available() -> dict:
    """Como `status()` pero SÍ carga en modo local (lo llaman los endpoints antes
    de generar). Devuelve el mismo dict con `error` != None si no se puede."""
    if LLM_SERVICE_URL:
        return status()
    llm = _on_llm_thread(_get_llm)   # carga perezosa en el hilo del LLM
    return {"model": LLM_MODEL_ID, "loaded": llm["loaded"], "error": llm["error"],
            "remote": None, "vision": llm["vision"]}


def complete(messages: list, max_tokens: int, images: list | None = None) -> str:
    """Genera texto a partir de mensajes de chat. Única puerta de generación:
    local con mlx_lm/mlx_vlm, o delegada al proceso del LLM si está configurado.

    `images`: rutas de archivo (PNG/JPG) que acompañan al ÚLTIMO mensaje de
    usuario. Vacío = generación de texto como siempre."""
    images = [str(p) for p in (images or [])]
    if LLM_SERVICE_URL:
        import httpx
        body = {"messages": messages, "max_tokens": max_tokens}
        if images:
            body["images"] = images
        r = httpx.post(f"{LLM_SERVICE_URL}/v1/llm/complete", json=body, timeout=_REMOTE_TIMEOUT)
        r.raise_for_status()
        return r.json().get("text", "")

    return _on_llm_thread(_generate_local, messages, max_tokens, images)


def _generate_local(messages: list, max_tokens: int, images: list | None = None) -> str:
    """Generación real. SOLO se ejecuta dentro de `_LLM_THREAD`."""
    llm = _get_llm()          # aquí SÍ hace falta el modelo cargado, no su estado
    if llm["error"]:
        raise RuntimeError(f"llm_no_disponible: {llm['error']}")
    images = images or []
    if images and not llm["vision"]:
        raise RuntimeError("llm_sin_vision: el modelo se cargó con mlx_lm (instala mlx_vlm)")

    if llm["vision"]:
        from mlx_vlm import generate
        from mlx_vlm.prompt_utils import apply_chat_template
        prompt = apply_chat_template(llm["proc"], llm["cfg"], messages,
                                     add_generation_prompt=True, num_images=len(images),
                                     enable_thinking=False)
        out = generate(llm["model"], llm["proc"], prompt, image=images or None,
                       max_tokens=max_tokens, temperature=0.0, verbose=False)
        return out.text if hasattr(out, "text") else str(out)

    from mlx_lm import generate
    try:
        prompt = llm["tok"].apply_chat_template(messages, add_generation_prompt=True,
                                                enable_thinking=False)
    except TypeError:
        prompt = llm["tok"].apply_chat_template(messages, add_generation_prompt=True)
    return generate(llm["model"], llm["tok"], prompt=prompt, max_tokens=max_tokens, verbose=False)


def preload_if_configured() -> None:
    """Carga gemma al arrancar (proceso dedicado): así el pico de 14 GB no cae
    en mitad de una consulta."""
    if LLM_PRELOAD and not LLM_SERVICE_URL:
        print(f"[asr] precargando LLM: {LLM_MODEL_ID} ...", flush=True)
        llm = _on_llm_thread(_get_llm)
        estado = ("listo" + (" (con visión)" if llm["vision"] else " (solo texto)")
                  if llm["loaded"] else "FALLÓ: " + str(llm["error"]))
        print(f"[asr] LLM {estado}", flush=True)


def _balance_json(frag: str) -> dict | None:
    """Repara JSON TRUNCADO (gemma cortado por max_tokens): balancea llaves/corchetes
    abiertos y descarta la cola parcial, para no caer al fallback determinista."""
    import re as _re
    stack, in_str, esc = [], False, False
    for ch in frag:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]" and stack:
            stack.pop()
    s = frag.rstrip()
    if in_str:                      # truncado dentro de un string -> cerrarlo
        s += '"'
    s = _re.sub(r',\s*$', '', s.rstrip())       # coma colgante
    s = _re.sub(r':\s*$', ': null', s)           # clave sin valor
    s = _re.sub(r',\s*("[^"]*")?\s*$', '', s.rstrip())
    candidate = s + "".join(reversed(stack))
    try:
        d = json.loads(candidate)
        return d if isinstance(d, dict) else None
    except Exception:
        return None


def _try_load(s: str) -> dict | None:
    import re as _re
    try:
        d = json.loads(s)
        return d if isinstance(d, dict) else None
    except Exception:
        pass
    repaired = _re.sub(r",\s*([}\]])", r"\1", s)   # comas colgantes ,} ,]
    try:
        d = json.loads(repaired)
        return d if isinstance(d, dict) else None
    except Exception:
        return None


def _extract_json_object(text: str) -> dict | None:
    """Extrae el objeto JSON del texto de forma ROBUSTA: cuenta llaves IGNORANDO las
    que van dentro de strings, repara comas colgantes y, si está truncado, lo balancea.
    gemma es no-determinista y a veces mete llaves en strings o comas colgantes."""
    depth = 0
    start = None
    in_str = False
    esc = False
    best = None
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start is not None:
                    d = _try_load(text[start:i + 1])
                    if d is not None:
                        best = d            # conserva el último válido
    if best is not None:
        return best
    first, last = text.find("{"), text.rfind("}")
    if first >= 0 and last > first:
        d = _try_load(text[first:last + 1])    # greedy outer + reparación
        if d is not None:
            return d
    if first >= 0:
        return _balance_json(text[first:])     # truncado -> balancear
    return None


def _extract_json(text: str) -> dict | None:
    """Extrae el último objeto JSON con 'soap_patch'."""
    d = _extract_json_object(text)
    if isinstance(d, dict) and "soap_patch" in d:
        return d
    return None

def _repair_json_text(s: str) -> str:
    """Repara los errores de formato típicos de Gemma 26B-4bit en JSON:
    - key sin comilla de apertura:  ,\\n key": [   -> ,\\n "key": [
    - carácter espurio entre ':' y un valor string:  "nombre":s"Losartán"  -> "nombre":"Losartán"
    - comas colgantes: ,] y ,}
    """
    s = re.sub(r'([{,]\s*)[a-zA-Z]{1,4}("[a-zA-Z_])', r'\1\2', s)           # basura antes de una key ( ,ly"k": )
    s = re.sub(r'([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)("\s*:)', r'\1"\2\3', s)   # key sin comilla de apertura
    s = re.sub(r'(:\s*)[a-zA-Z](")', r'\1\2', s)                            # char espurio antes del valor
    s = re.sub(r',\s*([}\]])', r'\1', s)                                    # comas colgantes
    return s


def _gen_json(system: str, user: str, max_tokens: int, retries: int = 3, array: bool = False):
    """Genera con Gemma y parsea JSON de forma ROBUSTA: repara los errores de
    formato típicos del 26B-4bit y REINTENTA si el parseo falla (la generación es
    no-determinista, un reintento suele resolver los JSON malformados)."""
    llm = available()
    if llm["error"]:
        return None
    msgs = [{"role": "user", "content": f"{system}\n{user}\n->"}]
    for _ in range(retries + 1):
        raw = complete(msgs, max_tokens)
        if array:
            for text in (raw, _repair_json_text(raw)):
                f, l = text.find("["), text.rfind("]")
                if f >= 0 and l > f:
                    try:
                        return json.loads(text[f:l + 1])
                    except Exception:
                        pass
            continue
        parsed = _extract_json_object(raw)
        if not isinstance(parsed, dict):
            parsed = _extract_json_object(_repair_json_text(raw))
        if isinstance(parsed, dict):
            return parsed
    return None
