"""PDF original de las guías (22-sep-2026): resolución doc_id -> archivo,
contención en el corpus, 404 claro cuando no está, y la bandera
`pdf_available` en el listado. Corpus falso en un tmp: no hacen falta los
471 MB reales."""
import json

import pytest

from app.services import guidelines_pdf as gp

PDF_MIN = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"


@pytest.fixture()
def corpus(tmp_path, monkeypatch):
    root = tmp_path / "rag-documentacion"
    (root / "00_indice").mkdir(parents=True)
    (root / "mexico" / "gpc_imss").mkdir(parents=True)
    (root / "mexico" / "nom").mkdir(parents=True)
    filas = [
        {"ruta_rag": "mexico/gpc_imss/000GRRCardiopatiaIsquemica.pdf", "doc_type": "gpc"},
        {"ruta_rag": "mexico/gpc_imss/999GRRSinArchivo.pdf", "doc_type": "gpc"},      # en manifiesto, sin PDF
        {"ruta_rag": "mexico/nom/NOM-036-SSA2-2012.pdf", "doc_type": "NOM_pdf"},
        {"ruta_rag": "../../fuera/del/corpus.pdf", "doc_type": "gpc"},                # traversal
        {"ruta_rag": "mexico/algo.xml", "doc_type": "xml"},                            # no es PDF
    ]
    (root / "00_indice" / "clasificacion_megi.jsonl").write_text(
        "\n".join(json.dumps(f) for f in filas) + "\nno-json\n", encoding="utf-8")
    (root / "mexico" / "gpc_imss" / "000GRRCardiopatiaIsquemica.pdf").write_bytes(PDF_MIN)
    (root / "mexico" / "nom" / "NOM-036-SSA2-2012.pdf").write_bytes(PDF_MIN)
    (root / "cie_10.pdf").write_bytes(PDF_MIN)
    monkeypatch.setattr(gp, "RAG_DOCS_DIR", root)
    monkeypatch.setattr(gp, "MANIFEST", root / "00_indice" / "clasificacion_megi.jsonl")
    gp.reset_cache()
    yield root
    gp.reset_cache()


def test_resuelve_por_nombre_de_archivo_y_los_especiales(corpus):
    assert gp.pdf_path("000GRRCardiopatiaIsquemica") == corpus / "mexico/gpc_imss/000GRRCardiopatiaIsquemica.pdf"
    assert gp.pdf_path("cie10") == corpus / "cie_10.pdf"
    assert gp.pdf_path("nom_004") == corpus / "mexico/nom/NOM-036-SSA2-2012.pdf"


def test_sin_archivo_o_fuera_del_corpus_devuelve_none(corpus):
    assert gp.pdf_path("999GRRSinArchivo") is None       # en el manifiesto pero no copiado
    assert gp.pdf_path("cemece") is None                 # especial sin archivo
    assert gp.pdf_path("corpus") is None                 # ../../ no sale del corpus
    assert gp.pdf_path("algo") is None                   # no es PDF
    assert gp.pdf_path("") is None and gp.pdf_path("no-existe") is None


# ------------------------------------------------------------------ endpoints
def _un_doc(client, auth):
    docs = client.get("/api/guidelines", headers=auth).json()["docs"]
    if not docs:
        pytest.skip("sin índice RAG en este checkout")
    return docs


def test_el_listado_dice_si_hay_pdf(client, auth, corpus, monkeypatch):
    docs = _un_doc(client, auth)
    con = {d["doc_id"]: d["pdf_available"] for d in docs}
    assert con.get("000GRRCardiopatiaIsquemica") is True
    assert all(isinstance(v, bool) for v in con.values())
    assert sum(con.values()) <= 3                         # solo los del corpus falso


def test_sirve_el_pdf_con_sesion_y_404_claro_si_falta(client, auth, corpus):
    _un_doc(client, auth)
    r = client.get("/api/guidelines/000GRRCardiopatiaIsquemica/pdf", headers=auth)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and "inline" in r.headers["content-disposition"]

    sin = next(d["doc_id"] for d in client.get("/api/guidelines", headers=auth).json()["docs"]
               if not d["pdf_available"])
    r2 = client.get(f"/api/guidelines/{sin}/pdf", headers=auth)
    assert r2.status_code == 404 and "PDF original" in r2.json()["detail"]

    assert client.get("/api/guidelines/no-existe/pdf", headers=auth).status_code == 404
    assert client.get("/api/guidelines/000GRRCardiopatiaIsquemica/pdf").status_code in (401, 403)
