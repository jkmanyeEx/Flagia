import unittest
from features import extract, FEATURE_NAMES, scope_reason
from revisions import analyze_revisions


class RevisionTests(unittest.TestCase):
    def compare(self, old, new, times=(1000, 3000)):
        return analyze_revisions([{"text": old, "timestamp": times[0]}, {"text": old, "timestamp": times[1]}], new)

    def test_negation_is_meaning_change(self):
        r = self.compare("학교에서 스마트폰 사용을 허용해야 한다.", "학교에서 스마트폰 사용을 허용하지 않아야 한다.")
        self.assertGreater(r["meaningEdits"], 0)
        self.assertGreater(r["meaningChangeRatio"], 0)

    def test_quantity_is_meaning_change(self):
        r = self.compare("학생은 하루에 3시간 동안 도서관에서 공부한다.", "학생은 하루에 5시간 동안 도서관에서 공부한다.")
        self.assertEqual(r["meaningEdits"], 1)

    def test_spacing_is_not_semantic(self):
        r = self.compare("우리는 이 문제를 해결할 수 있다.", "우리는 이 문제를 해결할수 있다.")
        self.assertEqual(r["meaningEdits"], 0)
        self.assertEqual(r["meaningChangeRatio"], 0)

    def test_transient_composition_and_duplicates_are_not_stable(self):
        old, new = "학교에서 스마트폰 사용을 허용해야 한다.", "학교에서 스마트폰 사용을 허용하지 않아야 한다."
        self.assertEqual(self.compare(old, new, (1000, 1000))["meaningEdits"], 0)
        self.assertEqual(analyze_revisions([{"text": old, "timestamp": 1000}], new)["status"], "unevaluated")

    def test_no_revision_does_not_invent_evidence(self):
        text = "학생은 학교에서 자신의 의견을 자유롭게 표현해야 한다."
        r = self.compare(text, text)
        self.assertEqual(r["meaningEdits"], 0)
        self.assertEqual(r["meaningChangeRatio"], 0)

    def test_features_finite_and_versioned(self):
        import math
        f = extract("우리는 이 문제를 해결할 수 있다. 그러나, 모든 학생의 의견이 같지는 않다.")
        self.assertEqual(list(f), FEATURE_NAMES)
        self.assertTrue(all(math.isfinite(v) for v in f.values()))
        self.assertEqual(scope_reason("한국어 문장"), "too_short")


if __name__ == "__main__":
    unittest.main()
