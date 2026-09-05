import { useMemo, useState } from "react";
import { api } from "../api/client";

interface Cut { start_ms: number; end_ms: number; text: string; editId?: string; enabled: boolean; busy?: boolean; }
interface Props { projectId: string; onSeek: (ms: number) => void; }

const t = (ms: number) => (ms / 1000).toFixed(1) + "s";
function secs(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Filler-word remover: cut "uh / um / hmm" (and, when aggressive, "like / so / actually").
export function FillerRemover({ projectId, onSeek }: Props) {
  const [cuts, setCuts] = useState<Cut[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sens, setSens] = useState(30);       // 0 = gentle, 100 = aggressive
  const aggressive = sens >= 50;

  const totalMs = useMemo(() => (cuts || []).reduce((a, c) => a + (c.end_ms - c.start_ms), 0), [cuts]);
  const removedMs = useMemo(
    () => (cuts || []).filter((c) => c.enabled).reduce((a, c) => a + (c.end_ms - c.start_ms), 0),
    [cuts]);
  const enabledCount = (cuts || []).filter((c) => c.enabled).length;
  const allOn = !!cuts && cuts.length > 0 && cuts.every((c) => c.enabled);

  async function find(agg = aggressive) {
    setBusy(true); setErr(null);
    try {
      const r = await api.detectFillers(projectId, agg);
      setCuts(r.fillers.map((f) => ({ ...f, enabled: false })));
    } catch (e: any) {
      setErr(e?.message || "Filler detection failed. Transcribe the video first, then try again.");
    } finally { setBusy(false); }
  }

  async function setEnabled(i: number, on: boolean) {
    if (!cuts) return;
    const c = cuts[i];
    if (c.enabled === on) return;
    const next = [...cuts]; next[i] = { ...c, busy: true }; setCuts(next);
    try {
      if (!c.editId) {
        const e = await api.addEdit(projectId, "filler_cut", { start_ms: c.start_ms, end_ms: c.end_ms });
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

  // re-scan when the sensitivity mode actually changes (gentle <-> aggressive)
  function onSensRelease() {
    if (cuts) find(sens >= 50);
  }

  return (
    <div className="rtk" style={{ marginTop: 16 }}>
      <div className="rtk-title">Filler-word remover</div>
      <p className="rtk-intro">
        Cuts meaningless disfluencies — "uh", "um", "hmm" — as whole segments.
        Nothing is deleted; cuts apply at export and can be undone.
      </p>

      <button className="rtk-scan" onClick={() => find()} disabled={busy}>
        {busy ? "Scanning…" : cuts ? "Re-scan" : "🗣 Find fillers"}
      </button>

      <div className="rtk-sens">
        <div className="rtk-sens-top">
          <span>Sensitivity</span>
          <span className="rtk-sens-val">{aggressive ? "Aggressive" : "Gentle"}</span>
        </div>
        <input type="range" min={0} max={100} step={5} value={sens}
          onChange={(e) => setSens(+e.target.value)}
          onMouseUp={onSensRelease} onTouchEnd={onSensRelease} />
        <div className="rtk-sens-ends"><span>Only uh / um</span><span>Also like / so</span></div>
      </div>

      {err && <p className="rtk-err">{err}</p>}

      {cuts && cuts.length > 0 && (
        <div className="rtk-summary">
          <div>
            <strong>{cuts.length}</strong> filler{cuts.length > 1 ? "s" : ""}
            <span className="rtk-sub"> · up to {secs(totalMs)}</span>
          </div>
          <button className={enabledCount ? "secondary" : ""} onClick={() => setAll(!allOn)}>
            {allOn ? "Undo all" : "Remove all"}
          </button>
        </div>
      )}

      {cuts && cuts.length > 0 && removedMs > 0 && (
        <div className="rtk-removed">✂ {secs(removedMs)} will be cut at export · {enabledCount} selected</div>
      )}

      {cuts && cuts.length === 0 && (
        <div className="rtk-empty">✓ No filler words detected.</div>
      )}

      {cuts && cuts.length > 0 && (
        <div className="flr-list">
          {cuts.map((c, i) => (
            <label key={i} className={"flr-row" + (c.enabled ? " on" : "")}>
              <input type="checkbox" checked={c.enabled} disabled={c.busy}
                onChange={() => setEnabled(i, !c.enabled)} />
              <span className="flr-word">"{c.text}"</span>
              <span className="spacer" />
              <span className="flr-time" onClick={(e) => { e.preventDefault(); onSeek(c.start_ms); }}>{t(c.start_ms)}</span>
              <span className="flr-dur">−{t(c.end_ms - c.start_ms)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
