"""ffmpeg helpers: probe duration, extract audio, detect silences, burn captions."""
import json
import os
import re
import subprocess
import tempfile


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def probe_duration_ms(media_path: str) -> int | None:
    cp = _run([
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", media_path,
    ])
    if cp.returncode != 0:
        return None
    try:
        data = json.loads(cp.stdout)
        return int(float(data["format"]["duration"]) * 1000)
    except Exception:
        return None


def extract_audio(media_path: str, out_path: str | None = None,
                  sample_rate: int = 16000) -> str:
    """Extract mono 16kHz WAV — the format ASR likes."""
    if out_path is None:
        fd, out_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
    cp = _run([
        "ffmpeg", "-y", "-i", media_path,
        "-vn", "-ac", "1", "-ar", str(sample_rate),
        "-c:a", "pcm_s16le", out_path,
    ])
    if cp.returncode != 0:
        raise RuntimeError(f"ffmpeg audio extract failed: {cp.stderr[-500:]}")
    return out_path


_SIL_RE_START = re.compile(r"silence_start:\s*([0-9.]+)")
_SIL_RE_END = re.compile(r"silence_end:\s*([0-9.]+)")


def detect_silences(audio_path: str, noise_db: float = -30.0,
                    min_ms: int = 600) -> list[dict]:
    """Return [{start_ms, end_ms}] of detected silences (for M3 silence remover)."""
    min_s = min_ms / 1000.0
    cp = _run([
        "ffmpeg", "-i", audio_path,
        "-af", f"silencedetect=noise={noise_db}dB:d={min_s}",
        "-f", "null", "-",
    ])
    log = cp.stderr
    starts = [float(m) for m in _SIL_RE_START.findall(log)]
    ends = [float(m) for m in _SIL_RE_END.findall(log)]
    out = []
    for s, e in zip(starts, ends):
        out.append({"start_ms": int(s * 1000), "end_ms": int(e * 1000)})
    return out


def burn_captions(media_path: str, ass_path: str, out_path: str,
                  audio_filter: str | None = None) -> str:
    """Burn a styled ASS subtitle track into the video (M1 export).
    If audio_filter is given, the audio is re-encoded through it (enhancement)."""
    # escape path for the subtitles filter
    safe = ass_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    cmd = ["ffmpeg", "-y", "-i", media_path, "-vf", f"subtitles='{safe}'"]
    if audio_filter:
        cmd += ["-af", audio_filter, "-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-c:a", "copy"]
    cmd.append(out_path)
    cp = _run(cmd)
    if cp.returncode != 0:
        raise RuntimeError(f"ffmpeg burn-in failed: {cp.stderr[-500:]}")
    return out_path


_MEAN_RE = re.compile(r"mean_volume:\s*(-?[0-9.]+)\s*dB")


def mean_volume(audio_path: str) -> float | None:
    """Mean volume in dB (via ffmpeg volumedetect). Used to auto-calibrate
    the silence threshold per clip, since normalized audio barely dips."""
    cp = _run([
        "ffmpeg", "-i", audio_path, "-af", "volumedetect", "-f", "null", "-",
    ])
    m = _MEAN_RE.search(cp.stderr)
    return float(m.group(1)) if m else None


def trim_and_concat(media_path: str, keep: list[dict], out_path: str) -> str:
    """Keep only the given intervals (ms) and concatenate them into one file.
    Used to physically remove silences from the exported video."""
    if not keep:
        raise RuntimeError("no keep intervals")
    parts_v = []
    parts_a = []
    filters = []
    for i, k in enumerate(keep):
        a = k["start_ms"] / 1000.0
        b = k["end_ms"] / 1000.0
        filters.append(
            f"[0:v]trim=start={a}:end={b},setpts=PTS-STARTPTS[v{i}];"
            f"[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS[a{i}]"
        )
        parts_v.append(f"[v{i}]")
        parts_a.append(f"[a{i}]")
    concat = "".join(f"{v}{a}" for v, a in zip(parts_v, parts_a))
    filter_complex = ";".join(filters) + ";" + concat + f"concat=n={len(keep)}:v=1:a=1[v][a]"
    cp = _run([
        "ffmpeg", "-y", "-i", media_path,
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "[a]", out_path,
    ])
    if cp.returncode != 0:
        raise RuntimeError(f"ffmpeg trim/concat failed: {cp.stderr[-500:]}")
    return out_path


def video_info(media_path: str) -> dict:
    """Probe fps (as num/den), width, height for timeline export."""
    cp = _run(["ffprobe", "-v", "quiet", "-select_streams", "v:0",
               "-show_entries", "stream=r_frame_rate,width,height",
               "-print_format", "json", media_path])
    info = {"fps_num": 25, "fps_den": 1, "width": 1920, "height": 1080}
    try:
        st = json.loads(cp.stdout)["streams"][0]
        rate = st.get("r_frame_rate", "25/1")
        num, den = rate.split("/")
        info["fps_num"], info["fps_den"] = int(num), int(den or 1)
        info["width"] = int(st.get("width") or 1920)
        info["height"] = int(st.get("height") or 1080)
    except Exception:
        pass
    return info


# "Mic -> studio" voice cleanup chain (no model needed): remove rumble, FFT
# denoise, gentle compression, then EBU R128 broadcast loudness. If an arnndn
# RNN model path is configured, prepend AI denoise for stronger results.
def audio_enhance_filter(arnndn_model: str | None = None) -> str:
    stages = []
    if arnndn_model:
        safe = arnndn_model.replace("\\", "/").replace(":", "\\:")
        stages.append(f"arnndn=m='{safe}'")
    stages += [
        "highpass=f=80",
        "afftdn=nf=-25",
        "acompressor=threshold=-18dB:ratio=3:attack=20:release=250",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
    ]
    return ",".join(stages)
