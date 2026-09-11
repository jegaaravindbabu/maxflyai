import { useMemo, useState } from "react";
import { api } from "../api/client";
import { IScissors } from "./icons";

interface Tok { i: number; seg_idx: number; text: string; start_ms: number; end_ms: number;
  flag: "retake" | "filler" | null; remove: boolean; }
interface Props {
  projectId: string;
  onSeek: (ms: number) => void;
  onClose: () => void;
  onApplied: (count: number, savedMs: number) => void;
}

function secs(ms: number) { return `${(ms / 1000).toFixed(1)}s`; }

// polished-style Retake Remover: AI flags retake / filler words red on a transcript;
// click a word to keep/remove it, or drag-select a range and Mark Remove / Mark Keep.
export function RetakeModal({ projectId, onSeek, onClose, onApplied }: Props) {
  const [phase, setPhase] = useState<"idle" | "detecting" | "results">("idle");
  const [filler, setFiller] = useState(true);
  const [tokens, setTokens] = useState<Tok[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [drag, setDrag] = useState<{ anchor: number } | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());

  const removeCount = useMemo(() => tokens.filter((t) => t.remove).length, [tokens]);
  const savedMs = useMemo(
    () => tokens.filter((t) => t.remove).reduce((a, t) => a + (t.end_ms - t.start_ms), 0),
    [tokens]);

  async function detect() {
    setPhase("detecting"); setErr(null);
    try {
      const r = await api.retakePlan(projectId, filler);
      setTokens(r.tokens.map((t) => ({ ...t, remove: t.flag != null })));
      setPhase("results");
      if (!r.tokens.length) setErr("No transcript yet — transcribe the video first.");
    } catch (e: any) { setErr(e?.message || "Detection failed."); setPhase("idle"); }
  }

  function toggle(i: number) {
    setTokens((prev) => prev.map((t) => (t.i === i ? { ...t, remove: !t.remove } : t)));
  }
  function markRange(remove: boolean) {
    if (!sel.size) return;
    setTokens((prev) => prev.map((t) => (sel.has(t.i) ? { ...t, remove } : t)));
    setSel(new Set());
  }
  function rangeSet(a: number, b: number) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const s = new Set<number>();
    for (let i = lo; i <= hi; i++) s.add(i);
    return s;
  }

  async function apply() {
    const rem = tokens.filter((t) => t.remove).sort((a, b) => a.start_ms - b.start_ms);
    if (!rem.length) return;
    // coalesce consecutive removed tokens into spans
    const spans: { start_ms: number; end_ms: number }[] = [];
    for (const t of rem) {
      const last = spans[spans.length - 1];
      if (last && t.start_ms - last.end_ms <= 60) last.end_ms = Math.max(last.end_ms, t.end_ms);
      else spans.push({ start_ms: t.start_ms, end_ms: t.end_ms });
    }
    setApplying(true);
    try {
      for (const sp of spans) await api.addEdit(projectId, "retake_remove", sp);
      onApplied(rem.length, savedMs);
      onClose();
    } catch (e: any) { setErr(e?.message || "Could not remove words."); setApplying(false); }
  }

  const cls = (t: Tok) =>
    "ed-rtk-w" + (t.remove ? " rm" : t.flag ? " keep" : "") + (sel.has(t.i) ? " sel" : "");

  return (
    <div className="ed-modal-scrim" onClick={onClose}>
      <div className="ed-rtkmodal" onClick={(e) => e.stopPropagation()}>
        <div className="ed-silmodal-hd">
          <div className="ed-silmodal-t">{IScissors} Retake Remover</div>
          <div className="ed-silmodal-sub">
            {phase === "results"
              ? <>Click <b className="rm">red words</b> to toggle, or drag a range and use <b className="rm">Mark Remove</b> / <b className="keep">Mark Keep</b>.</>
              : "Find and remove retakes and filler words automatically."}
          </div>
          <button className="ed-silmodal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="ed-silmodal-body">
          {phase !== "results" ? (
            <div className="ed-rtk-intro">
              <div className="ed-rtk-magic">{IScissors}</div>
              <div className="ed-rtk-h">Find and remove retakes automatically</div>
              <p className="ed-rtk-p">AI reads your transcript to find retakes — where you re-said a phrase or stumbled — and keeps the last clean take.</p>
              <label className="ed-rtk-check">
                <input type="checkbox" checked={filler} onChange={(e) => setFiller(e.target.checked)} />
                <span><b>Detect filler words</b><br /><i>Also flag "um", "uh", "hmm", "ah" and similar fillers.</i></span>
              </label>
              {err && <div className="ed-sil-err">{err}</div>}
              <button className="ed-rtk-detect" onClick={detect} disabled={phase === "detecting"}>
                {phase === "detecting" ? "Analyzing transcript…" : <>{IScissors} Detect Retakes</>}
              </button>
            </div>
          ) : (
            <>
              <div className="ed-rtk-bar">
                <span className="ed-rtk-legend">
                  <i className="rm" /> Remove <i className="keep" /> Keep <i className="off" /> Deselected
                </span>
                <span className="ed-rtk-tools">
                  <button onClick={() => markRange(true)} disabled={!sel.size}>Mark Remove</button>
                  <button onClick={() => markRange(false)} disabled={!sel.size}>Mark Keep</button>
                  <button onClick={detect}>{IScissors} Re-detect</button>
                </span>
              </div>
              <div className="ed-rtk-transcript" onMouseLeave={() => setDrag(null)}>
                {tokens.length === 0 && <div className="ed-rtk-empty">No words to review.</div>}
                {tokens.map((t) => (
                  <span key={t.i} className={cls(t)}
                    title={t.remove ? "Will be removed — click to keep" : "Kept — click to remove"}
                    onMouseDown={(e) => { e.preventDefault(); setDrag({ anchor: t.i }); setSel(new Set([t.i])); }}
                    onMouseEnter={() => { if (drag) setSel(rangeSet(drag.anchor, t.i)); }}
                    onMouseUp={() => {
                      if (drag && sel.size <= 1) { toggle(t.i); setSel(new Set()); onSeek(t.start_ms); }
                      setDrag(null);
                    }}>{t.text} </span>
                ))}
              </div>
              {err && <div className="ed-sil-err">{err}</div>}
            </>
          )}
        </div>

        <div className="ed-silmodal-ft">
          <button className="ed-sil-cancel" onClick={onClose}>Cancel</button>
          {phase === "results" && (
            <div className="ed-rtk-count">{removeCount} word{removeCount === 1 ? "" : "s"} to remove · {secs(savedMs)} saved</div>
          )}
          <button className="ed-sil-apply" disabled={phase !== "results" || removeCount === 0 || applying} onClick={apply}>
            {applying ? "Removing…" : <>{IScissors} Remove {removeCount || ""} Word{removeCount === 1 ? "" : "s"}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
