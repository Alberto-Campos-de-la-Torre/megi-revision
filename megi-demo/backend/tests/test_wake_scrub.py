"""Fases 7-8: scrubber de comandos en el transcript clínico y extractor de wake."""
from app.services.wake_scrub import extract_wake_command, scrub_wake_phrases


def test_removes_command_phrase_until_end_of_sentence():
    text = "El paciente refiere dolor torácico. MEGI, finaliza la consulta. Niega fiebre."
    out, hits = scrub_wake_phrases(text)
    assert hits == 1
    assert "MEGI" not in out
    assert "finaliza la consulta" not in out
    assert "dolor torácico" in out
    assert "Niega fiebre" in out


def test_covers_asr_variants_and_case():
    # "Meji" es como el whisper v1.5 real escribe "MEGI" (verificado con audio).
    for variant in ("megi", "Megi", "MEJI", "megí", "Meji", "Megui", "Meggi"):
        out, hits = scrub_wake_phrases(f"Tomó su medicamento. {variant} pausa la escucha")
        assert hits == 1, variant
        assert "pausa la escucha" not in out, variant
        assert "medicamento" in out, variant


def test_does_not_touch_clinical_text_without_wake_word():
    text = "Paciente con hipertensión; toma losartán 50 mg cada 24 horas."
    out, hits = scrub_wake_phrases(text)
    assert hits == 0
    assert out == text


def test_does_not_scrub_words_containing_the_wake_sequence():
    # "estrategia" contiene 'egi' pero no es la palabra de activación.
    text = "Se define la estrategia terapéutica del paciente."
    out, hits = scrub_wake_phrases(text)
    assert hits == 0
    assert out == text


def test_handles_empty_and_none_like_inputs():
    assert scrub_wake_phrases("") == ("", 0)
    out, hits = scrub_wake_phrases("MEGI, ir a pacientes")
    assert hits == 1
    assert out == ""


def test_extract_wake_command_returns_command_from_wake_word():
    # El enunciado sondeado puede traer cola de habla previa; el comando empieza
    # en el wake word y termina en el fin de la oración.
    got = extract_wake_command("el paciente mejora. Meji, pausar escucha. y entonces")
    assert got == "Meji, pausar escucha."


def test_extract_wake_command_none_without_wake_word():
    # Sin wake word NO se devuelve texto (el habla clínica no sale por este canal).
    assert extract_wake_command("el paciente refiere dolor torácico") is None
    assert extract_wake_command("") is None
    assert extract_wake_command(None) is None
