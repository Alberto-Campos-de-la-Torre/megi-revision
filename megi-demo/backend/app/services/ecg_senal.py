"""Registros de ECG en señal (WFDB `.hea` + `.dat`, o CSV exportado).

Todavía no hay modelo de ECG conectado (el del proyecto `electros` está
pendiente de adaptar). Mientras tanto, de un registro se saca lo que no
requiere modelo: derivaciones, frecuencia de muestreo, duración, una
estimación SIMPLE de la frecuencia cardiaca (picos R por umbral sobre la
derivación II o la primera) y un trazo de vista previa para que el médico lo
vea en pantalla. La estimación es orientativa y se dice orientativa.
"""
from __future__ import annotations

import io
import os
import re
import tempfile

import numpy as np
from PIL import Image, ImageDraw


def leer_wfdb(hea: bytes, dat: bytes | None, nombre_registro: str) -> dict:
    """Lee cabecera (y señal si hay .dat) con wfdb. Devuelve dict con
    derivaciones, fs, n_muestras, duracion_s, senal (ndarray o None)."""
    import wfdb
    base = re.sub(r"\.hea$", "", os.path.basename(nombre_registro)) or "registro"
    with tempfile.TemporaryDirectory() as d:
        # wfdb exige que .hea y .dat se llamen como el registro que declara la cabecera.
        texto = hea.decode("utf-8", "ignore").splitlines()
        declarado = texto[0].split()[0].split("/")[0] if texto and texto[0].split() else base
        # Líneas de señal: «archivo formato ganancia …». Algunas bases (PTB) reparten
        # las derivaciones en varios archivos (.dat + .xyz); solo se conservan las
        # señales cuyo archivo tenemos, y la cabecera se reescribe con ese conteo.
        senales = [l for l in texto[1:] if l.split() and not l.startswith("#")]
        comentarios = [l for l in texto[1:] if l.startswith("#")]
        archivos = sorted({l.split()[0] for l in senales})
        presentes = [a for a in archivos if a.lower().endswith(".dat")][:1] if dat is not None else []
        senales_ok = [l for l in senales if l.split()[0] in presentes] if dat is not None else senales
        cab = texto[0].split()
        if len(cab) >= 2 and dat is not None:
            cab[1] = str(len(senales_ok))
        with open(os.path.join(d, declarado + ".hea"), "w") as f:
            f.write("\n".join([" ".join(cab)] + senales_ok + comentarios) + "\n")
        if dat is not None:
            for n in presentes or [declarado + ".dat"]:
                with open(os.path.join(d, n), "wb") as f:
                    f.write(dat)
        if dat is None:
            h = wfdb.rdheader(os.path.join(d, declarado))
            return {"derivaciones": list(h.sig_name or []), "fs": float(h.fs), "n_muestras": int(h.sig_len or 0),
                    "duracion_s": (float(h.sig_len) / float(h.fs)) if h.fs and h.sig_len else None, "senal": None,
                    "unidades": list(h.units or [])}
        r = wfdb.rdrecord(os.path.join(d, declarado))
        return {"derivaciones": list(r.sig_name or []), "fs": float(r.fs), "n_muestras": int(r.sig_len),
                "duracion_s": float(r.sig_len) / float(r.fs), "senal": np.asarray(r.p_signal, dtype=np.float32),
                "unidades": list(r.units or [])}


def leer_csv(raw: bytes) -> dict | None:
    """CSV numérico: columnas = derivaciones (o tiempo + derivaciones)."""
    txt = raw.decode("utf-8", "ignore")
    sep = ";" if txt.count(";") > txt.count(",") else ","
    lineas = [l for l in txt.splitlines() if l.strip()]
    if len(lineas) < 50:
        return None
    cab = lineas[0].split(sep)
    tiene_cab = not re.match(r"^\s*-?\d", cab[0])
    filas = []
    for l in lineas[1 if tiene_cab else 0:]:
        try:
            filas.append([float(x.strip().replace(",", ".")) if x.strip() else np.nan for x in l.split(sep)])
        except ValueError:
            continue
    if len(filas) < 50:
        return None
    ancho = max(len(f) for f in filas)
    X = np.array([f + [np.nan] * (ancho - len(f)) for f in filas], dtype=np.float32)
    nombres = [c.strip() for c in cab] if tiene_cab else [f"col{i + 1}" for i in range(ancho)]
    fs = None
    if nombres and re.search(r"time|tiempo|t\b|seg|ms", nombres[0], re.I) and X.shape[0] > 2:
        dt = float(np.nanmedian(np.diff(X[:, 0])))
        if dt > 0:
            fs = 1.0 / dt if dt < 1 else 1000.0 / dt
        X, nombres = X[:, 1:], nombres[1:]
    return {"derivaciones": nombres, "fs": fs, "n_muestras": int(X.shape[0]),
            "duracion_s": (X.shape[0] / fs) if fs else None, "senal": X, "unidades": []}


def frecuencia_cardiaca(senal: np.ndarray, fs: float, derivaciones: list) -> dict | None:
    """Estimación simple: energía de la derivada, umbral adaptativo, refractario 250 ms."""
    if senal is None or not fs or senal.shape[0] < fs * 3:
        return None
    idx = 0
    for i, n in enumerate(derivaciones):
        if str(n).strip().lower() in ("ii", "mlii", "lead ii", "d2"):
            idx = i
            break
    x = senal[:, idx].astype(np.float64)
    x = x[np.isfinite(x)]
    if x.size < fs * 3:
        return None
    x = x - np.convolve(x, np.ones(int(fs * 0.2)) / (fs * 0.2), mode="same")      # quita línea de base
    d = np.diff(x) ** 2
    w = max(3, int(fs * 0.08))
    e = np.convolve(d, np.ones(w) / w, mode="same")
    umbral = 0.35 * np.percentile(e, 99)
    refract = int(fs * 0.25)
    picos, ultimo = [], -refract
    i = 0
    while i < e.size:
        if e[i] > umbral and i - ultimo > refract:
            j = i + np.argmax(e[i:min(i + refract, e.size)])
            picos.append(j); ultimo = j; i = j + refract
        else:
            i += 1
    if len(picos) < 3:
        return None
    rr = np.diff(picos) / fs
    rr = rr[(rr > 0.3) & (rr < 2.0)]
    if rr.size < 2:
        return None
    fc = 60.0 / float(np.median(rr))
    return {"fc_lpm": round(fc), "latidos_detectados": len(picos), "rr_medio_ms": round(float(np.mean(rr)) * 1000),
            "variabilidad_rr_ms": round(float(np.std(rr)) * 1000), "derivacion": str(derivaciones[idx]) if derivaciones else "1",
            "irregular": bool(np.std(rr) / np.mean(rr) > 0.15), "metodo": "umbral sobre energía de la derivada; orientativo, no diagnóstico"}


def vista_previa(senal: np.ndarray, fs: float | None, derivaciones: list, segundos: float = 10.0) -> bytes:
    """Trazo PNG: hasta 12 derivaciones, los primeros `segundos`."""
    n_der = min(senal.shape[1], 12)
    n = int(min(senal.shape[0], (fs or 250) * segundos))
    W, H_der = 1400, 110
    im = Image.new("RGB", (W, H_der * n_der + 20), (255, 248, 246))
    dr = ImageDraw.Draw(im)
    for gx in range(0, W, 28):
        dr.line([(gx, 0), (gx, im.height)], fill=(255, 220, 215), width=1)
    for gy in range(0, im.height, 28):
        dr.line([(0, gy), (W, gy)], fill=(255, 220, 215), width=1)
    xs = np.linspace(0, W - 1, n)
    for k in range(n_der):
        y = senal[:n, k].astype(np.float64)
        y = np.where(np.isfinite(y), y, 0.0)
        y = y - np.median(y)
        amp = np.percentile(np.abs(y), 99) or 1.0
        yy = H_der * k + 10 + H_der / 2 - (y / amp) * (H_der * 0.42)
        pts = list(zip(xs.tolist(), yy.tolist()))
        if len(pts) > 1:
            dr.line(pts, fill=(20, 20, 20), width=1)
        nombre = str(derivaciones[k]) if k < len(derivaciones) else f"{k + 1}"
        dr.text((6, H_der * k + 12), nombre, fill=(90, 30, 30))
    buf = io.BytesIO(); im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def resumen(info: dict, fc: dict | None, completo: bool) -> str:
    der = info.get("derivaciones") or []
    partes = [f"Registro de ECG en señal: {len(der)} {'derivaciones' if len(der) != 1 else 'derivación'}"
              + (f" ({', '.join(map(str, der[:12]))})" if der else "")]
    if info.get("fs"):
        partes.append(f"{round(float(info['fs']), 1):g} Hz")
    if info.get("duracion_s"):
        partes.append(f"{info['duracion_s']:.0f} s de duración")
    if fc:
        partes.append(f"frecuencia cardiaca estimada {fc['fc_lpm']} lpm en {fc['derivacion']} ({fc['latidos_detectados']} latidos, RR medio {fc['rr_medio_ms']} ms"
                      + (", ritmo irregular por variabilidad RR" if fc.get("irregular") else "") + "); estimación orientativa, no diagnóstico")
    if not completo:
        partes.append("falta el archivo .dat con la señal: solo se leyó la cabecera")
    partes.append("Sin modelo de ECG conectado todavía: no se interpretan morfología, intervalos ni ritmo")
    return ". ".join(partes) + "."

