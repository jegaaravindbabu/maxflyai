"""ffmpeg helpers: probe duration, extract audio, detect silences, burn captions."""
import json
import os
import re
import subprocess
import tempfile


# Shared low-memory H.264 encode flags. Tuned to keep peak RSS well under
# Render's 512MB instance (single thread, small lookahead / ref buffers).
_VENC = ["-threads", "1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
         "-x264-params", "ref=2:rc-lookahead=10:sync-lookahead=0:bframes=2",
         "-pix_fmt", "yuv420p", "-max_muxing_queue_size", "1024"]

# Hard wall-clock cap: a hung ffmpeg becomes a clean error instead of an
# export stuck in "processing" forever.
_FFMPEG_TIMEOUT = 1500


# Kill an ffmpeg encode if its RSS approaches the instance ceiling, so a large
# source fails with a clear error instead of OOM-killing the whole container
# (which 502s every user). Overridable via FFMPEG_MEM_LIMIT_MB.
_MEM_LIMIT_MB = int(os.environ.get("FFMPEG_MEM_LIMIT_MB", "330"))


def _proc_rss_mb(pid: int) -> int:
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024
    except Exception:
        pass
    return 0


def _run(cmd: list[str], timeout: int | None = _FFMPEG_TIMEOUT) -> subprocess.CompletedProcess:
    is_ffmpeg = bool(cmd) and cmd[0] == "ffmpeg"
    if is_ffmpeg and "-nostdin" not in cmd:
        cmd = [cmd[0], "-nostdin", *cmd[1:]]
    # Bound decoder memory for large (e.g. 4K) sources: single-thread, slice-based
    # decoding keeps peak RSS well under the 512MB instance during the decode stage.
    if is_ffmpeg and "-i" in cmd and "-thread_type" not in cmd:
        i = cmd.index("-i")
        cmd = cmd[:i] + ["-threads", "1", "-thread_type", "slice"] + cmd[i:]
    if not is_ffmpeg:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

    # ffmpeg: run under a memory + time watchdog.
    import time as _t
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            stdin=subprocess.DEVNULL, text=True)
    killed_mem = False
    deadline = _t.time() + (timeout or _FFMPEG_TIMEOUT)
    while proc.poll() is None:
        if _proc_rss_mb(proc.pid) > _MEM_LIMIT_MB:
            killed_mem = True
            proc.kill()
            break
        if _t.time() > deadline:
            proc.kill()
            out, err = proc.communicate()
            return subprocess.CompletedProcess(cmd, 124,
                out or "", (err or "") + f"\n[ffmpeg timed out after {timeout}s]")
        _t.sleep(0.2)
    out, err = proc.communicate()
    if killed_mem:
        err = (err or "") + (f"\n[ffmpeg exceeded the {_MEM_LIMIT_MB}MB memory budget "
                             "for this plan — try a lower export resolution]")
        return subprocess.CompletedProcess(cmd, 137, out or "", err)
    return subprocess.CompletedProcess(cmd, proc.returncode, out or "", err or "")


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


def audio_peaks(audio_path: str, buckets: int = 400) -> list[float]:
    """Downsample the audio to a small array of 0..1 RMS peaks for a waveform.
    Extracts mono s16le at 8 kHz and buckets it into `buckets` RMS values."""
    import array
    cp = subprocess.run(
        ["ffmpeg", "-nostdin", "-threads", "1", "-i", audio_path,
         "-ac", "1", "-ar", "8000", "-f", "s16le", "-acodec", "pcm_s16le", "-"],
        capture_output=True, timeout=_FFMPEG_TIMEOUT)
    raw = cp.stdout or b""
    if not raw:
        return []
    samples = array.array("h")
    samples.frombytes(raw[: len(raw) - (len(raw) % 2)])
    n = len(samples)
    if n == 0:
        return []
    buckets = max(16, min(int(buckets), 2000))
    step = max(1, n // buckets)
    peaks: list[float] = []
    for i in range(0, n, step):
        chunk = samples[i:i + step]
        if not chunk:
            continue
        acc = 0.0
        for v in chunk:
            acc += (v / 32768.0) ** 2
        peaks.append((acc / len(chunk)) ** 0.5)
    mx = max(peaks) if peaks else 1.0
    if mx > 0:
        peaks = [round(min(1.0, p / mx), 3) for p in peaks]
    return peaks[:buckets]


def burn_captions(media_path: str, ass_path: str, out_path: str,
                  audio_filter: str | None = None, video_prefilter: str | None = None) -> str:
    """Burn a styled ASS subtitle track into the video (M1 export).
    If audio_filter is given, the audio is re-encoded through it (enhancement).
    If video_prefilter is given (e.g. an auto-zoom zoompan), it is chained before
    the subtitle burn."""
    # escape path for the subtitles filter
    safe = ass_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    vf = (video_prefilter + "," if video_prefilter else "") + f"subtitles='{safe}'"
    cmd = ["ffmpeg", "-y", "-i", media_path, "-vf", vf, *_VENC]
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
    # Normalise the concatenated video: even dimensions + yuv420p so libx264
    # accepts sources that are 10-bit / 4:4:4 / odd-sized (e.g. After Effects
    # exports), and re-time audio so the tracks stay in sync across cuts.
    filter_complex = (";".join(filters) + ";" + concat +
                      f"concat=n={len(keep)}:v=1:a=1[vc][ac];"
                      "[vc]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[v];"
                      "[ac]aresample=async=1:first_pts=0[a]")
    cp = _run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", media_path,
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "[a]",
        *_VENC, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        out_path,
    ])
    if cp.returncode != 0:
        raise RuntimeError(f"ffmpeg trim/concat failed: {cp.stderr[-1200:]}")
    return out_path


def _atempo_chain(speed: float) -> str:
    """ffmpeg atempo only accepts 0.5-2.0 per instance; chain to reach any factor."""
    parts = []
    r = float(speed)
    while r > 2.0 + 1e-6:
        parts.append("atempo=2.0"); r /= 2.0
    while r < 0.5 - 1e-6:
        parts.append("atempo=0.5"); r /= 0.5
    parts.append(f"atempo={r:.5f}")
    return ",".join(parts)


def speed_video(src: str, out_path: str, speed: float) -> str:
    """Re-time the whole clip by `speed` (video setpts + audio atempo)."""
    sp = max(0.1, float(speed))
    fc = f"[0:v]setpts=PTS/{sp:.5f}[v];[0:a]{_atempo_chain(sp)}[a]"
    cmd = ["ffmpeg", "-y", "-i", src, "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
           *_VENC, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out_path]
    cp = _run(cmd)
    if cp.returncode != 0:
        raise RuntimeError(f"ffmpeg speed change failed: {cp.stderr[-400:]}")
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
def audio_enhance_filter(arnndn_model: str | None = None, strength: int = 50) -> str:
    # strength 0..100 controls how aggressive the noise reduction is.
    # noise floor: light (-15dB) at 0, ~-25dB at 50, aggressive (-35dB) at 100.
    try:
        st = max(0, min(100, int(strength)))
    except Exception:
        st = 50
    nf = -15 - round(st / 100 * 20)          # -15 .. -35
    stages = []
    if arnndn_model:
        safe = arnndn_model.replace("\\", "/").replace(":", "\\:")
        stages.append(f"arnndn=m='{safe}'")
    stages += [
        "highpass=f=80",
        f"afftdn=nf={nf}:tn=1",
        "acompressor=threshold=-18dB:ratio=3:attack=20:release=250",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
    ]
    return ",".join(stages)


def render_mp4(video_src: str, ass_path: str, out_path: str, width: int,
               height: int | None = None,
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
        size = float(img.get("size_pct", 100))
        fx = max(0.0, min(1.0, float(img.get("x_pct", 50)) / 100.0))
        fy = max(0.0, min(1.0, float(img.get("y_pct", 20)) / 100.0))
        s = max(0, int(img.get("start_ms", 0))) / 1000.0
        e = max(0, int(img.get("end_ms", 3000))) / 1000.0
        if size >= 90 and height:
            # full-frame photo: scale to cover the frame, crop, overlay for its span
            W, H = int(width), int(height)
            parts.append(
                f"[{i+1}:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
                f"crop={W}:{H}[img{i}]")
            parts.append(
                f"[{cur}][img{i}]overlay=0:0:"
                f"enable='between(t,{s:.3f},{e:.3f})'[ov{i}]")
        else:
            pxw = max(16, round(width * size / 100.0))
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
        size = float(br.get("size_pct", 100))
        fx = max(0.0, min(1.0, float(br.get("x_pct", 0)) / 100.0))
        fy = max(0.0, min(1.0, float(br.get("y_pct", 0)) / 100.0))
        s = max(0, int(br.get("start_ms", 0))) / 1000.0
        e = max(0, int(br.get("end_ms", 3000))) / 1000.0
        if size >= 90 and height:
            # full-frame B-roll: scale to cover the frame, crop, overlay for its span
            W, H = int(width), int(height)
            parts.append(
                f"[{in_idx}:v]setpts=PTS-STARTPTS+{s:.3f}/TB,"
                f"scale={W}:{H}:force_original_aspect_ratio=increase,"
                f"crop={W}:{H}[bv{j}]")
            parts.append(
                f"[{cur}][bv{j}]overlay=0:0:"
                f"enable='between(t,{s:.3f},{e:.3f})'[ovb{j}]")
        else:
            pxw = max(16, round(width * size / 100.0))
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
    cmd += [*_VENC, "-movflags", "+faststart", out_path]
    cp = _run(cmd)
    if cp.returncode != 0:
        raise RuntimeError(f"render_mp4 failed: {cp.stderr[-400:]}")
    return out_path


def compose_canvas(src: str, out_path: str, w: int, h: int, bg_type: str = "color",
                   color: str = "#000000", image_path: str | None = None,
                   blur_radius: int = 24, scale_pct: int = 100) -> str:
    """Place `src` (contain-fit, centred) onto a w×h canvas with a background:
    color | blur (blurred cover of the video) | image. `scale_pct` shrinks the
    foreground video (padding around it); `blur_radius` sets the blur strength.
    Audio is copied."""
    sp = max(30, min(int(scale_pct), 100))
    fw, fh = max(2, round(w * sp / 100)), max(2, round(h * sp / 100))
    br = max(2, min(int(blur_radius), 60))
    hexc = (color or "#000000").lstrip("#")
    if len(hexc) == 3:
        hexc = "".join(c * 2 for c in hexc)
    if len(hexc) != 6:
        hexc = "000000"
    inputs = ["-i", src]
    if bg_type == "image" and image_path:
        inputs += ["-i", image_path]

    fg = f"[0:v]scale={fw}:{fh}:force_original_aspect_ratio=decrease[fg]"
    if bg_type == "blur":
        bg = f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=luma_radius={br}:luma_power=1[bg]"
    elif bg_type == "image" and image_path:
        bg = f"[1:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}[bg]"
    else:
        bg = f"color=c=0x{hexc}:s={w}x{h}:r=30[bg]"
    graph = f"{bg};{fg};[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:shortest=1[v]"

    cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", graph,
           "-map", "[v]", "-map", "0:a?", "-c:a", "aac", "-b:a", "192k",
           *_VENC, "-movflags", "+faststart", out_path]
    cp = _run(cmd)
    if cp.returncode != 0:
        raise RuntimeError(f"compose_canvas failed: {cp.stderr[-400:]}")
    return out_path


# ---------------------------------------------------------------------------
# Video-tab effects ("videofx") -> a linear -vf chain, baked into the export.
# The input frame is already scaled to (ow x oh). Every stage is optional and
# only added when it deviates from the default, so untouched clips are untouched.
#
# Baked: crop (inset), loop motion (shake / float / sway / pulse / zoom),
#        blur, opacity, outline, and In/Out animation as REAL motion
#        (slides, rotate, zoom, pop; fade / fade-blur / type-on bake as fade,
#        flip approximated as zoom).
# Rounded corners are baked separately by rounded_corners_pass() (a one-time
# mask overlay, not a per-frame filter). Drop shadow stays editor-preview only
# (only visible when the clip is smaller than the canvas).
# ---------------------------------------------------------------------------
def _hex_to_0x(color: str, default: str = "0x000000") -> str:
    if not color:
        return default
    c = color.strip().lstrip("#")
    if len(c) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in c):
        return "0x" + c
    return default


def build_videofx_filter(fx: dict | None, ow: int, oh: int,
                         dur_s: float | None = None, fps: float = 30.0) -> str | None:
    if not fx:
        return None
    parts: list[str] = []

    def _num(k, d=0):
        try:
            return float(fx.get(k, d) or 0)
        except Exception:
            return d

    # 1) crop (inset): keep frame size, mask edges with black — matches the
    #    editor's clip-path inset preview.
    L, R, T, B = _num("cropL"), _num("cropR"), _num("cropT"), _num("cropB")
    if (L + R) < 100 and (T + B) < 100 and (L or R or T or B):
        cw = max(2, int(round(ow * (1 - (L + R) / 100.0))) // 2 * 2)
        ch = max(2, int(round(oh * (1 - (T + B) / 100.0))) // 2 * 2)
        cx = int(round(ow * L / 100.0))
        cy = int(round(oh * T / 100.0))
        parts.append(f"crop={cw}:{ch}:{cx}:{cy}")
        parts.append(f"pad={ow}:{oh}:{cx}:{cy}:color=black")

    # 2) loop motion (continuous). Upscale a touch so shake/float never reveal
    #    an edge; sway pre-scales more to hide rotation corners.
    loop = str(fx.get("animLoop", "none") or "none")
    if loop == "shakeH":
        parts.append(f"scale=ceil({ow}*1.05/2)*2:ceil({oh}*1.05/2)*2")
        parts.append(f"crop={ow}:{oh}:x='(in_w-{ow})/2+7*sin(2*PI*t/0.55)':y='(in_h-{oh})/2'")
    elif loop == "shakeV":
        parts.append(f"scale=ceil({ow}*1.05/2)*2:ceil({oh}*1.05/2)*2")
        parts.append(f"crop={ow}:{oh}:x='(in_w-{ow})/2':y='(in_h-{oh})/2+7*sin(2*PI*t/0.55)'")
    elif loop == "float":
        parts.append(f"scale=ceil({ow}*1.05/2)*2:ceil({oh}*1.05/2)*2")
        parts.append(f"crop={ow}:{oh}:x='(in_w-{ow})/2':y='(in_h-{oh})/2+10*sin(2*PI*t/3)'")
    elif loop == "sway":
        parts.append(f"scale=ceil({ow}*1.10/2)*2:ceil({oh}*1.10/2)*2")
        parts.append("rotate=a='0.03*sin(2*PI*t/3)':c=black")
        parts.append(f"crop={ow}:{oh}")
    elif loop in ("pulse", "zoom"):
        amp = 0.03 if loop == "pulse" else 0.05
        per = 2.0 if loop == "pulse" else 4.0
        pf = max(1, int(round(per * (fps or 30))))
        base = 1.0 + amp
        parts.append(
            f"zoompan=z='{base:.3f}+{amp:.3f}*sin(2*PI*on/{pf})':d=1:"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={ow}x{oh}:fps={fps:.4f}")

    # 3) blur
    b = _num("blur")
    if b > 0:
        parts.append(f"gblur=sigma={b*0.15:.2f}")

    # 4) opacity (blend toward black — matches opacity-over-dark preview)
    op = _num("opacity", 100)
    if op < 100:
        o = max(0.0, min(1.0, op / 100.0))
        parts.append(f"colorchannelmixer=rr={o:.3f}:gg={o:.3f}:bb={o:.3f}")

    # 5) outline (inner colored border ring)
    osize = _num("outlineSize")
    if osize > 0:
        col = _hex_to_0x(str(fx.get("outlineColor", "#000000")))
        t = int(round(osize))
        parts.append(f"drawbox=x=0:y=0:w={ow}:h={oh}:t={t}:color={col}")

    # 6) In / Out animation (entrance & exit), baked as REAL motion where ffmpeg
    #    allows it in a linear chain: slides (pad+crop), rotate, zoom/pop (zoompan).
    #    fade/fade-blur -> fade; flip -> zoom; type-on -> fade (a clean reveal).
    D = 0.6
    fpf = max(1, int(round(D * (fps or 30))))
    ai = str(fx.get("animIn", "none") or "none")
    if ai in ("fade", "fadeblur", "typeon"):
        parts.append(f"fade=t=in:st=0:d={D}:alpha=0")
    elif ai in ("zoom", "pop", "flip"):
        parts.append(f"zoompan=z='if(lte(on\\,{fpf})\\,1.25-0.25*on/{fpf}\\,1)':d=1:"
                     f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={ow}x{oh}:fps={(fps or 30):.4f}")
    elif ai == "rotate":
        parts.append(f"rotate=a='if(lt(t\\,{D})\\,-0.26*(1-t/{D})\\,0)':ow={ow}:oh={oh}:c=black")
    elif ai == "slideup":
        parts.append(f"pad={ow}:{2*oh}:0:{oh}:color=black,crop={ow}:{oh}:0:{oh}*min(t/{D}\\,1)")
    elif ai == "slidedown":
        parts.append(f"pad={ow}:{2*oh}:0:0:color=black,crop={ow}:{oh}:0:{oh}*(1-min(t/{D}\\,1))")
    elif ai == "slideleft":
        parts.append(f"pad={2*ow}:{oh}:{ow}:0:color=black,crop={ow}:{oh}:{ow}*min(t/{D}\\,1):0")
    elif ai == "slideright":
        parts.append(f"pad={2*ow}:{oh}:0:0:color=black,crop={ow}:{oh}:{ow}*(1-min(t/{D}\\,1)):0")
    elif ai != "none":
        parts.append(f"fade=t=in:st=0:d={D}:alpha=0")

    ao = str(fx.get("animOut", "none") or "none")
    if ao != "none" and dur_s and dur_s > (D + 0.1):
        st = dur_s - D
        s0 = int(round(st * (fps or 30)))
        if ao == "zoom":
            parts.append(f"zoompan=z='if(gte(on\\,{s0})\\,1+0.25*(on-{s0})/{fpf}\\,1)':d=1:"
                         f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={ow}x{oh}:fps={(fps or 30):.4f}")
        elif ao == "rotate":
            parts.append(f"rotate=a='if(gt(t\\,{st:.2f})\\,0.26*(t-{st:.2f})/{D}\\,0)':ow={ow}:oh={oh}:c=black")
        elif ao == "slidedown":
            parts.append(f"pad={ow}:{2*oh}:0:{oh}:color=black,crop={ow}:{oh}:0:{oh}*(1-max(0\\,min((t-{st:.2f})/{D}\\,1)))")
        elif ao == "slideup":
            parts.append(f"pad={ow}:{2*oh}:0:0:color=black,crop={ow}:{oh}:0:{oh}*max(0\\,min((t-{st:.2f})/{D}\\,1))")
        else:  # fade (and any other)
            parts.append(f"fade=t=out:st={st:.2f}:d={D}:alpha=0")

    return ",".join(parts) if parts else None


def rounded_corners_pass(in_path: str, out_path: str, w: int, h: int,
                         radius_pct: float) -> str:
    """Round the video's corners as a SEPARATE compositing pass: build a
    rounded-rect alpha mask ONCE (a single geq frame, so no per-frame cost),
    alpha-merge it onto the clip, and flatten over black. `radius_pct` is the
    Video-tab 'radius' 0..100 (editor uses radius/2 %% of the shorter side)."""
    import tempfile as _tf
    r = int(round((radius_pct / 2.0) / 100.0 * min(w, h)))
    r = max(1, min(r, min(w, h) // 2))
    fd, mask = _tf.mkstemp(suffix=".png"); os.close(fd)
    # one-shot mask: white inside the rounded rect, black in the corner arcs
    corner = (f"pow(max(0\\,{r}-min(X\\,{w}-1-X))\\,2)"
              f"+pow(max(0\\,{r}-min(Y\\,{h}-1-Y))\\,2)")
    mask_vf = f"format=gray,geq=lum='if(gt({corner}\\,{r}*{r})\\,0\\,255)'"
    m = _run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=black:s={w}x{h}",
              "-vf", mask_vf, "-frames:v", "1", mask])
    if m.returncode != 0:
        raise RuntimeError(f"rounded mask failed: {m.stderr[-400:]}")
    try:
        fc = (f"[0:v][1:v]alphamerge[a];color=c=black:s={w}x{h}[bg];"
              f"[bg][a]overlay=format=auto:shortest=1,format=yuv420p[v]")
        cp = _run(["ffmpeg", "-y", "-i", in_path, "-i", mask,
                   "-filter_complex", fc, "-map", "[v]", "-map", "0:a?",
                   *_VENC, "-c:a", "copy", "-movflags", "+faststart", out_path])
        if cp.returncode != 0:
            raise RuntimeError(f"rounded composite failed: {cp.stderr[-400:]}")
    finally:
        try: os.remove(mask)
        except Exception: pass
    return out_path


def drop_shadow_pass(in_path: str, out_path: str, w: int, h: int,
                     sx: float, sy: float, blur: float, color: str,
                     bg_color: str = "black") -> str:
    """Bake a drop shadow: inset the clip on a `bg_color` canvas and place an
    offset, blurred dark copy of it behind — so the shadow actually shows
    (a full-frame clip has nowhere to cast one). Offsets/blur are Video-tab px."""
    sxi, syi, bl = int(round(sx)), int(round(sy)), max(0.0, float(blur))
    pad = max(12, int(round(bl * 1.2 + max(abs(sxi), abs(syi)) + 12)))
    pad = min(pad, int(min(w, h) * 0.18))
    iw = max(2, (w - 2 * pad) // 2 * 2)
    ih = max(2, (h - 2 * pad) // 2 * 2)
    cx, cy = (w - iw) // 2, (h - ih) // 2
    sig = round(bl * 0.7, 2)
    scol = _hex_to_0x(color, "0x000000")
    bg = bg_color if bg_color in ("black", "white") else _hex_to_0x(bg_color, "0x000000")
    shadow_layer = (f"[shb][shs]overlay=x={cx + sxi}:y={cy + syi}[sho];"
                    f"[sho]gblur=sigma={sig}[shbl];") if sig > 0 else \
                   (f"[shb][shs]overlay=x={cx + sxi}:y={cy + syi}[shbl];")
    fc = (f"[0:v]scale={iw}:{ih}[clip];"
          f"color=c={scol}@0.5:s={iw}x{ih},format=rgba[shs];"
          f"color=c=black@0:s={w}x{h},format=rgba[shb];"
          + shadow_layer +
          f"color=c={bg}:s={w}x{h}[bg];"
          f"[bg][shbl]overlay=0:0[bg2];"
          f"[bg2][clip]overlay=x={cx}:y={cy}:format=auto,format=yuv420p[v]")
    cp = _run(["ffmpeg", "-y", "-i", in_path, "-filter_complex", fc,
               "-map", "[v]", "-map", "0:a?", *_VENC, "-c:a", "copy",
               "-movflags", "+faststart", out_path])
    if cp.returncode != 0:
        raise RuntimeError(f"drop shadow failed: {cp.stderr[-400:]}")
    return out_path
