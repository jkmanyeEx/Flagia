"""Offline-only runtime shared by training, calibration and the worker."""
import json
import math
from pathlib import Path
import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from features import FEATURE_NAMES, FEATURE_VERSION, extract

MAX_TOKENS = 384
MAX_CHUNKS = 24


def chunks(tokenizer, text):
    ids = tokenizer.encode(text, add_special_tokens=False)
    size = MAX_TOKENS - tokenizer.num_special_tokens_to_add(pair=False)
    if len(ids) > size * MAX_CHUNKS:
        raise ValueError("too_many_tokens")
    return [tokenizer.prepare_for_model(ids[i:i+size], truncation=False)
            for i in range(0, len(ids), size)] or [tokenizer.prepare_for_model([])]


class Detector:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.manifest = json.loads((self.directory / "manifest.json").read_text())
        if self.manifest["featureVersion"] != FEATURE_VERSION:
            raise ValueError("feature_version_mismatch")
        self.feature = json.loads((self.directory / "features.json").read_text())
        self.tokenizer = AutoTokenizer.from_pretrained(self.directory / "context", local_files_only=True)
        self.model = AutoModelForSequenceClassification.from_pretrained(
            self.directory / "context", local_files_only=True, use_safetensors=True).eval()
        # CPU is portable and avoids allocating the desktop GPU in production.
        torch.set_num_threads(2)

    def feature_score(self, text):
        values = extract(text)
        f = self.feature
        x = (np.array([values[k] for k in FEATURE_NAMES]) - np.array(f["mean"])) / np.array(f["scale"])
        logit = float(np.dot(x, f["coef"]) + f["intercept"])
        score = 1 / (1 + math.exp(-max(-700, min(700, logit))))
        contributions = sorted(zip(FEATURE_NAMES, x * np.array(f["coef"])), key=lambda p: abs(p[1]), reverse=True)
        return score, values, [{"feature": k, "value": values[k], "contribution": round(float(v), 4)}
                               for k, v in contributions[:5]]

    def context_score(self, text):
        parts = chunks(self.tokenizer, text)
        logits, weights = [], []
        with torch.inference_mode():
            for start in range(0, len(parts), 4):
                batch = parts[start:start+4]
                inputs = self.tokenizer.pad(batch, padding=True, return_tensors="pt")
                output = self.model(**inputs, return_dict=True).logits
                logits.extend((output[:, 1] - output[:, 0]).tolist())
                weights.extend(max(1, len(p["input_ids"]) - 2) for p in batch)
        # Aggregate the document before applying a single calibrated threshold.
        mean = float(np.average(logits, weights=weights))
        return 1 / (1 + math.exp(-max(-700, min(700, mean)))), len(parts)
