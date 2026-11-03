import unittest

from asr_service.rag.router import should_retrieve


class RagRouterTest(unittest.TestCase):
    def test_diagnosis_plan_uses_clinical_guidelines_not_cie(self):
        decision = should_retrieve(
            "Se considera probable faringoamigdalitis aguda y se indica manejo sintomatico."
        )
        self.assertTrue(decision["needs_rag"])
        self.assertEqual(decision["queries"][0]["use_cases"], ["dx_analisis_plan"])

    def test_explicit_cie_request_uses_coding_lookup(self):
        decision = should_retrieve("Codificar diagnostico en CIE-10 para faringoamigdalitis.")
        self.assertTrue(decision["needs_rag"])
        self.assertEqual(decision["queries"][0]["use_cases"], ["codificacion_cie10"])


if __name__ == "__main__":
    unittest.main()
