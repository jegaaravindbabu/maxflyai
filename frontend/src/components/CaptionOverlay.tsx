import type { Cue } from "../types";

const WORD_STYLES = ["karaoke", "highlight"];

interface Props {
  text: string;
  styleId: string;
  cue: Cue;
  curMs: number;
  keyId: number;
}

// Renders the active caption with the chosen animation. Word-by-word styles
// highlight the current word based on the playhead (words timed proportionally).
export function CaptionOverlay({ text, styleId, cue, curMs, keyId }: Props) {
  const cls = `cap cap-${styleId}`;

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
    return <span className={cls} key={keyId}>{spans}</span>;
  }

  // container-level animation; key re-triggers the CSS animation per cue
  return <span className={cls} key={keyId}>{text}</span>;
}
