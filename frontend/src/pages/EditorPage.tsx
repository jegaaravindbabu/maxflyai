import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../api/client";
import type { ProjectDetail } from "../types";
import { VideoPreview } from "../components/VideoPreview";
import { CaptionOverlay } from "../components/CaptionOverlay";
import { TranscriptPanel } from "../components/TranscriptPanel";
import { Waveform } from "../components/Waveform";
import { SilenceRemover } from "../components/SilenceRemover";
import { RetakeRemover } from "../components/RetakeRemover";
import { FillerRemover } from "../components/FillerRemover";

const LANGS = [
  ["unknown", "Auto-detect"], ["ta-IN", "Tamil"], ["te-IN", "Telugu"],
  ["hi-IN", "Hindi"], ["ml-IN", "Malayalam"], ["kn-IN", "Kannada"],
  ["bn-IN", "Bengali"], ["en-IN", "English"],
];

export function EditorPage({ projectId }: { projectId: string }) {
  const [proj, setProj] = useState<ProjectDetail | null>(null);
  const [lang, setLang] = useState("ta-IN");
  const [mode, setMode] = useState("transcribe");
  const [showTranslit, setShowTranslit] = useState(true);
  const [capStyle, setCapStyle] = useState("classic");
  const [enhanceAudio, setEnhanceAudio] = useState(false);
  const [styles, setStyles] = useState<{id:string;label:string}[]>([]);
  const [busy, setBusy] = useState(false);
  const [curMs, setCurMs] = useState(0);
  const [exports, setExports] = useState<{ fmt: string; url?: string; status: string }[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mediaEl, setMediaEl] = useState<HTMLMediaElement | null>(null);

  const load = useCallback(() => api.getProject(projectId).then(setProj).catch(() => {}), [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.captionStyles().then(r => setStyles(r.styles)).catch(()=>{}); }, []);

  // bind waveform once video mounts
  useEffect(() => { setMediaEl(videoRef.current); }, [proj?.id]);

  // poll lightweight status while a job runs; full-load once it completes
  useEffect(() => {
    if (proj?.status !== "transcribing") return;
    const t = setInterval(async () => {
      try {
        const s = await api.getStatus(projectId);
        if (s.status !== "transcribing") load();
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(t);
  }, [proj?.status, projectId, load]);

  // track playhead
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const on = () => setCurMs(v.currentTime * 1000);
    v.addEventListener("timeupdate", on);
    return () => v.removeEventListener("timeupdate", on);
  }, [proj?.id]);

  if (!proj) return <p className="muted">Loading…</p>;

  const cues = proj.cues || [];
  const activeIdx = cues.find((c) => curMs >= c.start_ms && curMs < c.end_ms)?.idx ?? -1;
  const activeCue = cues.find((c) => c.idx === activeIdx);
  const overlayText = activeCue
    ? (showTranslit && activeCue.translit_text ? activeCue.translit_text : activeCue.text)
    : "";

  function seek(ms: number) {
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
  }

  async function runTranscribe() {
    setBusy(true);
    try {
      await api.transcribe(projectId, lang, mode);
      await load();
    } catch (e: any) {
      alert("Transcription failed: " + e.message);
    } finally { setBusy(false); }
  }

  async function editCue(idx: number, text: string) {
    await api.editCue(projectId, idx, text);
    load();
  }

  function upsertExport(fmt: string, patch: { url?: string; status: string }) {
    setExports((prev) => {
      const rest = prev.filter((e) => e.fmt !== fmt);
      return [{ fmt, ...patch }, ...rest];
    });
  }

  async function doExport(fmt: string) {
    upsertExport(fmt, { status: "processing" });
    try {
      const r = await api.exportSub(projectId, fmt, showTranslit, true, capStyle, enhanceAudio);
      const eid = r.export_id;
      // poll the exports list until this job finishes
      for (let i = 0; i < 120; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        const list = await api.listExports(projectId);
        const row = list.find((x) => x.id === eid);
        if (row && row.status !== "processing") {
          upsertExport(fmt, { url: row.url || undefined, status: row.status });
          return;
        }
      }
      upsertExport(fmt, { status: "error" });
    } catch (e: any) {
      upsertExport(fmt, { status: "error" });
    }
  }

  return (
    <div>
      <div className="toolbar">
        <a href="#/" className="linkbtn" style={{ marginRight: 6 }}>← Home</a>
        <strong>{proj.name}</strong>
        <span className={"badge " + proj.status}>{proj.status}</span>
        <span className="spacer" />
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="transcribe">Transcribe</option>
          <option value="translit">Romanized (Thanglish)</option>
          <option value="codemix">Code-mix</option>
          <option value="translate">Translate → English</option>
        </select>
        <button onClick={runTranscribe} disabled={busy || proj.status === "transcribing"}>
          {proj.status === "transcribing" ? "Transcribing…" : "Transcribe"}
        </button>
      </div>

      {proj.error && <p style={{ color: "var(--accent)" }}>Error: {proj.error}</p>}

      <div className="editor">
        <div>
          <VideoPreview ref={videoRef}
            src={proj.media_url ? (proj.media_url.startsWith("http") ? proj.media_url : api.mediaUrl(proj.media_url)) : ""}
            overlay={activeCue && overlayText ? (
              <CaptionOverlay text={overlayText} styleId={capStyle} cue={activeCue}
                curMs={curMs} keyId={activeIdx} />
            ) : null} />
          <Waveform mediaEl={mediaEl} />
          <p className="hint">Waveform is synced to the video. Click a caption to jump; double-click its text to edit.</p>
          <SilenceRemover projectId={projectId} durationMs={proj.duration_ms || 1} onSeek={seek} />
          <RetakeRemover projectId={projectId} onSeek={seek} />
          <FillerRemover projectId={projectId} onSeek={seek} />
        </div>

        <div className="card">
          <div className="toolbar">
            <label className="hint">
              <input type="checkbox" checked={showTranslit}
                onChange={(e) => setShowTranslit(e.target.checked)} /> Show romanized
            </label>
            <select value={capStyle} onChange={(e) => setCapStyle(e.target.value)} title="Caption style">
              {styles.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
            </select>
            <label className="hint" title="Denoise + level the voice on the exported MP4">
              <input type="checkbox" checked={enhanceAudio}
                onChange={(e) => setEnhanceAudio(e.target.checked)} /> Enhance audio
            </label>
            <span className="spacer" />
            <button className="secondary" onClick={() => doExport("srt")}>SRT</button>
            <button className="secondary" onClick={() => doExport("vtt")}>VTT</button>
            <button className="secondary" onClick={() => doExport("ass")}>ASS</button>
            <button onClick={() => doExport("mp4")} title="Burned-in captions, dead air removed">MP4</button>
          </div>
          <div className="toolbar" style={{ marginTop: 4 }}>
            <span className="hint">Timeline (dead air removed) →</span>
            <span className="spacer" />
            <button className="secondary" onClick={() => doExport("fcpxml")}
              title="Editable timeline for Premiere Pro / DaVinci Resolve">FCPXML</button>
            <button className="secondary" onClick={() => doExport("edl")}
              title="CMX3600 EDL cut list">EDL</button>
            <button onClick={() => doExport("bundle")}
              title="Zip: separate video / voice / music / captions + multi-track project">Multi-track .zip</button>
          </div>
          {exports.length > 0 && (
            <div className="export-links" style={{ marginBottom: 10 }}>
              {exports.map((e) => (
                e.status === "ready" && e.url ? (
                  <a key={e.fmt} href={api.mediaUrl(e.url)} target="_blank" rel="noreferrer">
                    ↓ {e.fmt.toUpperCase()}
                  </a>
                ) : (
                  <span key={e.fmt} className={e.status === "error" ? "exp-err" : "exp-proc"}>
                    {e.fmt.toUpperCase()} {e.status === "error" ? "failed" : "…"}
                  </span>
                )
              ))}
            </div>
          )}
          <TranscriptPanel cues={cues} activeIdx={activeIdx} showTranslit={showTranslit}
            onSeek={seek} onEdit={editCue} />
        </div>
      </div>
    </div>
  );
}
