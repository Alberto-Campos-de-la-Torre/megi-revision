"""Motor de edad: cálculo, grupos y sugerencias por edad e historial."""
from datetime import date, timedelta

from app.services.age_engine import age_group, compute_age, preconsulta_base


def _bd(days_ago):
    return (date.today() - timedelta(days=days_ago)).isoformat()


def test_compute_age_exacta_y_fallback():
    a = compute_age(_bd(400), None)
    assert a["exacta"] and a["age_years"] == 1
    b = compute_age(None, 45)          # sin fecha -> años enteros
    assert not b["exacta"] and b["age_years"] == 45


def test_edad_corregida_en_prematuro():
    # nació a las 32 sem (8 antes de término), 60 días de vida
    a = compute_age(_bd(60), None, gestacional_semanas=32)
    assert a["prematuro"] is True
    assert a["edad_corregida_meses"] < a["age_months"]  # corregida es menor


def test_grupos_por_edad():
    assert age_group(compute_age(_bd(10), None))[0] == "neonatal"
    assert age_group(compute_age(_bd(50), None))[0] == "lactante_temprano"
    assert age_group(compute_age(None, 4))[0] == "preescolar"
    assert age_group(compute_age(None, 14))[0] == "adolescente"
    assert age_group(compute_age(None, 30))[0] == "adulto_joven"
    assert age_group(compute_age(None, 70))[0] == "adulto_mayor"


def test_sugerencias_neonatal_incluyen_bandera_fiebre():
    base = preconsulta_base({"birthdate": _bd(15), "age": 0, "chronic": [], "allergies": []}, [])
    assert base["grupo"] == "neonatal"
    textos = " ".join(s["texto"].lower() for s in base["sugerencias"])
    assert "fiebre" in textos and "tamiz neonatal" in textos


def test_adolescente_incluye_confidencial_y_headsss():
    base = preconsulta_base({"age": 15, "sex": "F", "chronic": [], "allergies": []}, [])
    textos = " ".join(s["texto"].lower() for s in base["sugerencias"])
    assert "confidencial" in textos and "headsss" in textos


def test_adulto_mayor_incluye_caidas_y_polifarmacia():
    base = preconsulta_base({"age": 72, "chronic": [], "allergies": []}, [])
    textos = " ".join(s["texto"].lower() for s in base["sugerencias"])
    assert "caídas" in textos and "polifarmacia" in textos


def test_historial_agrega_cronicos_alergias_y_primera_vez():
    # sin consultas -> primera vez; con crónicos/alergias -> preguntas dirigidas
    base = preconsulta_base(
        {"age": 55, "chronic": ["HTA", "DM2"], "allergies": ["Penicilina"]}, [])
    t = " ".join(s["texto"].lower() for s in base["sugerencias"])
    assert "hta" in t and "penicilina" in t and "primera consulta" in t


def test_historial_medicacion_previa():
    base = preconsulta_base(
        {"age": 60, "chronic": [], "allergies": []},
        [{"prescription": [{"drug": "Losartán 50 mg"}], "dx_codes": [], "soap": {}}])
    t = " ".join(s["texto"].lower() for s in base["sugerencias"])
    assert "losart" in t and "continúa" in t


def test_endpoint_preconsulta(client, auth, patient):
    # sin personalizar (mock: sin LLM) devuelve el motor determinista
    r = client.get(f"/api/patients/{patient['id']}/preconsulta?personalizar=0", headers=auth)
    assert r.status_code == 200
    d = r.json()
    assert d["grupo"] and d["sugerencias"]
    assert d["edad"]["age_years"] == patient["age"]


def test_endpoint_preconsulta_404(client, auth):
    assert client.get("/api/patients/NO-EXISTE/preconsulta", headers=auth).status_code == 404


def test_crear_paciente_con_fecha_nacimiento(client, auth):
    r = client.post("/api/patients", json={
        "name": "Bebé Prueba", "age": 0, "sex": "M", "reason": "control niño sano",
        "kind": "espontaneo", "birthdate": _bd(20),
    }, headers=auth)
    assert r.status_code == 200
    pid = r.json()["id"]
    pre = client.get(f"/api/patients/{pid}/preconsulta?personalizar=0", headers=auth).json()
    assert pre["grupo"] == "neonatal"      # 20 días -> neonato por edad exacta
    assert pre["edad"]["exacta"] is True
