"""Sugerencias en vivo: qué falta preguntar según lo que ya se dijo.

El sesgo que se protege aquí es el importante: MÁS VALE dejar algo de más en la
lista que darlo por preguntado sin serlo. Un falso "ya cubierto" esconde una
bandera roja; un falso pendiente solo hace ruido.
"""
from app.services import cobertura
from app.services.motivo_engine import sugerencias_por_motivo


def _sug(texto="Preguntar por fiebre", claves=("fiebre",), categoria="interrogatorio",
         prioridad="media"):
    return {"categoria": categoria, "texto": texto, "razon": "r", "fuente": "f",
            "prioridad": prioridad, "claves": list(claves)}


def test_sin_transcript_todo_esta_pendiente():
    r = cobertura.pendientes([_sug(), _sug("otra", ["tos"])], "")
    assert r["n_pendientes"] == 2 and r["n_cubiertas"] == 0


def test_lo_dicho_deja_de_estar_pendiente():
    r = cobertura.pendientes([_sug()], "el paciente refiere fiebre de dos días")
    assert r["n_pendientes"] == 0 and r["n_cubiertas"] == 1
    assert r["cubiertas"][0]["claves_vistas"] == ["fiebre"]


def test_ignora_acentos_y_mayusculas():
    r = cobertura.pendientes([_sug(claves=["última regla"])], "¿cuándo fue su ULTIMA REGLA?")
    assert r["n_cubiertas"] == 1


def test_una_alarma_necesita_dos_claves():
    alarma = _sug("Descartar SCA", ["irradia", "brazo", "diafores"], "alarma", "alta")
    # Una sola mención no basta: "brazo" puede salir por cualquier motivo.
    uno = cobertura.pendientes([alarma], "le tomé la presión en el brazo")
    assert uno["n_pendientes"] == 1
    dos = cobertura.pendientes([alarma], "¿le irradia al brazo?")
    assert dos["n_cubiertas"] == 1


def test_alarma_con_una_sola_clave_se_conforma_con_una():
    alarma = _sug("Ideación suicida", ["suicid"], "alarma", "alta")
    assert cobertura.pendientes([alarma], "niega ideas suicidas")["n_cubiertas"] == 1


def test_no_se_vigila_lo_que_no_tiene_claves():
    # Adivinar por el texto de la sugerencia sería peor que no seguir nada.
    r = cobertura.pendientes([_sug(claves=[])], "lo que sea")
    assert r["n_seguidas"] == 0 and r["pendientes"] == []


def test_las_alarmas_pendientes_van_primero():
    sugs = [_sug("rutina", ["nada1"]), _sug("ALARMA", ["nada2"], "alarma", "alta")]
    assert cobertura.pendientes(sugs, "")["pendientes"][0]["texto"] == "ALARMA"


def test_la_lista_en_vivo_se_acota_pero_dice_cuanto_oculta():
    sugs = [_sug(f"s{i}", [f"clave{i}"]) for i in range(10)]
    r = cobertura.pendientes(sugs, "", limite=4)
    assert len(r["pendientes"]) == 4 and r["n_pendientes"] == 10 and r["n_ocultas"] == 6


def test_caso_real_tos_va_cubriendo_conforme_avanza():
    sugs = sugerencias_por_motivo("tos desde hace tres semanas")["sugerencias"]
    inicio = cobertura.pendientes(sugs, "")
    assert inicio["n_pendientes"] == len(sugs)

    medio = cobertura.pendientes(sugs, "¿la tos es seca o con flema? ¿de qué color?")
    assert medio["n_cubiertas"] == 1 and medio["n_pendientes"] == len(sugs) - 1

    # La alarma de TB sigue pendiente hasta que se pregunta por peso y sudoración.
    assert any("tuberculosis" in s["texto"] for s in medio["pendientes"])
    tarde = cobertura.pendientes(sugs, "¿ha bajado de peso? ¿suda en la noche?")
    assert not any("tuberculosis" in s["texto"] for s in tarde["pendientes"])


# ------------------------------------------------------------------ endpoint
def test_endpoint_pendientes(client, auth, patient):
    c = client.post("/api/consultations", json={"patient_id": patient["id"]}, headers=auth).json()
    r = client.post("/api/live/pendientes",
                    json={"consultation_id": c["id"], "motivo": "me duele el pecho"},
                    headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["n_pendientes"] > 0
    assert body["pendientes"][0]["categoria"] == "alarma"


def test_endpoint_exige_consultation_id(client, auth):
    assert client.post("/api/live/pendientes", json={}, headers=auth).status_code == 400


def test_endpoint_respeta_la_pertenencia(client, auth):
    r = client.post("/api/live/pendientes",
                    json={"consultation_id": "NO-EXISTE", "motivo": "tos"}, headers=auth)
    assert r.status_code == 404
