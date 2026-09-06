import type React from "react";
import { forwardRef, ReactNode, useRef } from "react";

interface Props {
  src: string;
  overlay?: ReactNode;
  videoStyle?: React.CSSProperties;
}

export const VideoPreview = forwardRef<HTMLVideoElement, Props>(
  function VideoPreview({ src, overlay, videoStyle }, ref) {
    const wrapRef = useRef<HTMLDivElement>(null);
    // Match the preview box to the clip's real aspect so a portrait clip fits
    // the stage by height (instead of overflowing) and captions stay aligned.
    const onMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      if (wrapRef.current && v.videoWidth && v.videoHeight) {
        wrapRef.current.style.setProperty("--v-aspect", `${v.videoWidth} / ${v.videoHeight}`);
      }
    };
    return (
      <div className="preview-wrap" ref={wrapRef}>
        <video ref={ref} src={src} controls style={videoStyle} onLoadedMetadata={onMeta} />
        {overlay && <div className="caption-overlay">{overlay}</div>}
      </div>
    );
  }
);
