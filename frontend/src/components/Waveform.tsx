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
      waveColor: "#5a6178",
      progressColor: "#aab2c6",
      cursorColor: "transparent",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
    });
    wsRef.current = ws;
    return () => { ws.destroy(); wsRef.current = null; };
  }, [mediaEl]);

  return <div className="waveform card" ref={containerRef} />;
}
