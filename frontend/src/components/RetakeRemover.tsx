import { useState } from "react";
import { api } from "../api/client";

interface Take { idx: number; start_ms: number; end_ms: number; text: string; }
interface Candidate {
  similarity: number;
  kept: Take;
  cuts: Take[];
  applied?: boolean;
  editIds?: string[];
}

interface Props {
  projectId: string;
  onSeek: (ms: number) => void;
}

function t(ms: number) { return (ms / 1000).toFixed(1) + "s"; }

// M4 retake remover (manual-assisted): find near-duplicate takes, keep the last.
export function RetakeRemover({ projectId, onSeek }: Props) {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    setBusy(true);
    try {
      const r = await api.detectRetakes(projectId);
      setCands(r.candidates.map((c) => ({ ...c, applied: false })));
    } catch (e: any) {
      alert("Retake detection failed: " + e.message);
    } finally { setBusy(false); }
  }

  async function apply(i: number) {
    if (!cands) return;
    const c = cands[i];
    const next = [...cands];
    try {
      if (!c.applied) {
        const ids: string[] = [];
        for (const cut of c.cuts) {
          const e = await api.addEdit(projectId, "retake_remove",
            { start_ms: cut.start_ms, end_ms: cut.end_ms });
          ids.push(e.id);
        }
        next[i] = { ...c, applied: true, editIds: ids };
      } else {
        for (const id of c.editIds || []) await api.toggleEdit(projectId, id, false);
        next[i] = { ...c, applied: false, editIds: [] };
      }
      setCands(next);
    } catch (e: any) {
      alert("Failed to update retake: " + e.message);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <strong>Retake remover</strong>
        <span className="hint">finds repeated takes — keeps the last, applied at export</span>
        <span className="spacer" />
        <button className="secondary" onClick={find} disabled={busy}>
          {busy ? "Scanning…" : cands ? "Re-scan" : "Find retakes"}
        </button>
      </div>

      {cands && cands.length === 0 && (
        <span className="hint">No repeated takes found — clean recording.</span>
      )}

      {cands && cands.map((c, i) => (
        <div key={i} className={"retake" + (c.applied ? " applied" : "")}>
          <div className="retake-head">
            <span className="sim">{Math.round(c.similarity * 100)}% match</span>
            <span className="spacer" />
            <button className={c.applied ? "secondary" : ""} onClick={() => apply(i)}>
              {c.applied ? "Undo" : `Remove earlier take${c.cuts.length > 1 ? "s" : ""}`}
            </button>
          </div>
          {c.cuts.map((cut) => (
            <div key={cut.idx} className="take cut" onClick={() => onSeek(cut.start_ms)}>
              <span className="tag">CUT</span>
              <span className="time">{t(cut.start_ms)}</span>
              <span className="txt">{cut.text}</span>
            </div>
          ))}
          <div className="take keep" onClick={() => onSeek(c.kept.start_ms)}>
            <span className="tag ok">KEEP</span>
            <span className="time">{t(c.kept.start_ms)}</span>
            <span className="txt">{c.kept.text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
