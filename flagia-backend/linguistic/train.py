"""Train both classifiers, freeze empirical thresholds, audit held-out topics.

Input JSONL: text, label (human=0/AI=1), topic (split group), written_by.
Public data is deliberately not copied into source control. No pickles loaded.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import random
import time
import numpy as np
import torch
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from features import FEATURE_NAMES, FEATURE_VERSION, extract, normalize, scope_reason
from model import Detector, chunks


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def tier(a, b, thresholds):
    if a <= thresholds["aReview"]: return 0
    if b <= thresholds["bReview"]: return 15
    return 65 if a > thresholds["aStrong"] else 35


def metrics(rows, scores):
    human = [s for r, s in zip(rows, scores) if r["label"] == 0]
    ai = [s for r, s in zip(rows, scores) if r["label"] == 1]
    return {"humanCount": len(human), "aiCount": len(ai),
            "falsePositiveRate": sum(s > 0 for s in human) / max(1, len(human)),
            "detectionRate": sum(s > 0 for s in ai) / max(1, len(ai)),
            "deductions": dict(Counter(scores))}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--encoder", default="klue/roberta-small")
    p.add_argument("--revision", default="b6b4c36d827e0293ae2fcf04d527072f10a23064")
    p.add_argument("--epochs", type=int, default=3)
    args = p.parse_args()
    random.seed(42); np.random.seed(42); torch.manual_seed(42); torch.set_num_threads(4)
    raw = Path(args.data).read_bytes()
    data_hash = hashlib.sha256(raw).hexdigest()
    rows, seen = [], set()
    for line in raw.decode().splitlines():
        r = json.loads(line); r["text"] = normalize(r["text"])
        key = hashlib.sha256(r["text"].encode()).hexdigest()
        if key in seen or scope_reason(r["text"]): continue
        if r["label"] not in (0, 1): raise ValueError("invalid_label")
        seen.add(key); rows.append(r)
    groups = sorted({r["topic"] for r in rows}); random.shuffle(groups)
    if len(groups) < 8: raise ValueError("at_least_eight_independent_groups_required")
    # No topic, document, or paired generator prompt crosses a split.
    test_groups, calibration_groups = groups[:2], groups[2:4]
    train_groups = groups[4:]
    train = [r for r in rows if r["topic"] in train_groups and
             (r["label"] == 0 or r["written_by"] == "gpt-4o-2024-05-13")]
    calibration = [r for r in rows if r["topic"] in calibration_groups]
    test = [r for r in rows if r["topic"] in test_groups]
    for split in (train, calibration, test):
        if {r["label"] for r in split} != {0, 1}: raise ValueError("split_requires_both_classes")
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    print(json.dumps({"stage": "features", "splitCounts": [len(s) for s in (train, calibration, test)]}), flush=True)
    x = np.array([[v[k] for k in FEATURE_NAMES] for v in (extract(r["text"]) for r in train)])
    scaler = StandardScaler().fit(x)
    classifier = LogisticRegression(C=.3, class_weight="balanced", max_iter=2000, random_state=42)
    classifier.fit(scaler.transform(x), [r["label"] for r in train])
    write(output / "features.json", {"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist(),
        "coef": classifier.coef_[0].tolist(), "intercept": float(classifier.intercept_[0])})
    tokenizer = AutoTokenizer.from_pretrained(args.encoder, revision=args.revision)
    tokenizer.model_max_length = 1000000  # Explicit bounded chunking below.
    model = AutoModelForSequenceClassification.from_pretrained(args.encoder, revision=args.revision,
        num_labels=2, id2label={0: "HUMAN", 1: "AI"}, label2id={"HUMAN": 0, "AI": 1},
        use_safetensors=True, attn_implementation="eager")
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model.to(device)
    # Fine-tune the final two transformer layers and the classification head.
    for name, param in model.named_parameters():
        param.requires_grad = (name.startswith("classifier.") or
            any(name.startswith(f"roberta.encoder.layer.{i}.")
                for i in range(max(0, model.config.num_hidden_layers - 2), model.config.num_hidden_layers)))
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=2e-5, weight_decay=.01)
    documents = [chunks(tokenizer, r["text"]) for r in train]
    # Every training document has equal weight, irrespective of its chunk count.
    for epoch in range(args.epochs):
        model.train(); order = list(range(len(train))); random.shuffle(order)
        total = 0
        for start in range(0, len(order), 4):
            indices = order[start:start+4]
            samples = [documents[i][epoch % len(documents[i])] for i in indices]
            batch = {k: v.to(device) for k, v in tokenizer.pad(samples, padding=True, return_tensors="pt").items()}
            labels = torch.tensor([train[i]["label"] for i in indices], device=device)
            optimizer.zero_grad(set_to_none=True)
            loss = model(**batch, labels=labels, return_dict=True).loss
            loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step()
            total += float(loss.detach().cpu())
        print(json.dumps({"stage": "context", "epoch": epoch + 1, "loss": total / max(1, (len(order)+3)//4), "device": device}), flush=True)
    model.to("cpu").eval(); (output / "context").mkdir(exist_ok=True)
    model.save_pretrained(output / "context", safe_serialization=True)
    tokenizer.save_pretrained(output / "context")
    manifest = {"schema": 1, "featureVersion": FEATURE_VERSION, "encoder": args.encoder,
        "encoderRevision": args.revision, "datasetSha256": data_hash,
        "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "validation": "provisional", "scope": "ko-prose-200-12000",
        "calibrationMethod": "human-document-empirical-quantile-unverified",
        "training": {"seed": 42, "epochs": args.epochs, "batchSize": 4, "learningRate": 2e-5,
                     "trainableLayers": "last-two-plus-classification-head"},
        "splitCounts": {name: {"total": len(split), "human": sum(r["label"] == 0 for r in split)}
                        for name, split in [("train", train), ("calibration", calibration), ("test", test)]},
        "targetReviewFpr": .01, "targetStrongFpr": .001,
        "splitGroups": {"train": train_groups, "calibration": calibration_groups, "test": test_groups}}
    write(output / "manifest.json", manifest)
    detector = Detector(output)
    print(json.dumps({"stage": "calibration"}), flush=True)
    def predict(split):
        return [(detector.feature_score(r["text"])[0], detector.context_score(r["text"])[0]) for r in split]
    cal_scores = predict(calibration)
    human_scores = np.array([s for r, s in zip(calibration, cal_scores) if r["label"] == 0])
    thresholds = {"aReview": float(np.quantile(human_scores[:, 0], .99)),
                  "aStrong": float(np.quantile(human_scores[:, 0], .999)),
                  "bReview": float(np.quantile(human_scores[:, 1], .99))}
    manifest["thresholds"] = thresholds
    manifest["calibrationHumanCount"] = len(human_scores)
    test_scores = predict(test)
    audit = metrics(test, [tier(a, b, thresholds) for a, b in test_scores])
    audit["featureAuRoc"] = float(roc_auc_score([r["label"] for r in test], [s[0] for s in test_scores]))
    audit["contextAuRoc"] = float(roc_auc_score([r["label"] for r in test], [s[1] for s in test_scores]))
    audit["byGenerator"] = {g: metrics([r for r in test if r["written_by"] in ("human", g)],
        [tier(a, b, thresholds) for r, (a, b) in zip(test, test_scores) if r["written_by"] in ("human", g)])
        for g in sorted({r["written_by"] for r in test if r["label"] == 1})}
    manifest["audit"] = audit
    hashes = {str(f.relative_to(output)): hashlib.sha256(f.read_bytes()).hexdigest()
              for f in sorted(output.rglob("*")) if f.is_file() and f.name != "manifest.json"}
    manifest["files"] = hashes
    manifest["modelVersion"] = "ko-prose-" + hashlib.sha256(json.dumps(
        {"files": hashes, "thresholds": thresholds}, sort_keys=True).encode()).hexdigest()[:16]
    write(output / "manifest.json", manifest)
    print(json.dumps({"stage": "done", "modelVersion": manifest["modelVersion"], "audit": audit}), flush=True)


if __name__ == "__main__":
    main()
