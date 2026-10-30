"""Input-contract checks using the shipped baseline and neural checkpoints."""
import json
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

import torch

from build_dataset import leiden_to_stone, normalize
from predictor import Predictor, clean, prepare_text


def previous_clean(text):
    """The pre-change input path, retained only to check existing predictions."""
    text = re.sub(r"\([^)]*\)", "", text)
    text = re.sub(r"\[[^\]]*\]", " # ", text)
    return normalize(text)


class NormalizationTests(unittest.TestCase):
    def test_readable_erased_letters_are_kept(self):
        self.assertEqual(clean("DIS [[MANIBVS]] SACRVM"), "dis manibvs sacrvm")
        self.assertEqual(previous_clean("DIS [[MANIBVS]] SACRVM"), "dis # sacrvm")

    def test_notation_matches_corpus_normalization(self):
        for text in (
            "D(is) M(anibus) [restituted] C PORCIVS",
            "DIS [[MANIBVS]] SACRVM",
            "[[DIS]] [MANIBVS] / C PORCIVS",
            "\u0398\u0395\u039f\u03a3 [[\u0392\u039f\u0397\u0398\u0395\u0399]] [\u03a4\u03a9]",
        ):
            with self.subTest(text=text):
                self.assertEqual(clean(text), leiden_to_stone(text))

    def test_minimum_matches_corpus_non_gap_non_whitespace_rule(self):
        for text in ("", " ", "... /", "[illegible]", "# # #", "D M", "ABCD", "D(is) M(anibus)"):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, "at least 5"):
                prepare_text(text)
        self.assertEqual(prepare_text("A B # C D E"), "a b # c d e")
        self.assertEqual(prepare_text("[[ABCDE]]"), "abcde")


class CheckpointInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)
        cls.predictors = [Predictor("baseline"), Predictor("deep")]
        if cls.predictors[1].deep is None:
            raise AssertionError("The shipped deep checkpoint is required for this regression check.")
        cls.examples = json.loads((ML / "demo/examples.json").read_text(encoding="utf-8"))

    def test_real_predictors_reject_short_and_gap_only_input_before_inference(self):
        for predictor in self.predictors:
            with patch.object(type(predictor.base["vec"]), "transform", side_effect=AssertionError("Invalid input reached model inference")):
                for text in ("", "...", "[illegible]", "# #", "D M", "ABCD"):
                    with self.subTest(model=predictor.model_name, text=text), self.assertRaisesRegex(ValueError, "at least 5"):
                        predictor.predict(text)

    def test_existing_selected_examples_keep_original_predictions_and_flags(self):
        # These curated examples test compatibility, not held-out accuracy.
        for predictor in self.predictors:
            for example in self.examples:
                args = (example["text"], example.get("not_before"), example.get("not_after"), example.get("region"))
                with self.subTest(model=predictor.model_name, example=example["label"]):
                    with patch("predictor.clean", side_effect=previous_clean):
                        before = predictor.check(*args)
                    self.assertEqual(predictor.check(*args), before)

    def test_real_predictors_use_readable_erasure_as_the_same_visible_letters(self):
        for predictor in self.predictors:
            with self.subTest(model=predictor.model_name):
                self.assertEqual(predictor.predict("DIS [[MANIBVS]] SACRVM"), predictor.predict("DIS MANIBVS SACRVM"))


if __name__ == "__main__":
    unittest.main()
