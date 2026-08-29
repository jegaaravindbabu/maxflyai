"""
Day-1 Thanglish quality gate (PRD 5.2 / 13).
Runs transcribe + translit + codemix on a real clip and prints the outputs so you
can eyeball whether Sarvam's romanization is creator-grade or needs a style layer.

Usage:
  python scripts/sarvam_quality_test.py path/to/tamil_clip.wav [language_code]
Requires SARVAM_API_KEY in backend/.env (or the environment).
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import sarvam, ffmpeg_utils  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    media = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else "ta-IN"

    audio = ffmpeg_utils.extract_audio(media) if not media.endswith(".wav") else media
    dur = ffmpeg_utils.probe_duration_ms(media) or 0
    print(f"clip: {media}  duration_ms={dur}  language={lang}\n")

    for mode in ("transcribe", "translit", "codemix"):
        try:
            raw = sarvam.transcribe_rest(audio, language_code=lang, mode=mode,
                                         with_timestamps=(mode == "transcribe"))
            print(f"--- mode={mode} ---")
            print(raw.get("transcript", "").strip())
            if mode == "transcribe" and raw.get("timestamps"):
                ts = raw["timestamps"]
                print(f"[chunks: {len(ts.get('words', []))}]")
            print()
        except Exception as e:
            print(f"--- mode={mode} FAILED: {e}\n")


if __name__ == "__main__":
    main()
