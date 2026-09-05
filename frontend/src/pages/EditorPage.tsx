import { useEffect, useRef, useState, useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api/client";
import type { ProjectDetail, Overlay, ImageOverlay, BrollClip, Cue, Project } from "../types";
import { VideoPreview } from "../components/VideoPreview";
import { CaptionOverlay } from "../components/CaptionOverlay";
import { Waveform } from "../components/Waveform";
import { Filmstrip } from "../components/Filmstrip";
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

const WORD_STYLES = ["karaoke", "highlight"];
const CS_FONTS: [string, string][] = [
  ["", "Default (Inter)"], ["Anton", "Anton"], ["Bebas Neue", "Bebas Neue"],
  ["Poppins", "Poppins"], ["Montserrat", "Montserrat"], ["Pacifico", "Pacifico (script)"],
  ["Arial Black", "Arial Black"],
];
const ANIM_PRESETS: [string, string][] = [
  ["", "None"], ["fade", "Fade"], ["slide_up", "Slide Up"], ["slide_down", "Slide Down"],
  ["slide_left", "Slide Left"], ["slide_right", "Slide Right"], ["pop", "Pop"],
  ["bounce", "Bounce"], ["rotate", "Rotate"], ["flip", "Flip"],
];

// Live-preview CSS approximations of the ffmpeg preset grades (editor preview only).
const FILTER_CSS: Record<string, string> = {
  none: "",
  vivid: "saturate(1.4) contrast(1.12)",
  bright: "brightness(1.06) contrast(1.05) saturate(1.05)",
  contrast: "contrast(1.3) saturate(1.08)",
  sharp: "contrast(1.12) saturate(1.12)",
  warm: "sepia(0.2) saturate(1.12)",
  cool: "saturate(1.05) hue-rotate(12deg) brightness(1.02)",
  cinematic: "contrast(1.12) saturate(0.92) sepia(0.12)",
  teal: "contrast(1.08) saturate(1.12) hue-rotate(-8deg)",
  vintage: "sepia(0.45) contrast(0.9) saturate(0.85)",
  bw: "grayscale(1)",
};

interface Adjust { brightness: number; contrast: number; saturation: number; warmth: number; }
interface FilterLayer extends Adjust { id: string; name: string; start_ms: number; end_ms: number; }

function cssForFilter(name: string, a: Adjust): string {
  const parts: string[] = [];
  const preset = FILTER_CSS[name];
  if (preset) parts.push(preset);
  if (a.brightness) parts.push(`brightness(${(1 + a.brightness / 100 * 0.3).toFixed(3)})`);
  if (a.contrast) parts.push(`contrast(${(1 + a.contrast / 100 * 0.5).toFixed(3)})`);
  if (a.saturation) parts.push(`saturate(${(1 + a.saturation / 100).toFixed(3)})`);
  if (a.warmth > 0) parts.push(`sepia(${(a.warmth / 100 * 0.3).toFixed(3)})`);
  else if (a.warmth < 0) parts.push(`hue-rotate(${(a.warmth / 100 * 18).toFixed(1)}deg)`);
  return parts.join(" ");
}

const ADJUSTS: [keyof Adjust, string][] = [
  ["brightness", "Brightness"], ["contrast", "Contrast"],
  ["saturation", "Saturation"], ["warmth", "Warmth"],
];

// Rail order mirrors HyproAI: Uploads, Texts, Videos, Filters, Captions, Auto Zoom, Images
// (maxfly uploads via the New Project modal, so there is no separate Uploads panel;
//  "Videos" maps to B-roll clips. AI Tools / Canvas / Export are maxfly extras.)
const RAILS = [
  { id: "uploads", icon: "⤒", label: "Uploads" },
  { id: "texts", icon: "T", label: "Texts" },
  { id: "broll", icon: "🎞", label: "Videos" },
  { id: "filters", icon: "◑", label: "Filters" },
  { id: "captions", icon: "▤", label: "Captions" },
  { id: "zoom", icon: "⊕", label: "Auto Zoom" },
  { id: "images", icon: "🖼", label: "Images" },
  { id: "tools", icon: "✨", label: "AI Tools" },
  { id: "retake", icon: "↺", label: "Retake" },
  { id: "canvas", icon: "▭", label: "Canvas" },
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
  const [capSettings, setCapSettings] = useState<Record<string, any>>({});
  const [stylesTab, setStylesTab] = useState<"lines" | "words" | "saved">("lines");
  const [savedStyles, setSavedStyles] = useState<{ id: string; name: string; style: string; settings: any }[]>([]);
  const [infoDismissed, setInfoDismissed] = useState(false);
  const [canvas, setCanvas] = useState<Record<string, any>>({});
  const canvasImgRef = useRef<HTMLInputElement>(null);
  const [styleSearch, setStyleSearch] = useState("");
  const [styleSearchOpen, setStyleSearchOpen] = useState(false);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selOv, setSelOv] = useState<string | null>(null);
  const [zooms, setZooms] = useState<{ id: string; start_ms: number; end_ms: number; scale: number }[]>([]);
  const [zoomScale, setZoomScale] = useState(1.2);
  const [zoomBusy, setZoomBusy] = useState(false);
  const [filterList, setFilterList] = useState<{ id: string; label: string; group: string }[]>([]);
  const [filterGroups, setFilterGroups] = useState<{ name: string; sub: string }[]>([]);
  const [curFilter, setCurFilter] = useState("none");
  const [adjust, setAdjust] = useState<Adjust>({ brightness: 0, contrast: 0, saturation: 0, warmth: 0 });
  const [filterLayers, setFilterLayers] = useState<FilterLayer[]>([]);
  const [selLayer, setSelLayer] = useState<string | null>(null);
  const [images, setImages] = useState<ImageOverlay[]>([]);
  const [selImg, setSelImg] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const upInputRef = useRef<HTMLInputElement>(null);
  const [myMedia, setMyMedia] = useState<Project[]>([]);
  const [upTab, setUpTab] = useState<"import" | "export">("import");
  const [upBusy, setUpBusy] = useState(false);
  const imagesRef = useRef<ImageOverlay[]>([]);
  imagesRef.current = images;
  const [stockQ, setStockQ] = useState("");
  const [stockRes, setStockRes] = useState<{ id: string; thumb: string; url: string; alt: string }[]>([]);
  const [stockBusy, setStockBusy] = useState(false);
  const [brolls, setBrolls] = useState<BrollClip[]>([]);
  const [selBroll, setSelBroll] = useState<string | null>(null);
  const [brollBusy, setBrollBusy] = useState(false);
  const brollInputRef = useRef<HTMLInputElement>(null);
  const brollsRef = useRef<BrollClip[]>([]);
  brollsRef.current = brolls;
  const [bvQ, setBvQ] = useState("");
  const [bvRes, setBvRes] = useState<{ id: string; thumb: string; url: string; alt: string; duration?: number }[]>([]);
  const [bvBusy, setBvBusy] = useState(false);
  const [bvAdding, setBvAdding] = useState(false);
  const overlaysRef = useRef<Overlay[]>([]);
  overlaysRef.current = overlays;
  const [enhanceAudio, setEnhanceAudio] = useState(false);
  const [styles, setStyles] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [curMs, setCurMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exports, setExports] = useState<{ fmt: string; url?: string; status: string; error?: string }[]>([]);
  const [rail, setRail] = useState<"uploads" | "captions" | "texts" | "images" | "broll" | "tools" | "retake" | "zoom" | "filters" | "canvas" | "export">("captions");
  const [rightTab, setRightTab] = useState<"styles" | "font" | "animation" | "outline" | "shadow">("styles");
  const [topTab, setTopTab] = useState<"video" | "audio" | "text">("text");
  const [playRate, setPlayRate] = useState(1);
  const [audioVol, setAudioVol] = useState(1);
  const [density, setDensity] = useState<"compact" | "roomy">("roomy");
  type CueSnap = { start_ms: number; end_ms: number; text: string; translit_text: string | null; line_count: number };
  const [undoStack, setUndoStack] = useState<CueSnap[][]>([]);
  const [redoStack, setRedoStack] = useState<CueSnap[][]>([]);
  const [tlZoom, setTlZoom] = useState(1);
  const [aiMenu, setAiMenu] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const cuesRef = useRef<Cue[]>([]);
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
  useEffect(() => { api.filterPresets().then((r) => { setFilterList(r.filters); setFilterGroups(r.groups || []); }).catch(() => {}); }, []);
  useEffect(() => {
    api.getFilter(projectId).then((r) => { setCurFilter(r.name); setAdjust({ brightness: r.brightness, contrast: r.contrast, saturation: r.saturation, warmth: r.warmth }); }).catch(() => {});
    api.listFilterLayers(projectId).then((r) => setFilterLayers(r.layers)).catch(() => {});
    api.listImages(projectId).then(setImages).catch(() => {});
    api.listProjects().then(setMyMedia).catch(() => {});
    api.listBrolls(projectId).then(setBrolls).catch(() => {});
    api.getCaptionSettings(projectId).then((r) => setCapSettings(r || {})).catch(() => {});
    api.listSavedStyles(projectId).then(setSavedStyles).catch(() => {});
    api.getCanvas(projectId).then((r) => setCanvas(r || {})).catch(() => {});
  }, [projectId]);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (e.key === " ") {
        e.preventDefault(); togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!proj) return <div className="ed-loading muted">Loading editor…</div>;

  const dur = proj.duration_ms || 1;
  const cues = proj.cues || [];
  const activeIdx = cues.find((c) => curMs >= c.start_ms && curMs < c.end_ms)?.idx ?? -1;
  const activeCue = cues.find((c) => c.idx === activeIdx);
  cuesRef.current = cues;
  const lineStyles = styles.filter((x) => !WORD_STYLES.includes(x.id));
  const wordStyles = styles.filter((x) => WORD_STYLES.includes(x.id));
  const overlayText = activeCue ? (showTranslit && activeCue.translit_text ? activeCue.translit_text : activeCue.text) : "";
  const effStyle = animOn ? capStyle : "classic";
  const activeLayer = filterLayers.find((l) => curMs >= l.start_ms && curMs < l.end_ms);
  const filterPreviewCss = selLayer
    ? cssForFilter(curFilter, adjust)
    : activeLayer ? cssForFilter(activeLayer.name, activeLayer) : cssForFilter(curFilter, adjust);
  const wordMode = WORD_STYLES.includes(capStyle);
  const mediaSrc = proj.media_url ? (proj.media_url.startsWith("http") ? proj.media_url : api.mediaUrl(proj.media_url)) : "";

  const TLW = Math.max(900, Math.round((dur / 1000) * 44)) * tlZoom;
  const tlStep = dur <= 20000 ? 2000 : dur <= 60000 ? 5000 : dur <= 180000 ? 15000 : 30000;
  const tlTicks: number[] = [];
  for (let t = 0; t <= dur; t += tlStep) tlTicks.push(t);
  function scrub(e: ReactMouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pct * dur);
  }
  function seek(ms: number) { if (videoRef.current) videoRef.current.currentTime = ms / 1000; }
  function togglePlay() { const v = videoRef.current; if (!v) return; if (v.paused) v.play(); else v.pause(); }

  async function runTranscribe() {
    setBusy(true);
    try { await api.transcribe(projectId, lang, mode); await load(); }
    catch (e: any) { alert("Transcription failed: " + e.message); }
    finally { setBusy(false); }
  }
  function cloneCues(list: Cue[]) {
    return list.map((c) => ({ start_ms: c.start_ms, end_ms: c.end_ms, text: c.text,
      translit_text: c.translit_text ?? null, line_count: c.line_count ?? 1 }));
  }
  function pushHistory() {
    setUndoStack((prev) => [...prev.slice(-40), cloneCues(cuesRef.current)]);
    setRedoStack([]);
  }
  async function undo() {
    if (undoStack.length === 0) return;
    const snap = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, cloneCues(cuesRef.current)]);
    setUndoStack((s2) => s2.slice(0, -1));
    try { await api.replaceCues(projectId, snap); } catch {}
    load();
  }
  async function redo() {
    if (redoStack.length === 0) return;
    const snap = redoStack[redoStack.length - 1];
    setUndoStack((s2) => [...s2, cloneCues(cuesRef.current)]);
    setRedoStack((r) => r.slice(0, -1));
    try { await api.replaceCues(projectId, snap); } catch {}
    load();
  }
  function targetCueIdx(): number {
    if (activeIdx >= 0) return activeIdx;
    if (selected.size) return [...selected][0];
    return cues[0]?.idx ?? -1;
  }
  async function duplicateCap(idx: number) {
    const c = cues.find((x) => x.idx === idx);
    if (!c) return;
    pushHistory();
    const durc = Math.max(c.end_ms - c.start_ms, 500);
    await api.addCue(projectId, c.end_ms, c.end_ms + durc, c.text);
    load();
  }
  function prevCap() {
    const prev = [...cues].reverse().find((c) => c.start_ms < curMs - 60);
    if (prev) seek(prev.start_ms);
  }
  function nextCap() {
    const nx = cues.find((c) => c.start_ms > curMs + 60);
    if (nx) seek(nx.start_ms);
  }
  function toggleFullscreen() {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }

  async function saveCue(idx: number) {
    pushHistory();
    await api.editCue(projectId, idx, draft);
    setEditingIdx(null);
    load();
  }
  function toggleSel(idx: number) {
    setSelected((s) => { const n = new Set(s); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  }
  async function addCaption() {
    pushHistory();
    const at = Math.round(curMs);
    await api.addCue(projectId, at, at + 2000, "New caption");
    load();
  }
  async function splitAt(idx: number) {    pushHistory();
 await api.splitCue(projectId, idx, Math.round(curMs)); setSelected(new Set()); load(); }
  async function mergeNext(idx: number) {    pushHistory();
 await api.mergeCue(projectId, idx); setSelected(new Set()); load(); }
  async function deleteOne(idx: number) {    pushHistory();
 await api.deleteCue(projectId, idx); setSelected(new Set()); load(); }
  async function bulkDelete() {
    if (selected.size === 0) return;
    pushHistory();
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
  function upsertExport(fmt: string, patch: { url?: string; status: string; error?: string }) {
    setExports((prev) => [{ fmt, ...patch }, ...prev.filter((e) => e.fmt !== fmt)]);
  }
  async function doExport(fmt: string) {
    const style = animOn ? capStyle : "classic";
    upsertExport(fmt, { status: "processing" });
    try {
      const r = await api.exportSub(projectId, fmt, showTranslit, true, style, enhanceAudio, audioVol, playRate);
      const eid = r.export_id;
      for (let i = 0; i < 120; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        const list = await api.listExports(projectId);
        const row = list.find((x) => x.id === eid);
        if (row && row.status !== "processing") { upsertExport(fmt, { url: row.url || undefined, status: row.status, error: row.error || undefined }); return; }
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

  const gradeLabel = (name: string) => filterList.find((f) => f.id === name)?.label || name;

  async function applyFilter(name: string) {
    setCurFilter(name);
    if (selLayer) { await patchLayer(selLayer, { name }); return; }
    try { await api.setFilter(projectId, name, adjust); } catch {}
  }
  function changeAdjust(key: keyof Adjust, val: number) {
    setAdjust((prev) => ({ ...prev, [key]: val }));   // live CSS preview
  }
  function saveAdjust(next?: Adjust) {
    const a = next || adjust;
    if (selLayer) { patchLayer(selLayer, a); return; }
    api.setFilter(projectId, curFilter, a).catch(() => {});
  }
  function resetAdjust() {
    const zero: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
    setAdjust(zero);
    if (selLayer) { patchLayer(selLayer, zero); return; }
    api.setFilter(projectId, curFilter, zero).catch(() => {});
  }

  // ---- filter layers (grade only part of the timeline) ----
  async function patchLayer(id: string, patch: any) {
    setFilterLayers((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));
    try { await api.patchFilterLayer(projectId, id, patch); } catch {}
  }
  async function addLayer() {
    const start = Math.round(curMs);
    const end = Math.min(dur, start + 3000);
    const name = curFilter !== "none" ? curFilter : "vivid";
    try {
      const l = await api.addFilterLayer(projectId, { name, ...adjust, start_ms: start, end_ms: end });
      setFilterLayers((prev) => [...prev, l]);
      selectLayer(l.id, l);
    } catch {}
  }
  function selectLayer(id: string, layer?: FilterLayer) {
    const l = layer || filterLayers.find((x) => x.id === id);
    if (!l) return;
    setSelLayer(id);
    setCurFilter(l.name);
    setAdjust({ brightness: l.brightness, contrast: l.contrast, saturation: l.saturation, warmth: l.warmth });
  }
  function deselectLayer() {
    setSelLayer(null);
    api.getFilter(projectId).then((r) => { setCurFilter(r.name); setAdjust({ brightness: r.brightness, contrast: r.contrast, saturation: r.saturation, warmth: r.warmth }); }).catch(() => {});
  }
  function setLayerEdge(id: string, which: "start" | "end") {
    const t = Math.round(curMs);
    patchLayer(id, which === "start" ? { start_ms: t } : { end_ms: t });
  }
  async function deleteLayer(id: string) {
    try { await api.deleteFilterLayer(projectId, id); } catch {}
    setFilterLayers((prev) => prev.filter((l) => l.id !== id));
    if (selLayer === id) deselectLayer();
  }
  async function uploadNewVideo(file: File) {
    setUpBusy(true);
    try {
      const np = await api.upload(file);
      try { await api.transcribe(np.id, "ta-IN", "translit"); } catch {}
      window.location.hash = `#/project/${np.id}`;
    } catch (e: any) { alert("Upload failed: " + (e?.message || "")); }
    finally { setUpBusy(false); }
  }

  function pickImage() { imgInputRef.current?.click(); }
  async function uploadImage(file: File) {
    setImgBusy(true);
    const at = Math.round(curMs);
    try {
      const im = await api.addImage(projectId, file, at, at + 3000);
      setImages((prev) => [...prev, im]);
      setSelImg(im.id);
    } catch (e: any) { alert("Image upload failed: " + e.message); }
    finally { setImgBusy(false); }
  }
  function patchImgLocal(id: string, patch: Partial<ImageOverlay>) {
    setImages((prev) => prev.map((im) => (im.id === id ? { ...im, ...patch } : im)));
  }
  async function saveImg(id: string, patch: Partial<ImageOverlay>) {
    patchImgLocal(id, patch);
    try { await api.updateImage(projectId, id, patch); } catch {}
  }
  async function delImg(id: string) {
    setImages((prev) => prev.filter((im) => im.id !== id));
    if (selImg === id) setSelImg(null);
    try { await api.deleteImage(projectId, id); } catch {}
  }
  function startDragImg(e: ReactMouseEvent, im: ImageOverlay) {
    e.preventDefault(); e.stopPropagation();
    setSelImg(im.id);
    const parent = (e.currentTarget as HTMLElement).offsetParent as HTMLElement | null;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      patchImgLocal(im.id, { x_pct: x, y_pct: y });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const cur = imagesRef.current.find((v) => v.id === im.id);
      if (cur) api.updateImage(projectId, im.id, { x_pct: cur.x_pct, y_pct: cur.y_pct }).catch(() => {});
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function applySaved(sv: { style: string; settings: any }) {
    setCapStyle(sv.style);
    setCapSettings(sv.settings || {});
    api.setCaptionSettings(projectId, sv.settings || {}).catch(() => {});
  }
  async function saveCurrentStyle() {
    const nm = window.prompt("Name this style", styles.find((x) => x.id === capStyle)?.label || "My style");
    if (!nm || !nm.trim()) return;
    try {
      const sv = await api.addSavedStyle(projectId, nm.trim(), capStyle, capSettings);
      setSavedStyles((prev) => [...prev, sv]);
      setStylesTab("saved");
    } catch {}
  }
  async function delSaved(id: string) {
    setSavedStyles((prev) => prev.filter((x) => x.id !== id));
    try { await api.deleteEdit(projectId, id); } catch {}
  }
  function saveCanvas(patch: Record<string, any>) {
    setCanvas((prev) => ({ ...prev, ...patch }));
    api.setCanvas(projectId, patch).catch(() => {});
  }
  async function uploadCanvasImage(file: File) {
    try {
      const r = await api.uploadCanvasImage(projectId, file);
      setCanvas((prev) => ({ ...prev, image_url: r.image_url, bg_type: "image" }));
    } catch (e: any) { alert("Upload failed: " + (e?.message || "")); }
  }
  function saveCapSetting(patch: Record<string, any>) {
    setCapSettings((prev) => ({ ...prev, ...patch }));
    api.setCaptionSettings(projectId, patch).catch(() => {});
  }
  function resetCapSettings() {
    setCapSettings({});
    api.setCaptionSettings(projectId, { font: "", bold: null, spacing: 0, glow: false,
      anim_enabled: true, anim: "", speed: 1, scope: "caption" }).catch(() => {});
  }
  async function runStock() {
    if (!stockQ.trim()) return;
    setStockBusy(true);
    try { const r = await api.stockSearch(stockQ); setStockRes(r.results); }
    catch { setStockRes([]); }
    finally { setStockBusy(false); }
  }
  async function addStock(url: string) {
    const at = Math.round(curMs);
    try {
      const im = await api.addImageFromUrl(projectId, url, at, at + 3000);
      setImages((prev) => [...prev, im]);
      setSelImg(im.id);
    } catch (e: any) { alert("Could not add image: " + (e?.message || "")); }
  }
  async function runBrollStock() {
    if (!bvQ.trim()) return;
    setBvBusy(true);
    try { const r = await api.stockVideos(bvQ); setBvRes(r.results); }
    catch { setBvRes([]); }
    finally { setBvBusy(false); }
  }
  async function addBrollStock(url: string, duration?: number) {
    const at = Math.round(curMs);
    const len = duration ? Math.min(duration * 1000, 8000) : 4000;
    setBvAdding(true);
    try {
      const b = await api.addBrollFromUrl(projectId, url, at, at + len);
      setBrolls((prev) => [...prev, b]);
      setSelBroll(b.id);
    } catch (e: any) { alert("Could not add B-roll: " + (e?.message || "")); }
    finally { setBvAdding(false); }
  }
  function pickBroll() { brollInputRef.current?.click(); }
  async function uploadBroll(file: File) {
    setBrollBusy(true);
    const at = Math.round(curMs);
    try {
      const b = await api.addBroll(projectId, file, at, at + 4000);
      setBrolls((prev) => [...prev, b]);
      setSelBroll(b.id);
    } catch (e: any) { alert("B-roll upload failed: " + e.message); }
    finally { setBrollBusy(false); }
  }
  function patchBrollLocal(id: string, patch: Partial<BrollClip>) {
    setBrolls((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  async function saveBroll(id: string, patch: Partial<BrollClip>) {
    patchBrollLocal(id, patch);
    try { await api.updateBroll(projectId, id, patch); } catch {}
  }
  async function delBroll(id: string) {
    setBrolls((prev) => prev.filter((b) => b.id !== id));
    if (selBroll === id) setSelBroll(null);
    try { await api.deleteBroll(projectId, id); } catch {}
  }
  function startDragBroll(e: ReactMouseEvent, b: BrollClip) {
    e.preventDefault(); e.stopPropagation();
    setSelBroll(b.id);
    const parent = (e.currentTarget as HTMLElement).offsetParent as HTMLElement | null;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      patchBrollLocal(b.id, { x_pct: x, y_pct: y });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const cur = brollsRef.current.find((v) => v.id === b.id);
      if (cur) api.updateBroll(projectId, b.id, { x_pct: cur.x_pct, y_pct: cur.y_pct }).catch(() => {});
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  const transcribing = proj.status === "transcribing";

  return (
    <div className="ed">
      {/* ===== top bar ===== */}
      <div className="ed-top">
        <div className="ed-top-l">
          <a href="#/app" className="ed-back" title="Back">←</a>
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
          {rail === "uploads" && (
            <>
              <div className="ed-left-head"><h3>Media Library</h3></div>
              <div className="ml-tabs2">
                <div className={"ml-tab2" + (upTab === "import" ? " active" : "")} onClick={() => setUpTab("import")}>⤒ Import</div>
                <div className={"ml-tab2" + (upTab === "export" ? " active" : "")} onClick={() => setUpTab("export")}>⤓ Export</div>
              </div>
              <input ref={upInputRef} type="file" accept="video/*,audio/*" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadNewVideo(f); e.currentTarget.value = ""; }} />
              {upTab === "import" ? (
                <>
                  <button className="ml-import" onClick={() => upInputRef.current?.click()} disabled={upBusy}>
                    {upBusy ? "Uploading…" : "⤒ Import"}
                  </button>
                  {myMedia.length === 0 ? (
                    <div className="ml-empty2">
                      <div className="ml-empty2-ic">🗎</div>
                      <p>No media yet. Click Import to add videos, images, or audio.</p>
                    </div>
                  ) : (
                    <div className="ed-up-list">
                      {myMedia.map((m) => (
                        <div key={m.id} className={"ed-up-item" + (m.id === projectId ? " active" : "")}
                          onClick={() => { if (m.id !== projectId) window.location.hash = `#/project/${m.id}`; }}>
                          <div className="ed-up-thumb">▶</div>
                          <div className="ed-up-meta">
                            <div className="ed-up-name">{m.name}</div>
                            <div className="np-sub">{m.id === projectId ? "Current project" : (m.sub_count ? `${m.sub_count} subs` : "Open")}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <button className="ml-import" onClick={() => setRail("export")}>⤓ Export this project</button>
                  <div className="ml-empty2">
                    <div className="ml-empty2-ic">🗎</div>
                    <p>Export your captioned MP4, or download SRT / VTT / ASS subtitles.</p>
                  </div>
                </>
              )}
            </>
          )}

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

          {rail === "images" && (
            <>
              <div className="ed-left-head"><h3>Images / B-roll</h3></div>
              <div className="ed-hint-box">Overlay a logo, sticker, or stock photo on the video. Drag it on the preview to position; it burns into the exported MP4.</div>
              <div className="ed-stock">
                <input className="ed-stock-input" placeholder="Search stock photos…" value={stockQ}
                  onChange={(e) => setStockQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runStock(); }} />
                <button className="ed-stock-go" onClick={runStock} disabled={stockBusy}>{stockBusy ? "…" : "🔍"}</button>
              </div>
              {stockRes.length > 0 && (
                <div className="ed-stock-grid">
                  {stockRes.map((r) => (
                    <img key={r.id} src={r.thumb} title={r.alt} className="ed-stock-thumb"
                      loading="lazy" onClick={() => addStock(r.url)} />
                  ))}
                </div>
              )}
              <input ref={imgInputRef} type="file" accept="image/*" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.currentTarget.value = ""; }} />
              <button style={{ width: "100%" }} onClick={pickImage} disabled={imgBusy}>
                {imgBusy ? "Uploading…" : "＋ Upload image"}
              </button>
              {images.length === 0 ? (
                <div className="ed-cap-empty" style={{ paddingTop: 18 }}>No images yet.</div>
              ) : (
                <div className="ed-txt-list">
                  {images.map((im) => (
                    <div key={im.id} className={"ed-txt-item" + (selImg === im.id ? " active" : "")}
                      onClick={() => { setSelImg(im.id); seek(im.start_ms); }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <img src={im.image_url} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
                        <div className="np-sub">{fmtT(im.start_ms)} – {fmtT(im.end_ms)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {selImg && (() => {
                const im = images.find((v) => v.id === selImg);
                if (!im) return null;
                return (
                  <div className="card ed-txt-editor">
                    <div className="np-label">Size · {Math.round(im.size_pct)}%</div>
                    <input type="range" min={8} max={100} value={im.size_pct} style={{ width: "100%" }}
                      onChange={(e) => patchImgLocal(im.id, { size_pct: +e.target.value })}
                      onMouseUp={(e) => saveImg(im.id, { size_pct: +(e.target as HTMLInputElement).value })} />
                    <div className="ed-txt-time">
                      <button className="secondary" onClick={() => saveImg(im.id, { start_ms: Math.round(curMs) })}>Start ⟵ playhead</button>
                      <button className="secondary" onClick={() => saveImg(im.id, { end_ms: Math.round(curMs) })}>End ⟵ playhead</button>
                    </div>
                    <button className="ed-bulk-del" style={{ width: "100%", marginTop: 12 }} onClick={() => delImg(im.id)}>🗑 Delete image</button>
                    <div className="np-sub" style={{ marginTop: 8 }}>Drag the image on the video to reposition it.</div>
                  </div>
                );
              })()}
            </>
          )}

          {rail === "broll" && (
            <>
              <div className="ed-left-head"><h3>B-roll clips</h3></div>
              <div className="ed-hint-box">Overlay a second video clip (cutaway or picture-in-picture). It plays over your main video; the main audio is kept. Drag to reposition; burns into the exported MP4.</div>
              <div className="ed-stock">
                <input className="ed-stock-input" placeholder="Search stock videos…" value={bvQ}
                  onChange={(e) => setBvQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runBrollStock(); }} />
                <button className="ed-stock-go" onClick={runBrollStock} disabled={bvBusy}>{bvBusy ? "…" : "🔍"}</button>
              </div>
              {bvAdding && <div className="np-sub" style={{ marginBottom: 10 }}>Downloading clip…</div>}
              {bvRes.length > 0 && (
                <div className="ed-stock-grid ed-stock-grid-2">
                  {bvRes.map((r) => (
                    <div key={r.id} className="ed-vid-thumb" onClick={() => addBrollStock(r.url, r.duration)}>
                      <img src={r.thumb} loading="lazy" />
                      <span className="ed-vid-play">▶</span>
                      {r.duration ? <span className="ed-vid-dur">{r.duration}s</span> : null}
                    </div>
                  ))}
                </div>
              )}
              <input ref={brollInputRef} type="file" accept="video/*" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBroll(f); e.currentTarget.value = ""; }} />
              <button style={{ width: "100%" }} onClick={pickBroll} disabled={brollBusy}>
                {brollBusy ? "Uploading…" : "＋ Upload B-roll clip"}
              </button>
              {brolls.length === 0 ? (
                <div className="ed-cap-empty" style={{ paddingTop: 18 }}>No B-roll yet.</div>
              ) : (
                <div className="ed-txt-list">
                  {brolls.map((b) => (
                    <div key={b.id} className={"ed-txt-item" + (selBroll === b.id ? " active" : "")}
                      onClick={() => { setSelBroll(b.id); seek(b.start_ms); }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div className="ed-broll-badge">🎞</div>
                        <div className="np-sub">{fmtT(b.start_ms)} – {fmtT(b.end_ms)} · {Math.round(b.size_pct)}%</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {selBroll && (() => {
                const b = brolls.find((v) => v.id === selBroll);
                if (!b) return null;
                return (
                  <div className="card ed-txt-editor">
                    <div className="np-label">Size · {Math.round(b.size_pct)}% {b.size_pct >= 98 ? "(full cover)" : "(picture-in-picture)"}</div>
                    <input type="range" min={20} max={100} value={b.size_pct} style={{ width: "100%" }}
                      onChange={(e) => patchBrollLocal(b.id, { size_pct: +e.target.value })}
                      onMouseUp={(e) => saveBroll(b.id, { size_pct: +(e.target as HTMLInputElement).value })} />
                    <div className="ed-txt-time">
                      <button className="secondary" onClick={() => saveBroll(b.id, { start_ms: Math.round(curMs) })}>Start ⟵ playhead</button>
                      <button className="secondary" onClick={() => saveBroll(b.id, { end_ms: Math.round(curMs) })}>End ⟵ playhead</button>
                    </div>
                    <button className="ed-bulk-del" style={{ width: "100%", marginTop: 12 }} onClick={() => delBroll(b.id)}>🗑 Delete B-roll</button>
                    <div className="np-sub" style={{ marginTop: 8 }}>Drag the clip on the video to reposition it. It starts from its beginning at the window start.</div>
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
              <FillerRemover projectId={projectId} onSeek={seek} />
            </>
          )}

          {rail === "retake" && (
            <>
              <div className="ed-left-head"><h3>Retake Remover</h3></div>
              <RetakeRemover projectId={projectId} onSeek={seek} />
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

          {rail === "filters" && (
            <>
              <div className="ed-left-head"><h3>Filters</h3></div>
              <p className="np-sub" style={{ margin: "0 0 12px" }}>
                Tap a grade to preview it on your video. Fine-tune with Adjust below — everything bakes into the MP4 export.
              </p>

              <div className="ed-filt-card" onClick={() => applyFilter("none")}
                   style={curFilter === "none" ? { borderColor: "var(--accent)" } : undefined}>
                <div className="ed-filt-prev ed-filt-none" />
                <div className="ed-style-lb">Original</div>
              </div>

              {filterGroups.map((g) => (
                <div key={g.name} className="ed-filt-group">
                  <div className="ed-filt-ghead">{g.name}<span>{g.sub}</span></div>
                  <div className="ed-style-grid">
                    {filterList.filter((f) => f.group === g.name).map((f) => (
                      <div key={f.id} className={"ed-style-card" + (curFilter === f.id ? " active" : "")} onClick={() => applyFilter(f.id)}>
                        <div className={"ed-filt-prev ed-filt-" + f.id} />
                        <div className="ed-style-lb">{f.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="ed-filt-adjust">
                <div className="ed-filt-ghead">Adjust
                  <button className="ed-filt-reset" onClick={resetAdjust}>Reset all</button>
                </div>
                {ADJUSTS.map(([key, label]) => (
                  <div className="ed-cs-slider" key={key}>
                    <div className="ed-cs-slabel"><span>{label}</span><span>{adjust[key] > 0 ? "+" : ""}{adjust[key]}</span></div>
                    <input type="range" min={-100} max={100} step={1} value={adjust[key]}
                      onChange={(e) => changeAdjust(key, +e.target.value)}
                      onMouseUp={(e) => saveAdjust({ ...adjust, [key]: +(e.target as HTMLInputElement).value })}
                      onTouchEnd={(e) => saveAdjust({ ...adjust, [key]: +(e.target as HTMLInputElement).value })} />
                  </div>
                ))}
              </div>

              <div className="ed-filt-layers">
                <div className="ed-filt-ghead">Filter layers
                  {!selLayer && <button className="ed-filt-reset" onClick={addLayer}>+ Apply as layer</button>}
                </div>
                {selLayer ? (
                  <div className="ed-layer-edit">
                    <div className="np-sub">Editing this layer — move the playhead, then set its edges.</div>
                    <div className="ed-layer-edges">
                      <button className="secondary" onClick={() => setLayerEdge(selLayer, "start")}>⇤ Start = playhead</button>
                      <button className="secondary" onClick={() => setLayerEdge(selLayer, "end")}>End = playhead ⇥</button>
                    </div>
                    <button className="secondary" style={{ width: "100%", marginTop: 8 }} onClick={deselectLayer}>Done editing</button>
                  </div>
                ) : (
                  <div className="np-sub">Grade only part of the video: pick a look above, then <b>Apply as layer</b>. It drops a clip on the timeline from the playhead.</div>
                )}
                {filterLayers.map((l) => (
                  <div key={l.id} className={"ed-layer-row" + (selLayer === l.id ? " sel" : "")} onClick={() => selectLayer(l.id)}>
                    <span className="ed-layer-swatch"><span className={"ed-filt-prev ed-filt-" + l.name} /></span>
                    <span className="ed-layer-name">{gradeLabel(l.name)}</span>
                    <span className="ed-layer-range">{fmtT(l.start_ms)}–{fmtT(l.end_ms)}</span>
                    <button className="ed-layer-del" title="Delete layer" onClick={(e) => { e.stopPropagation(); deleteLayer(l.id); }}>×</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {rail === "canvas" && (
            <>
              <div className="ed-left-head"><h3>Canvas</h3></div>
              <div className="ed-hint-box">Set the output shape and a background behind your video. Applied on MP4 export.</div>
              <div className="ed-anim-lbl">ASPECT RATIO</div>
              <div className="ed-canvas-aspects">
                {([["original", "Original"], ["9:16", "9:16"], ["4:5", "4:5"], ["1:1", "1:1"], ["16:9", "16:9"]] as [string, string][]).map(([v, l]) => (
                  <div key={v} className={"ed-canvas-ar" + ((canvas.aspect || "original") === v ? " active" : "")} onClick={() => saveCanvas({ aspect: v })}>
                    <div className={"ed-ar-box ar-" + v.replace(":", "-")} />
                    <span>{l}</span>
                  </div>
                ))}
              </div>
              {canvas.aspect && canvas.aspect !== "original" && (
                <>
                  <div className="ed-anim-lbl" style={{ marginTop: 16 }}>BACKGROUND</div>
                  <div className="ed-seg-row">
                    {([["color", "Color"], ["blur", "Blur"], ["image", "Image"]] as [string, string][]).map(([v, l]) => (
                      <div key={v} className={"ed-seg-btn" + ((canvas.bg_type || "color") === v ? " active" : "")} onClick={() => saveCanvas({ bg_type: v })}>{l}</div>
                    ))}
                  </div>
                  {(canvas.bg_type || "color") === "color" && (
                    <div className="ed-swatches" style={{ marginTop: 12 }}>
                      {["#000000", "#ffffff", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"].map((c) => (
                        <span key={c} className={"ed-swatch" + ((canvas.color || "#000000").toLowerCase() === c ? " active" : "")}
                          style={{ background: c }} onClick={() => saveCanvas({ color: c })} />
                      ))}
                    </div>
                  )}
                  {canvas.bg_type === "image" && (
                    <>
                      <input ref={canvasImgRef} type="file" accept="image/*" hidden
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCanvasImage(f); e.currentTarget.value = ""; }} />
                      <button className="secondary" style={{ width: "100%", marginTop: 12 }} onClick={() => canvasImgRef.current?.click()}>＋ Upload background image</button>
                      {canvas.image_url && <img src={canvas.image_url} style={{ width: "100%", borderRadius: 8, marginTop: 10, maxHeight: 120, objectFit: "cover" }} />}
                    </>
                  )}
                  {canvas.bg_type === "blur" && <div className="np-sub" style={{ marginTop: 10 }}>A blurred, zoomed copy of your video fills the background.</div>}
                  <button className="secondary" style={{ width: "100%", marginTop: 14 }} onClick={() => saveCanvas({ aspect: "original" })}>Reset to original</button>
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
                <div className="np-label" style={{ marginTop: 16 }}>Export to your editor (NLE)</div>
                <div className="ed-nle">
                  <div className="ed-nle-row">
                    <div className="ed-nle-info">
                      <div className="ed-nle-t">DaVinci Resolve / Final Cut</div>
                      <div className="ed-nle-s">Video + captions as editable text, cuts applied</div>
                    </div>
                    <button className="secondary" onClick={() => doExport("fcpxml")}>FCPXML</button>
                  </div>
                  <div className="ed-nle-row">
                    <div className="ed-nle-info">
                      <div className="ed-nle-t">Premiere Pro</div>
                      <div className="ed-nle-s">Import SRT as an editable caption track</div>
                    </div>
                    <button className="secondary" onClick={() => doExport("srt")}>SRT</button>
                  </div>
                  <div className="ed-nle-row">
                    <div className="ed-nle-info">
                      <div className="ed-nle-t">Cut list — any editor</div>
                      <div className="ed-nle-s">CMX3600 EDL of the silence / retake cuts</div>
                    </div>
                    <button className="secondary" onClick={() => doExport("edl")}>EDL</button>
                  </div>
                  <div className="ed-nle-row">
                    <div className="ed-nle-info">
                      <div className="ed-nle-t">Full project (.zip)</div>
                      <div className="ed-nle-s">Video, voice + music stems, captions & timeline</div>
                    </div>
                    <button className="secondary" onClick={() => doExport("bundle")}>ZIP</button>
                  </div>
                </div>
                {exports.length > 0 && (
                  <div className="ed-exp-results">
                    {exports.map((e) => (
                      e.status === "ready" && e.url ? (
                        <a key={e.fmt} href={api.mediaUrl(e.url)} target="_blank" rel="noreferrer" download className="ed-exp-dl">↓ {e.fmt.toUpperCase()}</a>
                      ) : (
                        <span key={e.fmt} className={"ed-exp-stat " + (e.status === "error" ? "err" : "")} title={e.error || ""}>{e.fmt.toUpperCase()} {e.status === "error" ? "failed" : "…"}{e.status === "error" && e.error ? ": " + e.error.slice(0, 140) : ""}</span>
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
          <div className="ed-stage" ref={stageRef}>
            <div className={"ed-canvas-frame" + (canvas.aspect && canvas.aspect !== "original" ? " on" : "")}
              style={canvas.aspect && canvas.aspect !== "original" ? {
                aspectRatio: canvas.aspect.replace(":", "/"),
                background: canvas.bg_type === "image" && canvas.image_url ? `center/cover no-repeat url("${canvas.image_url}")`
                  : canvas.bg_type === "blur" ? "#0a0c13" : (canvas.color || "#000000"),
              } : undefined}>
            <VideoPreview ref={videoRef} src={mediaSrc} filterCss={filterPreviewCss}
              overlay={<>
                {activeCue && overlayText ? (
                  <CaptionOverlay text={overlayText} styleId={effStyle} cue={activeCue} curMs={curMs} keyId={activeIdx} settings={capSettings} />
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
                {images.filter((im) => curMs >= im.start_ms && curMs < im.end_ms).map((im) => (
                  <img key={im.id} src={im.image_url} draggable={false}
                    className={"ed-imgovl" + (selImg === im.id ? " sel" : "")}
                    style={{ left: im.x_pct + "%", top: im.y_pct + "%", width: im.size_pct + "%" }}
                    onMouseDown={(e) => startDragImg(e, im)}
                    onClick={(e) => { e.stopPropagation(); setSelImg(im.id); setRail("images"); }} />
                ))}
                {brolls.filter((b) => curMs >= b.start_ms && curMs < b.end_ms).map((b) => (
                  <video key={b.id} src={b.video_url} muted autoPlay loop playsInline draggable={false}
                    className={"ed-imgovl" + (selBroll === b.id ? " sel" : "")}
                    style={{ left: b.x_pct + "%", top: b.y_pct + "%", width: b.size_pct + "%" }}
                    onMouseDown={(e) => startDragBroll(e, b)}
                    onClick={(e) => { e.stopPropagation(); setSelBroll(b.id); setRail("broll"); }} />
                ))}
              </>} />
            </div>
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
            <div className={"ed-rt-tab" + (topTab === "video" ? " active" : "")} onClick={() => setTopTab("video")}>Video</div>
            <div className={"ed-rt-tab" + (topTab === "audio" ? " active" : "")} onClick={() => setTopTab("audio")}>Audio</div>
            <div className={"ed-rt-tab" + (topTab === "text" ? " active" : "")} onClick={() => setTopTab("text")}>Text</div>
          </div>
          {topTab === "text" && (
            <div className="ed-rt-sub">
              {(["styles", "font", "animation", "outline", "shadow"] as const).map((t) => (
                <div key={t} className={"ed-rt-subtab" + (rightTab === t ? " active" : "")} onClick={() => setRightTab(t)}>
                  {t === "styles" ? "Styles" : t === "font" ? "Font & colour" : t === "animation" ? "Animation" : t === "outline" ? "Outline" : "Shadow"}
                </div>
              ))}
            </div>
          )}

          {topTab === "video" && (
            <div className="ed-rt-body">
              <div className="ed-anim-lbl">PLAYBACK SPEED</div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Speed</span><span>{playRate.toFixed(2)}x</span></div>
                <input type="range" min={0.25} max={2} step={0.05} value={playRate}
                  onChange={(e) => { const v = +e.target.value; setPlayRate(v); if (videoRef.current) videoRef.current.playbackRate = v; }} />
                <div className="ed-cs-slabel" style={{ color: "var(--muted)" }}><span>0.25x</span><span>2x</span></div>
              </div>
              <div className="ed-hint-box" style={{ marginTop: 16 }}>
                Preview speed for scrubbing. For the look of the video use <b>Filters</b> (colour grading &amp; LUTs) and <b>Auto Zoom</b> (punch-ins) in the left rail; change the source with <b>Replace</b> above the preview.
              </div>
            </div>
          )}

          {topTab === "audio" && (
            <div className="ed-rt-body">
              <div className="ed-anim-lbl">VOLUME</div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Level</span><span>{Math.round(audioVol * 100)}%</span></div>
                <input type="range" min={0} max={2} step={0.05} value={audioVol}
                  onChange={(e) => { const v = +e.target.value; setAudioVol(v); if (videoRef.current) videoRef.current.volume = Math.min(1, v); }} />
                <div className="ed-cs-slabel" style={{ color: "var(--muted)" }}><span>mute</span><span>200%</span></div>
              </div>
              <div className="ed-anim-toggle" style={{ marginTop: 20 }}>
                <div>
                  <div className="ed-anim-title">Audio enhance</div>
                  <div className="np-sub">Clean background noise with AI — applied when you export.</div>
                </div>
                <label className="ed-switch">
                  <input type="checkbox" checked={enhanceAudio} onChange={(e) => setEnhanceAudio(e.target.checked)} />
                  <span className="ed-switch-track" />
                </label>
              </div>
            </div>
          )}

          {topTab === "text" && rightTab === "styles" && (
            <div className="ed-rt-body">
              <div className="ed-sub2">
                {(["lines", "words", "saved"] as const).map((t) => (
                  <div key={t} className={"ed-sub2-tab" + (stylesTab === t ? " active" : "")} onClick={() => setStylesTab(t)}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </div>
                ))}
                <span className="spacer" />
                <button className={"ed-sub2-icon" + (styleSearchOpen ? " on" : "")} title="Search styles"
                  onClick={() => { setStyleSearchOpen((v) => !v); if (styleSearchOpen) setStyleSearch(""); }}>🔍</button>
                <button className="ed-sub2-icon" title="Save current style" onClick={saveCurrentStyle}>⇧</button>
              </div>
              {styleSearchOpen && (
                <input className="ed-style-search" autoFocus placeholder="Search styles…" value={styleSearch}
                  onChange={(e) => setStyleSearch(e.target.value)} />
              )}

              {!infoDismissed && (
                <div className="ed-hint-box ed-hint-x">
                  <span>Styles apply to every caption in this video — colours and fonts can still be changed per caption.</span>
                  <button onClick={() => setInfoDismissed(true)}>×</button>
                </div>
              )}

              {stylesTab !== "saved" && (
                <>
                  <div className="ed-preset-list">
                    {(stylesTab === "lines" ? lineStyles : wordStyles).filter((st) => st.label.toLowerCase().includes(styleSearch.toLowerCase())).map((st) => (
                      <div key={st.id} className={"ed-preset-card" + (capStyle === st.id ? " active" : "")} onClick={() => setCapStyle(st.id)}>
                        <div className="ed-preset-name">{st.label}</div>
                        <div className="ed-preset-stage">
                          <span className={"cap cap-" + st.id} key={st.id}>Welcome to the <span className="cap-emph">future</span><br />of editing</span>
                        </div>
                        {capStyle === st.id && <div className="ed-showcase-check">✓</div>}
                      </div>
                    ))}
                  </div>
                  <div className="ed-swatches" style={{ marginTop: 14 }}>
                    {SWATCHES.map((sw) => (
                      <span key={sw.color} className={"ed-swatch" + (capStyle === sw.style ? " active" : "")}
                        style={{ background: sw.color }} title={sw.style} onClick={() => setCapStyle(sw.style)} />
                    ))}
                  </div>
                </>
              )}

              {stylesTab === "saved" && (
                <div className="ed-preset-list">
                  <button className="ed-addcap" onClick={saveCurrentStyle}>＋ Save current style</button>
                  {savedStyles.length === 0 ? (
                    <div className="ed-cap-empty" style={{ paddingTop: 16 }}>No saved styles yet.</div>
                  ) : (
                    savedStyles.filter((sv) => sv.name.toLowerCase().includes(styleSearch.toLowerCase())).map((sv) => (
                      <div key={sv.id} className="ed-preset-card" onClick={() => applySaved(sv)}>
                        <div className="ed-preset-name">{sv.name}
                          <button className="ed-preset-del" onClick={(e) => { e.stopPropagation(); delSaved(sv.id); }}>🗑</button>
                        </div>
                        <div className="ed-preset-stage">
                          <span className={"cap cap-" + sv.style}>Welcome to the <span className="cap-emph">future</span></span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {topTab === "text" && rightTab === "font" && (
            <div className="ed-rt-body">
              <div className="ed-cs-title">Font &amp; colour</div>
              <div className="ed-cs-row"><span>Font</span>
                <select value={capSettings.font || ""} onChange={(e) => saveCapSetting({ font: e.target.value })}>
                  {CS_FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="ed-cs-row"><span>Weight</span>
                <select value={String(capSettings.bold ?? 0)} onChange={(e) => saveCapSetting({ bold: +e.target.value })}>
                  <option value="0">Regular</option>
                  <option value="-1">Bold</option>
                </select>
              </div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Letter spacing</span><span>{capSettings.spacing ?? 0}px</span></div>
                <input type="range" min={-6} max={30} step={0.5} value={capSettings.spacing ?? 0}
                  onChange={(e) => setCapSettings((pr) => ({ ...pr, spacing: +e.target.value }))}
                  onMouseUp={(e) => saveCapSetting({ spacing: +(e.target as HTMLInputElement).value })} />
              </div>
              <div className="np-sub" style={{ marginTop: 10 }}>Caption colours come from the <b>Styles</b> tab — pick a preset or a colour swatch there, then Apply all.</div>
              <div className="ed-cs-divider" />
              <div className="ed-anim-lbl">TRANSCRIPTION</div>
              <label className="ed-setting">
                <span>Show romanized (Thanglish)</span>
                <input type="checkbox" checked={showTranslit} onChange={(e) => setShowTranslit(e.target.checked)} />
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

          {topTab === "text" && rightTab === "outline" && (
            <div className="ed-rt-body">
              <div className="ed-cs-title">Outline</div>
              <div className="ed-anim-toggle">
                <div>
                  <div className="ed-anim-title">Outline</div>
                  <div className="np-sub">A stroke around each letter for readability.</div>
                </div>
                <label className="ed-switch">
                  <input type="checkbox" checked={(capSettings.outline_w ?? 3) > 0}
                    onChange={(e) => saveCapSetting({ outline_w: e.target.checked ? 4 : 0 })} />
                  <span className="ed-switch-track" />
                </label>
              </div>
              <div className="ed-cs-slider" style={{ marginTop: 16 }}>
                <div className="ed-cs-slabel"><span>Thickness</span><span>{capSettings.outline_w ?? 3}px</span></div>
                <input type="range" min={0} max={12} step={1} value={capSettings.outline_w ?? 3}
                  onChange={(e) => setCapSettings((pr) => ({ ...pr, outline_w: +e.target.value }))}
                  onMouseUp={(e) => saveCapSetting({ outline_w: +(e.target as HTMLInputElement).value })} />
              </div>
            </div>
          )}

          {topTab === "text" && rightTab === "shadow" && (
            <div className="ed-rt-body">
              <div className="ed-cs-title">Shadow</div>
              <div className="ed-anim-toggle">
                <div>
                  <div className="ed-anim-title">Drop shadow</div>
                  <div className="np-sub">A soft shadow cast behind the text.</div>
                </div>
                <label className="ed-switch">
                  <input type="checkbox" checked={(capSettings.shadow ?? 1) > 0}
                    onChange={(e) => saveCapSetting({ shadow: e.target.checked ? 3 : 0 })} />
                  <span className="ed-switch-track" />
                </label>
              </div>
              <div className="ed-cs-slider" style={{ marginTop: 16 }}>
                <div className="ed-cs-slabel"><span>Depth</span><span>{capSettings.shadow ?? 1}px</span></div>
                <input type="range" min={0} max={12} step={1} value={capSettings.shadow ?? 1}
                  onChange={(e) => setCapSettings((pr) => ({ ...pr, shadow: +e.target.value }))}
                  onMouseUp={(e) => saveCapSetting({ shadow: +(e.target as HTMLInputElement).value })} />
              </div>
              <div className="ed-anim-toggle" style={{ marginTop: 20 }}>
                <div>
                  <div className="ed-anim-title">Glow</div>
                  <div className="np-sub">A luminous halo around the text.</div>
                </div>
                <label className="ed-switch">
                  <input type="checkbox" checked={!!capSettings.glow}
                    onChange={(e) => saveCapSetting({ glow: e.target.checked })} />
                  <span className="ed-switch-track" />
                </label>
              </div>
            </div>
          )}

          {topTab === "text" && rightTab === "animation" && (
            <div className="ed-rt-body">
              <div className="ed-anim-toggle">
                <div>
                  <div className="ed-anim-title">Animations</div>
                  <div className="np-sub">Animate caption entrance &amp; exit</div>
                </div>
                <label className="ed-switch">
                  <input type="checkbox" checked={capSettings.anim_enabled !== false}
                    onChange={(e) => saveCapSetting({ anim_enabled: e.target.checked })} />
                  <span className="ed-switch-track" />
                </label>
              </div>

              <div className={"ed-anim-controls" + (capSettings.anim_enabled === false ? " disabled" : "")}>
                <div className="ed-anim-lbl">WHEN</div>
                <div className="ed-seg-row" style={{ maxWidth: 180 }}>
                  {(["in", "out"] as const).map((w) => (
                    <div key={w} className={"ed-seg-btn" + ((capSettings.when || "in") === w ? " active" : "")}
                      onClick={() => saveCapSetting({ when: w })}>{w === "in" ? "In" : "Out"}</div>
                  ))}
                </div>

                <div className="ed-anim-lbl" style={{ marginTop: 16 }}>WHAT MOVES</div>
                <div className="ed-seg-row">
                  {([["caption", "Caption"], ["word", "Word"]] as [string, string][]).map(([v, l]) => (
                    <div key={v} className={"ed-seg-btn" + ((capSettings.scope || "caption") === v ? " active" : "")}
                      onClick={() => saveCapSetting({ scope: v })}>{l}</div>
                  ))}
                </div>
                <div className="np-sub" style={{ marginTop: 8 }}>
                  {capSettings.scope === "word" ? "Each word pops in on its own, right when it's spoken." : "The whole caption animates in as one block."}
                </div>

                <div className="ed-anim-lbl" style={{ marginTop: 18 }}>ANIMATION</div>
                <div className="ed-anim-grid">
                  {ANIM_PRESETS.map(([v, l]) => (
                    <div key={v || "none"} className={"ed-anim-card" + ((capSettings.anim || "") === v ? " active" : "")}
                      onClick={() => saveCapSetting({ anim: v })}>
                      <div className="ed-anim-prev"><span className={"ed-anim-word" + (v ? " capset-" + v : "")} key={v}>welcome</span></div>
                      <div className="ed-style-lb">{l}</div>
                    </div>
                  ))}
                </div>

                <div className="ed-cs-slider" style={{ marginTop: 16 }}>
                  <div className="ed-cs-slabel"><span>Speed</span><span>{(capSettings.speed ?? 1).toFixed(1)}x</span></div>
                  <input type="range" min={0.5} max={4} step={0.1} value={capSettings.speed ?? 1}
                    onChange={(e) => setCapSettings((pr) => ({ ...pr, speed: +e.target.value }))}
                    onMouseUp={(e) => saveCapSetting({ speed: +(e.target as HTMLInputElement).value })} />
                  <div className="ed-cs-slabel" style={{ color: "var(--muted)" }}><span>slower</span><span>faster</span></div>
                </div>

                <button className="secondary" style={{ width: "100%", marginTop: 14 }} onClick={resetCapSettings}>↺ Reset to defaults</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== bottom timeline ===== */}
      <div className="ed-timeline">
        <div className="ed-toolbar">
          <div className="ed-tb-group">
            <button className="ed-tb-btn" title="Undo" onClick={undo} disabled={undoStack.length === 0}>↺</button>
            <button className="ed-tb-btn" title="Redo" onClick={redo} disabled={redoStack.length === 0}>↻</button>
            <button className="ed-tb-btn" title="Delete selected caption" onClick={() => { if (selected.size) bulkDelete(); else { const t = targetCueIdx(); if (t >= 0) deleteOne(t); } }}>🗑</button>
            <button className="ed-tb-btn" title="Jump to start" onClick={() => seek(0)}>⏮</button>
            <span className="ed-tb-sep" />
            <button className="ed-tb-btn wide" title="Split caption at playhead" onClick={() => { const t = targetCueIdx(); if (t >= 0) splitAt(t); }}>⑃ Split</button>
            <button className="ed-tb-btn wide" title="Duplicate caption" onClick={() => { const t = targetCueIdx(); if (t >= 0) duplicateCap(t); }}>⧉ Duplicate</button>
            <div className="ed-tb-aiwrap">
              <button className="ed-tb-btn wide" title="AI tools" onClick={() => setAiMenu((v) => !v)}>✨ AI tools ▾</button>
              {aiMenu && (
                <div className="ed-tb-aimenu" onMouseLeave={() => setAiMenu(false)}>
                  <div className="ed-tb-aiitem" onClick={() => { setRail("tools"); setAiMenu(false); }}>Remove silences</div>
                  <div className="ed-tb-aiitem" onClick={() => { setRail("tools"); setAiMenu(false); }}>Remove filler words</div>
                  <div className="ed-tb-aiitem" onClick={() => { setRail("retake"); setAiMenu(false); }}>Remove retakes</div>
                  <div className="ed-tb-aiitem" onClick={() => { setRail("zoom"); setAiMenu(false); }}>Auto zoom</div>
                  <div className="ed-tb-aiitem" onClick={() => { setRail("tools"); setAiMenu(false); }}>Re-transcribe</div>
                </div>
              )}
            </div>
            <button className="ed-tb-btn" title="Add text overlay" onClick={() => { setRail("texts"); addText(); }}>T</button>
            <button className="ed-tb-btn" title="Toggle caption density" onClick={() => setDensity((d) => d === "roomy" ? "compact" : "roomy")}>▤▥</button>
          </div>

          <div className="ed-tb-center">
            <button className="ed-tb-btn" title="Previous caption" onClick={prevCap}>⏪</button>
            <button className="ed-tl-play" onClick={togglePlay}>{playing ? "⏸" : "▶"}</button>
            <button className="ed-tb-btn" title="Next caption" onClick={nextCap}>⏩</button>
            <span className="muted ed-tb-time">{fmtT(curMs)} / {fmtT(dur)}</span>
          </div>

          <div className="ed-tb-group">
            <button className="ed-tb-btn" title="Zoom out timeline" onClick={() => setTlZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>➖</button>
            <input type="range" min={0.5} max={4} step={0.25} value={tlZoom} className="ed-tb-zoom"
              onChange={(e) => setTlZoom(+e.target.value)} />
            <button className="ed-tb-btn" title="Zoom in timeline" onClick={() => setTlZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>➕</button>
            <button className="ed-tb-btn" title="Fullscreen preview" onClick={toggleFullscreen}>⛶</button>
            <span className="ed-tb-sep" />
            <span className="ed-tb-sel">Select</span>
            <button className="ed-tb-selbtn" onClick={() => setSelected(new Set(cues.map((c) => c.idx)))}>All</button>
            <button className="ed-tb-selbtn" onClick={() => setSelected(new Set())}>None</button>
          </div>
        </div>
        <div className="ed-tl-body">
          <div className="ed-tl-gutter">
            <div className="ed-th-ruler" />
            <div className="ed-th"><span className="ed-th-ic">≡</span></div>
            {overlays.length > 0 && <div className="ed-th"><span className="ed-th-ic">T</span></div>}
            {images.length > 0 && <div className="ed-th"><span className="ed-th-ic">▤</span></div>}
            {brolls.length > 0 && <div className="ed-th"><span className="ed-th-ic">▦</span></div>}
            {filterLayers.length > 0 && <div className="ed-th"><span className="ed-th-ic">◑</span></div>}
            <div className="ed-th ed-th-media"><span className="ed-th-ic">▶</span></div>
          </div>
          <div className="ed-tl2">
          <div className="ed-tl2-inner" style={{ width: TLW }}>
            <div className="ed-ph" style={{ left: `${(curMs / dur) * 100}%` }}><span className="ed-ph-knob" /></div>
            <div className="ed-tl2-ruler" onClick={scrub}>
              {tlTicks.map((t) => (
                <span key={t} className="ed-tick" style={{ left: `${(t / dur) * 100}%` }}>{fmtT(t)}</span>
              ))}
            </div>

            <div className="ed-lane" onClick={scrub}>
              {cues.map((c) => {
                const w = ((c.end_ms - c.start_ms) / dur) * 100;
                return (
                <div key={c.idx} className={"ed-tl-pill" + (c.idx === activeIdx ? " active" : "")}
                  style={{ left: `${(c.start_ms / dur) * 100}%`, width: `${Math.max(w, 0.7)}%` }}
                  title={c.text}
                  onClick={(e) => { e.stopPropagation(); setRail("captions"); seek(c.start_ms); }}>
                  {w > 2.4 ? (showTranslit && c.translit_text ? c.translit_text : c.text).slice(0, 14) : ""}
                </div>
                );
              })}
            </div>

            {overlays.length > 0 && (
              <div className="ed-lane" onClick={scrub}>
                {overlays.map((o) => (
                  <div key={o.id} className={"ed-tl-block ed-tl-text" + (selOv === o.id ? " sel" : "")}
                    style={{ left: `${(o.start_ms / dur) * 100}%`, width: `${Math.max(((o.end_ms - o.start_ms) / dur) * 100, 1.2)}%` }}
                    title={o.text}
                    onClick={(e) => { e.stopPropagation(); setSelOv(o.id); setRail("texts"); seek(o.start_ms); }}>
                    {o.text.slice(0, 14)}
                  </div>
                ))}
              </div>
            )}

            {images.length > 0 && (
              <div className="ed-lane" onClick={scrub}>
                {images.map((im) => (
                  <div key={im.id} className={"ed-tl-block ed-tl-img" + (selImg === im.id ? " sel" : "")}
                    style={{ left: `${(im.start_ms / dur) * 100}%`, width: `${Math.max(((im.end_ms - im.start_ms) / dur) * 100, 1.2)}%` }}
                    onClick={(e) => { e.stopPropagation(); setSelImg(im.id); setRail("images"); seek(im.start_ms); }}>🖼</div>
                ))}
              </div>
            )}

            {brolls.length > 0 && (
              <div className="ed-lane" onClick={scrub}>
                {brolls.map((b) => (
                  <div key={b.id} className={"ed-tl-block ed-tl-broll" + (selBroll === b.id ? " sel" : "")}
                    style={{ left: `${(b.start_ms / dur) * 100}%`, width: `${Math.max(((b.end_ms - b.start_ms) / dur) * 100, 1.2)}%` }}
                    onClick={(e) => { e.stopPropagation(); setSelBroll(b.id); setRail("broll"); seek(b.start_ms); }}>🎞 B-roll</div>
                ))}
              </div>
            )}

            {filterLayers.length > 0 && (
              <div className="ed-lane" onClick={scrub}>
                {filterLayers.map((l) => (
                  <div key={l.id} className={"ed-tl-block ed-tl-filter" + (selLayer === l.id ? " sel" : "")}
                    style={{ left: `${(l.start_ms / dur) * 100}%`, width: `${Math.max(((l.end_ms - l.start_ms) / dur) * 100, 1.2)}%` }}
                    title={gradeLabel(l.name)}
                    onClick={(e) => { e.stopPropagation(); setRail("filters"); selectLayer(l.id); seek(l.start_ms); }}>
                    ◑ {gradeLabel(l.name)}
                  </div>
                ))}
              </div>
            )}

            <div className="ed-lane ed-lane-media" onClick={scrub}>
              <div className="ed-media-clip">
                <div className="ed-media-name">{proj.source_filename || "video"} · {fmtT(dur)}</div>
                <Filmstrip src={mediaSrc} count={14} />
                <div className="ed-media-wave"><Waveform mediaEl={mediaEl} /></div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
