"""
Editable timeline export: FCPXML (Premiere Pro / DaVinci Resolve) and CMX3600 EDL.

The timeline is built from the KEEP intervals (the clip spans left after silence
cuts), placed back-to-back — so importing gives the creator their video with dead
air already removed, fully editable. Caption cues come in as editable title clips (real text tracks).

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


BASIC_TITLE_UID = (".../Titles.localized/Build In:Out/Basic Title.localized/Basic Title.moti")


def _title_clip(text: str, effect_ref: str, lane: int, offset_t: str, dur_t: str,
                ts_id: int, font_size: int) -> str:
    """One editable caption as an FCPXML <title> (Basic Title generator)."""
    txt = escape((text or "").replace("\n", " ").strip() or "caption")
    name = escape(((text or "caption").replace("\n", " ").strip())[:40] or "caption")
    return (
        f'          <title ref="{effect_ref}" lane="{lane}" offset="{offset_t}" '
        f'name="{name}" start="0s" duration="{dur_t}">\n'
        f'            <text><text-style ref="ts{ts_id}">{txt}</text-style></text>\n'
        f'            <text-style-def id="ts{ts_id}">\n'
        f'              <text-style font="Helvetica Neue" fontSize="{font_size}" '
        f'fontFace="Bold" bold="1" fontColor="1 1 1 1" strokeColor="0 0 0 1" '
        f'strokeWidth="4" alignment="center"/>\n'
        f'            </text-style-def>\n'
        f'          </title>'
    )


def build_fcpxml(title: str, media_path: str, media_name: str, duration_ms: int,
                 keep: list[dict], cues: list[dict] | None = None,
                 fps_num: int = 25, fps_den: int = 1,
                 width: int = 1920, height: int = 1080) -> str:
    """Editable timeline: video on lane 1, captions as editable titles on lane 2.

    Uses a start=0 <gap> container so every offset is an absolute timeline
    position — robust when silence/retake cuts split the video into segments.
    Targets DaVinci Resolve & Final Cut (editable text). For Premiere, import
    the SRT as a caption track."""
    def T(frames: int) -> str:
        return _fcpxml_time(frames, fps_num, fps_den)
    fd = f"{fps_den}/{fps_num}s" if fps_num != fps_den else "1s"
    asset_dur = T(_ms_to_frames(duration_ms, fps_num, fps_den))
    src_url = "file://" + os.path.abspath(media_path).replace(" ", "%20")
    name = escape(media_name)
    font_size = max(24, round(height * 0.06))

    def rec_frame_for(ms: int):
        rec = 0
        for k in keep:
            if k["start_ms"] <= ms < k["end_ms"]:
                return rec + _ms_to_frames(ms - k["start_ms"], fps_num, fps_den)
            rec += _ms_to_frames(k["end_ms"] - k["start_ms"], fps_num, fps_den)
        return None

    total_f = sum(_ms_to_frames(k["end_ms"] - k["start_ms"], fps_num, fps_den) for k in keep)
    total_t = T(total_f)

    vid = []
    off = 0
    for k in keep:
        start_f = _ms_to_frames(k["start_ms"], fps_num, fps_den)
        dur_f = _ms_to_frames(k["end_ms"] - k["start_ms"], fps_num, fps_den)
        vid.append(
            f'          <asset-clip ref="r2" lane="1" offset="{T(off)}" '
            f'name="{name}" start="{T(start_f)}" duration="{T(dur_f)}" tcFormat="NDF"/>'
        )
        off += dur_f

    titles = []
    for i, c in enumerate(cues or []):
        rf = rec_frame_for(int(c["start_ms"]))
        if rf is None:
            continue
        cue_dur_f = max(1, _ms_to_frames(int(c["end_ms"]) - int(c["start_ms"]), fps_num, fps_den))
        titles.append(_title_clip(c.get("text", ""), "r3", 2, T(rf), T(cue_dur_f), i, font_size))

    body = "\n".join(vid + titles)

    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat" frameDuration="{fd}" width="{width}" height="{height}"/>
    <asset id="r2" name="{name}" start="0s" duration="{asset_dur}" hasVideo="1" hasAudio="1" audioSources="1" audioChannels="2" format="r1">
      <media-rep kind="original-media" src="{src_url}"/>
    </asset>
    <effect id="r3" name="Basic Title" uid="{BASIC_TITLE_UID}"/>
  </resources>
  <library>
    <event name="maxfly">
      <project name="{escape(title)}">
        <sequence format="r1" duration="{total_t}" tcStart="0s" tcFormat="NDF">
          <spine>
            <gap name="Timeline" offset="0s" start="0s" duration="{total_t}">
{body}
            </gap>
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
    on lanes -1/-2, and captions as editable titles on lane 1. Stems are
    pre-rendered to the final cut timeline, so each layer is one contiguous clip."""
    def T(frames):
        return _fcpxml_time(frames, fps_num, fps_den)
    fd = f"{fps_den}/{fps_num}s" if fps_num != fps_den else "1s"
    dur = T(_ms_to_frames(total_ms, fps_num, fps_den))
    font_size = max(24, round(height * 0.06))

    assets = [
        '    <asset id="r2" name="video" start="0s" duration="' + dur + '" hasVideo="1" hasAudio="0" format="r1"><media-rep kind="original-media" src="' + escape(video_file) + '"/></asset>',
        '    <asset id="r3" name="voice" start="0s" duration="' + dur + '" hasVideo="0" hasAudio="1" audioSources="1" audioChannels="2"><media-rep kind="original-media" src="' + escape(voice_file) + '"/></asset>',
    ]
    if music_file:
        assets.append('    <asset id="r4" name="music" start="0s" duration="' + dur + '" hasVideo="0" hasAudio="1" audioSources="1" audioChannels="2"><media-rep kind="original-media" src="' + escape(music_file) + '"/></asset>')
    assets.append('    <effect id="r5" name="Basic Title" uid="' + BASIC_TITLE_UID + '"/>')

    connected = ['          <asset-clip ref="r3" lane="-1" offset="0s" name="voice" duration="' + dur + '" audioRole="dialogue"/>']
    if music_file:
        connected.append('          <asset-clip ref="r4" lane="-2" offset="0s" name="music" duration="' + dur + '" audioRole="music"/>')
    for i, c in enumerate(cues or []):
        rf = _ms_to_frames(int(c["start_ms"]), fps_num, fps_den)
        cue_dur_f = max(1, _ms_to_frames(int(c["end_ms"]) - int(c["start_ms"]), fps_num, fps_den))
        connected.append(_title_clip(c.get("text", ""), "r5", 1, T(rf), T(cue_dur_f), i, font_size))

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
