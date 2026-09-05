import { useMemo, useState } from "react";
import { api } from "../api/client";

interface Cut { start_ms: number; end_ms: number; editId?: string; enabled: boolean; busy?: boolean; }
interface Props { projectId: string; durationMs: number; onSeek: (ms: number) => void; }

function secs(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Silence remover: detect dead air, review each cut, toggle non-destructively.
export function SilenceRemover({ projectId, durationMs, onSeek }: Props) {
  const [cuts, setCuts] = useState<Cut[] | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sens, setSens] = useState(50);                 // 0 = gentle, 100 = aggressive
  const minSilenceMs = Math.round(800 - (sens / 100) * 600); // 800..200ms

  const totalMs = useMemo(() => (cuts || []).reduce((a, c) => a + (c.end_ms - c.start_ms), 0), [cuts]);
  const removedMs = useMemo(
    () => (cuts || []).filter((c) => c.enabled).reduce((a, c) => a + (c.end_ms - c.start_ms), 0),
    [cuts]);
  const enabledCount = (cuts || []).filter((c) => c.enabled).length;
  const allOn = !!cuts && cuts.length > 0 && cuts.every((c) => c.enabled);

  async function detect(minMs = minSilenceMs) {
    setBusy(true); setErr(null);
    try {
      const r = await api.detectSilences(projectId, minMs);
      setThreshold(r.threshold_db);
      setCuts(r.silences.map((s) => ({ ...s, enabled: false })));
    } catch (e: any) {
      setErr(e?.message || "Silence detection failed.");
    } finally { setBusy(false); }
  }

  async function setEnabled(i: number, on: boolean) {
    if (!cuts) return;
    const c = cuts[i];
    if (c.enabled === on) return;
    const next = [...cuts]; next[i] = { ...c, busy: true }; setCuts(next);
    try {
      if (!c.editId) {
        const e = await api.addEdit(projectId, "silence_cut", { start_ms: c.start_ms, end_ms: c.end_ms });
        next[i] = { ...c, editId: e.id, enabled: true, busy: false };
      } else {
        await api.toggleEdit(projectId, c.editId, on);
        next[i] = { ...c, enabled: on, busy: false };
      }
      setCuts([...next]);
    } catch (e: any) {
      next[i] = { ...c, busy: false }; setCuts([...next]);
      setErr(e?.message || "Couldn't update that cut.");
    }
  }

  async function setAll(on: boolean) {
    if (!cuts) return;
    for (let i = 0; i < cuts.length; i++) await setEnabled(i, on);
  }

  function onSensRelease() { if (cuts) detect(minSilenceMs); }

  return (
    <div className="rtk" style={{ marginTop: 16 }}>
      <div className="rtk-title">Silence remover</div>
      <p className="rtk-intro">
        Finds dead air and long pauses so your video always moves. Nothing is deleted —
        cuts apply at export and can be undone.
      </p>

      <button className="rtk-scan" onClick={() => detect()} disabled={busy}>
        {busy ? "Detecting…" : cuts ? "Re-detect" : "◾ Detect dead air"}
      </button>

      <div className="rtk-sens">
        <div className="rtk-sens-top">
          <span>Sensitivity</span>
          <span className="rtk-sens-val">{sens < 34 ? "Gentle" : sens > 66 ? "Aggressive" : "Balanced"} · {minSilenceMs}ms</span>
        </div>
        <input type="range" min={0} max={100} step={5} value={sens}
          onChange={(e) => setSens(+e.target.value)}
          onMouseUp={onSensRelease} onTouchEnd={onSensRelease} />
        <div className="rtk-sens-ends"><span>Long pauses only</span><span>Short pauses too</span></div>
      </div>

      {err && <p className="rtk-err">{err}</p>}

      {cuts && cuts.length > 0 && (
        <>
          <div className="cutbar" title="Detected silences across the clip">
            {cuts.map((c, i) => (
              <div key={i} className={"cutspan" + (c.enabled ? " on" : "")}
                style={{ left: `${(c.start_ms / durationMs) * 100}%`,
                         width: `${Math.max(0.4, ((c.end_ms - c.start_ms) / durationMs) * 100)}%` }}
                onClick={() => onSeek(c.start_ms)} />
            ))}
          </div>

          <div className="rtk-summary">
            <div>
              <strong>{cuts.length}</strong> silence{cuts.length > 1 ? "s" : ""}
              <span className="rtk-sub"> · up to {secs(totalMs)}{threshold != null ? ` · ${threshold} dB` : ""}</span>
            </div>
            <button className={enabledCount ? "secondary" : ""} onClick={() => setAll(!allOn)}>
              {allOn ? "Undo all" : "Remove all"}
            </button>
          </div>
        </>
      )}

      {cuts && cuts.length > 0 && removedMs > 0 && (
        <div className="rtk-removed">✂ {secs(removedMs)} will be cut at export · {enabledCount} selected</div>
      )}

      {cuts && cuts.length === 0 && (
        <div className="rtk-empty">✓ No dead air at this sensitivity — clean take.</div>
      )}

      {cuts && cuts.length > 0 && (
        <div className="flr-list">
          {cuts.map((c, i) => (
            <label key={i} className={"flr-row" + (c.enabled ? " on" : "")}>
              <input type="checkbox" checked={c.enabled} disabled={c.busy}
                onChange={() => setEnabled(i, !c.enabled)} />
              <span className="flr-word" onClick={(e) => { e.preventDefault(); onSeek(c.start_ms); }}>
                {secs(c.start_ms)} → {secs(c.end_ms)}</span>
              <span className="spacer" />
              <span className="flr-dur">−{secs(c.end_ms - c.start_ms)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
