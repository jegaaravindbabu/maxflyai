"""
Batch-API timing probe.

Purpose: the REST endpoint returned the whole clip as ONE timestamp chunk,
which is too coarse to time captions. This checks whether the BATCH API returns
finer chunking (many phrase-level timestamps) for the same clip.

It runs a batch transcribe job, then prints:
  - number of timestamp chunks
  - the first ~12 chunk boundaries (start -> end : text)
  - whether diarization/speaker info is present
  - dumps the full raw output JSON to  scripts/_batch_raw.json  for inspection

Usage:
  python scripts/sarvam_batch_test.py path/to/clip.mp4 [language_code]
  (language_code defaults to ta-IN; use "unknown" for auto-detect)

Needs SARVAM_API_KEY in backend/.env and ffmpeg on PATH.
Batch jobs can take a minute or two even for short clips.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import sarvam, ffmpeg_utils  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    media = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else "ta-IN"

    if not os.path.exists(media):
        print(f"File not found: {media}")
        sys.exit(1)

    if media.lower().endswith(".wav"):
        audio = media
    else:
        print("Extracting audio with ffmpeg...")
        audio = ffmpeg_utils.extract_audio(media)
    dur = ffmpeg_utils.probe_duration_ms(media) or 0
    print(f"clip: {media}  duration_ms={dur}  language={lang}")
    print("Submitting BATCH job (this can take a minute or two)...\n")

    raw = sarvam.transcribe_batch(audio, language_code=lang, mode="transcribe")

    # save raw for inspection
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_batch_raw.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(raw, f, ensure_ascii=False, indent=2)
    print(f"[raw output saved to {out_path}]\n")

    print("top-level keys:", sorted(raw.keys()))
    print("transcript (first 160 chars):", (raw.get("transcript") or "")[:160], "...\n")

    ts = raw.get("timestamps") or {}
    words = ts.get("words") or []
    starts = ts.get("start_time_seconds") or []
    ends = ts.get("end_time_seconds") or []
    print(f"===> TIMESTAMP CHUNKS: {len(words)} <===")
    if len(words) == len(starts) == len(ends) and words:
        for i in range(min(12, len(words))):
            print(f"  [{i}] {starts[i]:.2f}s -> {ends[i]:.2f}s : {words[i]}")
        if len(words) > 12:
            print(f"  ... (+{len(words) - 12} more)")
    else:
        print("  timestamps not in expected words[]/start[]/end[] shape; see _batch_raw.json")

    if raw.get("diarized_transcript"):
        print("\ndiarization present: yes")

    # verdict for caption timing
    print("\n--- verdict ---")
    n = len(words)
    if n <= 1:
        print("Batch is ALSO single-chunk -> need our own segmentation (VAD/silence or alignment).")
    elif dur and n >= max(3, dur / 6000):
        print(f"Batch gives {n} chunks for ~{dur/1000:.0f}s -> usable for caption cue timing.")
    else:
        print(f"Batch gives {n} chunks for ~{dur/1000:.0f}s -> better than REST but still coarse; "
              "consider a light segmentation pass.")


if __name__ == "__main__":
    main()
