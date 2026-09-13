// Project-timeline playlist: turns the source clip + split points + duplicate
// spans into an ordered list of spans in PROJECT time. A duplicated segment
// appears as an extra span right after the original, so the timeline gets
// longer and the duplicate plays again in the preview. With no duplicates the
// playlist is a 1:1 image of the source (projDur === dur), so every consumer
// behaves exactly as it did before.
export interface Span {
  src0: number; src1: number;   // source range this span plays
  segIdx: number;               // which source segment (index into segBounds)
  copy: boolean;                // true = a duplicate copy (not the original)
  proj0: number; proj1: number; // where it sits on the project timeline
}

export function buildSpans(
  dur: number,
  cuts: number[],
  dups: { start_ms: number; end_ms: number }[],
): { spans: Span[]; projDur: number } {
  const bounds = [0, ...Array.from(new Set(cuts)).filter((c) => c > 0 && c < dur).sort((a, b) => a - b), dur];
  const spans: Span[] = [];
  let proj = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i], e = bounds[i + 1];
    if (e <= s) continue;
    const k = dups.filter((d) => d.start_ms >= s - 60 && d.end_ms <= e + 60).length;
    const len = e - s;
    for (let r = 0; r < 1 + k; r++) {
      spans.push({ src0: s, src1: e, segIdx: i, copy: r > 0, proj0: proj, proj1: proj + len });
      proj += len;
    }
  }
  if (!spans.length) { spans.push({ src0: 0, src1: dur, segIdx: 0, copy: false, proj0: 0, proj1: dur }); proj = dur; }
  return { spans, projDur: proj || dur };
}

// project ms -> source ms
export function projToSrc(spans: Span[], p: number): number {
  for (const sp of spans) if (p >= sp.proj0 && p < sp.proj1) return sp.src0 + (p - sp.proj0);
  const last = spans[spans.length - 1];
  return last ? last.src1 : 0;
}

// source ms -> project ms of its FIRST occurrence (the original, not a copy)
export function srcToProj(spans: Span[], src: number): number {
  for (const sp of spans) if (src >= sp.src0 && src <= sp.src1) return sp.proj0 + (src - sp.src0);
  if (src <= 0) return 0;
  const last = spans[spans.length - 1];
  return last ? last.proj1 : src;
}

// which span index owns a project time
export function spanIndexAtProj(spans: Span[], p: number): number {
  for (let i = 0; i < spans.length; i++) if (p >= spans[i].proj0 && p < spans[i].proj1) return i;
  return Math.max(0, spans.length - 1);
}

// project time given the span currently playing and the source position in it
export function projFor(spans: Span[], idx: number, src: number): number {
  const sp = spans[idx];
  if (!sp) return src;
  return sp.proj0 + Math.max(0, Math.min(src, sp.src1) - sp.src0);
}
