import type React from "react";
import { forwardRef, ReactNode } from "react";

interface Props {
  src: string;
  overlay?: ReactNode;
  videoStyle?: React.CSSProperties;
}

export const VideoPreview = forwardRef<HTMLVideoElement, Props>(
  function VideoPreview({ src, overlay, videoStyle }, ref) {
    return (
      <div className="preview-wrap">
        <video ref={ref} src={src} controls style={videoStyle} />
        {overlay && <div className="caption-overlay">{overlay}</div>}
      </div>
    );
  }
);
