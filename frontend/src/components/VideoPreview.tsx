import { forwardRef, ReactNode } from "react";

interface Props {
  src: string;
  overlay?: ReactNode;
  filterCss?: string;
}

export const VideoPreview = forwardRef<HTMLVideoElement, Props>(
  function VideoPreview({ src, overlay, filterCss }, ref) {
    return (
      <div className="preview-wrap">
        <video ref={ref} src={src} controls
          style={filterCss ? { filter: filterCss } : undefined} />
        {overlay && <div className="caption-overlay">{overlay}</div>}
      </div>
    );
  }
);
