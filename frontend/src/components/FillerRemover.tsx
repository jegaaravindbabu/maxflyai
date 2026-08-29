import { useState } from "react";
import { api } from "../api/client";

interface Cut { start_ms: number; end_ms: number; text: string; editId?: string; enabled: boolean; }

interface Props { projectId: string; onSeek: (ms: number) => void; }

const t = (ms: number) => (ms / 1000).toFixed(1) + "s";

// Filler-word removal: cut "uh/um/hmm" etc. Applied non-destructively at export.
export function FillerRemover({ projectId, onSeek }: Props) {
  const [cuts, setCuts] = useState<Cut[] | null>(null);
  const [aggressive, setAggressive] = useState(false);
  const [busy, setBusy] = useState(false);

  async function find() {
    setBusy(true);
    try {
      const r = await api.detectFillers(projectId, aggressive);
      setCuts(r.fillers.map((f) => ({ ...f, enabled: false })));
    } catch (e: any) {
      alert("Filler detection failed: " + e.message);
    } finally { setBusy(false); }
  }

  async function toggle(i: number) {
    if (!cuts) return;
    const c = cuts[i]; const next = [...cuts];
    try {
      if (!c.editId) {
        const e = await api.addEdit(projectId, "filler_cut", { start_ms: c.start_ms, end_ms: c.end_ms });
        next[i] = { ...c, editId: e.id, enabled: true };
      } else {
        await api.toggleEdit(projectId, c.editId, !c.enabled);
        next[i] = { ...c, enabled: !c.enabled };
      }
      setCuts(next);
    } catch (e: any) { alert("Failed: " + e.message); }
  }

  async function removeAll() {
    if (!cuts) return;
    for (let i = 0; i < cuts.length; i++) if (!cuts[i].enabled) await toggle(i);
  }

  const enabled = cuts?.filter((c) => c.enabled) ?? [];
  const saved = enabled.reduce((a, c) => a + (c.end_ms - c.start_ms), 0);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <strong>Filler-word remover</strong>
        <span className="hint">cuts uh / um / hmm — applied at export</span>
        <span className="spacer" />
        <label className="hint"><input type="checkbox" checked={aggressive}
          onChange={(e) => setAggressive(e.target.checked)} /> aggressive</label>
        <button className="secondary" onClick={find} disabled={busy}>
          {busy ? "Scanning…" : cuts ? "Re-scan" : "Find fillers"}
        </button>
      </div>

      {cuts && cuts.length === 0 && (
        <span className="hint">No filler words detected.</span>
      )}

      {cuts && cuts.length > 0 && (
        <>
          <div className="hint" style={{ marginBottom: 8 }}>
            {cuts.length} filler{cuts.length === 1 ? "" : "s"} ·{" "}
            <strong style={{ color: "var(--ok)" }}>{t(saved)} saved</strong> ·{" "}
            {enabled.length} selected
            <button className="linkbtn" onClick={removeAll} disabled={busy}
              style={{ marginLeft: 10 }}>remove all</button>
          </div>
          <div className="cutlist">
            {cuts.map((c, i) => (
              <label key={i} className={"cutrow" + (c.enabled ? " on" : "")}>
                <input type="checkbox" checked={c.enabled} onChange={() => toggle(i)} />
                <span className="fillerword">"{c.text}"</span>
                <span className="time" onClick={(e) => { e.preventDefault(); onSeek(c.start_ms); }}>
                  {t(c.start_ms)}</span>
                <span className="dur">−{t(c.end_ms - c.start_ms)}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
