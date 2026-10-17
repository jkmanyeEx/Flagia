"""A private JSON-lines subprocess. No HTTP listener, outbound calls or text logs."""
import hashlib
import json
import os
from pathlib import Path
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
from features import normalize, scope_reason
from model import Detector
from revisions import analyze_revisions


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def main():
    directory = Path(sys.argv[1]).resolve()
    manifest = json.loads((directory / "manifest.json").read_text())
    for relative, expected in manifest["files"].items():
        path = (directory / relative).resolve()
        if not path.is_relative_to(directory) or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError("model_integrity_failure")
    detector = Detector(directory)
    emit({"ready": True, "modelVersion": manifest["modelVersion"]})
    for line in sys.stdin:
        request = json.loads(line)
        job_id = request["id"]
        try:
            text = normalize(request["text"])
            reason = scope_reason(text, request.get("mode", "STANDARD"))
            if reason:
                emit({"id": job_id, "result": {"status": "unevaluated", "reason": reason}})
                continue
            emit({"id": job_id, "stage": "features"})
            score_a, values, evidence = detector.feature_score(text)
            emit({"id": job_id, "stage": "context"})
            score_b, chunk_count = detector.context_score(text)
            emit({"id": job_id, "stage": "revisions"})
            revisions = analyze_revisions(request.get("states", []), text)
            emit({"id": job_id, "result": {
                "status": "evaluated", "modelVersion": manifest["modelVersion"],
                "validation": manifest["validation"], "thresholds": manifest["thresholds"],
                "calibrationHumanCount": manifest["calibrationHumanCount"],
                "featureScore": score_a, "contextScore": score_b,
                "chunkCount": chunk_count, "features": values, "evidence": evidence,
                "revisions": revisions,
            }})
        except Exception as error:
            reason = "too_many_tokens" if str(error) == "too_many_tokens" else "inference_failed"
            emit({"id": job_id, "result": {"status": "unevaluated", "reason": reason}})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not expose submitted text, local paths or model internals in errors.
        emit({"fatal": "model_unavailable"})
        sys.exit(1)
