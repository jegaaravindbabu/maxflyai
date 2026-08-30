import { useEffect, useRef, useState, useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api/client";
import type { ProjectDetail, Overlay } from "../types";
import { VideoPreview } from "../components/VideoPreview";
import { CaptionOverlay } from "../components/CaptionOverlay";
import { Waveform } from "../components/Waveform";
import { SilenceRemover } from "../components/SilenceRemover";
import { RetakeRemover } from "../components/RetakeRemover";
import { FillerRemover } from "../components/FillerRemover";

const LANGS = [
  ["unknown", "Auto-detect"], ["ta-IN", "Tamil"], ["te-IN", "Telugu"],
  ["hi-IN", "Hindi"], ["ml-IN", "Malayalam"], ["kn-IN", "Kannada"],
  ["bn-IN", "Bengali"], ["en-IN", "English"],
];

const SWATCHES: { color: string; style: string }[] = [
  { color: "#ffd21e", style: "bold_yellow" },
  { color: "#f97316", style: "uppercase" },
  { color: "#22c55e", style: "slide_up" },
  { color: "#ec4899", style: "pop" },
  { color: "#22d3ee", style: "glow" },
  { color: "#a855f7", style: "bounce" },
  { color: "#ef4444", style: "karaoke" },
  { color: "#ffffff", style: "classic" },
];

const RAILS = [
  { id: "captions", icon: "▤", label: "Captions" },
  { id: "texts", icon: "T", label: "Texts" },
  { id: "tools", icon: "✨", label: "AI Tools" },
  { id: "zoom", icon: "⊕", label: "Auto Zoom" },
  { id: "export", icon: "⬇", label: "Export" },
];

function fmtT(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function EditorPage({ projectId }: { projectId: string }) {
  const [proj, setProj] = useState<ProjectDetail | null>(null);
  const [lang, setLang] = useState("ta-IN");
  const [mode, setMode] = useState("transcribe");
  const [showTranslit, setShowTranslit] = useState(true);
  const [capStyle, setCapStyle] = useState("classic");
  const [animOn, setAnimOn] = useState(true);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selOv, setSelOv] = useState<string | null>(null);
  const [zooms, setZooms] = useState<{ id: string; start_ms: number; end_ms: number; scale: number }[]>([]);
  const [zoomScale, setZoomScale] = useState(1.2);
  const [zoomBusy, setZoomBusy] = useState(false);
  const overlaysRef = useRef<Overlay[]>([]);
  overlaysRef.current = overlays;
  const [enhanceAudio, setEnhanceAudio] = useState(false);
  const [styles, setStyles] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [curMs, setCurMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exports, setExports] = useState<{ fmt: string; url?: string; status: string }[]>([]);
  const [rail, setRail] = useState<"captions" | "texts" | "tools" | "zoom" | "export">("captions");
  const [rightTab, setRightTab] = useState<"styles" | "settings" | "animation">("styles");
  const [density, setDensity] = useState<"compact" | "roomy">("roomy");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mediaEl, setMediaEl] = useState<HTMLMediaElement | null>(null);

  const load = useCallback(() => api.getProject(projectId).then(setProj).catch(() => {}), [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.captionStyles().then((r) => setStyles(r.styles)).catch(() => {}); }, []);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`maxfly:proj:${projectId}`);
      if (raw) { const p = JSON.parse(raw); if (p.lang) setLang(p.lang); if (p.outputMode) setMode(p.outputMode); }
    } catch {}
  }, [projectId]);

  useEffect(() => { setMediaEl(videoRef.current); }, [proj?.id]);
  useEffect(() => { setOverlays(proj?.overlays || []); }, [proj?.id]);
  useEffect(() => { api.listAutozoom(projectId).then(setZooms).catch(() => {}); }, [projectId]);

  useEffect(() => {
    if (proj?.status !== "transcribing") return;
    const t = setInterval(async () => {
      try { const s = await api.getStatus(projectId); if (s.status !== "transcribing") load(); } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [proj?.status, projectId, load]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onT = () => setCurMs(v.currentTime * 1000);
    const onP = () => setPlaying(true);
    const onPa = () => setPlaying(false);
    v.addEventListener("timeupdate", onT);
    v.addEventListener("play", onP);
    v.addEventListener("pause", onPa);
    return () => { v.removeEventListener("timeupdate", onT); v.removeEventListener("play", onP); v.removeEventListener("pause", onPa); };
  }, [proj?.id]);

  if (!proj) return <div className="ed-loading muted">Loading editor…</div>;

  const dur = proj.duration_ms || 1;
  const cues = proj.cues || [];
  const activeIdx = cues.find((c) => curMs >= c.start_ms && curMs < c.end_ms)?.idx ?? -1;
  const activeCue = cues.find((c) => c.idx === activeIdx);
  const overlayText = activeCue ? (showTranslit && activeCue.translit_text ? activeCue.translit_text : activeCue.text) : "";
  const WORD_STYLES = ["karaoke", "highlight"];
  const effStyle = animOn ? capStyle : "classic";
  const wordMode = WORD_STYLES.includes(capStyle);
  const mediaSrc = proj.media_url ? (proj.media_url.startsWith("http") ? proj.media_url : api.mediaUrl(proj.media_url)) : "";

  function seek(ms: number) { if (videoRef.current) videoRef.current.currentTime = ms / 1000; }
  function togglePlay() { const v = videoRef.current; if (!v) return; if (v.paused) v.play(); else v.pause(); }

  async function runTranscribe() {
    setBusy(true);
    try { await api.transcribe(projectId, lang, mode); await load(); }
    catch (e: any) { alert("Transcription failed: " + e.message); }
    finally { setBusy(false); }
  }
  async function saveCue(idx: number) {
    await api.editCue(projectId, idx, draft);
    setEditingIdx(null);
    load();
  }
  function toggleSel(idx: number) {
    setSelected((s) => { const n = new Set(s); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  }
  async function addCaption() {
    const at = Math.round(curMs);
    await api.addCue(projectId, at, at + 2000, "New caption");
    load();
  }
  async function splitAt(idx: number) { await api.splitCue(projectId, idx, Math.round(curMs)); setSelected(new Set()); load(); }
  async function mergeNext(idx: number) { await api.mergeCue(projectId, idx); setSelected(new Set()); load(); }
  async function deleteOne(idx: number) { await api.deleteCue(projectId, idx); setSelected(new Set()); load(); }
  async function bulkDelete() {
    if (selected.size === 0) return;
    await api.bulkDeleteCues(projectId, [...selected]);
    setSelected(new Set());
    load();
  }
  async function addText() {
    const at = Math.round(curMs);
    const o = await api.addOverlay(projectId, { text: "Your text", start_ms: at, end_ms: at + 3000,
      x_pct: 50, y_pct: 20, font_size: 72, color: "#ffffff", bold: true });
    setOverlays((prev) => [...prev, o]);
    setSelOv(o.id);
    setRail("texts");
  }
  function patchLocal(id: string, patch: Partial<Overlay>) {
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }
  async function saveOverlay(id: string, patch: Partial<Overlay>) {
    patchLocal(id, patch);
    try { await api.updateOverlay(projectId, id, patch); } catch {}
  }
  async function delText(id: string) {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    if (selOv === id) setSelOv(null);
    try { await api.deleteOverlay(projectId, id); } catch {}
  }
  function startDrag(e: ReactMouseEvent, o: Overlay) {
    e.preventDefault(); e.stopPropagation();
    setSelOv(o.id);
    const parent = (e.currentTarget as HTMLElement).offsetParent as HTMLElement | null;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      patchLocal(o.id, { x_pct: x, y_pct: y });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const cur = overlaysRef.current.find((v) => v.id === o.id);
      if (cur) api.updateOverlay(projectId, o.id, { x_pct: cur.x_pct, y_pct: cur.y_pct }).catch(() => {});
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }
  function upsertExport(fmt: string, patch: { url?: string; status: string }) {
    setExports((prev) => [{ fmt, ...patch }, ...prev.filter((e) => e.fmt !== fmt)]);
  }
  async function doExport(fmt: string) {
    const style = animOn ? capStyle : "classic";
    upsertExport(fmt, { status: "processing" });
    try {
      const r = await api.exportSub(projectId, fmt, showTranslit, true, style, enhanceAudio);
      const eid = r.export_id;
      for (let i = 0; i < 120; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        const list = await api.listExports(projectId);
        const row = list.find((x) => x.id === eid);
        if (row && row.status !== "processing") { upsertExport(fmt, { url: row.url || undefined, status: row.status }); return; }
      }
      upsertExport(fmt, { status: "error" });
    } catch { upsertExport(fmt, { status: "error" }); }
  }

  async function generateZoom() {
    setZoomBusy(true);
    try { const r = await api.generateAutozoom(projectId, zoomScale); setZooms(r.zooms); }
    catch (e: any) { alert("Auto zoom failed: " + e.message); }
    finally { setZoomBusy(false); }
  }
  async function addZoomHere() {
    const s0 = Math.round(curMs);
    await api.addZoom(projectId, s0, s0 + 2500, zoomScale);
    api.listAutozoom(projectId).then(setZooms).catch(() => {});
  }
  async function clearZoom() { await api.clearAutozoom(projectId); setZooms([]); }
  async function delZoom(id: string) {
    setZooms((prev) => prev.filter((z) => z.id !== id));
    try { await api.deleteEdit(projectId, id); } catch {}
  }

  const transcribing = proj.status === "transcribing";

  return (
    <div className="ed">
      {/* ===== top bar ===== */}
      <div className="ed-top">
        <div className="ed-top-l">
          <a href="#/" className="ed-back" title="Back">←</a>
          <span className="ed-play-logo">▶</span>
        </div>
        <div className="ed-title">{proj.name}</div>
        <div className="ed-top-r">
          <span className="ed-pill">{(dur / 60000).toFixed(1)} min</span>
          <span className={"badge " + proj.status}>{proj.status}</span>
          <div className="ed-export-wrap">
            <button className="ed-export" onClick={() => setRail("export")}>⬇ Export</button>
          </div>
        </div>
      </div>

      {proj.error && <div className="ed-err-banner">Error: {proj.error}</div>}

      {/* ===== main 3-column ===== */}
      <div className="ed-main">
        {/* rail */}
        <div className="ed-rail">
          {RAILS.map((r) => (
            <div key={r.id} className={"ed-rail-btn" + (rail === r.id ? " active" : "")} onClick={() => setRail(r.id as any)}>
              <span className="ed-rail-ic">{r.icon}</span>
              <span className="ed-rail-lb">{r.label}</span>
            </div>
          ))}
        </div>

        {/* left panel */}
        <div className="ed-left">
          {rail === "captions" && (
            <>
              <div className="ed-left-head">
                <h3>Captions</h3>
                <div className="ed-density">
                  <span className={density === "compact" ? "active" : ""} onClick={() => setDensity("compact")}>Compact</span>
                  <span className={density === "roomy" ? "active" : ""} onClick={() => setDensity("roomy")}>Roomy</span>
                </div>
              </div>
              <div className="ed-cap-bar">
                <span className="ed-cap-count">{cues.length} captions</span>
                {cues.length > 0 && (
                  <span className="ed-selall" onClick={() => setSelected(selected.size === cues.length ? new Set() : new Set(cues.map((c) => c.idx)))}>
                    {selected.size === cues.length && cues.length > 0 ? "Deselect all" : "Select all"}
                  </span>
                )}
              </div>
              {selected.size > 0 && (
                <div className="ed-bulkbar">
                  <span>{selected.size} selected</span>
                  <button className="ed-bulk-del" onClick={bulkDelete}>🗑 Delete selected</button>
                </div>
              )}
              {cues.length === 0 ? (
                <div className="ed-cap-empty">
                  {transcribing ? "Transcribing your video…" : "No captions yet."}
                  {!transcribing && <button className="secondary" style={{ marginTop: 12 }} onClick={runTranscribe} disabled={busy}>Generate captions</button>}
                </div>
              ) : (
                <>
                <div className={"ed-cap-list " + density}>
                  {cues.map((c) => (
                    <div key={c.idx} className={"ed-cap-item" + (c.idx === activeIdx ? " active" : "") + (selected.has(c.idx) ? " sel" : "")} onClick={() => seek(c.start_ms)}>
                      <input type="checkbox" className="ed-cap-chk" checked={selected.has(c.idx)}
                        onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(c.idx)} />
                      <div className="ed-cap-num">{c.idx + 1}<span>{fmtT(c.start_ms)}</span></div>
                      <div className="ed-cap-text" onDoubleClick={(e) => { e.stopPropagation(); setEditingIdx(c.idx); setDraft(showTranslit && c.translit_text ? c.translit_text : c.text); }}>
                        {editingIdx === c.idx ? (
                          <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => saveCue(c.idx)} onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveCue(c.idx); } }} />
                        ) : (
                          showTranslit && c.translit_text ? c.translit_text : c.text
                        )}
                      </div>
                      <div className="ed-cap-acts" onClick={(e) => e.stopPropagation()}>
                        <button title="Split at playhead" onClick={() => splitAt(c.idx)}>⑃</button>
                        <button title="Merge with next" onClick={() => mergeNext(c.idx)} disabled={c.idx >= cues.length - 1}>⤵</button>
                        <button title="Delete" className="del" onClick={() => deleteOne(c.idx)}>🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="ed-addcap" onClick={addCaption}>+ Add caption</button>
                </>
              )}
            </>
          )}

          {rail === "texts" && (
            <>
              <div className="ed-left-head"><h3>Texts</h3></div>
              <button className="ed-addcap" onClick={addText}>+ Add text</button>
              {overlays.length === 0 ? (
                <div className="ed-cap-empty" style={{ paddingTop: 20 }}>
                  No text overlays yet. Add a title or on-screen text that burns onto the exported video.
                </div>
              ) : (
                <div className="ed-txt-list">
                  {overlays.map((o) => (
                    <div key={o.id} className={"ed-txt-item" + (selOv === o.id ? " active" : "")}
                      onClick={() => { setSelOv(o.id); seek(o.start_ms); }}>
                      <div className="ed-txt-preview" style={{ color: o.color, fontWeight: o.bold ? 800 : 500 }}>{o.text || "(empty)"}</div>
                      <div className="np-sub">{fmtT(o.start_ms)} – {fmtT(o.end_ms)}</div>
                    </div>
                  ))}
                </div>
              )}
              {selOv && (() => {
                const o = overlays.find((v) => v.id === selOv);
                if (!o) return null;
                return (
                  <div className="card ed-txt-editor">
                    <div className="np-label">Text</div>
                    <textarea className="ed-txt-input" value={o.text}
                      onChange={(e) => patchLocal(o.id, { text: e.target.value })}
                      onBlur={(e) => saveOverlay(o.id, { text: e.target.value })} />
                    <div className="np-label" style={{ marginTop: 12 }}>Font size · {o.font_size}</div>
                    <input type="range" min={32} max={160} value={o.font_size}
                      onChange={(e) => patchLocal(o.id, { font_size: +e.target.value })}
                      onMouseUp={(e) => saveOverlay(o.id, { font_size: +(e.target as HTMLInputElement).value })}
                      style={{ width: "100%" }} />
                    <div className="np-label" style={{ marginTop: 12 }}>Colour</div>
                    <div className="ed-swatches">
                      {["#ffffff", "#ffd21e", "#f97316", "#22c55e", "#22d3ee", "#a855f7", "#ec4899", "#ef4444"].map((c) => (
                        <span key={c} className={"ed-swatch" + (o.color.toLowerCase() === c ? " active" : "")}
                          style={{ background: c }} onClick={() => saveOverlay(o.id, { color: c })} />
                      ))}
                    </div>
                    <label className="ed-setting"><span>Bold</span>
                      <input type="checkbox" checked={o.bold} onChange={(e) => saveOverlay(o.id, { bold: e.target.checked })} /></label>
                    <div className="ed-txt-time">
                      <button className="secondary" onClick={() => saveOverlay(o.id, { start_ms: Math.round(curMs) })}>Start ⟵ playhead</button>
                      <button className="secondary" onClick={() => saveOverlay(o.id, { end_ms: Math.round(curMs) })}>End ⟵ playhead</button>
                    </div>
                    <button className="ed-bulk-del" style={{ width: "100%", marginTop: 12 }} onClick={() => delText(o.id)}>🗑 Delete text</button>
                    <div className="np-sub" style={{ marginTop: 8 }}>Drag the text on the video to reposition it.</div>
                  </div>
                );
              })()}
            </>
          )}

          {rail === "tools" && (
            <>
              <div className="ed-left-head"><h3>AI Tools</h3></div>
              <div className="ed-tools-transcribe card">
                <div className="np-label">Language</div>
                <select value={lang} onChange={(e) => setLang(e.target.value)}>
                  {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <div className="np-label" style={{ marginTop: 10 }}>Mode</div>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="transcribe">Transcribe (native)</option>
                  <option value="translit">Romanized (Thanglish)</option>
                  <option value="codemix">Code-mix</option>
                  <option value="translate">Translate → English</option>
                </select>
                <button style={{ marginTop: 12, width: "100%" }} onClick={runTranscribe} disabled={busy || transcribing}>
                  {transcribing ? "Transcribing…" : cues.length ? "Re-transcribe" : "Transcribe"}
                </button>
              </div>
              <SilenceRemover projectId={projectId} durationMs={dur} onSeek={seek} />
              <RetakeRemover projectId={projectId} onSeek={seek} />
              <FillerRemover projectId={projectId} onSeek={seek} />
            </>
          )}

          {rail === "zoom" && (
            <>
              <div className="ed-left-head"><h3>Auto Zoom</h3></div>
              <div className="ed-hint-box">Adds dynamic punch-in zooms to keep the edit lively. Applied when you export MP4.</div>
              <div className="ed-anim-lbl">INTENSITY</div>
              <div className="ed-seg-row">
                {[["Subtle", 1.1], ["Medium", 1.2], ["Strong", 1.35]].map(([lb, v]) => (
                  <div key={lb as string} className={"ed-seg-btn" + (zoomScale === v ? " active" : "")}
                    onClick={() => setZoomScale(v as number)}>{lb}</div>
                ))}
              </div>
              <button style={{ width: "100%", marginTop: 14 }} onClick={generateZoom} disabled={zoomBusy}>
                {zoomBusy ? "Generating…" : "✨ Generate auto zoom"}
              </button>
              <button className="secondary" style={{ width: "100%", marginTop: 8 }} onClick={addZoomHere}>+ Add zoom at playhead</button>
              <div className="ed-cap-count" style={{ marginTop: 16 }}>{zooms.length} zoom{zooms.length === 1 ? "" : "s"}</div>
              {zooms.length > 0 && (
                <>
                  <div className="ed-txt-list">
                    {zooms.map((z) => (
                      <div key={z.id} className="ed-txt-item" onClick={() => seek(z.start_ms)}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>{fmtT(z.start_ms)} – {fmtT(z.end_ms)} · {Math.round((z.scale - 1) * 100)}%</span>
                          <button className="ed-cap-acts" style={{ display: "flex" }} onClick={(e) => { e.stopPropagation(); delZoom(z.id); }}>
                            <span className="del" style={{ padding: "2px 8px" }}>🗑</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="secondary" style={{ width: "100%", marginTop: 12 }} onClick={clearZoom}>Clear all zooms</button>
                </>
              )}
            </>
          )}

          {rail === "export" && (
            <>
              <div className="ed-left-head"><h3>Export</h3></div>
              <div className="card">
                <div className="np-label">Subtitles</div>
                <div className="ed-exp-btns">
                  <button className="secondary" onClick={() => doExport("srt")}>SRT</button>
                  <button className="secondary" onClick={() => doExport("vtt")}>VTT</button>
                  <button className="secondary" onClick={() => doExport("ass")}>ASS</button>
                </div>
                <div className="np-label" style={{ marginTop: 14 }}>Video</div>
                <button style={{ width: "100%" }} onClick={() => doExport("mp4")}>Export MP4 (burned-in)</button>
                <div className="np-label" style={{ marginTop: 14 }}>Editing timeline</div>
                <div className="ed-exp-btns">
                  <button className="secondary" onClick={() => doExport("fcpxml")}>FCPXML</button>
                  <button className="secondary" onClick={() => doExport("edl")}>EDL</button>
                </div>
                <button className="secondary" style={{ width: "100%", marginTop: 8 }} onClick={() => doExport("bundle")}>Multi-track .zip</button>
                {exports.length > 0 && (
                  <div className="ed-exp-results">
                    {exports.map((e) => (
                      e.status === "ready" && e.url ? (
                        <a key={e.fmt} href={api.mediaUrl(e.url)} target="_blank" rel="noreferrer" className="ed-exp-dl">↓ {e.fmt.toUpperCase()}</a>
                      ) : (
                        <span key={e.fmt} className={"ed-exp-stat " + (e.status === "error" ? "err" : "")}>{e.fmt.toUpperCase()} {e.status === "error" ? "failed" : "…"}</span>
                      )
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* center preview */}
        <div className="ed-center">
          <div className="ed-center-top">
            <button className="ed-replace secondary">↻ Replace</button>
          </div>
          <div className="ed-stage">
            <VideoPreview ref={videoRef} src={mediaSrc}
              overlay={<>
                {activeCue && overlayText ? (
                  <CaptionOverlay text={overlayText} styleId={effStyle} cue={activeCue} curMs={curMs} keyId={activeIdx} />
                ) : null}
                {overlays.filter((o) => curMs >= o.start_ms && curMs < o.end_ms).map((o) => (
                  <div key={o.id} className={"ed-ovl" + (selOv === o.id ? " sel" : "")}
                    style={{ left: o.x_pct + "%", top: o.y_pct + "%", color: o.color,
                             fontSize: Math.max(11, o.font_size * 0.24) + "px", fontWeight: o.bold ? 800 : 500 }}
                    onMouseDown={(e) => startDrag(e, o)}
                    onClick={(e) => { e.stopPropagation(); setSelOv(o.id); setRail("texts"); }}>
                    {o.text}
                  </div>
                ))}
              </>} />
          </div>
          <div className="ed-zoombar">
            <span className="muted">{fmtT(curMs)} / {fmtT(dur)}</span>
            <span className="spacer" />
            <span className="muted">100%</span>
          </div>
        </div>

        {/* right panel */}
        <div className="ed-right">
          <div className="ed-rt-tabs">
            <div className="ed-rt-tab">Video</div>
            <div className="ed-rt-tab">Audio</div>
            <div className="ed-rt-tab active">Text</div>
          </div>
          <div className="ed-rt-sub">
            {(["styles", "settings", "animation"] as const).map((t) => (
              <div key={t} className={"ed-rt-subtab" + (rightTab === t ? " active" : "")} onClick={() => setRightTab(t)}>
                {t === "styles" ? "Styles" : t === "settings" ? "Caption settings" : "Animation"}
              </div>
            ))}
          </div>

          {rightTab === "styles" && (
            <div className="ed-rt-body">
              <div className="ed-hint-box">Styles apply to every caption in this video — colours and fonts can still be changed per caption.</div>
              <div className="ed-swatches">
                {SWATCHES.map((s) => (
                  <span key={s.color} className={"ed-swatch" + (capStyle === s.style ? " active" : "")}
                    style={{ background: s.color }} title={s.style} onClick={() => setCapStyle(s.style)} />
                ))}
              </div>
              <div className="ed-style-grid">
                {styles.map((st) => (
                  <div key={st.id} className={"ed-style-card" + (capStyle === st.id ? " active" : "")} onClick={() => setCapStyle(st.id)}>
                    <div className={"ed-style-prev cap cap-" + st.id}>Aa</div>
                    <div className="ed-style-lb">{st.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rightTab === "settings" && (
            <div className="ed-rt-body">
              <label className="ed-setting">
                <span>Show romanized (Thanglish)</span>
                <input type="checkbox" checked={showTranslit} onChange={(e) => setShowTranslit(e.target.checked)} />
              </label>
              <label className="ed-setting">
                <span>Enhance audio on export</span>
                <input type="checkbox" checked={enhanceAudio} onChange={(e) => setEnhanceAudio(e.target.checked)} />
              </label>
              <div className="np-label" style={{ marginTop: 14 }}>Language</div>
              <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: "100%" }}>
                {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button style={{ width: "100%", marginTop: 12 }} onClick={runTranscribe} disabled={busy || transcribing}>
                {transcribing ? "Transcribing…" : "Re-transcribe"}
              </button>
            </div>
          )}

          {rightTab === "animation" && (
            <div className="ed-rt-body">
              <div className="ed-anim-toggle">
                <div>
                  <div className="ed-anim-title">Animations</div>
                  <div className="np-sub">Animate caption entrance as it appears</div>
                </div>
                <label className="ed-switch">
                  <input type="checkbox" checked={animOn} onChange={(e) => setAnimOn(e.target.checked)} />
                  <span className="ed-switch-track" />
                </label>
              </div>

              <div className={"ed-anim-controls" + (animOn ? "" : " disabled")}>
                <div className="ed-anim-lbl">WHAT MOVES</div>
                <div className="ed-seg-row">
                  <div className={"ed-seg-btn" + (!wordMode ? " active" : "")}
                    onClick={() => setCapStyle(WORD_STYLES.includes(capStyle) ? "pop" : capStyle === "classic" ? "pop" : capStyle)}>As one block</div>
                  <div className={"ed-seg-btn" + (wordMode ? " active" : "")}
                    onClick={() => setCapStyle("karaoke")}>Each word</div>
                </div>
                <div className="np-sub" style={{ marginTop: 8 }}>
                  {wordMode ? "Each word pops in on its own, right when it's spoken." : "The whole caption animates in as one block."}
                </div>

                <div className="ed-anim-lbl" style={{ marginTop: 18 }}>ANIMATION STYLE</div>
                <div className="ed-style-grid">
                  {(wordMode ? ["karaoke", "highlight"] : ["classic", "fade", "slide_up", "pop", "bounce", "glow"]).map((id) => {
                    const st = styles.find((s) => s.id === id);
                    return (
                      <div key={id} className={"ed-style-card" + (capStyle === id ? " active" : "")} onClick={() => setCapStyle(id)}>
                        <div className={"ed-style-prev cap cap-" + id}>Aa</div>
                        <div className="ed-style-lb">{st?.label || id}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== bottom timeline ===== */}
      <div className="ed-timeline">
        <div className="ed-tl-controls">
          <button className="ed-tl-play" onClick={togglePlay}>{playing ? "⏸" : "▶"}</button>
          <span className="muted">{fmtT(curMs)} / {fmtT(dur)}</span>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 12 }}>Click a caption to jump · double-click to edit</span>
        </div>
        <div className="ed-tl-scroll">
          <div className="ed-tl-track ed-tl-caps" style={{ minWidth: Math.max(cues.length * 46, 800) }}>
            {cues.map((c) => (
              <div key={c.idx} className={"ed-tl-pill" + (c.idx === activeIdx ? " active" : "")}
                style={{ left: `${(c.start_ms / dur) * 100}%`, width: `${Math.max(((c.end_ms - c.start_ms) / dur) * 100, 1.5)}%` }}
                title={c.text} onClick={() => seek(c.start_ms)}>
                {(showTranslit && c.translit_text ? c.translit_text : c.text).slice(0, 10)}
              </div>
            ))}
          </div>
          <div className="ed-tl-wave">
            <Waveform mediaEl={mediaEl} />
          </div>
        </div>
      </div>
    </div>
  );
}
