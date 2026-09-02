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
             "translit_text": r.translit_text} for r in rows]


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


# 720-wide canvas keeps the final composite encode within the 512MB instance.
CANVAS_DIMS = {"9:16": (720, 1280), "4:5": (720, 900), "1:1": (720, 720), "16:9": (1280, 720)}


def _load_canvas(db, project_id: str) -> dict | None:
    row = (db.query(Edit)
             .filter(Edit.project_id == project_id, Edit.enabled == True,  # noqa: E712
                     Edit.type == "canvas").order_by(Edit.created_at.desc()).first())
    return (row.payload_json or None) if row else None


def _load_color_filter(db, project_id: str) -> str | None:
    row = (db.query(Edit)
             .filter(Edit.project_id == project_id, Edit.enabled == True,  # noqa: E712
                     Edit.type == "filter").order_by(Edit.created_at.desc()).first())
    if not row:
        return None
    name = (row.payload_json or {}).get("name")
    return filters.filter_string(name)


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


def run_export(project_id: str, fmt: str = "srt", use_translit: bool = False,
               apply_cuts: bool = True, style: str = "classic",
               enhance_audio: bool = False, export_id: str | None = None) -> dict:
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if project is None:
            raise ValueError("project not found")

        orig_cues = _load_cues(db, project_id)
        cuts = _load_enabled_cuts(db, project_id) if apply_cuts else []
        removed_ms = timeline.total_removed_ms(cuts) if cuts else 0
        cues = timeline.apply_cuts_to_cues(orig_cues, cuts) if cuts else orig_cues

        suffix = "_clean" if cuts else ""

        if fmt == "ass":
            content = build_ass(cues, style, use_translit, _load_capsettings(db, project_id))
            key = f"exports/{project_id}{suffix}.ass"
            storage.write_bytes(key, content.encode("utf-8"))
        elif fmt in SERIALIZERS:
            content = SERIALIZERS[fmt](cues, use_translit)
            key = f"exports/{project_id}{suffix}.{fmt}"
            storage.write_bytes(key, content.encode("utf-8"))
        elif fmt == "mp4":
            # 1. trim the video to the kept intervals (physically remove dead air)
            src = storage.path(project.source_media_url)
            if cuts:
                dur = project.duration_ms or ffmpeg_utils.probe_duration_ms(src) or 0
                keep = timeline.keep_intervals(cuts, dur)
                fd, trimmed = tempfile.mkstemp(suffix=".mp4"); os.close(fd)
                ffmpeg_utils.trim_and_concat(src, keep, trimmed)
                video_src = trimmed
            else:
                video_src = src
            # 2. burn the (remapped) captions
            audio_filter = (ffmpeg_utils.audio_enhance_filter(settings.arnndn_model_path or None)
                            if enhance_audio else None)
            ass = build_ass(cues, style, use_translit, _load_capsettings(db, project_id))
            overlays = _load_overlays(db, project_id)
            if overlays:
                for o in overlays:
                    o["start_ms"] = timeline.remap_ms(o["start_ms"], cuts) if cuts else o["start_ms"]
                    o["end_ms"] = timeline.remap_ms(o["end_ms"], cuts) if cuts else o["end_ms"]
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
            # cap resolution to keep the encode within Render's 512MB memory
            sw, sh = vinfo["width"], vinfo["height"]
            longest = max(sw, sh)
            if longest > 1280:
                sc = 1280.0 / longest
                ow = max(2, (round(sw * sc) // 2) * 2)
                oh = max(2, (round(sh * sc) // 2) * 2)
                scale_vf = f"scale={ow}:{oh}"
            else:
                ow, oh, scale_vf = sw, sh, None
            # auto-zoom prefilter (against the capped dims)
            zoom_prefilter = None
            zsegs = _load_zoom_segments(db, project_id)
            if zsegs:
                if cuts:
                    for z in zsegs:
                        z["start_ms"] = timeline.remap_ms(z["start_ms"], cuts)
                        z["end_ms"] = timeline.remap_ms(z["end_ms"], cuts)
                    zsegs = [z for z in zsegs if z["end_ms"] > z["start_ms"]]
                try:
                    zoom_prefilter = autozoom.build_zoom_filter(
                        zsegs, ow, oh, vinfo["fps_num"], vinfo["fps_den"])
                except Exception:
                    zoom_prefilter = None
            # colour filter
            color_vf = _load_color_filter(db, project_id)
            vfilters = [f for f in (scale_vf, zoom_prefilter, color_vf) if f]
            # image / B-roll overlays
            images = _load_images(db, project_id)
            img_inputs = []
            for im in images:
                s0 = timeline.remap_ms(im["start_ms"], cuts) if cuts else im["start_ms"]
                e0 = timeline.remap_ms(im["end_ms"], cuts) if cuts else im["end_ms"]
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
                s0 = timeline.remap_ms(br["start_ms"], cuts) if cuts else br["start_ms"]
                e0 = timeline.remap_ms(br["end_ms"], cuts) if cuts else br["end_ms"]
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
            # canvas backdrop (aspect + background) as a final composite
            canvas = _load_canvas(db, project_id)
            if canvas and canvas.get("aspect") in CANVAS_DIMS:
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
            title = project.name or "maxfly timeline"
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
                af = (ffmpeg_utils.audio_enhance_filter(settings.arnndn_model_path or None)
                      if enhance_audio else None)
                stems.render_voice(src, keep, os.path.join(work, "voice.wav"), audio_filter=af)
                music_out = stems.render_music(src, keep, os.path.join(work, "music.wav"))
                music_name = "music.wav" if music_out else None
                with open(os.path.join(work, "captions.srt"), "w", encoding="utf-8") as fh:
                    fh.write(SERIALIZERS["srt"](cues, use_translit))
                with open(os.path.join(work, "captions.ass"), "w", encoding="utf-8") as fh:
                    fh.write(build_ass(cues, style, use_translit, _load_capsettings(db, project_id)))
                fcp = timeline_export.build_fcpxml_multitrack(
                    project.name or "maxfly", total_ms, "video.mp4", "voice.wav", music_name,
                    cues=cues, fps_num=info["fps_num"], fps_den=info["fps_den"],
                    width=info["width"], height=info["height"])
                with open(os.path.join(work, "timeline.fcpxml"), "w", encoding="utf-8") as fh:
                    fh.write(fcp)
                readme = (
                    "maxfly.ai multi-track export\n\n"
                    "Layers (rendered to the final cut timeline):\n"
                    "  video.mp4     - picture only, no audio\n"
                    "  voice.wav     - dialogue / main audio" + (" (enhanced)" if enhance_audio else "") + "\n"
                    + ("  music.wav     - instrumental (vocals removed)\n" if music_name else "")
                    + "  captions.srt  - subtitles\n"
                    "  captions.ass  - styled subtitles\n"
                    "  timeline.fcpxml - open in Premiere Pro / DaVinci Resolve / Final Cut\n\n"
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
                   apply_cuts: bool, style: str, enhance_audio: bool) -> None:
    """Background entry: run the export, mark the Export row error on failure."""
    try:
        run_export(project_id, fmt, use_translit, apply_cuts, style, enhance_audio,
                   export_id=export_id)
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


@shared_task(name="maxfly.export")
def export_task(project_id: str, fmt: str = "srt", use_translit: bool = False,
                apply_cuts: bool = True, style: str = "classic",
               enhance_audio: bool = False) -> dict:
    return run_export(project_id, fmt, use_translit, apply_cuts, style, enhance_audio)
