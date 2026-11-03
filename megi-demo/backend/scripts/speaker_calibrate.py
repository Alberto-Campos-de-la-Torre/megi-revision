"""Fase 10 — calibración del umbral de verificación del hablante.

Puntúa los audios de comandos RETENIDOS (tabla `audio`, voice_command) contra la
huella enrolada del usuario y muestra la distribución de scores. Si le pasas un
directorio de audios impostores (otras voces), también puntúa esos y sugiere un
umbral sesgado a MENOR FALSA ACEPTACIÓN (el costo de que otra voz mande supera
al de rechazarte cuando estás ronco).

Uso (ASR service en :8010):
    cd backend && .venv/bin/python scripts/speaker_calibrate.py <username> [dir_impostores]
"""
import json
import math
import sqlite3
import sys
from pathlib import Path

import httpx

BACKEND_DIR = Path(__file__).resolve().parent.parent
DB = BACKEND_DIR / "data" / "megi.sqlite"
PROFILES = BACKEND_DIR / "data" / "speaker_profiles"
ASR = "http://localhost:8010"


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def embed(path: str):
    r = httpx.post(f"{ASR}/v1/speaker/embed", json={"audio_path": path}, timeout=300).json()
    if r.get("status") != "done":
        raise RuntimeError(r.get("error"))
    return r["embedding"]


def stats(scores):
    if not scores:
        return "(sin muestras)"
    s = sorted(scores)
    p = lambda q: s[min(len(s) - 1, int(q * len(s)))]
    return f"n={len(s)} min={s[0]:.3f} p10={p(.1):.3f} mediana={p(.5):.3f} p90={p(.9):.3f} max={s[-1]:.3f}"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    username = sys.argv[1]
    profile_path = PROFILES / f"{username}.json"
    if not profile_path.exists():
        print(f"Sin perfil enrolado para '{username}' ({profile_path}). Enrola primero desde el panel 🎙.")
        sys.exit(1)
    ref = json.loads(profile_path.read_text())["embedding"]

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT asr_wav_path, transcript FROM audio WHERE audio_kind='voice_command' ORDER BY created_at"
    ).fetchall()

    genuine = []
    print(f"Puntuando {len(rows)} comandos retenidos contra la huella de '{username}':\n")
    for r in rows:
        wav = r["asr_wav_path"]
        if not wav or not Path(wav).exists():
            continue
        try:
            score = cosine(embed(wav), ref)
            genuine.append(score)
            print(f"  {score:.3f}  {(r['transcript'] or '')[:60]!r}")
        except Exception as e:
            print(f"  ERROR {wav}: {e}")

    impostor = []
    if len(sys.argv) > 2:
        for f in sorted(Path(sys.argv[2]).glob("*")):
            if f.suffix.lower() not in (".wav", ".aiff", ".mp3", ".webm"):
                continue
            try:
                impostor.append(cosine(embed(str(f)), ref))
                print(f"  [impostor] {impostor[-1]:.3f}  {f.name}")
            except Exception as e:
                print(f"  [impostor] ERROR {f.name}: {e}")

    print(f"\nGenuinos:   {stats(genuine)}")
    print(f"Impostores: {stats(impostor)}")
    if genuine:
        floor = sorted(genuine)[max(0, int(0.1 * len(genuine)) - 1)]
        suggestion = floor - 0.05
        if impostor:
            suggestion = max(suggestion, max(impostor) + 0.05)
        print(f"\nUmbral sugerido (sesgado a menor falsa aceptación): {suggestion:.2f}")
        print(f"Para aplicarlo: edita 'threshold' en {profile_path} o exporta MEGI_SPEAKER_THRESHOLD.")


if __name__ == "__main__":
    main()
