import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { IScissors } from "./icons";

interface Region { start_ms: number; end_ms: number; keep: boolean; }
interface Props {
  projectId: string;
  durationMs: number;
  onSeek: (ms: number) => void;
  onClose: () => void;
  onApplied: (count: number, savedMs: number) => void;
}

function secs(ms: number) {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

// HyproAI-style "Auto Remove Silence" modal: detect by AI (caption timings) or by a
// manual dB threshold, preview the cuts on a waveform, keep/remove each, then apply.
export function SilenceModal({ projectId, durationMs, onSeek, onClose, onApplied }: Props) {
  const [phase, setPhase] = useState<"idle" | "detecting" | "results">("idle");
  const [mode, setMode] = useState<"ai" | "audio">("ai");
  const [threshold, setThreshold] = useState(-35);       // dB
  const [minDur, setMinDur] = useState(0.2);             // seconds
  const [padBefore, setPadBefore] = useState(20);        // ms
  const [padAfter, setPadAfter] = useState(20);          // ms
  const [regions, setRegions] = useState<Region[]>([]);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [thrDb, setThrDb] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.waveform(projectId).then((r) => setPeaks(r.peaks || [])).catch(() => {});
  }, [projectId]);

  const savedMs = useMemo(
    () => regions.filter((r) => r.keep).reduce((a, r) => a + (r.end_ms - r.start_ms), 0),
    [regions]);
  const cutCount = regions.filter((r) => r.keep).length;
  const pct = durationMs ? Math.min(1, savedMs / durationMs) : 0;

  async function detect(m: "ai" | "audio") {
    setMode(m); setPhase("detecting"); setErr(null);
    try {
      const r = await api.detectSilences(projectId, m === "ai"
        ? { mode: "ai", minSilenceMs: Math.max(minDur * 1000, 350) }
        : { mode: "audio", noiseDb: threshold, minSilenceMs: minDur * 1000,
            padBeforeMs: padBefore, padAfterMs: padAfter });
      setThrDb(r.threshold_db);
      setRegions((r.silences || []).map((s) => ({ ...s, keep: true })));
      setPhase("results");
    } catch (e: any) {
      setErr(e?.message || "Detection failed."); setPhase("idle");
    }
  }

  function toggleRegion(i: number) {
    setRegions((prev) => prev.map((r, j) => (j === i ? { ...r, keep: !r.keep } : r)));
  }

  async function apply() {
    const keep = regions.filter((r) => r.keep);
    if (!keep.length) return;
    setApplying(true);
    try {
      for (const r of keep) {
        await api.addEdit(projectId, "silence_cut", { start_ms: r.start_ms, end_ms: r.end_ms });
      }
      onApplied(keep.length, savedMs);
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Could not remove silences."); setApplying(false);
    }
  }

  // draw the waveform + red silence regions
  useEffect(() => {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const w = wrap.clientWidth || 520, h = 96;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + "px"; cv.style.height = h + "px";
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    const n = peaks.length || 1;
    const bw = w / n;
    // base waveform
    for (let i = 0; i < peaks.length; i++) {
      const t = (i / n) * durationMs;
      const inCut = regions.some((r) => r.keep && t >= r.start_ms && t < r.end_ms);
      const amp = Math.max(1, peaks[i] * (mid - 3));
      ctx.fillStyle = inCut ? "rgba(255,90,90,0.9)" : "rgba(198,255,58,0.75)";
      ctx.fillRect(i * bw, mid - amp, Math.max(1, bw - 0.4), amp * 2);
    }
    // red region bands (so a silent gap with no waveform is still visible)
    for (const r of regions) {
      if (!r.keep) continue;
      const x = (r.start_ms / durationMs) * w;
      const ww = Math.max(2, ((r.end_ms - r.start_ms) / durationMs) * w);
      ctx.fillStyle = "rgba(255,90,90,0.18)";
      ctx.fillRect(x, 0, ww, h);
      ctx.fillStyle = "rgba(255,90,90,0.9)";
      ctx.fillRect(x, 0, 1.5, h); ctx.fillRect(x + ww - 1.5, 0, 1.5, h);
    }
  }, [peaks, regions, durationMs]);

  function onWaveClick(e: React.MouseEvent) {
    const wrap = wrapRef.current; if (!wrap || !durationMs) return;
    const rect = wrap.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * durationMs;
    const idx = regions.findIndex((r) => t >= r.start_ms && t < r.end_ms);
    if (idx >= 0) { toggleRegion(idx); onSeek(regions[idx].start_ms); }
    else onSeek(t);
  }

  return (
    <div className="ed-modal-scrim" onClick={onClose}>
      <div className="ed-silmodal" onClick={(e) => e.stopPropagation()}>
        <div className="ed-silmodal-hd">
          <div className="ed-silmodal-t">{IScissors} Auto Remove Silence</div>
          <div className="ed-silmodal-sub">Detect and remove silent regions across this clip</div>
          <button className="ed-silmodal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="ed-silmodal-body">
          <button className="ed-sil-ai" onClick={() => detect("ai")} disabled={phase === "detecting"}>
            {phase === "detecting" && mode === "ai" ? "Analyzing…" : <>✦ Calculate by AI</>}
          </button>
          <div className="ed-sil-aihint">Reads word timestamps from your captions — works at any noise level, no threshold to tune.</div>

          <div className="ed-sil-or"><span>OR MANUAL</span></div>

          <div className="ed-sil-grid">
            <div>
              <div className="ed-cs-slabel"><span>Threshold</span><span>{threshold} dB</span></div>
              <input type="range" min={-60} max={-10} step={1} value={threshold}
                onChange={(e) => setThreshold(+e.target.value)} />
              <div className="ed-sil-ends"><span>Keep more</span><span>Cut more</span></div>
            </div>
            <div>
              <div className="ed-cs-slabel"><span>Min duration</span><span>{minDur.toFixed(1)}s</span></div>
              <input type="range" min={0.1} max={2} step={0.1} value={minDur}
                onChange={(e) => setMinDur(+e.target.value)} />
              <div className="ed-sil-ends"><span>Short</span><span>Long</span></div>
            </div>
          </div>

          <div className="ed-sil-gap">Gap size (speech protection)</div>
          <div className="ed-sil-grid">
            <div>
              <div className="ed-cs-slabel"><span>Pad before</span><span>{padBefore}ms</span></div>
              <input type="range" min={0} max={200} step={10} value={padBefore}
                onChange={(e) => setPadBefore(+e.target.value)} />
            </div>
            <div>
              <div className="ed-cs-slabel"><span>Pad after</span><span>{padAfter}ms</span></div>
              <input type="range" min={0} max={200} step={10} value={padAfter}
                onChange={(e) => setPadAfter(+e.target.value)} />
            </div>
          </div>

          <button className="ed-sil-manual" onClick={() => detect("audio")} disabled={phase === "detecting"}>
            {phase === "detecting" && mode === "audio" ? "Detecting…" : <>{IScissors} Detect with manual settings</>}
          </button>

          {err && <div className="ed-sil-err">{err}</div>}

          {phase === "results" && (
            <div className="ed-sil-preview">
              <div className="ed-sil-prevhd">
                <span>Preview · {cutCount} cut{cutCount === 1 ? "" : "s"} · −{secs(savedMs)}</span>
                <span className="ed-sil-legend"><i className="keep" /> Keep <i className="rm" /> Remove</span>
              </div>
              <div className="ed-sil-wave" ref={wrapRef} onClick={onWaveClick}>
                <canvas ref={canvasRef} />
                {peaks.length === 0 && <div className="ed-sil-wave-fallback">Waveform unavailable — regions still apply.</div>}
              </div>
              <div className="ed-sil-metrics">
                <div className="ed-sil-count">
                  <strong>{regions.length}</strong> silence{regions.length === 1 ? "" : "s"} found
                  <div className="ed-sil-sub">{secs(savedMs)} of {secs(durationMs)} total{thrDb != null ? ` · ${thrDb} dB` : " · AI"}</div>
                </div>
                <div className="ed-sil-donut" style={{ background: `conic-gradient(var(--accent) ${pct * 360}deg, var(--panel-2) 0)` }}>
                  <span>{Math.round(pct * 100)}%</span>
                </div>
              </div>
              {regions.length > 0 && (
                <div className="ed-sil-list">
                  {regions.map((r, i) => (
                    <label key={i} className={"ed-sil-row" + (r.keep ? " on" : "")}>
                      <input type="checkbox" checked={r.keep} onChange={() => toggleRegion(i)} />
                      <span className="ed-sil-time" onClick={(e) => { e.preventDefault(); onSeek(r.start_ms); }}>
                        {secs(r.start_ms)} → {secs(r.end_ms)}</span>
                      <span className="spacer" />
                      <span className="ed-sil-dur">−{secs(r.end_ms - r.start_ms)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ed-silmodal-ft">
          <button className="ed-sil-cancel" onClick={onClose}>Cancel</button>
          <button className="ed-sil-apply" disabled={phase !== "results" || cutCount === 0 || applying} onClick={apply}>
            {applying ? "Removing…" : <>{IScissors} Remove {cutCount || ""} Silence{cutCount === 1 ? "" : "s"}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
