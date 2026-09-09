import type React from "react";
import { forwardRef, ReactNode, useRef, useEffect } from "react";

interface Props {
  src: string;
  overlay?: ReactNode;
  frameOverlay?: ReactNode;
  videoStyle?: React.CSSProperties;
  zoom?: number;
  safeZone?: boolean;
  onSurfaceClick?: () => void;
  controls?: ReactNode;
  cropOverlay?: ReactNode;
  /** When set + enhanceOn, the video is muted and this cleaned track plays in sync. */
  enhancedSrc?: string;
  enhanceOn?: boolean;
}

export const VideoPreview = forwardRef<HTMLVideoElement, Props>(
  function VideoPreview(
    { src, overlay, frameOverlay, videoStyle, zoom, safeZone, onSurfaceClick, controls, cropOverlay, enhancedSrc, enhanceOn },
    ref
  ) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const vidRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const useEnh = !!(enhanceOn && enhancedSrc);

    // Merge the forwarded ref with our internal one so the parent still controls
    // the <video>, while we can also drive the synced enhanced-audio element.
    const setRefs = (el: HTMLVideoElement | null) => {
      vidRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    };

    const onMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      if (wrapRef.current && v.videoWidth && v.videoHeight) {
        wrapRef.current.style.setProperty("--v-aspect", `${v.videoWidth} / ${v.videoHeight}`);
      }
    };

    // Keep the cleaned-audio element muted/synced with the video's state.
    const syncAudio = (v: HTMLVideoElement) => {
      const a = audioRef.current;
      if (!a) return;
      a.playbackRate = v.playbackRate;
      a.volume = Math.min(1, isNaN(v.volume) ? 1 : v.volume);
      if (Math.abs(a.currentTime - v.currentTime) > 0.12) a.currentTime = v.currentTime;
    };
    const onPlay = (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (!useEnh) return;
      syncAudio(e.currentTarget);
      audioRef.current?.play().catch(() => {});
    };
    const onPause = () => { audioRef.current?.pause(); };
    const onSeeked = (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (audioRef.current) audioRef.current.currentTime = e.currentTarget.currentTime;
    };
    const onRateChange = (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (audioRef.current) audioRef.current.playbackRate = e.currentTarget.playbackRate;
    };
    const onVolumeChange = (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (audioRef.current) audioRef.current.volume = Math.min(1, isNaN(e.currentTarget.volume) ? 1 : e.currentTarget.volume);
    };
    const onTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget, a = audioRef.current;
      if (!useEnh || !a || v.paused) return;
      if (Math.abs(a.currentTime - v.currentTime) > 0.3) a.currentTime = v.currentTime;
    };

    // React to enhance toggling on/off (or the video being mid-play when applied).
    useEffect(() => {
      const v = vidRef.current, a = audioRef.current;
      if (!v) return;
      v.muted = useEnh;
      if (useEnh && a) {
        a.currentTime = v.currentTime;
        a.playbackRate = v.playbackRate;
        a.volume = Math.min(1, isNaN(v.volume) ? 1 : v.volume);
        if (!v.paused) a.play().catch(() => {});
      } else if (a) {
        a.pause();
      }
    }, [useEnh, enhancedSrc]);

    // Zoom scales the video + composited overlays together, keeping them aligned.
    // The <video> stays a normal in-flow child so the frame always renders.
    const zt: React.CSSProperties | undefined =
      zoom && zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: "center center" } : undefined;
    return (
      <div className="preview-wrap" ref={wrapRef}>
        <video ref={setRefs} src={src} style={{ ...(videoStyle || {}), ...(zt || {}) }}
          onLoadedMetadata={onMeta} playsInline muted={useEnh}
          onPlay={onPlay} onPause={onPause} onSeeked={onSeeked}
          onRateChange={onRateChange} onVolumeChange={onVolumeChange} onTimeUpdate={onTimeUpdate}
          onClick={() => onSurfaceClick && onSurfaceClick()} />
        {enhancedSrc && <audio ref={audioRef} src={enhancedSrc} preload="auto" hidden />}
        {overlay && <div className="caption-overlay" style={zt}>{overlay}</div>}
        {frameOverlay && <div className="ed-frame-layer" style={zt}>{frameOverlay}</div>}
        {cropOverlay}
        {safeZone && (
          <div className="ed-safezone" aria-hidden>
            <div className="ed-safezone-inner" />
          </div>
        )}
        {controls}
      </div>
    );
  }
);
