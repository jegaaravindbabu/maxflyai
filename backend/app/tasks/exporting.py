"""Export task: subtitles (srt/vtt/ass) and burned-in MP4.

Enabled silence_cut / manual_cut edits are applied here (ripple-delete): subtitle
timings are recomputed and the MP4 is physically trimmed. Transcripts stay
immutable; edits only take effect at export.
"""
from __future__ import annotations

import os
import tempfile

from celery import shared_task

from app.database import SessionLocal
from app.models import Project, CaptionCue, Export, Edit, TextOverlay, ImageOverlay, BrollClip
from app.services.captions import SERIALIZERS
from app.services.caption_styles import build_ass, build_overlay_events
from app.services import ffmpeg_utils, timeline, timeline_export, stems, autozoom, filters
from app.services.storage import storage
from app.config import settings

CUT_TYPES = ("silence_cut", "manual_cut", "retake_remove", "filler_cut")


def _load_cues(db, project_id: str) -> list[dict]:
    rows = (db.query(CaptionCue)
              .filter(CaptionCue.project_id == project_id)
              .order_by(CaptionCue.idx).all())
    return [{"start_ms": r.start_ms, "end_ms": r.end_ms, "text": r.text,
             "translit_text": r.translit_text, "idx": r.idx, "oidx": r.idx} for r in rows]


def _load_zoom_segments(db, project_id: str) -> list[dict]:
    rows = (db.query(Edit)
              .filter(Edit.project_id == project_id, Edit.enabled == True,  # noqa: E712
                      Edit.type == "zoom").all())
    segs = []
    for r in rows:
        p = r.payload_json or {}
        if "start_ms" in p and "end_ms" in p:
            segs.append({"start_ms": int(p["start_ms"]), "end_ms": int(p["end_ms"]),
                         "scale": float(p.get("scale", 1.2))})
    segs.sort(key=lambda z: z["start_ms"])
    return segs


def _load_capsettings(db, project_id: str) -> dict | None:
    row = (db.query(Edit)
             .filter(Edit.project_id == project_id, Edit.enabled == True,  # noqa: E712
                     Edit.type == "capsettings").order_by(Edit.created_at.desc()).first())
    return (row.payload_json or None) if row else None


def _load_overrides(db, project_id: str) -> dict:
    """Per-caption + per-word style overrides for the ASS builder."""
    caprow = (db.query(Edit)
                .filter(Edit.project_id == project_id, Edit.type == "capoverrides")
                .order_by(Edit.created_at.desc()).first())
    wordrow = (db.query(Edit)
                 .filter(Edit.project_id == project_id, Edit.type == "wordoverrides")
                 .order_by(Edit.created_at.desc()).first())
    return {"caption": (caprow.payload_json or {}) if caprow else {},
            "words": (wordrow.payload_json or {}) if wordrow else {}}


def _load_videofx(db, project_id: str) -> dict | None:
    row = (db.query(Edit)
             .filter(Edit.project_id == project_id, Edit.enabled == True,  # noqa: E712
                     Edit.type == "videofx").order_by(Edit.created_at.desc()).first())
    return (row.payload_json or None) if row else None


# 720-wide canvas keeps the final composite encode within the 512MB instance.
CANVAS_DIMS = {"9:16": (720, 1280), "4:5": (720, 900), "1:1": (720, 720), "16:9": (1280, 720)}


def _load_canvas(db, project_id: str) -> dict | None:
    row = (db.query(Edit)
             .filter(Edit.project_id == project_id, Edit.enabled == True,  # noqa: E712
                     Edit.type == "canvas").order_by(Edit.created_at.desc()).first())
    return (row.payload_json or None) if row else None


def _load_color_filter(db, project_id: str, cuts=None, sp: float = 1.0) -> str | None:
    """Whole-video grade + any time-ranged filter layers.

    Layer ranges are original-ms; they are remapped through the silence/retake
    cuts and the playback-speed factor to output-timeline seconds so the grade
    lands on the right frames after editing."""
    chain: list[str] = []
    # global grade (whole video, newest wins)
    g = (db.query(Edit)
           .filter(Edit.project_id == project_id, Edit.enabled == True,  # noqa: E712
                   Edit.type == "filter").order_by(Edit.created_at.desc()).first())
    if g:
        gp = g.payload_json or {}
        vf = filters.combined_vf(gp.get("name"), gp.get("adjust"))
        if vf:
            chain.append(vf)
    # ranged layers
    def out_s(ms: int) -> float:
        m = timeline.remap_ms(int(ms), cuts) if cuts else int(ms)
        return (m / sp) / 1000.0 if sp else m / 1000.0
    layers = (db.query(Edit)
                .filter(Edit.project_id == project_id, Edit.enabled == True,  # noqa: E712
                        Edit.type == "filter_layer").order_by(Edit.created_at).all())
    for row in layers:
        lp = row.payload_json or {}
        vf = filters.combined_vf(lp.get("name"), lp.get("adjust"))
        if not vf:
            continue
        s0 = out_s(lp.get("start_ms", 0))
        e0 = out_s(lp.get("end_ms", 0))
        if e0 <= s0:
            continue
        chain.append(filters.with_enable(vf, s0, e0))
    return ",".join(chain) if chain else None


def _load_images(db, project_id: str) -> list[dict]:
    rows = (db.query(ImageOverlay)
              .filter(ImageOverlay.project_id == project_id)
              .order_by(ImageOverlay.idx).all())
    return [{"image_url": r.image_url, "start_ms": r.start_ms, "end_ms": r.end_ms,
             "x_pct": r.x_pct, "y_pct": r.y_pct, "size_pct": r.size_pct} for r in rows]


def _load_brolls(db, project_id: str) -> list[dict]:
    rows = (db.query(BrollClip)
              .filter(BrollClip.project_id == project_id)
              .order_by(BrollClip.idx).all())
    return [{"video_url": r.video_url, "start_ms": r.start_ms, "end_ms": r.end_ms,
             "x_pct": r.x_pct, "y_pct": r.y_pct, "size_pct": r.size_pct} for r in rows]


def _load_overlays(db, project_id: str) -> list[dict]:
    rows = (db.query(TextOverlay)
              .filter(TextOverlay.project_id == project_id)
              .order_by(TextOverlay.idx).all())
    return [{"text": r.text, "start_ms": r.start_ms, "end_ms": r.end_ms,
             "x_pct": r.x_pct, "y_pct": r.y_pct, "font_size": r.font_size,
             "color": r.color, "bold": r.bold} for r in rows]


def _load_enabled_dups(db, project_id: str) -> list[dict]:
    rows = (db.query(Edit)
              .filter(Edit.project_id == project_id, Edit.enabled == True,  # noqa: E712
                      Edit.type == "dup_span").all())
    dups = []
    for r in rows:
        p = r.payload_json or {}
        if "start_ms" in p and "end_ms" in p:
            dups.append({"start_ms": int(p["start_ms"]), "end_ms": int(p["end_ms"])})
    return dups


def _load_enabled_cuts(db, project_id: str) -> list[dict]:
    rows = (db.query(Edit)
              .filter(Edit.project_id == project_id, Edit.enabled == True,  # noqa: E712
                      Edit.type.in_(CUT_TYPES)).all())
    cuts = []
    for r in rows:
        p = r.payload_json or {}
        if "start_ms" in p and "end_ms" in p:
            cuts.append({"start_ms": int(p["start_ms"]), "end_ms": int(p["end_ms"])})
    return cuts


def _target_dims(sw: int, sh: int, resolution: str = "auto"):
    """Pick output (w, h) + scale filter from a requested resolution.
    'auto' keeps the source but caps the long side to 1280 (memory-safe).
    '1080'/'720'/'480' target that many pixels on the SHORT side, so vertical
    9:16 clips read as 1080x1920 / 720x1280 / 480x854 -- downscale only, with a
    hard 1920 long-side ceiling. Even dimensions for H.264."""
    sw = int(sw or 0); sh = int(sh or 0)
    if sw < 2 or sh < 2:
        return sw, sh, None
    short = min(sw, sh); longest = max(sw, sh)
    def _even(x):
        return max(2, (int(round(x)) // 2) * 2)
    if resolution in ("1080", "720", "480"):
        tgt = int(resolution)
        sc = min(1.0, tgt / float(short))
        if longest * sc > 1920:
            sc = 1920.0 / longest
    else:  # auto
        sc = 1280.0 / longest if longest > 1280 else 1.0
    if sc >= 0.999:
        return sw, sh, None
    ow, oh = _even(sw * sc), _even(sh * sc)
    return ow, oh, f"scale={ow}:{oh}"


def run_export(project_id: str, fmt: str = "srt", use_translit: bool = False,
               apply_cuts: bool = True, style: str = "classic",
               enhance_audio: bool = False, volume: float = 1.0, speed: float = 1.0,
               enhance_strength: int = 50, resolution: str = "auto",
               export_id: str | None = None) -> dict:
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if project is None:
            raise ValueError("project not found")

        orig_cues = _load_cues(db, project_id)
        cuts = _load_enabled_cuts(db, project_id) if apply_cuts else []
        dups = _load_enabled_dups(db, project_id) if apply_cuts else []
        removed_ms = timeline.total_removed_ms(cuts) if cuts else 0
        dur0 = project.duration_ms or 0
        playlist = (timeline.playlist_with_dups(cuts, dups, dur0)
                    if (dups and dur0) else None)
        if playlist:
            cues = timeline.apply_playlist_to_cues(orig_cues, playlist)
        else:
            cues = timeline.apply_cuts_to_cues(orig_cues, cuts) if cuts else orig_cues

        suffix = "_clean" if (cuts or dups) else ""

        if fmt == "ass":
            content = build_ass(cues, style, use_translit, _load_capsettings(db, project_id), _load_overrides(db, project_id))
            key = f"exports/{project_id}{suffix}.ass"
            storage.write_bytes(key, content.encode("utf-8"))
        elif fmt in SERIALIZERS:
            content = SERIALIZERS[fmt](cues, use_translit)
            key = f"exports/{project_id}{suffix}.{fmt}"
            storage.write_bytes(key, content.encode("utf-8"))
        elif fmt == "mp4":
            # 1. trim the video to the kept intervals (physically remove dead air)
            src = storage.path(project.source_media_url)
            if playlist is None and dups:
                # duration was missing from the DB — probe so dups still apply
                dur_p = ffmpeg_utils.probe_duration_ms(src) or 0
                if dur_p:
                    playlist = timeline.playlist_with_dups(cuts, dups, dur_p)
                    cues = timeline.apply_playlist_to_cues(orig_cues, playlist)
            if playlist:
                fd, trimmed = tempfile.mkstemp(suffix=".mp4"); os.close(fd)
                ffmpeg_utils.trim_and_concat(src, playlist, trimmed)
                video_src = trimmed
            elif cuts:
                dur = project.duration_ms or ffmpeg_utils.probe_duration_ms(src) or 0
                keep = timeline.keep_intervals(cuts, dur)
                fd, trimmed = tempfile.mkstemp(suffix=".mp4"); os.close(fd)
                ffmpeg_utils.trim_and_concat(src, keep, trimmed)
                video_src = trimmed
            else:
                video_src = src
            # playback speed: bake into the source; retime everything by 1/speed
            sp = max(0.1, float(speed))
            vol = max(0.0, float(volume))
            fast = abs(sp - 1.0) > 1e-3
            if fast:
                fd, sped = tempfile.mkstemp(suffix=".mp4"); os.close(fd)
                ffmpeg_utils.speed_video(video_src, sped, sp)
                video_src = sped
            def _rt(ms):
                return int(round(ms / sp)) if fast else int(ms)
            if fast:
                cues = [{**c, "start_ms": _rt(c["start_ms"]), "end_ms": _rt(c["end_ms"])} for c in cues]
            # 2. burn the (remapped) captions
            _af = []
            if enhance_audio:
                _ef = ffmpeg_utils.audio_enhance_filter(settings.arnndn_model_path or None, enhance_strength)
                if _ef: _af.append(_ef)
            if abs(vol - 1.0) > 1e-3:
                _af.append(f"volume={vol:.3f}")
            audio_filter = ",".join(_af) if _af else None
            ass = build_ass(cues, style, use_translit, _load_capsettings(db, project_id), _load_overrides(db, project_id))
            overlays = _load_overlays(db, project_id)
            if overlays:
                for o in overlays:
                    o["start_ms"] = _rt(timeline.remap_ms(o["start_ms"], cuts) if cuts else o["start_ms"])
                    o["end_ms"] = _rt(timeline.remap_ms(o["end_ms"], cuts) if cuts else o["end_ms"])
                overlays = [o for o in overlays if o["end_ms"] > o["start_ms"]]
                ev = build_overlay_events(overlays)
                if ev:
                    ass = ass.rstrip("\n") + "\n" + ev + "\n"
            fd, ass_path = tempfile.mkstemp(suffix=".ass"); os.close(fd)
            with open(ass_path, "w", encoding="utf-8") as f:
                f.write(ass)
            key = f"exports/{project_id}{suffix}_captioned.mp4"
            # ffmpeg writes to a local temp file; we upload it to storage below.
            # (storage.path() is a DOWNLOAD helper and 404s on a not-yet-created key.)
            fd, out_path = tempfile.mkstemp(suffix="_captioned.mp4"); os.close(fd)
            vinfo = ffmpeg_utils.video_info(video_src)
            # output dims from the requested resolution (short-side target),
            # with a hard long-side ceiling so the encode stays within memory
            sw, sh = vinfo["width"], vinfo["height"]
            ow, oh, scale_vf = _target_dims(sw, sh, resolution)
            # auto-zoom prefilter (against the capped dims)
            zoom_prefilter = None
            zsegs = _load_zoom_segments(db, project_id)
            if zsegs:
                if cuts or fast:
                    for z in zsegs:
                        st = timeline.remap_ms(z["start_ms"], cuts) if cuts else z["start_ms"]
                        en = timeline.remap_ms(z["end_ms"], cuts) if cuts else z["end_ms"]
                        z["start_ms"] = _rt(st); z["end_ms"] = _rt(en)
                    zsegs = [z for z in zsegs if z["end_ms"] > z["start_ms"]]
                try:
                    zoom_prefilter = autozoom.build_zoom_filter(
                        zsegs, ow, oh, vinfo["fps_num"], vinfo["fps_den"])
                except Exception:
                    zoom_prefilter = None
            # colour filter
            color_vf = _load_color_filter(db, project_id, cuts=cuts, sp=sp)
            vfilters = [f for f in (scale_vf, zoom_prefilter, color_vf) if f]
            # video-tab effects (opacity/blur/crop/outline + In/Loop/Out animation)
            try:
                _fps = vinfo["fps_num"] / max(1, vinfo["fps_den"])
            except Exception:
                _fps = 30.0
            _dur_s = (ffmpeg_utils.probe_duration_ms(video_src) or 0) / 1000.0
            _vfx = _load_videofx(db, project_id)
            vfx_vf = ffmpeg_utils.build_videofx_filter(_vfx, ow, oh, _dur_s, _fps)
            if vfx_vf:
                vfilters.append(vfx_vf)
            # image / B-roll overlays
            images = _load_images(db, project_id)
            img_inputs = []
            for im in images:
                s0 = _rt(timeline.remap_ms(im["start_ms"], cuts) if cuts else im["start_ms"])
                e0 = _rt(timeline.remap_ms(im["end_ms"], cuts) if cuts else im["end_ms"])
                if e0 <= s0:
                    continue
                try:
                    ipath = storage.path(im["image_url"])
                except Exception:
                    continue
                img_inputs.append({"path": ipath, "start_ms": s0, "end_ms": e0,
                                   "x_pct": im["x_pct"], "y_pct": im["y_pct"], "size_pct": im["size_pct"]})
            broll_rows = _load_brolls(db, project_id)
            broll_inputs = []
            for br in broll_rows:
                s0 = _rt(timeline.remap_ms(br["start_ms"], cuts) if cuts else br["start_ms"])
                e0 = _rt(timeline.remap_ms(br["end_ms"], cuts) if cuts else br["end_ms"])
                if e0 <= s0:
                    continue
                try:
                    bpath = storage.path(br["video_url"])
                except Exception:
                    continue
                broll_inputs.append({"path": bpath, "start_ms": s0, "end_ms": e0,
                                     "x_pct": br["x_pct"], "y_pct": br["y_pct"], "size_pct": br["size_pct"]})
            if img_inputs or broll_inputs:
                ffmpeg_utils.render_mp4(video_src, ass_path, out_path, ow,
                                        vfilters=vfilters, images=img_inputs,
                                        brolls=broll_inputs, audio_filter=audio_filter)
            else:
                prefilter = ",".join(vfilters) if vfilters else None
                ffmpeg_utils.burn_captions(video_src, ass_path, out_path,
                                           audio_filter=audio_filter, video_prefilter=prefilter)
            os.remove(ass_path)
            # rounded corners: separate one-time-mask compositing pass (the mask
            # is a single geq frame, so there is no per-frame cost on the video).
            try:
                _rad = float((_vfx or {}).get("radius", 0) or 0)
            except Exception:
                _rad = 0.0
            if _rad > 0:
                fd, _rc = tempfile.mkstemp(suffix="_round.mp4"); os.close(fd)
                try:
                    ffmpeg_utils.rounded_corners_pass(out_path, _rc, ow, oh, _rad)
                    os.replace(_rc, out_path)
                except Exception:
                    try: os.remove(_rc)
                    except Exception: pass
            # canvas backdrop (aspect + background) as a final composite
            canvas = _load_canvas(db, project_id)
            _canvas_active = bool(canvas and canvas.get("aspect") in CANVAS_DIMS)
            # drop shadow: inset the clip with an offset blurred dark copy behind
            # it (a full-frame clip has nowhere to cast one). Cast on the canvas
            # colour when a solid-colour canvas is set, else on black; skipped for
            # image/blur canvases (can't cast onto those in this pass).
            try:
                _sx = float((_vfx or {}).get("shadowX", 0) or 0)
                _sy = float((_vfx or {}).get("shadowY", 0) or 0)
                _sb = float((_vfx or {}).get("shadowBlur", 0) or 0)
            except Exception:
                _sx = _sy = _sb = 0.0
            _colour_canvas = _canvas_active and canvas.get("bg_type") == "color"
            if (_sx or _sy or _sb) and (not _canvas_active or _colour_canvas):
                _sbg = canvas.get("color") if _colour_canvas else "black"
                fd, _ds = tempfile.mkstemp(suffix="_shadow.mp4"); os.close(fd)
                try:
                    ffmpeg_utils.drop_shadow_pass(
                        out_path, _ds, ow, oh, _sx, _sy, _sb,
                        (_vfx or {}).get("shadowColor", "#000000"), _sbg or "black")
                    os.replace(_ds, out_path)
                except Exception:
                    try: os.remove(_ds)
                    except Exception: pass
            if _canvas_active:
                cw, ch = CANVAS_DIMS[canvas["aspect"]]
                cimg = None
                if canvas.get("bg_type") == "image" and canvas.get("image_url"):
                    try: cimg = storage.path(canvas["image_url"])
                    except Exception: cimg = None
                ctmp = out_path + ".canvas.mp4"
                try:
                    ffmpeg_utils.compose_canvas(out_path, ctmp, cw, ch,
                        canvas.get("bg_type", "color"), canvas.get("color", "#000000"), cimg)
                    os.replace(ctmp, out_path)
                except Exception:
                    if os.path.exists(ctmp): os.remove(ctmp)
            if cuts and os.path.exists(video_src):
                os.remove(video_src)
            # publish the rendered mp4 to storage (Supabase/R2/local) under `key`
            with open(out_path, "rb") as _f:
                storage.write_bytes(key, _f.read())
            if os.path.exists(out_path):
                os.remove(out_path)
        elif fmt in ("fcpxml", "edl"):
            src = storage.path(project.source_media_url)
            dur = project.duration_ms or ffmpeg_utils.probe_duration_ms(src) or 0
            keep = timeline.keep_intervals(cuts, dur) if cuts else [{"start_ms": 0, "end_ms": dur}]
            info = ffmpeg_utils.video_info(src)
            title = project.name or "ceyonai timeline"
            media_name = project.source_filename or os.path.basename(src)
            if fmt == "edl":
                content = timeline_export.build_edl(
                    title, media_name, keep,
                    fps_num=info["fps_num"], fps_den=info["fps_den"])
            else:
                content = timeline_export.build_fcpxml(
                    title, src, media_name, dur, keep, cues=orig_cues,
                    fps_num=info["fps_num"], fps_den=info["fps_den"],
                    width=info["width"], height=info["height"])
            key = f"exports/{project_id}{suffix}.{fmt}"
            storage.write_bytes(key, content.encode("utf-8"))
        elif fmt == "bundle":
            import io, zipfile
            src = storage.path(project.source_media_url)
            dur_full = project.duration_ms or ffmpeg_utils.probe_duration_ms(src) or 0
            keep = timeline.keep_intervals(cuts, dur_full) if cuts else [{"start_ms": 0, "end_ms": dur_full}]
            total_ms = sum(k["end_ms"] - k["start_ms"] for k in keep)
            info = ffmpeg_utils.video_info(src)
            work = tempfile.mkdtemp(prefix="maxfly_bundle_")
            try:
                stems.render_video_only(src, keep, os.path.join(work, "video.mp4"))
                af = (ffmpeg_utils.audio_enhance_filter(settings.arnndn_model_path or None, enhance_strength)
                      if enhance_audio else None)
                stems.render_voice(src, keep, os.path.join(work, "voice.wav"), audio_filter=af)
                music_out = stems.render_music(src, keep, os.path.join(work, "music.wav"))
                music_name = "music.wav" if music_out else None
                with open(os.path.join(work, "captions.srt"), "w", encoding="utf-8") as fh:
                    fh.write(SERIALIZERS["srt"](cues, use_translit))
                with open(os.path.join(work, "captions.ass"), "w", encoding="utf-8") as fh:
                    fh.write(build_ass(cues, style, use_translit, _load_capsettings(db, project_id), _load_overrides(db, project_id)))
                fcp = timeline_export.build_fcpxml_multitrack(
                    project.name or "ceyonai", total_ms, "video.mp4", "voice.wav", music_name,
                    cues=cues, fps_num=info["fps_num"], fps_den=info["fps_den"],
                    width=info["width"], height=info["height"])
                with open(os.path.join(work, "timeline.fcpxml"), "w", encoding="utf-8") as fh:
                    fh.write(fcp)
                readme = (
                    "ceyonai multi-track export\n\n"
                    "Layers (rendered to the final cut timeline):\n"
                    "  video.mp4     - picture only, no audio\n"
                    "  voice.wav     - dialogue / main audio" + (" (enhanced)" if enhance_audio else "") + "\n"
                    + ("  music.wav     - instrumental (vocals removed)\n" if music_name else "")
                    + "  captions.srt  - subtitles\n"
                    "  captions.ass  - styled subtitles\n"
                    "  timeline.fcpxml - DaVinci Resolve / Final Cut: video + editable caption titles\n\n"
                    "Premiere Pro: import captions.srt as a caption track (FCPXML title import is limited).\n"
                    "Keep all files in the same folder so the timeline relinks the media.\n")
                with open(os.path.join(work, "README.txt"), "w", encoding="utf-8") as fh:
                    fh.write(readme)

                names = ["video.mp4", "voice.wav", "captions.srt", "captions.ass",
                         "timeline.fcpxml", "README.txt"] + (["music.wav"] if music_name else [])
                buf = io.BytesIO()
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                    for n in names:
                        z.write(os.path.join(work, n), arcname=n)
                key = f"exports/{project_id}{suffix}_bundle.zip"
                storage.write_bytes(key, buf.getvalue())
            finally:
                import shutil
                shutil.rmtree(work, ignore_errors=True)
        else:
            raise ValueError(f"unsupported export format: {fmt}")

        if export_id:
            exp = db.get(Export, export_id)
            exp.format = fmt
            exp.url = storage.url(key)
            exp.status = "ready"
        else:
            exp = Export(project_id=project_id, format=fmt, url=storage.url(key), status="ready")
            db.add(exp)
        db.commit()
        return {"export_id": exp.id, "url": exp.url, "format": fmt,
                "cuts_applied": len(cuts), "removed_ms": removed_ms}
    finally:
        db.close()


def run_export_job(export_id: str, project_id: str, fmt: str, use_translit: bool,
                   apply_cuts: bool, style: str, enhance_audio: bool,
                   volume: float = 1.0, speed: float = 1.0,
                   enhance_strength: int = 50, resolution: str = "auto") -> None:
    """Background entry: run the export, mark the Export row error on failure."""
    try:
        run_export(project_id, fmt, use_translit, apply_cuts, style, enhance_audio,
                   volume, speed, enhance_strength=enhance_strength,
                   resolution=resolution, export_id=export_id)
    except Exception as e:
        db = SessionLocal()
        try:
            exp = db.get(Export, export_id)
            if exp:
                exp.status = "error"
                exp.url = None
                try:
                    exp.error = str(e)[:900]
                except Exception:
                    pass
                db.commit()
        finally:
            db.close()
        raise


@shared_task(name="maxfly.export", bind=True, max_retries=1, default_retry_delay=10)
def export_task(self, export_id: str, project_id: str, fmt: str = "srt",
                use_translit: bool = False, apply_cuts: bool = True,
                style: str = "classic", enhance_audio: bool = False,
                volume: float = 1.0, speed: float = 1.0,
                enhance_strength: int = 50, resolution: str = "auto") -> None:
    """Celery entry for exports. Mirrors run_export_job so the Export row is
    marked error on failure; retries once on transient errors."""
    run_export_job(export_id, project_id, fmt, use_translit, apply_cuts, style,
                   enhance_audio, volume, speed, enhance_strength, resolution)
