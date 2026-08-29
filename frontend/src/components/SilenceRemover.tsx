import { useState } from "react";
import { api } from "../api/client";

interface Cut {
  start_ms: number;
  end_ms: number;
  editId?: string;
  enabled: boolean;
}

interface Props {
  projectId: string;
  durationMs: number;
  onSeek: (ms: number) => void;
}

function secs(ms: number) {
  return (ms / 1000).toFixed(1) + "s";
}

// M3 silence remover: detect dead air, review each cut, toggle non-destructively.
export function SilenceRemover({ projectId, durationMs, onSeek }: Props) {
  const [cuts, setCuts] = useState<Cut[] | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function detect() {
    setBusy(true);
    try {
      const r = await api.detectSilences(projectId);
      setThreshold(r.threshold_db);
      setCuts(r.silences.map((s) => ({ ...s, enabled: false })));
    } catch (e: any) {
      alert("Silence detection failed: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(i: number) {
    if (!cuts) return;
    const c = cuts[i];
    const next = [...cuts];
    try {
      if (!c.editId) {
        const e = await api.addEdit(projectId, "silence_cut", {
          start_ms: c.start_ms,
          end_ms: c.end_ms,
        });
        next[i] = { ...c, editId: e.id, enabled: true };
      } else {
        await api.toggleEdit(projectId, c.editId, !c.enabled);
        next[i] = { ...c, enabled: !c.enabled };
      }
      setCuts(next);
    } catch (e: any) {
      alert("Failed to update cut: " + e.message);
    }
  }

  const enabledCuts = cuts?.filter((c) => c.enabled) ?? [];
  const saved = enabledCuts.reduce((a, c) => a + (c.end_ms - c.start_ms), 0);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <strong>Silence remover</strong>
        <span className="hint">removes dead air — applied at export, non-destructive</span>
        <span className="spacer" />
        <button className="secondary" onClick={detect} disabled={busy}>
          {busy ? "Detecting…" : cuts ? "Re-detect" : "Detect dead air"}
        </button>
      </div>

      {cuts && (
        <>
          {/* visual cut map across the clip's duration */}
          <div className="cutbar" title="Detected silences across the clip">
            {cuts.map((c, i) => (
              <div
                key={i}
                className={"cutspan" + (c.enabled ? " on" : "")}
                style={{
                  left: `${(c.start_ms / durationMs) * 100}%`,
                  width: `${Math.max(0.4, ((c.end_ms - c.start_ms) / durationMs) * 100)}%`,
                }}
                onClick={() => onSeek(c.start_ms)}
              />
            ))}
          </div>

          <div className="hint" style={{ margin: "8px 0" }}>
            {cuts.length} silence{cuts.length === 1 ? "" : "s"} found
            {threshold != null && ` at ${threshold} dB`} ·{" "}
            <strong style={{ color: "var(--ok)" }}>{secs(saved)} saved</strong> ·{" "}
            {enabledCuts.length} of {cuts.length} selected
          </div>

          <div className="cutlist">
            {cuts.map((c, i) => (
              <label key={i} className={"cutrow" + (c.enabled ? " on" : "")}>
                <input type="checkbox" checked={c.enabled} onChange={() => toggle(i)} />
                <span className="time" onClick={(e) => { e.preventDefault(); onSeek(c.start_ms); }}>
                  {secs(c.start_ms)} → {secs(c.end_ms)}
                </span>
                <span className="dur">−{secs(c.end_ms - c.start_ms)}</span>
              </label>
            ))}
            {cuts.length === 0 && (
              <span className="hint">No dead air detected at this threshold — clean take.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
