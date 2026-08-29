"""
Apply the non-destructive edit layer to produce a final timeline.

Given enabled cut edits (silence_cut / manual_cut), we:
  - merge overlapping cuts
  - ripple-delete: remap every timestamp so removed spans collapse
  - drop/clip caption cues that fall inside removed spans
  - expose keep_intervals for trimming the actual video at export

This is what makes edits real at export time while keeping transcripts immutable.
"""
from __future__ import annotations


def merge_cuts(cuts: list[dict]) -> list[dict]:
    """Merge overlapping/adjacent cut spans; returns sorted non-overlapping list."""
    spans = sorted(({"start_ms": int(c["start_ms"]), "end_ms": int(c["end_ms"])}
                    for c in cuts if c["end_ms"] > c["start_ms"]),
                   key=lambda c: c["start_ms"])
    merged: list[dict] = []
    for s in spans:
        if merged and s["start_ms"] <= merged[-1]["end_ms"]:
            merged[-1]["end_ms"] = max(merged[-1]["end_ms"], s["end_ms"])
        else:
            merged.append(dict(s))
    return merged


def remap_ms(t: int, cuts: list[dict]) -> int:
    """Map an original timestamp to the post-cut timeline (cuts merged+sorted).
    A timestamp inside a cut maps to that cut's start position."""
    removed = 0
    for c in cuts:
        if t >= c["end_ms"]:
            removed += c["end_ms"] - c["start_ms"]
        elif t > c["start_ms"]:
            removed += t - c["start_ms"]
            break
        else:
            break
    return t - removed


def apply_cuts_to_cues(cues: list[dict], cuts: list[dict]) -> list[dict]:
    """Return new cue dicts with cut spans removed and times rippled.
    Cues fully inside a cut are dropped; partial overlaps are clipped."""
    merged = merge_cuts(cuts)
    if not merged:
        return [dict(c) for c in cues]
    out: list[dict] = []
    idx = 0
    for c in cues:
        ns = remap_ms(int(c["start_ms"]), merged)
        ne = remap_ms(int(c["end_ms"]), merged)
        if ne <= ns:
            continue  # entirely within removed dead air
        nc = dict(c)
        nc["start_ms"] = ns
        nc["end_ms"] = ne
        nc["idx"] = idx
        out.append(nc)
        idx += 1
    return out


def keep_intervals(cuts: list[dict], duration_ms: int) -> list[dict]:
    """Complement of the cuts within [0, duration] — the video spans to keep."""
    merged = merge_cuts(cuts)
    keep: list[dict] = []
    cursor = 0
    for c in merged:
        s = max(0, c["start_ms"])
        if s > cursor:
            keep.append({"start_ms": cursor, "end_ms": s})
        cursor = max(cursor, min(duration_ms, c["end_ms"]))
    if cursor < duration_ms:
        keep.append({"start_ms": cursor, "end_ms": duration_ms})
    return keep


def total_removed_ms(cuts: list[dict]) -> int:
    return sum(c["end_ms"] - c["start_ms"] for c in merge_cuts(cuts))
