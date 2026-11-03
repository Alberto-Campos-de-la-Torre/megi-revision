import unittest

from asr_service.clinical import (
    extract_clinical_facts,
    finalize_transcript,
    render_final_soap,
    validate_clinical_facts,
)


FARINGO_TRANSCRIPT = """
Paciente femenino acude a consulta por presentar dolor en garganta de tres dias de evolucion.
Refiere dolor progresivo con aumento de molestia al tragar alimentos solidos y liquidos.
Comenta haber presentado fiebre no cuantificada desde el dia anterior, malestar general,
sensacion de cansancio, escalofrios ocasionales y disminucion del apetito, negatriz producida,
dificultad para respirar, dolor toracico. ¿Que mas dice? Nauseas, vomito, diarrea y congestion
nasal importante. Menciona haber tomado Paracetamol por cuenta propia. A la exploracion fisica,
el paciente se encuentra consciente, orientado, con adecuado estado de hidratacion y sin datos de
dificultad respiratoria. Los signos vitales registrados son presion arterial de 120 sobre 78.
Frecuencia cardiaca de 88 latidos por minuto. Frecuencia respiratoria de 18 respiraciones por minuto.
Temperatura de 38.2 C. Saturacion de oxigeno del 98% al aire ambiente. A la inspeccion de cavidad
oral se observa orofaringe hiperemica, amigdalas aumentadas con presencia de exudado blanquecino
bilateral. Se palpan adenopatias cervicales dolorosas. No se observa desviacion de la uvula ni
dificultad para abrir la boca. Se considera probable faringoamigdalitis aguda con posibilidad de
etiologia bacteriana. Se indica manejo sintomatico con paracetamol de 500 mg por via oral cada
6 meses por via oral cada 6 a 8 horas en caso de fiebre o dolor. Se dan datos de alarma,
dificultad para respirar, imposibilidad para tragar liquidos, fiebre persistente o mayor a 39 grados,
voz apagada, rigidez del cuello, somnolencia, deshidratacion o empeoramiento del estado general.
Recuerden, son de alarma, no diagnosticos.
"""


class ClinicalFactsTest(unittest.TestCase):
    def test_extracts_negations_alarms_and_corrected_medication(self):
        result = finalize_transcript(FARINGO_TRANSCRIPT)
        facts = result["clinical_facts"]
        validation = result["validation"]
        soap = result["soap"]

        self.assertEqual(validation["status"], "ready")
        self.assertTrue(result["official_note"])
        self.assertIn("Dolor de garganta", facts["sintomas_presentes"])
        self.assertIn("Dificultad respiratoria", facts["sintomas_negados"])
        self.assertIn("Nausea", facts["sintomas_negados"])
        self.assertIn("Voz apagada", facts["datos_alarma_condicionales"])
        self.assertEqual(facts["medicamentos"][0]["frecuencia"], "cada 6 a 8 horas")
        self.assertEqual(facts["medicamentos"][0]["validez"], "plausible")
        self.assertNotIn("voz apagada", soap["S"].lower())
        self.assertIn("voz apagada", soap["P"].lower())
        self.assertIn("Niega", soap["S"])

    def test_conflict_blocks_official_note(self):
        facts = extract_clinical_facts("Paciente refiere dificultad para respirar. Niega dificultad para respirar.")
        facts, validation = validate_clinical_facts(facts)
        soap = render_final_soap(facts, validation)

        self.assertEqual(validation["status"], "requires_review")
        self.assertFalse(validation["official_note"])
        self.assertTrue(any(flag["kind"] == "negation_conflict" for flag in validation["flags"]))
        self.assertIn("No firmar", soap["P"])

    def test_implausible_medication_frequency_blocks(self):
        result = finalize_transcript(
            "Se indica amoxicilina 500 mg por via oral cada 8 meses en caso de infeccion."
        )
        validation = result["validation"]
        self.assertEqual(validation["status"], "requires_review")
        self.assertFalse(result["official_note"])
        self.assertTrue(any(flag["kind"] == "medication_frequency_implausible" for flag in validation["flags"]))
        self.assertIn("verificar indicacion", result["soap"]["P"].lower())

    def test_low_asr_quality_is_draft_only(self):
        result = finalize_transcript(
            "Alax porcino zika MMA MHD no se puede ver nada. Paciente con dolor de garganta."
        )
        self.assertEqual(result["validation"]["status"], "draft_only")
        self.assertFalse(result["official_note"])
        self.assertTrue(any(flag["kind"] == "asr_quality_low" for flag in result["validation"]["flags"]))

    def test_alarm_misattribution_is_removed_from_present_symptoms(self):
        facts = {
            "motivo_consulta": "Dolor de garganta",
            "sintomas_presentes": ["Dolor de garganta", "Voz apagada"],
            "sintomas_negados": [],
            "datos_alarma_condicionales": ["Voz apagada"],
            "medicamentos": [],
        }
        facts, validation = validate_clinical_facts(facts)
        self.assertNotIn("Voz apagada", facts["sintomas_presentes"])
        self.assertTrue(any(flag["kind"] == "alarm_misattribution" for flag in validation["flags"]))

    def test_render_uses_general_indications_without_faringitis_boilerplate(self):
        transcript = (
            "Paciente acude por seguimiento de hipertension arterial. "
            "Niega dolor toracico y dificultad para respirar. "
            "Se ajusta tratamiento antihipertensivo y se indica dieta hiposodica."
        )
        llm_facts = {
            "motivo_consulta": "Seguimiento de hipertension arterial",
            "sintomas_presentes": ["Cefalea ocasional"],
            "sintomas_negados": ["Dolor toracico", "Dificultad respiratoria"],
            "signos_vitales": {"ta": "150/92 mmHg", "fc": "76 lpm"},
            "impresion_diagnostica": ["Hipertension arterial sistemica en descontrol"],
            "diagnosticos_diferenciales": ["Hipertension secundaria"],
            "indicaciones": [
                "Ajustar tratamiento antihipertensivo",
                "Dieta hiposodica",
                "Control en 1 mes",
            ],
            "medicamentos": [{
                "nombre": "Losartan",
                "dosis": "50 mg",
                "via": "VO",
                "frecuencia": "cada 24 horas",
                "indicacion": "hipertension",
            }],
        }

        result = finalize_transcript(transcript, llm_facts=llm_facts)
        soap = result["soap"]

        self.assertEqual(result["validation"]["status"], "ready")
        self.assertIn("Hipertension arterial sistemica en descontrol", soap["A"])
        self.assertIn("Hipertension secundaria", soap["A"])
        self.assertIn("Ajustar tratamiento antihipertensivo", soap["P"])
        self.assertIn("Dieta hiposodica", soap["P"])
        self.assertIn("Control en 1 mes", soap["P"])
        self.assertIn("Losartan 50 mg VO cada 24 horas para hipertension", soap["P"])
        self.assertNotIn("Faringitis viral", soap["A"])
        self.assertNotIn("Mononucleosis", soap["A"])
        self.assertNotIn("dieta blanda", soap["P"].lower())
        self.assertNotIn("antibiotico", soap["P"].lower())
        self.assertNotIn("estreptococ", soap["P"].lower())


if __name__ == "__main__":
    unittest.main()
