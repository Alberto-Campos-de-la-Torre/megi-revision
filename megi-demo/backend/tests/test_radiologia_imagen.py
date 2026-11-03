"""Imágenes del informe radiológico: formato por bytes, DICOM -> PNG, subida,
tope, sello con imágenes, inmutabilidad y aislamiento entre médicos.

La lectura asistida (`/analizar`) llama al ASR: aquí se prueba con el cliente
ASR sustituido, porque el modelo no corre en la suite (MEGI_REAL_ASR=false)."""
import io

import numpy as np
import pytest
from PIL import Image

from app.services import radiologia_imagen as rxi


# ------------------------------------------------------------------ fixtures
def _png(w=64, h=48, modo="L") -> bytes:
    im = Image.fromarray((np.random.default_rng(1).random((h, w)) * 255).astype(np.uint8), "L")
    if modo == "RGB":
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _jpg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (120, 120, 120)).save(buf, "JPEG")
    return buf.getvalue()


def _dicom(frames: int = 1, photometric: str = "MONOCHROME2", comprimido: bool = False) -> bytes:
    """DICOM sintético de 16 bits con ventana explícita."""
    import pydicom
    from pydicom.dataset import FileDataset, FileMetaDataset
    from pydicom.uid import ExplicitVRLittleEndian, JPEG2000, generate_uid

    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = pydicom.uid.SecondaryCaptureImageStorage
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = JPEG2000 if comprimido else ExplicitVRLittleEndian
    ds = FileDataset(None, {}, file_meta=meta, preamble=b"\0" * 128)
    ds.is_little_endian, ds.is_implicit_VR = True, False
    ds.Modality, ds.BodyPartExamined = "CR", "CHEST"
    ds.PatientName = "NO^DEBE^SALIR"
    ds.Rows, ds.Columns = 32, 48
    ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, photometric
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 12, 11, 0
    ds.WindowCenter, ds.WindowWidth = 2048, 4096
    ds.RescaleIntercept, ds.RescaleSlope = 0, 1
    if frames > 1:
        ds.NumberOfFrames = frames
    px = np.zeros((frames, 32, 48), dtype=np.uint16)
    for f in range(frames):
        px[f, :, :] = (f + 1) * 500          # cada corte con brillo distinto
    px[:, 10:20, 10:30] = 4000               # rectángulo brillante
    datos = (px if frames > 1 else px[0]).tobytes()
    if comprimido:
        # Bytes cualesquiera encapsulados como si fueran JPEG 2000: lo que importa
        # es que la sintaxis declare compresión y no haya códec para abrirla.
        from pydicom.encaps import encapsulate
        ds.PixelData = encapsulate([datos])
        ds["PixelData"].is_undefined_length = True
    else:
        ds.PixelData = datos
    buf = io.BytesIO()
    ds.save_as(buf, enforce_file_format=True)
    return buf.getvalue()


# ------------------------------------------------------------------ servicio
def test_formato_por_bytes_no_por_nombre():
    assert rxi.detectar_formato(_png(), "foto.dcm") == "png"        # el nombre miente
    assert rxi.detectar_formato(_jpg(), "") == "jpg"
    assert rxi.detectar_formato(_dicom(), "estudio.bin") == "dicom"  # preámbulo DICM
    with pytest.raises(rxi.ImagenInvalida):
        rxi.detectar_formato(b"%PDF-1.4 no soy imagen", "placa.png")


def test_png_y_jpg_producen_vista():
    png, w, h, meta = rxi.a_vista_png(_png(64, 48), "png")
    assert (w, h) == (64, 48) and png[:8] == b"\x89PNG\r\n\x1a\n" and meta == {}
    _, w2, h2, _ = rxi.a_vista_png(_jpg(), "jpg")
    assert (w2, h2) == (40, 30)


def test_vista_se_reduce_al_lado_maximo(monkeypatch):
    monkeypatch.setattr(rxi, "LADO_MAX_VISTA", 32)
    _, w, h, _ = rxi.a_vista_png(_png(128, 64), "png")
    assert max(w, h) == 32 and (w, h) == (32, 16)


def test_dicom_a_png_aplica_ventana_y_conserva_solo_meta_del_estudio():
    png, w, h, meta = rxi.a_vista_png(_dicom(), "dicom")
    assert (w, h) == (48, 32)
    im = Image.open(io.BytesIO(png))
    arr = np.asarray(im)
    assert im.mode == "L"
    assert arr[15, 20] > arr[2, 2]                    # el rectángulo sale más claro
    assert meta["modality"] == "CR" and meta["body_part"] == "CHEST" and meta["frames"] == 1
    assert "NO^DEBE^SALIR" not in str(meta) and "PatientName" not in str(meta)


def test_dicom_monochrome1_se_invierte():
    _, _, _, _ = rxi.a_vista_png(_dicom(photometric="MONOCHROME2"), "dicom")
    png1, _, _, _ = rxi.a_vista_png(_dicom(photometric="MONOCHROME1"), "dicom")
    png2, _, _, _ = rxi.a_vista_png(_dicom(photometric="MONOCHROME2"), "dicom")
    a1 = np.asarray(Image.open(io.BytesIO(png1)))
    a2 = np.asarray(Image.open(io.BytesIO(png2)))
    assert a1[15, 20] < a1[2, 2] and a2[15, 20] > a2[2, 2]   # en MONOCHROME1 el brillante sale oscuro


def test_dicom_multiframe_toma_el_corte_central():
    _, w, h, meta = rxi.a_vista_png(_dicom(frames=5), "dicom")
    assert (w, h) == (48, 32) and meta["frames"] == 5 and meta["frame_usado"] == 2


def test_dicom_comprimido_sin_codec_se_rechaza_con_motivo():
    with pytest.raises(rxi.ImagenInvalida) as e:
        rxi.a_vista_png(_dicom(comprimido=True), "dicom")
    assert e.value.status == 415 and "JPEG 2000" in e.value.detail


# ------------------------------------------------------------------ endpoints
@pytest.fixture()
def informe(client, auth, patient):
    r = client.post("/api/radiologia/informes",
                    json={"patient_id": patient["id"], "modalidad": "radiografia",
                          "region": "tórax", "indicacion": "tos y fiebre"}, headers=auth)
    assert r.status_code == 200
    return r.json()


def _subir(client, auth, informe_id, data, nombre="placa.png"):
    return client.post(f"/api/radiologia/informes/{informe_id}/imagenes",
                       files={"file": (nombre, data, "application/octet-stream")}, headers=auth)


def test_subir_ver_y_borrar_imagen(client, auth, informe):
    r = _subir(client, auth, informe["id"], _png())
    assert r.status_code == 200, r.text
    img = r.json()
    assert img["formato"] == "png" and img["id"].startswith("IMG-") and len(img["sha256"]) == 64
    assert (img["ancho"], img["alto"]) == (64, 48)

    vista = client.get(f"/api/radiologia/informes/{informe['id']}/imagenes/{img['id']}/vista", headers=auth)
    assert vista.status_code == 200 and vista.headers["content-type"] == "image/png"
    assert vista.content[:8] == b"\x89PNG\r\n\x1a\n"

    detalle = client.get(f"/api/radiologia/informes/{informe['id']}", headers=auth).json()
    assert [i["id"] for i in detalle["imagenes"]] == [img["id"]]

    assert client.delete(f"/api/radiologia/informes/{informe['id']}/imagenes/{img['id']}",
                         headers=auth).status_code == 200
    assert client.get(f"/api/radiologia/informes/{informe['id']}/imagenes", headers=auth).json() == []
    assert client.get(f"/api/radiologia/informes/{informe['id']}/imagenes/{img['id']}/vista",
                      headers=auth).status_code == 404


def test_dicom_se_sube_y_guarda_meta(client, auth, informe):
    r = _subir(client, auth, informe["id"], _dicom(), nombre="IM000001")
    assert r.status_code == 200, r.text
    assert r.json()["formato"] == "dicom" and r.json()["dicom_meta"]["modality"] == "CR"


def test_archivo_que_no_es_imagen_se_rechaza(client, auth, informe):
    r = _subir(client, auth, informe["id"], b"hola, no soy una imagen", nombre="placa.png")
    assert r.status_code == 415
    assert client.get(f"/api/radiologia/informes/{informe['id']}/imagenes", headers=auth).json() == []


def test_maximo_cuatro_imagenes(client, auth, informe):
    for _ in range(4):
        assert _subir(client, auth, informe["id"], _png()).status_code == 200
    assert _subir(client, auth, informe["id"], _png()).status_code == 409


def test_firma_sella_las_imagenes_y_luego_no_se_tocan(client, auth, informe):
    a = _subir(client, auth, informe["id"], _png()).json()
    client.patch(f"/api/radiologia/informes/{informe['id']}",
                 json={"hallazgos": "sin alteraciones", "impresion": "normal"}, headers=auth)
    firmado = client.post(f"/api/radiologia/informes/{informe['id']}/firmar", headers=auth).json()
    assert firmado["status"] == "firmado"

    # Mismo informe sin imagen habría dado otro sello: la imagen ES parte de lo firmado.
    import hashlib, json
    secciones = {k: firmado[k] for k in ("tecnica", "comparacion", "hallazgos", "impresion", "recomendaciones")}
    esperado = "sha256:" + hashlib.sha256(json.dumps(
        {**secciones, "id": firmado["id"], "patient_id": firmado["patient_id"],
         "modalidad": firmado["modalidad"], "imagenes": [a["sha256"]]},
        ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    assert firmado["content_hash"] == esperado

    assert _subir(client, auth, informe["id"], _png()).status_code == 409
    assert client.delete(f"/api/radiologia/informes/{informe['id']}/imagenes/{a['id']}",
                         headers=auth).status_code == 409
    assert client.post(f"/api/radiologia/informes/{informe['id']}/analizar", headers=auth).status_code == 409


def test_analizar_sin_imagenes_es_400_y_sin_asr_es_503(client, auth, informe, monkeypatch):
    from app.routes import radiologia as rutas
    monkeypatch.setattr(rutas, "REAL_ASR", True)
    assert client.post(f"/api/radiologia/informes/{informe['id']}/analizar", headers=auth).status_code == 400
    monkeypatch.setattr(rutas, "REAL_ASR", False)
    _subir(client, auth, informe["id"], _png())
    assert client.post(f"/api/radiologia/informes/{informe['id']}/analizar", headers=auth).status_code == 503


def test_analizar_guarda_la_lectura_con_los_hashes(client, auth, informe, monkeypatch):
    from app.routes import radiologia as rutas
    from app.services import asr_client

    a = _subir(client, auth, informe["id"], _png()).json()
    b = _subir(client, auth, informe["id"], _jpg(), nombre="lateral.jpg").json()
    llamada = {}

    def falso(paths, modalidad, region, indicacion):
        llamada.update(paths=paths, modalidad=modalidad, region=region, indicacion=indicacion)
        return {"status": "done", "model": "gemma-test", "latency_ms": 5,
                "lectura": {"tecnica": "PA", "hallazgos": "sin consolidaciones",
                            "impresion": "probablemente normal", "limitaciones": ""}}

    monkeypatch.setattr(rutas, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "radiologia_analizar_imagen", falso)
    r = client.post(f"/api/radiologia/informes/{informe['id']}/analizar", headers=auth)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["lectura"]["impresion"] == "probablemente normal"
    assert out["imagenes"] == [a["sha256"], b["sha256"]] and out["n_imagenes"] == 2
    # El contexto del estudio viaja con etiqueta legible, y las rutas son las vistas PNG.
    assert llamada["modalidad"] == "Radiografía" and llamada["region"] == "tórax"
    assert llamada["indicacion"] == "tos y fiebre"
    assert len(llamada["paths"]) == 2 and all(p.endswith("vista.png") for p in llamada["paths"])

    # Queda guardada en el informe, como objeto; y NO tocó las secciones.
    det = client.get(f"/api/radiologia/informes/{informe['id']}", headers=auth).json()
    assert det["analisis_ia"]["lectura"]["tecnica"] == "PA" and det["analisis_ia"]["by"] == "king"
    assert not (det["hallazgos"] or "").strip()

    # Borrar una imagen invalida la lectura: ya no mira lo mismo.
    client.delete(f"/api/radiologia/informes/{informe['id']}/imagenes/{b['id']}", headers=auth)
    assert client.get(f"/api/radiologia/informes/{informe['id']}", headers=auth).json()["analisis_ia"] is None


def test_analizar_sin_vision_en_el_asr_es_503(client, auth, informe, monkeypatch):
    from app.routes import radiologia as rutas
    from app.services import asr_client
    _subir(client, auth, informe["id"], _png())
    monkeypatch.setattr(rutas, "REAL_ASR", True)
    monkeypatch.setattr(asr_client, "radiologia_analizar_imagen",
                        lambda *a: {"status": "error", "error": "llm_sin_vision: instala mlx_vlm"})
    r = client.post(f"/api/radiologia/informes/{informe['id']}/analizar", headers=auth)
    assert r.status_code == 503 and "mlx_vlm" in r.json()["detail"]


def test_otro_medico_no_ve_las_imagenes(client, auth, informe):
    from tests.test_aislamiento_medicos import _medico
    img = _subir(client, auth, informe["id"], _png()).json()
    otro = _medico(client, auth, "radiologo_ajeno")
    base = f"/api/radiologia/informes/{informe['id']}/imagenes"
    assert client.get(base, headers=otro).status_code == 404
    assert client.get(f"{base}/{img['id']}/vista", headers=otro).status_code == 404
    assert _subir(client, otro, informe["id"], _png()).status_code == 404
    assert client.delete(f"{base}/{img['id']}", headers=otro).status_code == 404
    assert client.post(f"/api/radiologia/informes/{informe['id']}/analizar", headers=otro).status_code == 404


def test_ids_con_traversal_se_rechazan(client, auth, informe):
    r = client.get(f"/api/radiologia/informes/{informe['id']}/imagenes/..%2F..%2Fx/vista", headers=auth)
    assert r.status_code in (404, 422)
