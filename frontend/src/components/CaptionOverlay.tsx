import type React from "react";
import type { Cue } from "../types";

const WORD_STYLES = ["karaoke", "highlight"];

interface Props {
  text: string;
  styleId: string;
  cue: Cue;
  curMs: number;
  keyId: number;
  settings?: any;
}

// Renders the active caption with the chosen animation. Word-by-word styles
// highlight the current word based on the playhead (words timed proportionally).
const FONT_MAP: Record<string, string> = {
  "Anton": "Anton, sans-serif",
  "Bebas Neue": "\"Bebas Neue\", sans-serif",
  "Poppins": "Poppins, sans-serif",
  "Montserrat": "Montserrat, sans-serif",
  "Pacifico": "Pacifico, cursive",
  "Arial Black": "\"Arial Black\", sans-serif",
};

export function CaptionOverlay({ text, styleId, cue, curMs, keyId, settings }: Props) {
  const st = settings || {};
  const animOn = st.anim_enabled !== false;
  const extra = animOn && st.anim && st.anim !== "none" ? ` capset-${st.anim}` : "";
  const cls = `cap cap-${styleId}${extra}`;
  const dyn: React.CSSProperties = {};
  if (st.font && FONT_MAP[st.font]) dyn.fontFamily = FONT_MAP[st.font];
  if (st.bold === -1) dyn.fontWeight = 800 as any;
  if (typeof st.spacing === "number") dyn.letterSpacing = st.spacing + "px";
  if (st.glow) dyn.textShadow = "0 0 10px rgba(255,255,255,.7), 0 0 4px #000";
  if (extra && st.speed) dyn.animationDuration = (0.4 / Math.max(0.3, st.speed)) + "s";

  if (WORD_STYLES.includes(styleId)) {
    const words = text.split(/\s+/).filter(Boolean);
    const total = words.reduce((a, w) => a + w.length, 0) || 1;
    const dur = Math.max(cue.end_ms - cue.start_ms, 1);
    let acc = cue.start_ms;
    const spans = words.map((w, i) => {
      const wStart = acc;
      const wEnd = acc + (dur * w.length) / total;
      acc = wEnd;
      const on = curMs >= wStart && curMs < wEnd;
      const passed = curMs >= wEnd;
      return (
        <span key={i} className={"capword" + (on ? " capword-on" : passed ? " capword-passed" : "")}>
          {w}{" "}
        </span>
      );
    });
    return <span className={cls} style={dyn} key={keyId}>{spans}</span>;
  }

  // container-level animation; key re-triggers the CSS animation per cue
  return <span className={cls} style={dyn} key={keyId}>{text}</span>;
}
