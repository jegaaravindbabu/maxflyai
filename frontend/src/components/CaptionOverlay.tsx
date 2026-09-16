import type React from "react";
import type { Cue } from "../types";

// Styles that fill/highlight the current word (karaoke) regardless of scope.
const FILL_STYLES = ["karaoke", "highlight"];
// Motion presets that make sense per-word (each word animates in on cue).
const MOTION = new Set(["fade", "slide_up", "slide_down", "slide_left", "slide_right", "pop", "bounce", "rotate", "flip", "fade_blur", "type_on", "type_expand", "scale", "bounce_drop"]);

interface Props {
  text: string;
  styleId: string;
  cue: Cue;
  curMs: number;
  keyId: number;
  settings?: any;
  wordOverrides?: Record<string, any>;
  selWord?: number;
  frameW?: number;
  frameH?: number;
}

const FONT_MAP: Record<string, string> = {
  "Anton": "Anton, sans-serif",
  "Bebas Neue": "\"Bebas Neue\", sans-serif",
  "Poppins": "Poppins, sans-serif",
  "Montserrat": "Montserrat, sans-serif",
  "Pacifico": "Pacifico, cursive",
  "Arial Black": "\"Arial Black\", sans-serif",
  "Oswald": "Oswald, sans-serif",
  "Bangers": "Bangers, cursive",
  "Fredoka": "Fredoka, sans-serif",
  "Luckiest Guy": "\"Luckiest Guy\", cursive",
  "Permanent Marker": "\"Permanent Marker\", cursive",
  "Righteous": "Righteous, sans-serif",
  "Alfa Slab One": "\"Alfa Slab One\", serif",
  "Titan One": "\"Titan One\", sans-serif",
  "Kanit": "Kanit, sans-serif",
  "Archivo Black": "\"Archivo Black\", sans-serif",
  "Caveat": "Caveat, cursive",
  "Lato": "Lato, sans-serif",
  "Rubik": "Rubik, sans-serif",
  "Teko": "Teko, sans-serif",
};

// Renders the active caption with the chosen animation.
//  - scope "caption": the whole line animates in as one block (capset-*).
//  - scope "word" (or karaoke/highlight styles): each word is timed to the
//    playhead — it can karaoke-fill (highlight current word) and/or pop/bounce
//    in on its own as it is spoken.
export function CaptionOverlay({ text, styleId, cue, curMs, keyId, settings, wordOverrides, selWord, frameW, frameH }: Props) {
  const st = settings || {};
  // "out" is a graceful exit baked into the export at the end of the cue; in the
  // live preview we just show the caption static rather than a misleading entrance.
  const animOn = st.anim_enabled !== false && st.when !== "out";
  const anim: string = animOn && st.anim && st.anim !== "none" ? st.anim : "";
  const wordScope = st.scope === "word" || st.scope === "single";
  const fillStyle = FILL_STYLES.includes(styleId) || styleId.startsWith("word_") || styleId === "anton_gold";
  const wov = wordOverrides || {};
  const hasWordOv = Object.keys(wov).length > 0;

  const dyn: React.CSSProperties = {};
  if (st.font && FONT_MAP[st.font]) dyn.fontFamily = FONT_MAP[st.font];
  if (st.text_color) dyn.color = st.text_color;
  if (st.size) { const _f = Number(st.size) / 64; if (_f > 0) dyn.fontSize = _f.toFixed(3) + "em"; }
  if (st.bold === -1) dyn.fontWeight = 800 as any;
  if (st.weight) dyn.fontWeight = Number(st.weight) as any;
  const _lg = typeof st.letter_gap === "number" ? st.letter_gap : st.spacing;
  if (typeof _lg === "number") dyn.letterSpacing = _lg + "px";
  if (typeof st.word_gap === "number" && st.word_gap) dyn.wordSpacing = st.word_gap + "px";
  if (st.glow) dyn.textShadow = "0 0 10px rgba(255,255,255,.7), 0 0 4px #000";
  // Live EFFECTS feedback: reflect the Outline / Drop-shadow sliders in the
  // preview (the export already bakes them via ASS). Only when explicitly set.
  if (typeof st.outline_w === "number") {
    const ow = Math.max(0, st.outline_w) * 0.16;
    (dyn as any).WebkitTextStroke = ow > 0 ? `${ow.toFixed(2)}px ${st.outline_color || "#000000"}` : undefined;
  }
  if (typeof st.shadow === "number" && st.shadow > 0) {
    const d = (st.shadow * 0.4).toFixed(1);
    dyn.textShadow = `${d}px ${d}px ${(st.shadow * 0.5).toFixed(1)}px rgba(0,0,0,.85)`;
  }
  if (st.italic) dyn.fontStyle = "italic";
  if (st.underline) dyn.textDecoration = "underline";
  if (st.background) { dyn.background = "rgba(0,0,0,.5)"; dyn.padding = "0.06em 0.28em"; dyn.borderRadius = "6px"; }
  if (st.align === "left") dyn.textAlign = "left";
  else if (st.align === "right") dyn.textAlign = "right";
  if (typeof st.opacity === "number" && st.opacity < 100) dyn.opacity = Math.max(0, st.opacity) / 100;
  if (st.case === "upper") dyn.textTransform = "uppercase";
  else if (st.case === "lower") dyn.textTransform = "lowercase";
  else if (st.case === "title") dyn.textTransform = "capitalize";
  const _pv = Number(st.pos_v) || 0, _ph = Number(st.pos_h) || 0;
  const _sY = frameH && frameH > 0 ? frameH / 1080 : 1;   // export script height
  const _sX = frameW && frameW > 0 ? frameW / 1920 : 1;   // export script width
  if (_pv || _ph) dyn.transform = `translate(${(_ph * _sX).toFixed(1)}px, ${(-_pv * _sY).toFixed(1)}px)`;
  // align: mirror the ASS \an anchor (move the block to the edge), not just justify text
  if (st.align === "left") { dyn.display = "block"; (dyn as any).width = "fit-content"; dyn.marginRight = "auto"; dyn.marginLeft = "0"; }
  else if (st.align === "right") { dyn.display = "block"; (dyn as any).width = "fit-content"; dyn.marginLeft = "auto"; dyn.marginRight = "0"; }
  // Big-word (emphasis) per-part overrides shown live in the preview.
  const emphStyle: React.CSSProperties = {};
  if (typeof st.big_opacity === "number" && st.big_opacity < 100) emphStyle.opacity = Math.max(0, st.big_opacity) / 100;
  if (st.big_case === "upper") emphStyle.textTransform = "uppercase";
  else if (st.big_case === "lower") emphStyle.textTransform = "lowercase";
  else if (st.big_case === "title") emphStyle.textTransform = "capitalize";
  if (st.highlight_color) emphStyle.color = st.highlight_color;
  if (st.emph_color) emphStyle.color = st.emph_color;
  if (st.big_size) { const _bf = Number(st.big_size) / Number(st.size || 64); if (_bf > 0) emphStyle.fontSize = _bf.toFixed(3) + "em"; }
  if (st.big_glow) emphStyle.textShadow = "0 0 8px currentColor, 0 0 3px #000";
  if (st.highlight_box) { emphStyle.background = st.highlight_box; emphStyle.padding = "0 .1em"; emphStyle.borderRadius = "4px"; }

  const speed = Math.max(0.3, st.speed || 1);
  const wordDur = (0.45 / speed).toFixed(2) + "s";
  const emph = (st.emphasis || "").trim().toLowerCase();
  const isEmph = (w: string) => !!emph && w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === emph;

  // ----- WORD-BY-WORD mode -----
  const perWordMotion = wordScope && animOn && MOTION.has(anim);
  if (perWordMotion || fillStyle || hasWordOv || (typeof selWord === "number" && selWord >= 0)) {
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
      if (isEmph(w)) cw += " capword-emph";
      if (on) cw += " capword-on";
      else if (passed) cw += " capword-passed";

      const wStyle: React.CSSProperties = isEmph(w) ? { ...emphStyle } : {};
      const _hl = on || isEmph(w);
      if (_hl && st.highlight_color) wStyle.color = st.highlight_color;
      if (_hl && st.highlight_box) { wStyle.background = st.highlight_box; wStyle.padding = "0 .12em"; wStyle.borderRadius = "4px"; }
      const wordAnim = perWordMotion && (st.scope !== "single" || isEmph(w));
      if (wordAnim) {
        if (arrived) {
          cw += " capword-move capset-" + anim;
          wStyle.animationDuration = wordDur;
        } else {
          wStyle.opacity = 0;   // not spoken yet — pops in when the playhead reaches it
        }
      }
      const _wd = wov[String(i)];
      if (_wd) {
        if (_wd.color) wStyle.color = _wd.color;
        if (_wd.size) { const _wf = Number(_wd.size) / Number(st.size || 64); if (_wf > 0) wStyle.fontSize = _wf.toFixed(3) + "em"; }
        if (_wd.glow) wStyle.textShadow = "0 0 8px currentColor, 0 0 3px #000";
        if (_wd.x != null && _wd.y != null) wStyle.visibility = "hidden";  // moved out to the frame layer
      }
      if (typeof selWord === "number" && selWord === i) cw += " capword-sel";
      return <span key={i} className={cw} style={wStyle}>{w}{" "}</span>;
    });

    return <span className={`cap cap-${styleId}`} style={dyn} key={keyId}>{spans}</span>;
  }

  // ----- WHOLE-CAPTION mode ----- (key re-triggers the CSS animation per cue)
  const extra = anim ? ` capset-${anim}` : "";
  const capDyn = { ...dyn };
  if (extra) (capDyn as any).animationDuration = wordDur;
  const body = emph
    ? text.split(/(\s+)/).map((w, i) => isEmph(w)
        ? <span key={i} className="capword-emph" style={emphStyle}>{w}</span> : w)
    : text;
  return <span className={`cap cap-${styleId}${extra}`} style={capDyn} key={keyId}>{body}</span>;
}
