"""
Retake detection (M4, manual-assisted v1).

Creators often flub a line and immediately redo it. Those retakes are near-
IDENTICAL text, so lexical similarity (difflib ratio + token overlap) detects
them reliably without heavy multilingual embeddings. We group consecutive
near-duplicate segments and suggest keeping the LAST take (the clean redo),
cutting the earlier ones. Everything is a suggestion the user confirms.

Removals are emitted as cut spans and applied via the same non-destructive
edit/export pipeline as silence cuts.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

# strip punctuation incl. Tamil danda/devanagari marks; keep letters/digits/space
_PUNCT = re.compile(r"[^\w஀-௿ऀ-ॿఀ-౿ಀ-೿"
                    r"ഀ-ൿঀ-৿\s]", re.UNICODE)


def normalize(text: str) -> str:
    t = (text or "").lower()
    t = _PUNCT.sub(" ", t)
    return " ".join(t.split())


def similarity(a: str, b: str) -> float:
    """0..1 lexical similarity: blend of char-ratio and token Jaccard."""
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    seq = SequenceMatcher(None, na, nb).ratio()
    ta, tb = set(na.split()), set(nb.split())
    jac = len(ta & tb) / len(ta | tb) if (ta | tb) else 0.0
    return 0.6 * seq + 0.4 * jac


def find_retakes(segments: list[dict], window: int = 3,
                 threshold: float = 0.62) -> list[dict]:
    """
    segments: [{idx,text,start_ms,end_ms}] in order.
    Returns candidate groups:
      { similarity, kept:{...}, cuts:[{...}] }
    where `cuts` are the earlier near-duplicate takes to remove and `kept` is
    the take suggested to keep (the last in the run).
    """
    n = len(segments)
    used = [False] * n
    out: list[dict] = []
    for i in range(n):
        if used[i]:
            continue
        run = [i]
        last = i
        # extend the run while the next-within-window segment is a near-duplicate
        while True:
            best_j, best_s = None, 0.0
            for j in range(last + 1, min(last + 1 + window, n)):
                if used[j]:
                    continue
                s = similarity(segments[last]["text"], segments[j]["text"])
                if s >= threshold and s > best_s:
                    best_j, best_s = j, s
            if best_j is None:
                break
            run.append(best_j)
            used[best_j] = True
            last = best_j
        if len(run) >= 2:
            for k in run:
                used[k] = True
            kept_idx = run[-1]
            cut_idxs = run[:-1]
            # representative similarity = min pairwise in the run vs kept
            sims = [similarity(segments[k]["text"], segments[kept_idx]["text"])
                    for k in cut_idxs]
            out.append({
                "similarity": round(min(sims), 3),
                "kept": _brief(segments[kept_idx]),
                "cuts": [_brief(segments[k]) for k in cut_idxs],
            })
    return out


def _brief(seg: dict) -> dict:
    return {"idx": seg["idx"], "start_ms": seg["start_ms"], "end_ms": seg["end_ms"],
            "text": seg["text"]}
