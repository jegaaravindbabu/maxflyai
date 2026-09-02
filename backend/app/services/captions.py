"""
Caption logic:
  1. build_cues_from_segments  -- reading-speed cue segmentation
  2. SRT / VTT / ASS serializers

Reading-speed rules (PRD 5.1): ~15-17 chars/sec, max ~42 chars/line,
1-7s per cue, max 2 lines. Because Sarvam gives chunk-level timing, each
segment already ~= a phrase; we split over-long segments and merge tiny ones.
"""
from dataclasses import dataclass, field
from typing import Optional

MAX_CHARS_PER_LINE = 42
MAX_LINES = 2
MAX_CUE_MS = 7000
MIN_CUE_MS = 800
MAX_CHARS = MAX_CHARS_PER_LINE * MAX_LINES


@dataclass
class Cue:
    idx: int
    start_ms: int
    end_ms: int
    text: str
    translit_text: Optional[str] = None
    line_count: int = 1


@dataclass
class CuePrefs:
    """Caption segmentation preferences (from the New Project modal)."""
    max_chars: int = MAX_CHARS_PER_LINE   # max characters per line
    min_dur_ms: int = MIN_CUE_MS          # minimum on-screen duration per cue
    gap_ms: int = 0                       # blank gap inserted between cues
    single_word: bool = False             # one word per cue (vs balanced 2 lines)


def _wrap_two_lines(text: str, max_chars: int = MAX_CHARS_PER_LINE) -> tuple[str, int]:
    """Balance text into at most 2 lines <= max_chars."""
    text = " ".join(text.split())
    if len(text) <= max_chars:
        return text, 1
    words = text.split(" ")
    best = None
    for i in range(len(words)):
        running = " ".join(words[: i + 1])
        rest = " ".join(words[i + 1:])
        if len(running) <= max_chars and len(rest) <= max_chars:
            score = abs(len(running) - len(rest))
            if best is None or score < best[0]:
                best = (score, running, rest)
    if best:
        return best[1] + "\n" + best[2], 2
    return text[:max_chars] + "\n" + text[max_chars:max_chars * 2], 2


def _split_long_segment(seg: dict, max_chars_total: int = MAX_CHARS) -> list[dict]:
    """Split a segment whose text is too long or duration too long into pieces."""
    text = " ".join((seg.get("text") or "").split())
    translit = seg.get("translit_text")
    start, end = seg["start_ms"], seg["end_ms"]
    dur = max(end - start, 1)
    if len(text) <= max_chars_total and dur <= MAX_CUE_MS:
        return [seg]

    n = max(1, -(-len(text) // max_chars_total), -(-dur // MAX_CUE_MS))  # ceil
    words = text.split(" ")
    if n <= 1 or len(words) <= 1:
        return [seg]
    per = -(-len(words) // n)
    pieces = []
    total_chars = max(len(text), 1)
    cursor = start
    for i in range(0, len(words), per):
        chunk_words = words[i:i + per]
        chunk_text = " ".join(chunk_words)
        frac = len(chunk_text) / total_chars
        seg_end = min(end, cursor + max(int(dur * frac), MIN_CUE_MS))
        pieces.append({
            "text": chunk_text,
            "translit_text": translit,  # translit split is approximate
            "start_ms": cursor,
            "end_ms": seg_end,
            "speaker": seg.get("speaker"),
        })
        cursor = seg_end
    if pieces:
        pieces[-1]["end_ms"] = end
    return pieces


def _explode_words(seg: dict, min_dur_ms: int) -> list[dict]:
    """Split a segment into one cue per word, timing spread proportionally."""
    text = " ".join((seg.get("text") or "").split())
    words = text.split(" ") if text else []
    tr = seg.get("translit_text")
    tr_words = " ".join(tr.split()).split(" ") if tr else None
    start, end = int(seg["start_ms"]), int(seg["end_ms"])
    dur = max(end - start, 1)
    total = max(len(text), 1)
    out: list[dict] = []
    cursor = start
    for i, w in enumerate(words):
        frac = max(len(w), 1) / total
        w_end = min(end, cursor + max(int(dur * frac), min_dur_ms))
        out.append({
            "text": w,
            "translit_text": (tr_words[i] if tr_words and i < len(tr_words) else None),
            "start_ms": cursor,
            "end_ms": w_end,
            "speaker": seg.get("speaker"),
        })
        cursor = w_end
    if out:
        out[-1]["end_ms"] = end
    return out


def build_cues_from_segments(segments: list[dict], prefs: "CuePrefs | None" = None) -> list[Cue]:
    """segments: list of dicts with text, translit_text, start_ms, end_ms.
    `prefs` controls max line length, minimum duration, inter-cue gap and
    single-word vs balanced two-line layout (New Project modal)."""
    prefs = prefs or CuePrefs()
    max_line = max(4, int(prefs.max_chars))
    max_total = max_line * (1 if prefs.single_word else MAX_LINES)
    min_dur = max(1, int(prefs.min_dur_ms))
    gap = max(0, int(prefs.gap_ms))

    exploded: list[dict] = []
    for seg in segments:
        if not (seg.get("text") or "").strip():
            continue
        if prefs.single_word:
            exploded.extend(_explode_words(seg, min_dur))
        else:
            exploded.extend(_split_long_segment(seg, max_total))

    cues: list[Cue] = []
    idx = 0
    for seg in exploded:
        start = int(seg["start_ms"])
        end = int(seg["end_ms"])
        if end - start < min_dur:
            end = start + min_dur
        if prefs.single_word:
            wrapped, lines = seg["text"], 1
        else:
            wrapped, lines = _wrap_two_lines(seg["text"], max_line)
        cues.append(Cue(
            idx=idx,
            start_ms=start,
            end_ms=end,
            text=wrapped,
            translit_text=seg.get("translit_text"),
            line_count=lines,
        ))
        idx += 1

    # prevent overlaps and enforce the requested gap between cues
    for i in range(1, len(cues)):
        min_start = cues[i - 1].end_ms + gap
        if cues[i].start_ms < min_start:
            cues[i].start_ms = min_start
            if cues[i].end_ms <= cues[i].start_ms:
                cues[i].end_ms = cues[i].start_ms + min_dur
    return cues


# ---------- serializers ----------

def _ms_to_srt(ms: int) -> str:
    ms = max(ms, 0)
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _ms_to_vtt(ms: int) -> str:
    return _ms_to_srt(ms).replace(",", ".")


def _ms_to_ass(ms: int) -> str:
    ms = max(ms, 0)
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    cs = ms // 10
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def _cue_text(cue: dict, use_translit: bool) -> str:
    if use_translit and cue.get("translit_text"):
        return cue["translit_text"]
    return cue["text"]


def to_srt(cues: list[dict], use_translit: bool = False) -> str:
    out = []
    for i, c in enumerate(cues, start=1):
        out.append(str(i))
        out.append(f"{_ms_to_srt(c['start_ms'])} --> {_ms_to_srt(c['end_ms'])}")
        out.append(_cue_text(c, use_translit))
        out.append("")
    return "\n".join(out).strip() + "\n"


def to_vtt(cues: list[dict], use_translit: bool = False) -> str:
    out = ["WEBVTT", ""]
    for c in cues:
        out.append(f"{_ms_to_vtt(c['start_ms'])} --> {_ms_to_vtt(c['end_ms'])}")
        out.append(_cue_text(c, use_translit))
        out.append("")
    return "\n".join(out).strip() + "\n"


ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H00000000,&H90000000,-1,0,1,3,1,2,60,60,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def to_ass(cues: list[dict], use_translit: bool = False) -> str:
    lines = [ASS_HEADER]
    for c in cues:
        text = _cue_text(c, use_translit).replace("\n", "\\N")
        lines.append(
            f"Dialogue: 0,{_ms_to_ass(c['start_ms'])},{_ms_to_ass(c['end_ms'])},"
            f"Default,,0,0,0,,{text}"
        )
    return "\n".join(lines) + "\n"


SERIALIZERS = {"srt": to_srt, "vtt": to_vtt, "ass": to_ass}
