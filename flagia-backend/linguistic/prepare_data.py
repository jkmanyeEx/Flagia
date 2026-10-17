"""Fetch a fixed public research corpus; refuse silent upstream data changes."""
import hashlib
from pathlib import Path
import urllib.request

URL = "https://raw.githubusercontent.com/Shinwoo-Park/katfishnet/main/katfish_dataset/essay.jsonl"
SHA256 = "2cec81c53556fda7cbd73838c1802617e4dbc4edfc5318694e382bf012b70f2f"

if __name__ == "__main__":
    data = urllib.request.urlopen(URL, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise SystemExit("Corpus changed upstream; review and version it before training.")
    root = Path(__file__).resolve().parent.parent / ".linguistic-local"
    root.mkdir(exist_ok=True)
    (root / "katfish-essay.jsonl").write_bytes(data)
    print("Verified public corpus saved locally; source text was not logged.")
