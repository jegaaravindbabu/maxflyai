import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

interface Props {
  mediaEl: HTMLMediaElement | null;
}

// Waveform bound to the same media element as the video, so playhead stays synced.
export function Waveform({ mediaEl }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current || !mediaEl) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      media: mediaEl,
      height: 64,
      waveColor: "#3a3f52",
      progressColor: "#ff5a3c",
      cursorColor: "#4c8dff",
    });
    wsRef.current = ws;
    return () => { ws.destroy(); wsRef.current = null; };
  }, [mediaEl]);

  return <div className="waveform card" ref={containerRef} />;
}
