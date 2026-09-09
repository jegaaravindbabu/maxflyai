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
  cropOverlay?: ReactNode;
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
    // Zoom scales the video + composited overlays together, keeping them aligned.
    // The <video> stays a normal in-flow child so the frame always renders.
    const zt: React.CSSProperties | undefined =
      zoom && zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: "center center" } : undefined;
    return (
      <div className="preview-wrap" ref={wrapRef}>
        <video ref={ref} src={src} style={{ ...(videoStyle || {}), ...(zt || {}) }}
          onLoadedMetadata={onMeta} playsInline onClick={() => onSurfaceClick && onSurfaceClick()} />
        {overlay && <div className="caption-overlay" style={zt}>{overlay}</div>}
        {frameOverlay && <div className="ed-frame-layer" style={zt}>{frameOverlay}</div>}
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
