"""Conservative revision candidates from stable complete Korean sentences.

These are observable linguistic changes, not proof of authorship or a complete
argument-understanding model. Ambiguous edits are kept as unknown.
"""
import difflib
from collections import Counter
from features import kiwi, normalize, signature


def analyze_revisions(states, final_text):
    stable = []
    previous = set()
    previous_time = None
    previous_segment = None
    for state in states:
        current = {s.text.strip() for s in kiwi().split_into_sents(normalize(state["text"]))
                   if s.text.strip().endswith((".", "!", "?", "다", "요")) and len(s.text.strip()) >= 12}
        segment = state.get("segment", 0)
        if previous_segment != segment:
            previous = set()
            previous_time = None
        timestamp = state.get("timestamp", 0)
        if previous_time is not None and timestamp - previous_time >= 1000:
            stable.extend(current & previous)
        previous = current
        previous_time = timestamp
        previous_segment = segment
    stable = set(stable)
    final_sentences = [s.text.strip() for s in kiwi().split_into_sents(final_text)]
    final_set = set(final_sentences)
    final_core, _ = signature(final_text)
    examples, counts = [], Counter()
    credited = Counter()
    for old in sorted(stable - final_set):
        if not final_sentences: break
        new = max(final_sentences, key=lambda s: difflib.SequenceMatcher(None, old, s).ratio())
        similarity = difflib.SequenceMatcher(None, old, new).ratio()
        if similarity < .45:
            counts["unknown"] += 1
            continue
        before, before_ops = signature(old)
        after, after_ops = signature(new)
        changed = (before - after) + (after - before)
        if before == after and before_ops == after_ops:
            kind = "surface"
        elif before_ops != after_ops:
            kind = "meaning"
        elif similarity >= .94 or sum(changed.values()) <= 1:
            kind = "unknown"
        else:
            # Core vocabulary changed; no claim that the proposition changed.
            kind = "rewording"
        counts[kind] += 1
        if kind == "meaning":
            # Credit only changed markers/lemmas, never the whole sentence.
            credited |= (before - final_core) | ((before_ops - after_ops) + (after_ops - before_ops))
        if len(examples) < 8:
            examples.append({"kind": kind, "before": old[:220], "after": new[:220]})
    changed_chars = sum(len(word) * count for word, count in credited.items())
    return {
        "status": "evaluated" if len(states) >= 2 else "unevaluated",
        "stableSentenceCount": len(stable),
        "surfaceEdits": counts["surface"], "rewordings": counts["rewording"],
        "meaningEdits": counts["meaning"], "unknownEdits": counts["unknown"],
        "meaningChangeRatio": min(.25, changed_chars / max(200, len(final_text))),
        "examples": examples,
        "method": "stable-sentence-operators-v1",
        "coverage": "sampled" if any("segment" in state for state in states) else "complete-checkpoints",
    }
