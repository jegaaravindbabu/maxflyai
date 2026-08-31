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
                  audio_filter: str | None = None, video_prefilter: str | None = None) -> str:
    """Burn a styled ASS subtitle track into the video (M1 export).
    If audio_filter is given, the audio is re-encoded through it (enhancement).
    If video_prefilter is given (e.g. an auto-zoom zoompan), it is chained before
    the subtitle burn."""
    # escape path for the subtitles filter
    safe = ass_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    vf = (video_prefilter + "," if video_prefilter else "") + f"subtitles='{safe}'"
    cmd = ["ffmpeg", "-y", "-i", media_path, "-vf", vf,
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"]
    if audio_filter:
        cmd += ["-af", audio_filter]
    cmd += ["-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out_path]
    cp = _run(cmd)
    if cp.returncode != 0:
        raise RuntimeError(f"ffmpeg burn-in failed: {cp.stderr[-600:]}")
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


def render_mp4(video_src: str, ass_path: str, out_path: str, width: int,
               vfilters: list[str] | None = None,
               images: list[dict] | None = None,
               brolls: list[dict] | None = None,
               audio_filter: str | None = None) -> str:
    """Full composite render: base video -> vfilters (zoom/colour) -> B-roll clips
    -> image overlays -> burned captions, in a single filter_complex pass.
    `images`/`brolls` items: {path, start_ms, end_ms, x_pct, y_pct, size_pct}.
    B-roll audio is dropped; the main audio is kept."""
    vfilters = [v for v in (vfilters or []) if v]
    images = images or []
    brolls = brolls or []
    safe = ass_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")

    inputs = ["-i", video_src]
    for img in images:
        inputs += ["-i", img["path"]]
    for br in brolls:
        inputs += ["-i", br["path"]]

    parts = []
    pre = ",".join(vfilters) if vfilters else "null"
    parts.append(f"[0:v]{pre}[base]")
    cur = "base"
    # image overlays (input indices 1..len(images))
    for i, img in enumerate(images):
        pxw = max(16, round(width * float(img.get("size_pct", 40)) / 100.0))
        fx = max(0.0, min(1.0, float(img.get("x_pct", 50)) / 100.0))
        fy = max(0.0, min(1.0, float(img.get("y_pct", 20)) / 100.0))
        s = max(0, int(img.get("start_ms", 0))) / 1000.0
        e = max(0, int(img.get("end_ms", 3000))) / 1000.0
        parts.append(f"[{i+1}:v]scale={pxw}:-1[img{i}]")
        parts.append(
            f"[{cur}][img{i}]overlay="
            f"x='max(0,min(main_w*{fx:.4f},main_w-overlay_w))':"
            f"y='max(0,min(main_h*{fy:.4f},main_h-overlay_h))':"
            f"enable='between(t,{s:.3f},{e:.3f})'[ov{i}]")
        cur = f"ov{i}"
    # B-roll clips (input indices after images); time-shift so each starts at its window
    base_idx = 1 + len(images)
    for j, br in enumerate(brolls):
        in_idx = base_idx + j
        pxw = max(16, round(width * float(br.get("size_pct", 100)) / 100.0))
        fx = max(0.0, min(1.0, float(br.get("x_pct", 0)) / 100.0))
        fy = max(0.0, min(1.0, float(br.get("y_pct", 0)) / 100.0))
        s = max(0, int(br.get("start_ms", 0))) / 1000.0
        e = max(0, int(br.get("end_ms", 3000))) / 1000.0
        parts.append(f"[{in_idx}:v]scale={pxw}:-1,setpts=PTS-STARTPTS+{s:.3f}/TB[bv{j}]")
        parts.append(
            f"[{cur}][bv{j}]overlay="
            f"x='max(0,min(main_w*{fx:.4f},main_w-overlay_w))':"
            f"y='max(0,min(main_h*{fy:.4f},main_h-overlay_h))':"
            f"enable='between(t,{s:.3f},{e:.3f})'[ovb{j}]")
        cur = f"ovb{j}"
    parts.append(f"[{cur}]subtitles='{safe}'[vout]")
    filter_complex = ";".join(parts)

    cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", filter_complex,
           "-map", "[vout]", "-map", "0:a?"]
    if audio_filter:
        cmd += ["-af", audio_filter, "-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_path]
    cp = _run(cmd)
    if cp.returncode != 0:
        raise RuntimeError(f"render_mp4 failed: {cp.stderr[-400:]}")
    return out_path


def compose_canvas(src: str, out_path: str, w: int, h: int, bg_type: str = "color",
                   color: str = "#000000", image_path: str | None = None) -> str:
    """Place `src` (contain-fit, centred) onto a w×h canvas with a background:
    color | blur (blurred cover of the video) | image. Audio is copied."""
    hexc = (color or "#000000").lstrip("#")
    if len(hexc) == 3:
        hexc = "".join(c * 2 for c in hexc)
    if len(hexc) != 6:
        hexc = "000000"
    inputs = ["-i", src]
    if bg_type == "image" and image_path:
        inputs += ["-i", image_path]

    fg = f"[0:v]scale={w}:{h}:force_original_aspect_ratio=decrease[fg]"
    if bg_type == "blur":
        bg = f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=luma_radius=24:luma_power=1[bg]"
    elif bg_type == "image" and image_path:
        bg = f"[1:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}[bg]"
    else:
        bg = f"color=c=0x{hexc}:s={w}x{h}:r=30[bg]"
    graph = f"{bg};{fg};[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:shortest=1[v]"

    cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", graph,
           "-map", "[v]", "-map", "0:a?", "-c:a", "aac", "-b:a", "192k",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_path]
    cp = _run(cmd)
    if cp.returncode != 0:
        raise RuntimeError(f"compose_canvas failed: {cp.stderr[-400:]}")
    return out_path
