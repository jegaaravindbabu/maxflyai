"""
Caption timing via silence-anchored segmentation.

Sarvam returns an accurate transcript but only ONE timestamp for the whole
request (confirmed on real Tamil clips, REST and Batch). So we derive cue timing
ourselves:

  1. speech_segments_from_silence(): ffmpeg silencedetect -> the real time
     boundaries of speech runs (anchored to actual pauses in the audio).
  2. distribute_text_over_segments(): spread the transcript's words across those
     timed segments in proportion to each segment's duration.

The result is timed phrase segments that the existing caption cue builder turns
into cues. Timing is anchored to real pauses, so cues start/end on natural
boundaries instead of a single 25s block. Word placement within a segment is
proportional (approximate) — good enough to edit, and the user can nudge.
"""
from __future__ import annotations

from app.services import ffmpeg_utils

# cue sizing (kept consistent with captions.py)
MAX_SEG_MS = 6000
MIN_SPEECH_MS = 200


def _complement_speech(silences: list[dict], duration_ms: int) -> list[dict]:
    """Given silence intervals, return the speech intervals between them."""
    speech: list[dict] = []
    cursor = 0
    for sil in sorted(silences, key=lambda s: s["start_ms"]):
        s_start = max(0, sil["start_ms"])
        s_end = min(duration_ms, sil["end_ms"])
        if s_start > cursor:
            speech.append({"start_ms": cursor, "end_ms": s_start})
        cursor = max(cursor, s_end)
    if cursor < duration_ms:
        speech.append({"start_ms": cursor, "end_ms": duration_ms})
    return [s for s in speech if s["end_ms"] - s["start_ms"] >= MIN_SPEECH_MS]


def _split_long(seg: dict, max_ms: int = MAX_SEG_MS) -> list[dict]:
    """Split a speech run longer than max_ms into equal time slices."""
    dur = seg["end_ms"] - seg["start_ms"]
    if dur <= max_ms:
        return [seg]
    n = -(-dur // max_ms)  # ceil
    step = dur / n
    out = []
    for i in range(n):
        out.append({
            "start_ms": int(seg["start_ms"] + i * step),
            "end_ms": int(seg["start_ms"] + (i + 1) * step),
        })
    out[-1]["end_ms"] = seg["end_ms"]
    return out


def speech_segments_from_silence(audio_path: str, duration_ms: int,
                                 noise_db: float | None = None,
                                 min_silence_ms: int = 250) -> list[dict]:
    """Return cue-sized speech segments [{start_ms, end_ms}] anchored to pauses.

    noise_db=None auto-calibrates the threshold from the clip's mean volume
    (mean + 2 dB), which works for both quiet and heavily-normalized audio.
    """
    if noise_db is None:
        mean = ffmpeg_utils.mean_volume(audio_path)
        noise_db = (mean + 2.0) if mean is not None else -30.0
    silences = ffmpeg_utils.detect_silences(audio_path, noise_db=noise_db,
                                             min_ms=min_silence_ms)
    speech = _complement_speech(silences, duration_ms)
    if not speech:  # no pauses detected -> treat whole clip as one run
        speech = [{"start_ms": 0, "end_ms": duration_ms}]
    segments: list[dict] = []
    for run in speech:
        segments.extend(_split_long(run))
    return segments


def distribute_text_over_segments(full_text: str, segments: list[dict],
                                  translit_text: str | None = None) -> list[dict]:
    """Spread words across timed segments in proportion to each segment's duration."""
    words = (full_text or "").split()
    if not segments:
        return []
    if not words:
        return [{"idx": i, "text": "", "translit_text": None, **s}
                for i, s in enumerate(segments)]

    total_dur = sum(s["end_ms"] - s["start_ms"] for s in segments) or 1
    tl_words = (translit_text or "").split() if translit_text else None

    out: list[dict] = []
    w_cursor = 0
    t_cursor = 0
    n_words = len(words)
    for i, seg in enumerate(segments):
        remaining_segs = len(segments) - i
        frac = (seg["end_ms"] - seg["start_ms"]) / total_dur
        take = max(1, round(n_words * frac))
        # don't strand words on the last segment / don't overrun
        if remaining_segs == 1:
            take = n_words - w_cursor
        take = min(take, n_words - w_cursor)
        chunk = words[w_cursor:w_cursor + take]
        w_cursor += take

        tl_chunk = None
        if tl_words is not None:
            tl_take = max(1, round(len(tl_words) * frac))
            if remaining_segs == 1:
                tl_take = len(tl_words) - t_cursor
            tl_take = min(tl_take, len(tl_words) - t_cursor)
            tl_chunk = " ".join(tl_words[t_cursor:t_cursor + tl_take])
            t_cursor += tl_take

        out.append({
            "idx": i,
            "text": " ".join(chunk),
            "translit_text": tl_chunk,
            "start_ms": seg["start_ms"],
            "end_ms": seg["end_ms"],
        })
        if w_cursor >= n_words:
            # ran out of words but segments remain -> stop (trailing silence)
            break
    return [s for s in out if s["text"].strip()]


def timed_segments_from_transcript(audio_path: str, duration_ms: int,
                                   full_text: str, translit_text: str | None = None,
                                   noise_db: float | None = None,
                                   min_silence_ms: int = 250) -> list[dict]:
    """Convenience: silence segments + text distribution in one call."""
    segs = speech_segments_from_silence(audio_path, duration_ms,
                                        noise_db=noise_db, min_silence_ms=min_silence_ms)
    return distribute_text_over_segments(full_text, segs, translit_text)
