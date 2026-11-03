"""Buscador CIE-10: matchea impresiones verbosas y expone score (para el
prellenado del diagnóstico en Revisión)."""


def _search(client, auth, q):
    return client.get(f"/api/cie10/search?q={q}", headers=auth).json()["results"]


def test_specific_term(client, auth):
    r = _search(client, auth, "amigdal")
    assert r and r[0]["code"] == "J03.9"


def test_verbose_impression_matches(client, auth):
    # "Probable enfermedad renal crónica descompensada" -> N18.9 arriba
    r = _search(client, auth, "Probable%20enfermedad%20renal%20cronica%20descompensada")
    assert r and r[0]["code"] == "N18.9"
    assert r[0]["score"] >= 2   # match fuerte -> se auto-asigna en el front


def test_weak_match_is_low_score(client, auth):
    # "faringoamigdalitis aguda" no está en el set curado; solo comparte "aguda"
    # -> score débil, para que el front NO meta un código equivocado.
    r = _search(client, auth, "faringoamigdalitis%20aguda")
    assert (not r) or r[0]["score"] < 2
