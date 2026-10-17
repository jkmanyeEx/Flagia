"""Shared, versioned Korean features. Never assigns AI labels by hand."""
import math
import re
import unicodedata
from collections import Counter
from functools import lru_cache

FEATURE_VERSION = "kiwi-prose-v1"
FEATURE_NAMES = [
    "comma_sentence_share", "commas_per_sentence", "comma_position_mean",
    "comma_position_std", "comma_left_pos_diversity", "comma_right_pos_diversity",
    "punctuation_per_token", "sentence_length_mean", "sentence_length_cv",
    "token_length_mean", "particle_share", "ending_share", "ending_diversity",
    "bound_noun_spaced_share", "auxiliary_spaced_share",
    *[f"pos_{n}gram_diversity" for n in range(1, 6)],
]


@lru_cache(maxsize=1)
def kiwi():
    from kiwipiepy import Kiwi
    return Kiwi(num_workers=1)


def normalize(text):
    return unicodedata.normalize("NFC", text).replace("\r\n", "\n").strip()


def scope_reason(text, mode="STANDARD"):
    if mode == "CREATIVE":
        return "unsupported_genre"
    letters = re.findall(r"[^\W\d_]", text)
    hangul = re.findall(r"[가-힣]", text)
    if len(text) < 200:
        return "too_short"
    if len(text) > 12000:
        return "too_long"
    if len(hangul) / max(1, len(letters)) < 0.6:
        return "unsupported_language"
    if "```" in text or len(re.findall(r"[{}=;]", text)) / max(1, len(text)) > .04:
        return "unsupported_genre"
    if len(kiwi().split_into_sents(text)) < 3:
        return "too_short"
    return None


def extract(text):
    text = normalize(text)
    tokens = kiwi().tokenize(text)
    sentences = kiwi().split_into_sents(text)
    lengths = [len(s.text) for s in sentences] or [0]
    mean_len = sum(lengths) / len(lengths)
    comma_positions, left, right, counts = [], [], [], []
    for sentence in sentences:
        positions = [m.start() for m in re.finditer(",", sentence.text)]
        counts.append(len(positions))
        comma_positions.extend(p / max(1, len(sentence.text)) for p in positions)
    for i, token in enumerate(tokens):
        if token.form == ",":
            if i: left.append(tokens[i - 1].tag)
            if i + 1 < len(tokens): right.append(tokens[i + 1].tag)
    pos = [t.tag for t in tokens]
    endings = [t.form for t in tokens if t.tag.startswith("E")]
    bound, auxiliary = [], []
    for i, token in enumerate(tokens):
        if i and token.tag in ("NNB", "VX"):
            previous_end = tokens[i - 1].start + tokens[i - 1].len
            spaced = int(any(c.isspace() for c in text[previous_end:token.start]))
            (bound if token.tag == "NNB" else auxiliary).append(spaced)

    def ratio(values): return sum(values) / max(1, len(values))
    def diversity(values): return len(set(values)) / max(1, len(values))
    comma_mean = ratio(comma_positions)
    result = [
        sum(c > 0 for c in counts) / max(1, len(counts)), ratio(counts), comma_mean,
        math.sqrt(ratio([(p - comma_mean) ** 2 for p in comma_positions])),
        diversity(left), diversity(right),
        sum(t.tag.startswith("S") for t in tokens) / max(1, len(tokens)),
        mean_len,
        math.sqrt(ratio([(v - mean_len) ** 2 for v in lengths])) / max(1, mean_len),
        ratio([len(t.form) for t in tokens]),
        sum(t.tag.startswith("J") for t in tokens) / max(1, len(tokens)),
        len(endings) / max(1, len(tokens)), diversity(endings), ratio(bound), ratio(auxiliary),
    ]
    for n in range(1, 6):
        result.append(diversity([tuple(pos[i:i+n]) for i in range(len(pos)-n+1)]))
    return dict(zip(FEATURE_NAMES, result))


def signature(sentence):
    tokens = kiwi().tokenize(normalize(sentence))
    core = Counter(t.form for t in tokens if t.tag.startswith(("N", "V", "M")))
    operators = Counter(t.form for t in tokens if t.form in {
        "안", "않", "못", "없", "아니", "모든", "일부", "항상", "반드시", "오직",
        "가능", "불가능", "때문", "따라서", "그러나", "만약", "찬성", "반대",
    } or t.tag == "SN")
    return core, operators
