import { useMemo, useState } from "react";
import { api } from "../api/client";

interface Take { idx: number; start_ms: number; end_ms: number; text: string; }
interface Candidate {
  similarity: number;
  kept: Take;
  cuts: Take[];
  applied?: boolean;
  editIds?: string[];
  busy?: boolean;
}

interface Props {
  projectId: string;
  onSeek: (ms: number) => void;
}

function t(ms: number) { return (ms / 1000).toFixed(1) + "s"; }
function secs(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
function cutMs(c: Candidate) { return c.cuts.reduce((a, k) => a + (k.end_ms - k.start_ms), 0); }

// Retake remover: find near-duplicate takes, keep the last, cut the earlier ones.
export function RetakeRemover({ projectId, onSeek }: Props) {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sens, setSens] = useState(50); // 0 = strict, 100 = loose
  const threshold = +(0.80 - (sens / 100) * 0.35).toFixed(3); // 0.80..0.45

  const removedMs = useMemo(
    () => (cands || []).filter((c) => c.applied).reduce((a, c) => a + cutMs(c), 0),
    [cands]
  );
  const totalMs = useMemo(
    () => (cands || []).reduce((a, c) => a + cutMs(c), 0),
    [cands]
  );
  const anyApplied = (cands || []).some((c) => c.applied);
  const allApplied = !!cands && cands.length > 0 && cands.every((c) => c.applied);

  async function find() {
    setBusy(true); setErr(null);
    try {
      const r = await api.detectRetakes(projectId, threshold);
      setCands(r.candidates.map((c) => ({ ...c, applied: false })));
    } catch (e: any) {
      setErr(e?.message || "Retake detection failed. Transcribe the video first, then try again.");
    } finally { setBusy(false); }
  }

  async function setApplied(i: number, applied: boolean) {
    if (!cands) return;
    const c = cands[i];
    if (c.applied === applied) return;
    const next = [...cands];
    next[i] = { ...c, busy: true };
    setCands(next);
    try {
      if (applied) {
        const ids: string[] = [];
        for (const cut of c.cuts) {
          const e = await api.addEdit(projectId, "retake_remove",
            { start_ms: cut.start_ms, end_ms: cut.end_ms });
          ids.push(e.id);
        }
        next[i] = { ...c, applied: true, editIds: ids, busy: false };
      } else {
        for (const id of c.editIds || []) await api.toggleEdit(projectId, id, false);
        next[i] = { ...c, applied: false, editIds: [], busy: false };
      }
      setCands([...next]);
    } catch (e: any) {
      next[i] = { ...c, busy: false };
      setCands([...next]);
      setErr(e?.message || "Couldn't update that retake.");
    }
  }

  async function applyAll(applied: boolean) {
    if (!cands) return;
    for (let i = 0; i < cands.length; i++) await setApplied(i, applied);
  }

  return (
    <div className="rtk">
      <p className="rtk-intro">
        Fumbled a line and said it again? maxfly finds near-duplicate takes and keeps
        only your best (last) one. Nothing is deleted — cuts apply at export and can be undone.
      </p>

      <button className="rtk-scan" onClick={find} disabled={busy}>
        {busy ? "Scanning…" : cands ? "Re-scan" : "↺ Find retakes"}
      </button>

      <div className="rtk-sens">
        <div className="rtk-sens-top">
          <span>Sensitivity</span>
          <span className="rtk-sens-val">{sens < 34 ? "Strict" : sens > 66 ? "Loose" : "Balanced"}</span>
        </div>
        <input type="range" min={0} max={100} step={5} value={sens}
          onChange={(e) => setSens(+e.target.value)}
          onMouseUp={() => { if (cands) find(); }}
          onTouchEnd={() => { if (cands) find(); }} />
        <div className="rtk-sens-ends"><span>Only near-identical</span><span>Catch more</span></div>
      </div>

      {err && <p className="rtk-err">{err}</p>}

      {cands && cands.length > 0 && (
        <div className="rtk-summary">
          <div>
            <strong>{cands.length}</strong> repeated take{cands.length > 1 ? "s" : ""}
            <span className="rtk-sub"> · up to {secs(totalMs)} removable</span>
          </div>
          <button className={anyApplied ? "secondary" : ""}
                  onClick={() => applyAll(!allApplied)}>
            {allApplied ? "Undo all" : "Remove all"}
          </button>
        </div>
      )}

      {cands && cands.length > 0 && removedMs > 0 && (
        <div className="rtk-removed">✂ {secs(removedMs)} will be cut at export</div>
      )}

      {cands && cands.length === 0 && (
        <div className="rtk-empty">✓ No repeated takes found — clean recording.</div>
      )}

      {cands && cands.map((c, i) => (
        <div key={i} className={"rtk-card" + (c.applied ? " applied" : "")}>
          <div className="rtk-card-head">
            <span className="rtk-match">{Math.round(c.similarity * 100)}% match</span>
            <span className="rtk-len">{secs(cutMs(c))}</span>
            <span className="spacer" />
            <button className={"rtk-apply" + (c.applied ? " undo" : "")}
                    disabled={c.busy}
                    onClick={() => setApplied(i, !c.applied)}>
              {c.busy ? "…" : c.applied ? "Undo" : `Remove ${c.cuts.length > 1 ? c.cuts.length + " takes" : "take"}`}
            </button>
          </div>
          {c.cuts.map((cut) => (
            <div key={cut.idx} className="rtk-take cut" onClick={() => onSeek(cut.start_ms)} title="Jump to this take">
              <span className="rtk-tag cut">CUT</span>
              <span className="rtk-time">{t(cut.start_ms)}</span>
              <span className="rtk-txt">{cut.text}</span>
            </div>
          ))}
          <div className="rtk-take keep" onClick={() => onSeek(c.kept.start_ms)} title="Jump to the kept take">
            <span className="rtk-tag keep">KEEP</span>
            <span className="rtk-time">{t(c.kept.start_ms)}</span>
            <span className="rtk-txt">{c.kept.text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
