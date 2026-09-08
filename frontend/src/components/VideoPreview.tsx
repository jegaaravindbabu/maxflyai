import type React from "react";
import { forwardRef, ReactNode, useRef } from "react";

interface Props {
  src: string;
  overlay?: ReactNode;
  frameOverlay?: ReactNode;
  videoStyle?: React.CSSProperties;
  zoom?: number;
  safeZone?: boolean;
  onSurfaceClick?: () => void;
  controls?: ReactNode;
}

export const VideoPreview = forwardRef<HTMLVideoElement, Props>(
  function VideoPreview({ src, overlay, frameOverlay, videoStyle, zoom, safeZone, onSurfaceClick, controls }, ref) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const onMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      if (wrapRef.current && v.videoWidth && v.videoHeight) {
        wrapRef.current.style.setProperty("--v-aspect", `${v.videoWidth} / ${v.videoHeight}`);
      }
    };
    const z = zoom && zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: "center center" } : undefined;
    return (
      <div className="preview-wrap" ref={wrapRef}>
        {/* scaled group: video + composited overlays (zoom affects only this) */}
        <div className="pv-scale" style={z}>
          <video ref={ref} src={src} style={videoStyle} onLoadedMetadata={onMeta} playsInline
            onClick={() => onSurfaceClick && onSurfaceClick()} />
          {overlay && <div className="caption-overlay">{overlay}</div>}
          {frameOverlay && <div className="ed-frame-layer">{frameOverlay}</div>}
          {safeZone && (
            <div className="ed-safezone" aria-hidden>
              <div className="ed-safezone-inner" />
              <span className="ed-safezone-tip">Danger zone — captions &amp; app buttons can cover your video near the edges</span>
            </div>
          )}
        </div>
        {/* unscaled controls anchored to the video frame */}
        {controls}
      </div>
    );
  }
);
