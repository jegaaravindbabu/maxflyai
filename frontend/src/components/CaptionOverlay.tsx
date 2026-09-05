import type React from "react";
import type { Cue } from "../types";

// Styles that fill/highlight the current word (karaoke) regardless of scope.
const FILL_STYLES = ["karaoke", "highlight"];
// Motion presets that make sense per-word (each word animates in on cue).
const MOTION = new Set(["fade", "slide_up", "slide_down", "slide_left", "slide_right", "pop", "bounce", "rotate", "flip"]);

interface Props {
  text: string;
  styleId: string;
  cue: Cue;
  curMs: number;
  keyId: number;
  settings?: any;
}

const FONT_MAP: Record<string, string> = {
  "Anton": "Anton, sans-serif",
  "Bebas Neue": "\"Bebas Neue\", sans-serif",
  "Poppins": "Poppins, sans-serif",
  "Montserrat": "Montserrat, sans-serif",
  "Pacifico": "Pacifico, cursive",
  "Arial Black": "\"Arial Black\", sans-serif",
};

// Renders the active caption with the chosen animation.
//  - scope "caption": the whole line animates in as one block (capset-*).
//  - scope "word" (or karaoke/highlight styles): each word is timed to the
//    playhead — it can karaoke-fill (highlight current word) and/or pop/bounce
//    in on its own as it is spoken.
export function CaptionOverlay({ text, styleId, cue, curMs, keyId, settings }: Props) {
  const st = settings || {};
  const animOn = st.anim_enabled !== false;
  const anim: string = animOn && st.anim && st.anim !== "none" ? st.anim : "";
  const wordScope = st.scope === "word";
  const fillStyle = FILL_STYLES.includes(styleId);

  const dyn: React.CSSProperties = {};
  if (st.font && FONT_MAP[st.font]) dyn.fontFamily = FONT_MAP[st.font];
  if (st.bold === -1) dyn.fontWeight = 800 as any;
  if (typeof st.spacing === "number") dyn.letterSpacing = st.spacing + "px";
  if (st.glow) dyn.textShadow = "0 0 10px rgba(255,255,255,.7), 0 0 4px #000";

  const speed = Math.max(0.3, st.speed || 1);
  const wordDur = (0.45 / speed).toFixed(2) + "s";

  // ----- WORD-BY-WORD mode -----
  const perWordMotion = wordScope && animOn && MOTION.has(anim);
  if (perWordMotion || fillStyle) {
    const words = text.split(/\s+/).filter(Boolean);
    const totalChars = words.reduce((a, w) => a + w.length, 0) || 1;
    const dur = Math.max(cue.end_ms - cue.start_ms, 1);
    let acc = cue.start_ms;

    const spans = words.map((w, i) => {
      const wStart = acc;
      const wEnd = acc + (dur * w.length) / totalChars;
      acc = wEnd;
      const on = curMs >= wStart && curMs < wEnd;
      const passed = curMs >= wEnd;
      const arrived = curMs >= wStart;

      let cw = "capword";
      if (on) cw += " capword-on";
      else if (passed) cw += " capword-passed";

      const wStyle: React.CSSProperties = {};
      if (perWordMotion) {
        if (arrived) {
          cw += " capword-move capset-" + anim;
          wStyle.animationDuration = wordDur;
        } else {
          wStyle.opacity = 0;   // not spoken yet — pops in when the playhead reaches it
        }
      }
      return <span key={i} className={cw} style={wStyle}>{w}{" "}</span>;
    });

    return <span className={`cap cap-${styleId}`} style={dyn} key={keyId}>{spans}</span>;
  }

  // ----- WHOLE-CAPTION mode ----- (key re-triggers the CSS animation per cue)
  const extra = anim ? ` capset-${anim}` : "";
  const capDyn = { ...dyn };
  if (extra) (capDyn as any).animationDuration = wordDur;
  return <span className={`cap cap-${styleId}${extra}`} style={capDyn} key={keyId}>{text}</span>;
}
