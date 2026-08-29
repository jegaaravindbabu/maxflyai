"""
Filler-word removal (matches HyproAI's "uh/um" cut).

Fillers are disfluencies with no meaning: uh, um, hmm, er, aa, etc. We operate on
the timed segments produced by our silence segmentation — an isolated filler like
"um" between two pauses becomes its own short segment, which we can cut precisely.

Detection is TEXT-based on the segments we already have (no extra ASR pass): a
segment whose words are ALL fillers is a clean cut. Removals become filler_cut
edits that flow through the same ripple-delete export pipeline as silence/retake.

For fillers embedded mid-phrase (e.g. "um so the point"), precise video cutting
needs word-level timing Sarvam doesn't give; those are handled as caption text
cleanup (clean_filler_text) rather than a video cut. Transcribing in Sarvam
`verbatim` mode surfaces the most fillers.
"""
from __future__ import annotations

import re

# Pure disfluencies (safe to remove) — English + common Indic vocalizations.
FILLERS = {
    "uh", "uhh", "um", "umm", "uhm", "hmm", "hm", "mm", "mmm", "er", "err",
    "erm", "ah", "ahh", "aa", "aah", "eh", "huh", "oh", "uhhuh", "mhm",
    "hmmm", "aana", "aa",  # aa = common Tamil hesitation
}

# Discourse fillers — only removed in aggressive mode, and only as whole segments.
AGGRESSIVE = {
    "like", "actually", "basically", "literally", "so", "yeah", "right",
    "you know", "i mean", "sort of", "kind of",
}

_PUNCT = re.compile(r"[^\w஀-௿ऀ-ॿఀ-౿"
                    r"ಀ-೿ഀ-ൿঀ-৿\s]", re.UNICODE)


def _norm(text: str) -> str:
    return " ".join(_PUNCT.sub(" ", (text or "").lower()).split())


def _is_filler_only(text: str, vocab: set[str]) -> bool:
    toks = _norm(text).split()
    return bool(toks) and all(t in vocab for t in toks)


def detect_filler_cuts(segments: list[dict], aggressive: bool = False) -> list[dict]:
    """Return whole-segment filler cuts [{start_ms,end_ms,text}] safe to remove."""
    vocab = FILLERS | AGGRESSIVE if aggressive else FILLERS
    out = []
    for s in segments:
        if _is_filler_only(s.get("text", ""), vocab):
            out.append({"start_ms": s["start_ms"], "end_ms": s["end_ms"],
                        "text": s["text"].strip()})
    return out


def clean_filler_text(text: str, aggressive: bool = False) -> str:
    """Strip standalone filler tokens from a caption string (for caption cleanup)."""
    vocab = FILLERS | AGGRESSIVE if aggressive else FILLERS
    # work line by line to preserve 2-line wrapping
    cleaned_lines = []
    for line in (text or "").split("\n"):
        kept = [w for w in line.split() if _norm(w) not in vocab]
        cleaned_lines.append(" ".join(kept))
    result = "\n".join(cleaned_lines)
    return " ".join(result.split("\n")) .strip() if not result.strip() else result.strip()
