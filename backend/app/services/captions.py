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


def _wrap_two_lines(text: str) -> tuple[str, int]:
    """Balance text into at most 2 lines <= MAX_CHARS_PER_LINE."""
    text = " ".join(text.split())
    if len(text) <= MAX_CHARS_PER_LINE:
        return text, 1
    words = text.split(" ")
    # find split near the middle that keeps both lines within limit
    best = None
    running = ""
    for i in range(len(words)):
        running = " ".join(words[: i + 1])
        rest = " ".join(words[i + 1:])
        if len(running) <= MAX_CHARS_PER_LINE and len(rest) <= MAX_CHARS_PER_LINE:
            # prefer the most balanced split
            score = abs(len(running) - len(rest))
            if best is None or score < best[0]:
                best = (score, running, rest)
    if best:
        return best[1] + "\n" + best[2], 2
    # fallback: hard cut
    return text[:MAX_CHARS_PER_LINE] + "\n" + text[MAX_CHARS_PER_LINE:MAX_CHARS], 2


def _split_long_segment(seg: dict) -> list[dict]:
    """Split a segment whose text is too long or duration too long into pieces."""
    text = " ".join((seg.get("text") or "").split())
    translit = seg.get("translit_text")
    start, end = seg["start_ms"], seg["end_ms"]
    dur = max(end - start, 1)
    if len(text) <= MAX_CHARS and dur <= MAX_CUE_MS:
        return [seg]

    n = max(1, -(-len(text) // MAX_CHARS), -(-dur // MAX_CUE_MS))  # ceil
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


def build_cues_from_segments(segments: list[dict]) -> list[Cue]:
    """segments: list of dicts with text, translit_text, start_ms, end_ms."""
    exploded: list[dict] = []
    for seg in segments:
        if not (seg.get("text") or "").strip():
            continue
        exploded.extend(_split_long_segment(seg))

    cues: list[Cue] = []
    idx = 0
    for seg in exploded:
        start = int(seg["start_ms"])
        end = int(seg["end_ms"])
        if end - start < MIN_CUE_MS:
            end = start + MIN_CUE_MS
        wrapped, lines = _wrap_two_lines(seg["text"])
        cues.append(Cue(
            idx=idx,
            start_ms=start,
            end_ms=end,
            text=wrapped,
            translit_text=seg.get("translit_text"),
            line_count=lines,
        ))
        idx += 1

    # prevent overlaps
    for i in range(1, len(cues)):
        if cues[i].start_ms < cues[i - 1].end_ms:
            cues[i].start_ms = cues[i - 1].end_ms
            if cues[i].end_ms <= cues[i].start_ms:
                cues[i].end_ms = cues[i].start_ms + MIN_CUE_MS
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
