import { forwardRef, ReactNode } from "react";

interface Props {
  src: string;
  overlay?: ReactNode;
}

export const VideoPreview = forwardRef<HTMLVideoElement, Props>(
  function VideoPreview({ src, overlay }, ref) {
    return (
      <div className="preview-wrap">
        <video ref={ref} src={src} controls />
        {overlay && <div className="caption-overlay">{overlay}</div>}
      </div>
    );
  }
);
