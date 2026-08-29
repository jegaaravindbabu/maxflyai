"""
Editable timeline export: FCPXML (Premiere Pro / DaVinci Resolve) and CMX3600 EDL.

The timeline is built from the KEEP intervals (the clip spans left after silence
cuts), placed back-to-back — so importing gives the creator their video with dead
air already removed, fully editable. Caption cues are added as FCPXML markers.

Hand-written (no OpenTimelineIO dependency) for portability.
"""
from __future__ import annotations

import os
from fractions import Fraction
from xml.sax.saxutils import escape


# ---------------- helpers ----------------

def _ms_to_frames(ms: int, fps_num: int, fps_den: int) -> int:
    return round(ms / 1000.0 * fps_num / fps_den)


def _fcpxml_time(frames: int, fps_num: int, fps_den: int) -> str:
    """Frame count -> FCPXML rational seconds (frame-aligned)."""
    fr = Fraction(frames * fps_den, fps_num)
    return f"{fr.numerator}/{fr.denominator}s" if fr.denominator != 1 else f"{fr.numerator}s"


def _tc(frames: int, fps: int) -> str:
    """Frame count -> HH:MM:SS:FF timecode (non-drop)."""
    h = frames // (3600 * fps)
    m = (frames // (60 * fps)) % 60
    s = (frames // fps) % 60
    f = frames % fps
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"


# ---------------- EDL ----------------

def build_edl(title: str, media_name: str, keep: list[dict],
              fps_num: int = 25, fps_den: int = 1) -> str:
    fps = max(1, round(fps_num / fps_den))
    lines = [f"TITLE: {title[:70]}", "FCM: NON-DROP FRAME", ""]
    rec = 0
    for i, k in enumerate(keep, start=1):
        src_in = _ms_to_frames(k["start_ms"], fps_num, fps_den)
        src_out = _ms_to_frames(k["end_ms"], fps_num, fps_den)
        dur = src_out - src_in
        rec_in, rec_out = rec, rec + dur
        rec = rec_out
        lines.append(
            f"{i:03d}  AX       AA/V  C        "
            f"{_tc(src_in, fps)} {_tc(src_out, fps)} {_tc(rec_in, fps)} {_tc(rec_out, fps)}"
        )
        lines.append(f"* FROM CLIP NAME: {media_name}")
        lines.append("")
    return "\n".join(lines) + "\n"


# ---------------- FCPXML ----------------

def build_fcpxml(title: str, media_path: str, media_name: str, duration_ms: int,
                 keep: list[dict], cues: list[dict] | None = None,
                 fps_num: int = 25, fps_den: int = 1,
                 width: int = 1920, height: int = 1080) -> str:
    frame_dur = _fcpxml_time  # alias
    fd = f"{fps_den}/{fps_num}s" if fps_num != fps_den else "1s"
    asset_dur = _fcpxml_time(_ms_to_frames(duration_ms, fps_num, fps_den), fps_num, fps_den)
    src_url = "file://" + os.path.abspath(media_path).replace(" ", "%20")
    name = escape(media_name)

    # map original ms -> record frames, to place caption markers on the cut timeline
    def rec_frame_for(ms: int) -> int | None:
        rec = 0
        for k in keep:
            if k["start_ms"] <= ms < k["end_ms"]:
                return rec + _ms_to_frames(ms - k["start_ms"], fps_num, fps_den)
            rec += _ms_to_frames(k["end_ms"] - k["start_ms"], fps_num, fps_den)
        return None

    spine = []
    offset = 0
    for k in keep:
        start_f = _ms_to_frames(k["start_ms"], fps_num, fps_den)
        dur_f = _ms_to_frames(k["end_ms"] - k["start_ms"], fps_num, fps_den)
        spine.append(
            f'        <asset-clip ref="r2" offset="{frame_dur(offset, fps_num, fps_den)}" '
            f'name="{name}" start="{frame_dur(start_f, fps_num, fps_den)}" '
            f'duration="{frame_dur(dur_f, fps_num, fps_den)}" tcFormat="NDF"/>'
        )
        offset += dur_f

    markers = []
    for c in (cues or []):
        rf = rec_frame_for(int(c["start_ms"]))
        if rf is None:
            continue
        txt = escape((c.get("text") or "").replace("\n", " ")[:60] or "caption")
        markers.append(
            f'        <marker start="{frame_dur(rf, fps_num, fps_den)}" '
            f'duration="{frame_dur(1, fps_num, fps_den)}" value="{txt}"/>'
        )

    total_f = offset
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat" frameDuration="{fd}" width="{width}" height="{height}"/>
    <asset id="r2" name="{name}" start="0s" duration="{asset_dur}" hasVideo="1" hasAudio="1" audioSources="1" audioChannels="2" format="r1">
      <media-rep kind="original-media" src="{src_url}"/>
    </asset>
  </resources>
  <library>
    <event name="maxfly">
      <project name="{escape(title)}">
        <sequence format="r1" duration="{frame_dur(total_f, fps_num, fps_den)}" tcStart="0s" tcFormat="NDF">
          <spine>
{chr(10).join(spine)}
{chr(10).join(markers)}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
'''


def build_fcpxml_multitrack(title: str, total_ms: int, video_file: str,
                            voice_file: str, music_file: str | None,
                            cues: list[dict] | None = None,
                            fps_num: int = 25, fps_den: int = 1,
                            width: int = 1920, height: int = 1080) -> str:
    """Multi-track project: video on the spine, voice + music as connected audio
    clips on lanes -1/-2 with dialogue/music roles. Stems are pre-rendered to the
    final cut timeline, so each layer is one contiguous clip. media-rep uses bare
    filenames (the bundle is unzipped together)."""
    def T(frames):
        return _fcpxml_time(frames, fps_num, fps_den)
    fd = f"{fps_den}/{fps_num}s" if fps_num != fps_den else "1s"
    dur = T(_ms_to_frames(total_ms, fps_num, fps_den))

    assets = [
        '    <asset id="r2" name="video" start="0s" duration="' + dur + '" hasVideo="1" hasAudio="0" format="r1"><media-rep kind="original-media" src="' + escape(video_file) + '"/></asset>',
        '    <asset id="r3" name="voice" start="0s" duration="' + dur + '" hasVideo="0" hasAudio="1" audioSources="1" audioChannels="2"><media-rep kind="original-media" src="' + escape(voice_file) + '"/></asset>',
    ]
    if music_file:
        assets.append('    <asset id="r4" name="music" start="0s" duration="' + dur + '" hasVideo="0" hasAudio="1" audioSources="1" audioChannels="2"><media-rep kind="original-media" src="' + escape(music_file) + '"/></asset>')

    connected = ['          <asset-clip ref="r3" lane="-1" offset="0s" name="voice" duration="' + dur + '" audioRole="dialogue"/>']
    if music_file:
        connected.append('          <asset-clip ref="r4" lane="-2" offset="0s" name="music" duration="' + dur + '" audioRole="music"/>')
    for c in (cues or []):
        rf = _ms_to_frames(int(c["start_ms"]), fps_num, fps_den)
        txt = escape((c.get("text") or "").replace("\n", " ")[:60] or "caption")
        connected.append('          <marker start="' + T(rf) + '" duration="' + T(1) + '" value="' + txt + '"/>')

    nl = "\n"
    return (
        '<?xml version="1.0" encoding="UTF-8"?>' + nl +
        "<!DOCTYPE fcpxml>" + nl +
        '<fcpxml version="1.10">' + nl +
        "  <resources>" + nl +
        '    <format id="r1" name="FFVideoFormat" frameDuration="' + fd + '" width="' + str(width) + '" height="' + str(height) + '"/>' + nl +
        nl.join(assets) + nl +
        "  </resources>" + nl +
        "  <library>" + nl +
        '    <event name="maxfly">' + nl +
        '      <project name="' + escape(title) + '">' + nl +
        '        <sequence format="r1" duration="' + dur + '" tcStart="0s" tcFormat="NDF">' + nl +
        "          <spine>" + nl +
        '            <asset-clip ref="r2" offset="0s" name="video" duration="' + dur + '" tcFormat="NDF">' + nl +
        nl.join(connected) + nl +
        "            </asset-clip>" + nl +
        "          </spine>" + nl +
        "        </sequence>" + nl +
        "      </project>" + nl +
        "    </event>" + nl +
        "  </library>" + nl +
        "</fcpxml>" + nl
    )
