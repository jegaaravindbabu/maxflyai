import { useEffect, useRef, useState } from "react";

/**
 * A row of video thumbnails (like HyproAI's media track). Captures frames from
 * a hidden <video> by seeking through it and drawing each frame into its own
 * <canvas> (drawing a tainted canvas is allowed — we never read pixels back,
 * so it works even when the media host sends no CORS headers). Falls back to a
 * subtle gradient strip if the video can't be read.
 */
export function Filmstrip({ src, count = 14 }: { src: string; count?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src || !wrapRef.current) return;
    let cancelled = false;
    const canvases = Array.from(wrapRef.current.querySelectorAll("canvas")) as HTMLCanvasElement[];
    if (!canvases.length) return;

    const v = document.createElement("video");
    v.src = src; v.muted = true; v.preload = "auto";
    (v as any).playsInline = true;
    const cleanup = () => { try { v.removeAttribute("src"); v.load(); } catch {} };

    let i = 0;
    const onSeeked = () => {
      if (cancelled) return;
      const c = canvases[i];
      if (c) {
        const ctx = c.getContext("2d");
        try { ctx && ctx.drawImage(v, 0, 0, c.width, c.height); }
        catch { setFailed(true); cleanup(); return; }
      }
      i++;
      if (i >= canvases.length) { cleanup(); return; }
      grab();
    };
    const grab = () => {
      const dur = v.duration || 0;
      if (!isFinite(dur) || dur <= 0) { setFailed(true); return; }
      v.currentTime = (dur * (i + 0.5)) / canvases.length;
    };
    const onLoaded = () => {
      if (cancelled) return;
      const ar = v.videoWidth && v.videoHeight ? v.videoHeight / v.videoWidth : 0.5625;
      canvases.forEach((c) => { c.width = 96; c.height = Math.round(96 * ar); });
      v.addEventListener("seeked", onSeeked);
      grab();
    };
    v.addEventListener("loadeddata", onLoaded);
    v.addEventListener("error", () => { if (!cancelled) setFailed(true); });

    return () => { cancelled = true; v.removeEventListener("seeked", onSeeked); cleanup(); };
  }, [src, count]);

  return (
    <div className={"ed-filmstrip" + (failed ? " failed" : "")} ref={wrapRef}>
      {Array.from({ length: count }).map((_, i) => <canvas key={i} className="ed-frame" />)}
    </div>
  );
}
