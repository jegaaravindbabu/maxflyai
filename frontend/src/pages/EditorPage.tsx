import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { api, type Zoom } from "../api/client";
import type { ProjectDetail, Overlay, ImageOverlay, BrollClip, Cue, Project } from "../types";
import { VideoPreview } from "../components/VideoPreview";
import { CaptionOverlay } from "../components/CaptionOverlay";
import { Waveform } from "../components/Waveform";
import { Filmstrip } from "../components/Filmstrip";
import { Dropdown } from "../components/Dropdown";
import { SilenceRemover } from "../components/SilenceRemover";
import { RetakeRemover } from "../components/RetakeRemover";
import { FillerRemover } from "../components/FillerRemover";

const LANGS = [
  ["unknown", "Auto-detect"], ["ta-IN", "Tamil"], ["hi-IN", "Hindi"],
  ["ml-IN", "Malayalam"], ["te-IN", "Telugu"], ["bn-IN", "Bengali"],
  ["kn-IN", "Kannada"], ["gu-IN", "Gujarati"], ["mr-IN", "Marathi"],
  ["pa-IN", "Punjabi"], ["od-IN", "Odia"], ["en-IN", "English"],
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

const WORD_STYLES = ["karaoke", "highlight", "anton_gold",
  "word_sunset", "word_outline", "word_neon", "word_gold", "word_green", "word_bubble", "word_mono", "word_purple",
  "word_marker", "word_ghost", "word_comic", "word_hlbox"];
const CS_FONTS: [string, string][] = [
  ["", "Default (Inter)"], ["Anton", "Anton"], ["Bebas Neue", "Bebas Neue"],
  ["Oswald", "Oswald"], ["Teko", "Teko"], ["Poppins", "Poppins"], ["Montserrat", "Montserrat"],
  ["Kanit", "Kanit"], ["Lato", "Lato"], ["Rubik", "Rubik"], ["Fredoka", "Fredoka"],
  ["Righteous", "Righteous"], ["Archivo Black", "Archivo Black"], ["Arial Black", "Arial Black"],
  ["Alfa Slab One", "Alfa Slab One"], ["Titan One", "Titan One"], ["Bangers", "Bangers"],
  ["Luckiest Guy", "Luckiest Guy"], ["Permanent Marker", "Permanent Marker (script)"],
  ["Pacifico", "Pacifico (script)"], ["Caveat", "Caveat (script)"],
];
const ANIM_PRESETS: [string, string][] = [
  ["", "None"], ["fade", "Fade"], ["fade_blur", "Fade Blur"],
  ["type_on", "Type On"], ["type_expand", "Type Expand"], ["scale", "Scale"],
  ["pop", "Pop"], ["bounce", "Bounce"], ["bounce_drop", "Bounce Drop"],
  ["slide_up", "Slide Up"], ["slide_down", "Slide Down"],
  ["slide_left", "Slide Left"], ["slide_right", "Slide Right"],
  ["rotate", "Rotate"], ["flip", "Flip"],
];

// ---- Video-element animation picker (In / Loop / Out) ----
// key -> CSS animation shorthand applied to the <video> in the live preview.
const VFX_ANIM_IN: Record<string, string> = {
  none: "", fade: "vfxin-fade .6s ease", fadeblur: "vfxin-fadeblur .7s ease",
  zoom: "vfxin-zoom .6s ease", slideup: "vfxin-slideup .6s ease", slidedown: "vfxin-slidedown .6s ease",
  slideleft: "vfxin-slideleft .6s ease", slideright: "vfxin-slideright .6s ease",
  rotate: "vfxin-rotate .6s ease", flip: "vfxin-flip .7s ease",
  pop: "vfxin-pop .6s cubic-bezier(.2,1.4,.4,1)", typeon: "vfxin-typeon .8s ease",
};
const VFX_ANIM_LOOP: Record<string, string> = {
  none: "", shakeH: "vfxloop-shakeH .55s ease-in-out infinite", shakeV: "vfxloop-shakeV .55s ease-in-out infinite",
  pulse: "vfxloop-pulse 2s ease-in-out infinite", zoom: "vfxloop-zoom 4s ease-in-out infinite",
  sway: "vfxloop-sway 3s ease-in-out infinite", float: "vfxloop-float 3s ease-in-out infinite",
};
// [key, label, demo-class] for each timing tab's card grid.
const VFX_IN_CARDS: [string, string, string][] = [
  ["none", "None", ""], ["fade", "Fade", "vfxdemo-fade"], ["fadeblur", "Fade Blur", "vfxdemo-fadeblur"],
  ["zoom", "Zoom In", "vfxdemo-zoom"], ["slideup", "Slide Up", "vfxdemo-slideup"], ["slidedown", "Slide Down", "vfxdemo-slidedown"],
  ["slideleft", "Slide Left", "vfxdemo-slideleft"], ["slideright", "Slide Right", "vfxdemo-slideright"],
  ["rotate", "Rotate", "vfxdemo-rotate"], ["flip", "Flip", "vfxdemo-flip"], ["pop", "Pop", "vfxdemo-pop"], ["typeon", "Type On", "vfxdemo-typeon"],
];
const VFX_LOOP_CARDS: [string, string, string][] = [
  ["none", "None", ""], ["shakeH", "Shake H", "vfxdemo-shakeH"], ["shakeV", "Shake V", "vfxdemo-shakeV"],
  ["pulse", "Pulse", "vfxdemo-pulse"], ["zoom", "Zoom", "vfxdemo-zoomloop"], ["sway", "Sway", "vfxdemo-sway"], ["float", "Float", "vfxdemo-float"],
];
const VFX_OUT_CARDS: [string, string, string][] = [
  ["none", "None", ""], ["fade", "Fade Out", "vfxdemo-ofade"], ["zoom", "Zoom Out", "vfxdemo-ozoom"],
  ["slidedown", "Slide Down", "vfxdemo-oslidedown"], ["slideup", "Slide Up", "vfxdemo-oslideup"], ["rotate", "Rotate Out", "vfxdemo-orotate"],
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

// thin line icons for the track gutter (match ceyonai's clean row)
const svg = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcType: Record<string, React.ReactNode> = {
  captions: svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M9 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3" /></>),
  text: svg(<><path d="M5 6V5h14v1M12 5v14M9 19h6" /></>),
  images: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="M21 16l-5-5-8 8" /></>),
  broll: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 15h18M8 4v16M16 4v16" /></>),
  filters: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" /></>),
  media: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 15h18M8 4v16M16 4v16" /></>),
};
const IcEye = (on: boolean) => on
  ? svg(<><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></>)
  : svg(<><path d="M9.9 4.24A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.16 3.19M6.06 6.06A18 18 0 0 0 1 12s4 8 11 8a9 9 0 0 0 3.94-.94M1 1l22 22" /></>);
const IcLock = (locked: boolean) => locked
  ? svg(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>)
  : svg(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-1.3" /></>);
const IcVol = (muted: boolean) => muted
  ? svg(<><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M22 9l-6 6M16 9l6 6" /></>)
  : svg(<><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 8.5a5 5 0 0 1 0 7" /></>);

// crisp line icons for the timeline toolbar (HyproAI-style)
const tsvg = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcUndo = tsvg(<><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-4" /></>);
const IcRedo = tsvg(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h4" /></>);
const IcTrash = tsvg(<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></>);
const IcStart = tsvg(<><path d="M6 5v14" /><path d="M18 5 8 12l10 7z" /></>);
const IcSplit = tsvg(<><path d="M8 3v18" /><path d="M16 3v18" /><path d="M3 12h4" /><path d="M17 12h4" /></>);
const IcDup = tsvg(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>);
const IcAI = tsvg(<><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z" /><path d="M18.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></>);
const IcTextTool = tsvg(<><path d="M5 6V5h14v1" /><path d="M12 5v14" /><path d="M9 19h6" /></>);
const IcRows = tsvg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M3 14h18" /></>);
const IcPrev = tsvg(<><path d="M11 19 4 12l7-7z" /><path d="M18 19l-7-7 7-7z" /></>);
const IcNext = tsvg(<><path d="M13 5l7 7-7 7z" /><path d="M6 5l7 7-7 7z" /></>);
const IcPlay = (<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="none"><path d="M8 5.5v13l11-6.5z" /></svg>);
const IcPause = (<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><rect x="7" y="5" width="3.6" height="14" rx="1" /><rect x="13.4" y="5" width="3.6" height="14" rx="1" /></svg>);
const IcZoomOut = tsvg(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M8 11h6" /></>);
const IcZoomIn = tsvg(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M11 8v6" /><path d="M8 11h6" /></>);
const IcFull = tsvg(<><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M16 21h3a2 2 0 0 1 2-2v-3" /><path d="M8 21H5a2 2 0 0 0-2-2v-3" /></>);
const IcTrayUp = tsvg(<><path d="M12 15V4" /><path d="m7 8 5-4 5 4" /><path d="M3 15v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /></>);
const IcTrayDown = tsvg(<><path d="M12 4v11" /><path d="m7 11 5 4 5-4" /><path d="M3 15v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /></>);
const IcFileMedia = tsvg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="m10 12 4 2.5-4 2.5z" /></>);
const IcFilm2 = tsvg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 15h18M8 4v16M16 4v16" /></>);
const IcRefresh = tsvg(<><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" /><path d="M21 4v4h-4" /></>);
const IcReset = tsvg(<><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 4v4h4" /></>);
const IcSearch = tsvg(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>);
const IcPlus = tsvg(<path d="M12 5v14M5 12h14" />);
const IcCrop = tsvg(<><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></>);
const IcSpeaker = tsvg(<><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /></>);
const IcImageS = tsvg(<><rect x="3" y="4.5" width="18" height="15" rx="3" /><circle cx="8.8" cy="10" r="1.6" /><path d="M21 16.5 15.5 11 6.5 19.5" /></>);
const IcHalf = tsvg(<><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" /></>);
const IcExternal = tsvg(<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></>);
const IcPlayS = (<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M8 5.5v13l11-6.5z" /></svg>);

// Rail order mirrors ceyonai: Uploads, Texts, Videos, Filters, Captions, Auto Zoom, Images
// (ceyonai uploads via the New Project modal, so there is no separate Uploads panel;
//  "Videos" maps to B-roll clips. AI Tools / Canvas / Export are ceyonai extras.)
const rsvg = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const RAILS = [
  { id: "uploads", icon: rsvg(<><path d="M12 16V5" /><path d="m7 9 5-4 5 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>), label: "Uploads" },
  { id: "texts", icon: rsvg(<><path d="M5 7V5h14v2" /><path d="M12 5v14" /><path d="M9 19h6" /></>), label: "Texts" },
  { id: "broll", icon: rsvg(<><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="m15.5 10.5 6-3.5v10l-6-3.5" /></>), label: "Videos" },
  { id: "filters", icon: rsvg(<><path d="M10 4l1.7 4.3L16 10l-4.3 1.7L10 16l-1.7-4.3L4 10l4.3-1.7z" /><path d="M18 13l.9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9z" /></>), label: "Filters" },
  { id: "captions", icon: rsvg(<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 13h4M13 13h4M7 16h7" /></>), label: "Captions" },
  { id: "zoom", icon: rsvg(<><circle cx="12" cy="12" r="8" /><path d="M12 8.5v7M8.5 12h7" /></>), label: "Auto Zoom" },
  { id: "images", icon: rsvg(<><rect x="3" y="4.5" width="18" height="15" rx="3" /><circle cx="8.8" cy="10" r="1.6" /><path d="M21 16.5 15.5 11 6.5 19.5" /></>), label: "Images" },
  { id: "tools", icon: rsvg(<><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>), label: "AI Tools" },
  { id: "retake", icon: rsvg(<><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 4v4h4" /></>), label: "Retake" },
  { id: "canvas", icon: rsvg(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><rect x="7" y="8" width="10" height="8" rx="1.5" /></>), label: "Canvas" },
];

function fmtT(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function EditorPage({ projectId }: { projectId: string }) {
  const [proj, setProj] = useState<ProjectDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [lang, setLang] = useState("ta-IN");
  const [mode, setMode] = useState("transcribe");
  const [showTranslit, setShowTranslit] = useState(true);
  const [capStyle, setCapStyle] = useState("classic");
  const [animOn, setAnimOn] = useState(true);
  const [capSettings, setCapSettings] = useState<Record<string, any>>({});
  const [capOverrides, setCapOverrides] = useState<Record<string, any>>({});
  const [wordOverrides, setWordOverrides] = useState<Record<string, Record<string, any>>>({});
  const [selWord, setSelWord] = useState<number>(-1);
  const [styleClip, setStyleClip] = useState<Record<string, any> | null>(null);
  const [customiseOpen, setCustomiseOpen] = useState(true);
  const [stylesTab, setStylesTab] = useState<"lines" | "words" | "saved">("lines");
  const [styleScope, setStyleScope] = useState<"all" | "caption">("all");
  // Looping clock so the word-style preview cards animate on their own (like HyproAI).
  const [cardTick, setCardTick] = useState(0);
  useEffect(() => {
    if (stylesTab !== "words") return;
    const _id = setInterval(() => setCardTick((t) => t + 1), 520);
    return () => clearInterval(_id);
  }, [stylesTab]);
  const [savedStyles, setSavedStyles] = useState<{ id: string; name: string; style: string; settings: any }[]>([]);
  const [infoDismissed, setInfoDismissed] = useState(false);
  const [canvas, setCanvas] = useState<Record<string, any>>({});
  const canvasImgRef = useRef<HTMLInputElement>(null);
  const [styleSearch, setStyleSearch] = useState("");
  const [styleSearchOpen, setStyleSearchOpen] = useState(false);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selOv, setSelOv] = useState<string | null>(null);
  const [textTab, setTextTab] = useState<"content" | "style" | "anim" | "outline" | "shadow">("content");
  const TXT_ANIMS: [string, string][] = [["none", "None"], ["fade", "Fade"], ["slide_up", "Slide up"], ["slide_down", "Slide down"], ["slide_left", "Slide left"], ["slide_right", "Slide right"], ["rise", "Rise"], ["drop", "Drop"], ["pop", "Pop"], ["zoom", "Zoom"], ["bounce", "Bounce"], ["rotate", "Rotate"], ["flip", "Flip"], ["blur", "Blur"], ["expand", "Expand"]];
  const [zooms, setZooms] = useState<Zoom[]>([]);
  const [zoomDensity, setZoomDensity] = useState<"fewer" | "balanced" | "more">("balanced");
  const [zoomOn, setZoomOn] = useState(true);
  const [zoomBusy, setZoomBusy] = useState(false);
  const [zoomProg, setZoomProg] = useState("");
  const [selZoomId, setSelZoomId] = useState<string | null>(null);
  const [zoomAdvOpen, setZoomAdvOpen] = useState(false);
  const [filterList, setFilterList] = useState<{ id: string; label: string; group: string }[]>([]);
  const [filterGroups, setFilterGroups] = useState<{ name: string; sub: string }[]>([]);
  const [curFilter, setCurFilter] = useState("none");
  const [adjust, setAdjust] = useState<Adjust>({ brightness: 0, contrast: 0, saturation: 0, warmth: 0 });
  const [filmFrame, setFilmFrame] = useState<string>("");
  const [filterLayers, setFilterLayers] = useState<FilterLayer[]>([]);
  const [selLayer, setSelLayer] = useState<string | null>(null);
  const [hiddenTracks, setHiddenTracks] = useState<Set<string>>(new Set());
  const [lockedTracks, setLockedTracks] = useState<Set<string>>(new Set());
  const [mediaMuted, setMediaMuted] = useState(false);
  const [capToolsOpen, setCapToolsOpen] = useState(false);
  const [emphasisDraft, setEmphasisDraft] = useState("");
  const [images, setImages] = useState<ImageOverlay[]>([]);
  const [selImg, setSelImg] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const upInputRef = useRef<HTMLInputElement>(null);
  const [myMedia, setMyMedia] = useState<Project[]>([]);
  const [upTab, setUpTab] = useState<"import" | "export">("import");
  const [upBusy, setUpBusy] = useState(false);
  const [upModal, setUpModal] = useState(false);
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upDrag, setUpDrag] = useState(false);
  const [upPct, setUpPct] = useState(0);
  const [upName, setUpName] = useState("");
  const [upExports, setUpExports] = useState<{ id: string; format: string; url: string | null; download_url?: string | null; status: string }[]>([]);
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
  const filterLayersRef = useRef<FilterLayer[]>([]);
  filterLayersRef.current = filterLayers;
  const [bvQ, setBvQ] = useState("");
  const [bvRes, setBvRes] = useState<{ id: string; thumb: string; url: string; alt: string; duration?: number }[]>([]);
  const [bvBusy, setBvBusy] = useState(false);
  const [bvAdding, setBvAdding] = useState(false);
  const overlaysRef = useRef<Overlay[]>([]);
  overlaysRef.current = overlays;
  const [enhanceAudio, setEnhanceAudio] = useState(false);
  const [enhanceStrength, setEnhanceStrength] = useState(50);
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedUrl, setEnhancedUrl] = useState<string | null>(null);
  const [enhanceErr, setEnhanceErr] = useState<string>("");
  async function applyAudioEnhance() {
    setEnhancing(true); setEnhanceErr("");
    try {
      const r = await api.enhanceAudioNow(projectId, enhanceStrength);
      const u = r.url.startsWith("http") ? r.url : api.mediaUrl(r.url);
      setEnhancedUrl(u);
      setEnhanceAudio(true);
    } catch (e: any) {
      setEnhanceErr((e && e.message) ? e.message : "Couldn't clean the audio. Please try again.");
    } finally {
      setEnhancing(false);
    }
  }
  const [styles, setStyles] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [curMs, setCurMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [safeZone, setSafeZone] = useState(false);
  const [clipSelected, setClipSelected] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");
  function sendReport() {
    const body = encodeURIComponent(reportText.trim() + "\n\n— Project: " + (proj?.name || "") + " (" + projectId + ")");
    window.open("mailto:aravindbabu6969@gmail.com?subject=" + encodeURIComponent("ceyonai report") + "&body=" + body, "_blank");
    setReportOpen(false); setReportText("");
  }
  const [exports, setExports] = useState<{ fmt: string; url?: string; status: string; error?: string }[]>([]);
  const [expRes, setExpRes] = useState("auto");   // export resolution: auto|1080|720|480
  const [nleOpen, setNleOpen] = useState(false);  // "Export for Editor" section collapsed by default
  const [expOpen, setExpOpen] = useState(false);  // right-side export panel (HyproAI-style)
  const [expJob, setExpJob] = useState<{ fmt: string; status: "rendering" | "ready" | "error"; pct: number; url?: string; downloadUrl?: string; error?: string; open: boolean } | null>(null);
  const progRef = useRef<number | undefined>(undefined);
  const [rail, setRail] = useState<"uploads" | "captions" | "texts" | "images" | "broll" | "tools" | "retake" | "zoom" | "filters" | "canvas" | "export">("captions");
  const [rightTab, setRightTab] = useState<"styles" | "settings" | "animation">("styles");
  const [capPart, setCapPart] = useState<"top" | "big" | "bottom">("bottom");
  const [topTab, setTopTab] = useState<"video" | "audio" | "text">("text");
  const [playRate, setPlayRate] = useState(1);
  const [audioVol, setAudioVol] = useState(1);
  const VFX_DEFAULT = { opacity: 100, radius: 0, outlineColor: "#000000", outlineSize: 0,
    shadowColor: "#000000", shadowX: 0, shadowY: 0, shadowBlur: 0, blur: 0, anim: "none",
    animIn: "none", animLoop: "none", animOut: "none",
    cropOpen: false, cropT: 0, cropR: 0, cropB: 0, cropL: 0 };
  const [videofx, setVideofx] = useState<any>(VFX_DEFAULT);
  const [animTab, setAnimTab] = useState<"in" | "loop" | "out">("in");
  const [animBoxOpen, setAnimBoxOpen] = useState(false);
  const [animBoxPos, setAnimBoxPos] = useState<{ x: number; y: number } | null>(null);
  const [lineStyleOpen, setLineStyleOpen] = useState(false);
  const [lineStylePos, setLineStylePos] = useState<{ x: number; y: number } | null>(null);
  function startAnimBoxDrag(e: React.MouseEvent) {
    e.preventDefault();
    const start = { mx: e.clientX, my: e.clientY };
    const box = (e.currentTarget as HTMLElement).closest(".ed-animprops") as HTMLElement | null;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const base = { x: r.left, y: r.top };
    const onMove = (ev: MouseEvent) => {
      const nx = Math.max(8, Math.min(window.innerWidth - r.width - 8, base.x + (ev.clientX - start.mx)));
      const ny = Math.max(8, Math.min(window.innerHeight - 60, base.y + (ev.clientY - start.my)));
      setAnimBoxPos({ x: nx, y: ny });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  function startLineStyleDrag(e: React.MouseEvent) {
    e.preventDefault();
    const start = { mx: e.clientX, my: e.clientY };
    const box = (e.currentTarget as HTMLElement).closest(".ed-linestyle") as HTMLElement | null;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const base = { x: r.left, y: r.top };
    const onMove = (ev: MouseEvent) => {
      const nx = Math.max(8, Math.min(window.innerWidth - r.width - 8, base.x + (ev.clientX - start.mx)));
      const ny = Math.max(8, Math.min(window.innerHeight - 60, base.y + (ev.clientY - start.my)));
      setLineStylePos({ x: nx, y: ny });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  const setFx = (patch: any) => setVideofx((v: any) => {
    const n = { ...v, ...patch };
    try { localStorage.setItem("ceyonai:vfx:" + projectId, JSON.stringify(n)); } catch {}
    api.setVideoFx(projectId, n).catch(() => {});
    return n;
  });
  const [density, setDensity] = useState<"compact" | "roomy">("roomy");
  type CueSnap = { start_ms: number; end_ms: number; text: string; translit_text: string | null; line_count: number };
  const [undoStack, setUndoStack] = useState<CueSnap[][]>([]);
  const [redoStack, setRedoStack] = useState<CueSnap[][]>([]);
  const [tlZoom, setTlZoom] = useState(1);
  const [tlFilter, setTlFilter] = useState<"all" | "videos" | "captions">("all");
  const [aiMenu, setAiMenu] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const cuesRef = useRef<Cue[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mediaEl, setMediaEl] = useState<HTMLMediaElement | null>(null);

  const [loadTry, setLoadTry] = useState(0);
  const [loadDiag, setLoadDiag] = useState("");
  const load = useCallback(async (attempt = 0): Promise<void> => {
    setLoadErr(null);
    if (!attempt) { setLoadTry(0); setLoadDiag(""); }
    try {
      const p = await api.getProject(projectId);
      setProj(p); setLoadErr(null); setLoadTry(0);
    } catch (e: any) {
      const msg = String(e?.message || e || "Failed to load project");
      const netFail = /failed to fetch|networkerror|load failed/i.test(msg);
      if (netFail && typeof attempt === "number" && attempt < 4) {
        // the server may be waking from sleep — retry quietly with backoff
        setLoadTry(attempt + 1);
        await new Promise((r) => setTimeout(r, 2500 + attempt * 2500));
        return load(attempt + 1);
      }
      setLoadErr(msg);
      setLoadTry(0);
      if (netFail) {
        try {
          await api.captionStyles();
          setLoadDiag("The ceyonai server IS reachable from this browser, but the project request is being blocked on this computer — usually an antivirus \u2018web protection\u2019 feature or an ad-blocker. ceyonai now retries via an alternate route automatically; if you still see this, open your antivirus\u2019s web-protection settings and allow maxfly-api.onrender.com.");
        } catch {
          setLoadDiag("This browser can't reach the ceyonai server at all. That's usually an ad-blocker / antivirus extension or a network filter blocking maxfly-api.onrender.com. Try an Incognito window (extensions are off there) — if it loads, allow the site in your extension.");
        }
      }
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.captionStyles().then((r) => setStyles(r.styles)).catch(() => {}); }, []);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`ceyonai:proj:${projectId}`) || localStorage.getItem(`maxfly:proj:${projectId}`);
      if (raw) { const p = JSON.parse(raw); if (p.lang) setLang(p.lang); if (p.outputMode) setMode(p.outputMode); }
    } catch {}
  }, [projectId]);

  useEffect(() => { setMediaEl(videoRef.current); }, [proj?.id]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ceyonai:vfx:" + projectId) || localStorage.getItem("maxfly:vfx:" + projectId);
      if (raw) {
        const j = JSON.parse(raw);
        if (j.anim && !j.animIn) j.animIn = j.anim === "slide" ? "slideup" : (j.anim === "zoom" || j.anim === "fade") ? j.anim : "none";
        setVideofx({ ...VFX_DEFAULT, ...j });
      }
    } catch {}
    api.getVideoFx(projectId).then((r) => {
      if (r && Object.keys(r).length) setVideofx((v: any) => ({ ...VFX_DEFAULT, ...v, ...r }));
    }).catch(() => {});
  }, [projectId]);
  useEffect(() => { if (videoRef.current) videoRef.current.muted = mediaMuted; }, [mediaMuted]);
  useEffect(() => { setOverlays(proj?.overlays || []); }, [proj?.id]);
  useEffect(() => { api.listAutozoom(projectId).then(setZooms).catch(() => {}); }, [projectId]);
  useEffect(() => {
    if (rail === "uploads" && upTab === "export") {
      api.listExports(projectId).then((l) => setUpExports(l as any)).catch(() => {});
    }
  }, [rail, upTab, projectId]);
  // --- timeline clip segmentation (HyproAI-style split/delete on the video track) ---
  const [videoCuts, setVideoCuts] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem("ceyonai:vcuts:" + projectId) || "[]"); } catch { return []; }
  });
  const [selSeg, setSelSeg] = useState<number | null>(null);
  const [cutEdits, setCutEdits] = useState<{ id: string; start_ms: number; end_ms: number }[]>([]);
  const [dupEdits, setDupEdits] = useState<{ id: string; start_ms: number; end_ms: number }[]>([]);
  const tl2Ref = useRef<HTMLDivElement | null>(null);
  const [tlBoxW, setTlBoxW] = useState(1000);
  const [tlToast, setTlToast] = useState("");
  const tlToastRef = useRef<number | null>(null);
  const toast = (msg: string) => {
    setTlToast(msg);
    if (tlToastRef.current) window.clearTimeout(tlToastRef.current);
    tlToastRef.current = window.setTimeout(() => setTlToast(""), 2600);
  };
  useEffect(() => {
    api.listEdits(projectId).then((rows: any[]) => {
      const tl = (rows || []).filter((r) => r.enabled && r.payload_json && r.payload_json.source === "timeline");
      setCutEdits(tl.filter((r) => r.type === "manual_cut")
        .map((r) => ({ id: r.id, start_ms: r.payload_json.start_ms, end_ms: r.payload_json.end_ms })));
      setDupEdits(tl.filter((r) => r.type === "dup_span")
        .map((r) => ({ id: r.id, start_ms: r.payload_json.start_ms, end_ms: r.payload_json.end_ms })));
    }).catch(() => {});
  }, [projectId]);
  useEffect(() => {
    const el = tl2Ref.current;
    if (!el) return;
    const upd = () => setTlBoxW(el.clientWidth || 1000);
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [proj?.id]);
  useEffect(() => { api.filterPresets().then((r) => { setFilterList(r.filters); setFilterGroups(r.groups || []); }).catch(() => {}); }, []);
  // The filter thumbnails show a real frame of the user's footage. We fetch it
  // from the backend (ffmpeg extracts one frame) rather than capturing it from
  // the <video> via canvas, because the clip is served cross-origin and a
  // canvas capture would taint and silently fail. The returned data-URL renders
  // in an <img> with CSS grades applied — no CORS/canvas dependency.
  useEffect(() => {
    if (rail !== "filters" || filmFrame) return;
    let cancelled = false;
    api.projectFrame(projectId)
      .then((r) => { if (!cancelled && r.data_url) setFilmFrame(r.data_url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [rail, filmFrame, projectId]);
  useEffect(() => {
    api.getFilter(projectId).then((r) => { setCurFilter(r.name); setAdjust({ brightness: r.brightness, contrast: r.contrast, saturation: r.saturation, warmth: r.warmth }); }).catch(() => {});
    api.listFilterLayers(projectId).then((r) => setFilterLayers(r.layers)).catch(() => {});
    api.listImages(projectId).then(setImages).catch(() => {});
    api.listProjects().then(setMyMedia).catch(() => {});
    api.listBrolls(projectId).then(setBrolls).catch(() => {});
    api.getCaptionSettings(projectId).then((r) => setCapSettings(r || {})).catch(() => {});
    api.getCaptionOverrides(projectId).then((r) => setCapOverrides(r || {})).catch(() => {});
    api.getWordOverrides(projectId).then((r) => setWordOverrides(r || {})).catch(() => {});
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

  // show a default Pexels grid the moment the Videos / Images panel opens,
  // so it's populated like the reference editor (curated photos / popular clips).
  useEffect(() => {
    if (rail === "images" && stockRes.length === 0 && !stockBusy) runStock();
    if (rail === "broll" && bvRes.length === 0 && !bvBusy) runBrollStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rail]);

  if (!proj) {
    if (loadErr) {
      const is401 = /\b401\b|bearer|invalid token/i.test(loadErr);
      return (
        <div className="ed-loading" style={{ flexDirection: "column", gap: 12, textAlign: "center", padding: 24 }}>
          <div style={{ fontWeight: 700 }}>Couldn't load this project</div>
          <div className="muted" style={{ maxWidth: 460, fontSize: 13 }}>
            {is401 ? "Your session may have expired. Please sign in again."
              : (loadDiag || "Something went wrong loading the editor. Check your connection and retry.")}
          </div>
          <div className="muted" style={{ fontSize: 11, opacity: .6 }}>{loadErr}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => load()}>{IcRefresh} Retry</button>
            <button className="secondary" onClick={() => { window.location.hash = "#/app"; }}>Back to projects</button>
          </div>
        </div>
      );
    }
    return (
      <div className="ed-loading muted" style={{ flexDirection: "column", gap: 10, textAlign: "center" }}>
        <div>{loadTry > 0 ? "Waking the ceyonai server…" : "Loading editor…"}</div>
        {loadTry > 0 && <div style={{ fontSize: 12, opacity: .65 }}>The server naps when idle — retrying automatically (attempt {loadTry + 1} of 5)</div>}
      </div>
    );
  }

  const dur = proj.duration_ms || 1;
  const cues = proj.cues || [];
  const activeIdx = cues.find((c) => curMs >= c.start_ms && curMs < c.end_ms)?.idx ?? -1;
  const activeCue = cues.find((c) => c.idx === activeIdx);
  cuesRef.current = cues;
  const lineStyles = styles.filter((x) => !WORD_STYLES.includes(x.id));
  const wordStyles = styles.filter((x) => WORD_STYLES.includes(x.id));
  const overlayText = activeCue ? (showTranslit && activeCue.translit_text ? activeCue.translit_text : activeCue.text) : "";
  // Per-caption + per-word style overrides (Paste-to / Single Words).
  const _cidx = String(activeIdx);
  const effSettings = activeIdx >= 0 ? { ...capSettings, ...(capOverrides[_cidx] || {}) } : capSettings;
  const activeWordOv = wordOverrides[_cidx] || {};
  const activeWords = overlayText ? overlayText.split(/\s+/).filter(Boolean) : [];
  // Apply a preset either to the whole video (global capStyle) or to just the
  // selected caption (stored as a per-caption "style" override).
  function applyPreset(id: string) {
    if (styleScope === "caption" && activeIdx >= 0) {
      const c = _cidx;
      setCapOverrides((pr) => ({ ...pr, [c]: { ...(pr[c] || {}), style: id } }));
      api.setCaptionOverride(projectId, activeIdx, { style: id }).catch(() => {});
    } else {
      setCapStyle(id);
    }
  }
  function clearCaptionPreset() {
    if (activeIdx < 0) return;
    const c = _cidx;
    setCapOverrides((pr) => ({ ...pr, [c]: { ...(pr[c] || {}), style: "" } }));
    api.setCaptionOverride(projectId, activeIdx, { style: "" }).catch(() => {});
  }
    // Apply a whole preset to just the selected caption (used by the Line styling panel).
  function applyCaptionPreset(id: string) {
    if (activeIdx >= 0) {
      const cc = _cidx;
      setCapOverrides((pr) => ({ ...pr, [cc]: { ...(pr[cc] || {}), style: id } }));
      api.setCaptionOverride(projectId, activeIdx, { style: id }).catch(() => {});
    } else {
      setCapStyle(id);
    }
  }
  function copyStyle() { setStyleClip({ ...effSettings }); }
  function pasteStyleTo(scope: "caption" | "all") {
    if (!styleClip) return;
    if (scope === "all") {
      setCapSettings((pr) => ({ ...pr, ...styleClip }));
      api.setCaptionSettings(projectId, styleClip).catch(() => {});
    } else if (activeIdx >= 0) {
      const c = _cidx;
      setCapOverrides((pr) => ({ ...pr, [c]: { ...(pr[c] || {}), ...styleClip } }));
      api.setCaptionOverride(projectId, activeIdx, styleClip).catch(() => {});
    }
  }
  function setWordOv(w: number, patch: Record<string, any>) {
    if (activeIdx < 0) return;
    const c = _cidx;
    setWordOverrides((pr) => {
      const cm = { ...(pr[c] || {}) };
      cm[String(w)] = { ...(cm[String(w)] || {}), ...patch };
      return { ...pr, [c]: cm };
    });
    api.setWordOverride(projectId, activeIdx, w, patch).catch(() => {});
  }
  function clearWordOv(w: number) {
    if (activeIdx < 0) return;
    const c = _cidx;
    setWordOverrides((pr) => {
      const cm = { ...(pr[c] || {}) };
      delete cm[String(w)];
      const next = { ...pr };
      if (Object.keys(cm).length) next[c] = cm; else delete next[c];
      return next;
    });
    api.setWordOverride(projectId, activeIdx, w, {}, true).catch(() => {});
  }
  function startCropDrag(handle: string, e: ReactMouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const parent = (e.currentTarget as HTMLElement).closest(".preview-wrap") as HTMLElement | null;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    let last: any = { ...videofx };
    const move = (ev: MouseEvent) => {
      const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      const patch: any = {};
      if (handle.includes("l")) patch.cropL = Math.round(Math.max(0, Math.min(x, 100 - last.cropR - 8)));
      if (handle.includes("r")) patch.cropR = Math.round(Math.max(0, Math.min(100 - x, 100 - last.cropL - 8)));
      if (handle.includes("t")) patch.cropT = Math.round(Math.max(0, Math.min(y, 100 - last.cropB - 8)));
      if (handle.includes("b")) patch.cropB = Math.round(Math.max(0, Math.min(100 - y, 100 - last.cropT - 8)));
      last = { ...last, ...patch };
      setVideofx((v: any) => ({ ...v, ...patch }));
    };
    const up = () => {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      api.setVideoFx(projectId, { cropT: last.cropT, cropR: last.cropR, cropB: last.cropB, cropL: last.cropL }).catch(() => {});
    };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }
  const selWordSafe = selWord >= 0 && selWord < activeWords.length ? selWord : -1;
  const selWordOv = selWordSafe >= 0 ? (activeWordOv[String(selWordSafe)] || {}) : {};
  const movedWords = activeWords
    .map((w, i) => ({ i, w, wd: activeWordOv[String(i)] as any }))
    .filter((x) => x.wd && x.wd.x != null && x.wd.y != null);
  function startDragWord(e: ReactMouseEvent, i: number) {
    e.preventDefault(); e.stopPropagation();
    setSelWord(i);
    if (activeIdx < 0) return;
    const parent = (e.currentTarget as HTMLElement).offsetParent as HTMLElement | null;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    let lx = 50, ly = 50;
    const c = _cidx;
    const move = (ev: MouseEvent) => {
      lx = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      ly = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      setWordOverrides((pr) => { const cm = { ...(pr[c] || {}) }; cm[String(i)] = { ...(cm[String(i)] || {}), x: lx, y: ly }; return { ...pr, [c]: cm }; });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      api.setWordOverride(projectId, activeIdx, i, { x: lx, y: ly }).catch(() => {});
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }
  const capOvStyle = activeIdx >= 0 ? ((capOverrides[_cidx] || {}) as any).style : undefined;
  const effStyle = capOvStyle || (animOn ? capStyle : "classic");
  const activeStyleId = (styleScope === "caption" && capOvStyle) ? capOvStyle : capStyle;
  const _resMul = expRes === "1080" ? 1.6 : expRes === "720" ? 1.1 : expRes === "480" ? 0.8 : 1.2;
  const _estSec = Math.round((dur / 1000) * _resMul + 12);
  const estText = _estSec <= 75 ? "Estimated time: under a minute" : `Estimated time: about ${Math.round(_estSec / 60)} min (based on video length)`;
  const activeLayer = filterLayers.find((l) => curMs >= l.start_ms && curMs < l.end_ms);
  const filterPreviewCss = selLayer
    ? cssForFilter(curFilter, adjust)
    : activeLayer ? cssForFilter(activeLayer.name, activeLayer) : cssForFilter(curFilter, adjust);
  const _grade = hiddenTracks.has("filters") ? "" : filterPreviewCss;
  const _fparts: string[] = [];
  if (_grade) _fparts.push(_grade);
  if (videofx.blur) _fparts.push(`blur(${(videofx.blur * 0.12).toFixed(1)}px)`);
  if (videofx.shadowBlur || videofx.shadowX || videofx.shadowY)
    _fparts.push(`drop-shadow(${videofx.shadowX}px ${videofx.shadowY}px ${Math.max(0, videofx.shadowBlur)}px ${videofx.shadowColor})`);
  const _vanim = [VFX_ANIM_LOOP[videofx.animLoop || "none"], VFX_ANIM_IN[videofx.animIn || "none"]].filter(Boolean).join(", ");
  const _gradeLayer = filterLayers.find((l) => curMs >= l.start_ms && curMs < l.end_ms);
  const _gradeCss = _gradeLayer
    ? cssForFilter(_gradeLayer.name, _gradeLayer)
    : cssForFilter(curFilter, adjust);
  const videoFxStyle: React.CSSProperties = {
    filter: [_fparts.join(" "), _gradeCss].filter(Boolean).join(" ") || undefined,
    animation: _vanim || undefined,
    opacity: videofx.opacity / 100,
    borderRadius: videofx.radius ? (videofx.radius / 2) + "%" : undefined,
    boxShadow: videofx.outlineSize ? `0 0 0 ${videofx.outlineSize}px ${videofx.outlineColor}` : undefined,
    clipPath: (videofx.cropT || videofx.cropR || videofx.cropB || videofx.cropL)
      ? `inset(${videofx.cropT}% ${videofx.cropR}% ${videofx.cropB}% ${videofx.cropL}%)` : undefined,
  };
  const selZoom = zooms.find((z) => z.id === selZoomId) || null;
  const contentZoomOn = zoomOn && !selZoomId;
  const contentZooms = useMemo(
    () => (zoomOn ? zooms.filter((z) => z.enabled !== false) : []),
    [zooms, zoomOn]
  );
  const isHidden = (t: string) => hiddenTracks.has(t);
  const isLocked = (t: string) => lockedTracks.has(t);
  const toggleHide = (t: string) => setHiddenTracks((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const toggleLock = (t: string) => setLockedTracks((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const trackHead = (id: string, media = false) => (
    <div className={"ed-th" + (media ? " ed-th-media" : "") + (isHidden(id) ? " thoff" : "")}>
      <span className="ed-th-type">{IcType[id]}</span>
      <button className={"ed-th-b" + (isHidden(id) ? " off" : "")} title={isHidden(id) ? "Show track" : "Hide track"}
        onClick={(e) => { e.stopPropagation(); toggleHide(id); }}>{IcEye(!isHidden(id))}</button>
      <button className={"ed-th-b" + (isLocked(id) ? " on" : "")} title={isLocked(id) ? "Unlock track" : "Lock track"}
        onClick={(e) => { e.stopPropagation(); toggleLock(id); }}>{IcLock(isLocked(id))}</button>
      {media && (
        <button className={"ed-th-b" + (mediaMuted ? " on" : "")} title={mediaMuted ? "Unmute" : "Mute"}
          onClick={(e) => { e.stopPropagation(); setMediaMuted((m) => !m); }}>{IcVol(mediaMuted)}</button>
      )}
    </div>
  );
  const wordMode = WORD_STYLES.includes(capStyle);
  const mediaSrc = proj.media_url ? (proj.media_url.startsWith("http") ? proj.media_url : api.mediaUrl(proj.media_url)) : "";

  const TLW = Math.max(320, tlBoxW - 2) * tlZoom;   // zoom 1 = whole video fits the visible timeline
  const tlStep = dur <= 20000 ? 2000 : dur <= 60000 ? 5000 : dur <= 180000 ? 15000 : 30000;
  const tlTicks: number[] = [];
  for (let t = 0; t <= dur; t += tlStep) tlTicks.push(t);
  function scrub(e: ReactMouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pct * dur);
  }
  function seek(ms: number) { if (videoRef.current) videoRef.current.currentTime = ms / 1000; }
  const segBounds = [0, ...videoCuts.filter((c) => c > 0 && c < dur).sort((a, b) => a - b), dur];
  function saveVideoCuts(next: number[]) {
    const arr = [...next].sort((a, b) => a - b).filter((v, i, a2) => v > 200 && v < dur - 200 && (i === 0 || v - a2[i - 1] > 200));
    setVideoCuts(arr);
    try { localStorage.setItem("ceyonai:vcuts:" + projectId, JSON.stringify(arr)); } catch {}
  }
  function splitAction() {
    if (selSeg == null) {
      const t = targetCueIdx();
      if (t >= 0) { splitAt(t); toast("Caption split at " + fmtT(curMs)); return; }
    }
    const at = Math.round(curMs);
    if (at <= 200 || at >= dur - 200) { toast("Move the playhead into the clip, then press Split"); return; }
    if (videoCuts.some((c) => Math.abs(c - at) < 200)) { toast("Already split here"); return; }
    saveVideoCuts([...videoCuts, at]);
    const crossing = dupEdits.filter((d) => d.start_ms < at - 60 && d.end_ms > at + 60);
    crossing.forEach((d) => { api.deleteEdit(projectId, d.id).catch(() => {}); });
    if (crossing.length) setDupEdits((p) => p.filter((d) => !crossing.some((x) => x.id === d.id)));
    setSelSeg(null);
    toast("Clip split at " + fmtT(at));
  }
  function duplicateAction() {
    if (selSeg != null) {
      const s0 = Math.round(segBounds[selSeg]), e0 = Math.round(segBounds[selSeg + 1]);
      if (cutEdits.some((c) => c.start_ms <= s0 + 60 && c.end_ms >= e0 - 60)) {
        toast("Restore this segment before duplicating it"); return;
      }
      api.addEdit(projectId, "dup_span", { start_ms: s0, end_ms: e0, source: "timeline" })
        .then((r) => {
          setDupEdits((p) => {
            const next = [...p, { id: r.id, start_ms: s0, end_ms: e0 }];
            const n = 1 + next.filter((d) => d.start_ms >= s0 - 60 && d.end_ms <= e0 + 60).length;
            toast("Segment duplicated — plays \u00d7" + n + " in the export");
            return next;
          });
        })
        .catch(() => toast("Couldn't duplicate the segment — try again"));
      return;
    }
    const t = targetCueIdx();
    if (t >= 0) { duplicateCap(t); toast("Caption duplicated"); }
    else toast("Select a caption or a clip segment to duplicate");
  }
  async function removeDup(d: { id: string; start_ms: number; end_ms: number }) {
    try { await api.deleteEdit(projectId, d.id); setDupEdits((p) => p.filter((x) => x.id !== d.id)); toast("Removed one copy"); } catch {}
  }
  async function deleteAction() {
    if (selSeg != null) {
      const s0 = Math.round(segBounds[selSeg]), e0 = Math.round(segBounds[selSeg + 1]);
      if (e0 - s0 >= dur - 400) { toast("Can't remove the whole clip — split it first"); return; }
      try {
        const r = await api.addEdit(projectId, "manual_cut", { start_ms: s0, end_ms: e0, source: "timeline" });
        setCutEdits((p) => [...p, { id: r.id, start_ms: s0, end_ms: e0 }]);
        const inside = dupEdits.filter((d) => d.start_ms >= s0 - 60 && d.end_ms <= e0 + 60);
        inside.forEach((d) => { api.deleteEdit(projectId, d.id).catch(() => {}); });
        if (inside.length) setDupEdits((p) => p.filter((d) => !inside.some((x) => x.id === d.id)));
        setSelSeg(null);
        toast("Segment removed — it will be cut from the export");
      } catch { toast("Couldn't remove the segment — try again"); }
      return;
    }
    if (selOv) { delText(selOv); toast("Text deleted"); return; }
    if (selImg) { delImg(selImg); toast("Image deleted"); return; }
    if (selBroll) { delBroll(selBroll); toast("B-roll deleted"); return; }
    if (selected.size) { const n = selected.size; bulkDelete(); toast("Deleted " + n + " caption" + (n > 1 ? "s" : "")); return; }
    const t = targetCueIdx();
    if (t >= 0) { deleteOne(t); toast("Caption deleted"); }
    else toast("Select a caption, text, image or clip segment first");
  }
  async function restoreCut(editId: string) {
    try { await api.deleteEdit(projectId, editId); setCutEdits((p) => p.filter((c) => c.id !== editId)); toast("Segment restored"); } catch {}
  }
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
    return -1;
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
    const at = Math.max(0, Math.min(Math.round(curMs), Math.max(0, dur - 1000)));
    const end = Math.min(dur, at + 4000);
    const o = await api.addOverlay(projectId, { text: "Your text", start_ms: at, end_ms: end,
      x_pct: 50, y_pct: 42, font_size: 72, color: "#ffffff", bold: true });
    setOverlays((prev) => [...prev, o]);
    setSelOv(o.id);
    setRail("texts");
    seek(at + 50);   // move the playhead onto the text so it shows immediately
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
  function exBeep() {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const a = new AC(); const osc = a.createOscillator(); const g = a.createGain();
      osc.connect(g); g.connect(a.destination); osc.type = "sine"; osc.frequency.value = 880; g.gain.value = 0.05;
      osc.start(); setTimeout(() => { try { osc.stop(); a.close(); } catch {} }, 180);
    } catch { /* no sound available */ }
  }
  async function doExport(fmt: string, resolution = "auto") {
    const style = animOn ? capStyle : "classic";
    upsertExport(fmt, { status: "processing" });
    setExpJob({ fmt, status: "rendering", pct: 0, open: true });
    if (progRef.current) window.clearInterval(progRef.current);
    // smooth simulated progress toward ~92% while the server renders
    progRef.current = window.setInterval(() => {
      setExpJob((j) => (j && j.status === "rendering" ? { ...j, pct: Math.min(92, j.pct + Math.max(1, (92 - j.pct) * 0.08)) } : j));
    }, 700);
    try {
      const r = await api.exportSub(projectId, fmt, showTranslit, true, style, enhanceAudio, audioVol, playRate, enhanceStrength, resolution);
      const eid = r.export_id;
      for (let i = 0; i < 160; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        const list = await api.listExports(projectId);
        const row = list.find((x) => x.id === eid);
        if (row && row.status !== "processing") {
          if (progRef.current) window.clearInterval(progRef.current);
          if (row.status === "ready" && row.url) {
            upsertExport(fmt, { url: row.url, status: "ready" });
            setExpJob({ fmt, status: "ready", pct: 100, url: row.url, downloadUrl: (row as any).download_url || row.url, open: true });
            exBeep();
          } else {
            upsertExport(fmt, { status: "error", error: row.error || undefined });
            setExpJob({ fmt, status: "error", pct: 0, error: row.error || "Export failed", open: true });
          }
          return;
        }
      }
      if (progRef.current) window.clearInterval(progRef.current);
      upsertExport(fmt, { status: "error" });
      setExpJob({ fmt, status: "error", pct: 0, error: "Timed out — please try again.", open: true });
    } catch (e: any) {
      if (progRef.current) window.clearInterval(progRef.current);
      upsertExport(fmt, { status: "error" });
      setExpJob({ fmt, status: "error", pct: 0, error: String(e?.message || e), open: true });
    }
  }

  const ZOOM_SPEED: Record<string, number> = { fast: 0.15, medium: 0.35, slow: 0.70 };
  const speedLabel = (sec: number) => (sec <= 0.22 ? "fast" : sec >= 0.55 ? "slow" : "medium");
  const zoomStrengthPct = (z: Zoom) => Math.round((z.scale - 1) * 100);

  async function generateZoom() {
    setZoomBusy(true);
    setZoomProg("Finding moments\u2026");
    const flip = window.setTimeout(() => setZoomProg("Focusing on the subject\u2026"), 800);
    try {
      const r = await api.generateAutozoom(projectId, zoomDensity);
      setZooms(r.zooms);
      setSelZoomId(null);
      setZoomOn(true);
      toast(`Found ${r.count} moment${r.count === 1 ? "" : "s"} \u2014 preview, then aim.`);
    } catch (e: any) { toast("Auto zoom failed: " + e.message); }
    finally { window.clearTimeout(flip); setZoomProg(""); setZoomBusy(false); }
  }
  async function addZoomHere() {
    const s0 = Math.round(curMs);
    const end = Math.min(dur || s0 + 2000, s0 + 2000);
    try {
      const z = await api.addZoom(projectId, s0, end, "medium");
      setZooms((prev) => [...prev, z]);
      setSelZoomId(z.id);
      setZoomAdvOpen(false);
    } catch (e: any) { toast("Could not add zoom: " + e.message); }
  }
  async function clearZoom() {
    await api.clearAutozoom(projectId);
    setZooms([]); setSelZoomId(null);
  }
  async function delZoom(id: string) {
    setZooms((prev) => prev.filter((z) => z.id !== id));
    if (selZoomId === id) setSelZoomId(null);
    try { await api.deleteEdit(projectId, id); } catch {}
  }
  function patchZoomLocal(id: string, patch: Partial<Zoom>) {
    setZooms((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  }
  async function commitZoom(id: string, patch: Partial<Zoom>) {
    patchZoomLocal(id, patch);
    try { const z = await api.patchZoom(projectId, id, patch); patchZoomLocal(id, z); } catch {}
  }
  function setZoomStrength(id: string, st: "subtle" | "medium" | "strong") {
    const scale = st === "subtle" ? 1.10 : st === "strong" ? 1.35 : 1.20;
    commitZoom(id, { strength: st, scale });
  }
  function setZoomSpeed(id: string, which: "ease_in" | "ease_out", label: string) {
    commitZoom(id, { [which]: ZOOM_SPEED[label] } as Partial<Zoom>);
  }
  function setZoomDuration(id: string, ms: number) {
    const z = zooms.find((x) => x.id === id); if (!z) return;
    commitZoom(id, { end_ms: z.start_ms + Math.max(400, Math.round(ms)) });
  }
  function revertZoom(id: string) {
    commitZoom(id, { strength: "medium", scale: 1.20, fx: 0.5, fy: 0.5, ease_in: 0.35, ease_out: 0.35 });
  }
  async function toggleZoomMaster() {
    const next = !zoomOn;
    setZoomOn(next);
    setZooms((prev) => prev.map((z) => ({ ...z, enabled: next })));
    for (const z of zooms) { try { await api.patchZoom(projectId, z.id, { enabled: next }); } catch {} }
  }
  function startZoomAim(e: ReactMouseEvent, id: string) {
    e.preventDefault(); e.stopPropagation();
    const wrap = (e.currentTarget as HTMLElement).closest(".preview-wrap") as HTMLElement | null;
    if (!wrap) return;
    const z0 = zooms.find((x) => x.id === id); if (!z0) return;
    const half = 0.5 / Math.max(1.05, z0.scale);
    let last = { fx: z0.fx, fy: z0.fy };
    const move = (ev: MouseEvent) => {
      const r = wrap.getBoundingClientRect();
      let fx = (ev.clientX - r.left) / r.width;
      let fy = (ev.clientY - r.top) / r.height;
      fx = Math.max(half, Math.min(1 - half, fx));
      fy = Math.max(half, Math.min(1 - half, fy));
      last = { fx, fy };
      patchZoomLocal(id, last);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      api.patchZoom(projectId, id, last).catch(() => {});
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
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

  function patchLayerLocal(id: string, patch: Partial<FilterLayer>) {
    setFilterLayers((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));
  }
  // Tap a grade card -> drop a filter clip on the timeline (HyproAI-style).
  async function addFilterClip(name: string) {
    let start = Math.round(curMs);
    let end = start + 3000;
    if (end > dur) { end = dur; start = Math.max(0, dur - 3000); }
    if (end <= start) { start = 0; end = Math.min(dur, 3000); }
    try {
      const l = await api.addFilterLayer(projectId, { name, brightness: 0, contrast: 0, saturation: 0, warmth: 0, start_ms: start, end_ms: end });
      setFilterLayers((prev) => [...prev, l]);
      selectLayer(l.id, l);
      toast("Filter added \u2014 drag it on the timeline to set when it applies");
    } catch {}
  }
  // Drag a filter clip to move it, or drag its edges to stretch it.
  function startFilterClip(e: ReactMouseEvent, l: FilterLayer, mode: "move" | "left" | "right") {
    e.preventDefault(); e.stopPropagation();
    setRail("filters"); selectLayer(l.id);
    const lane = (e.currentTarget as HTMLElement).closest(".ed-lane") as HTMLElement | null;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const startX = e.clientX;
    const s0 = l.start_ms, e0 = l.end_ms;
    const MIN = 300;
    const move = (ev: MouseEvent) => {
      const dMs = ((ev.clientX - startX) / rect.width) * dur;
      let ns = s0, ne = e0;
      if (mode === "move") {
        ns = s0 + dMs; ne = e0 + dMs;
        if (ns < 0) { ne -= ns; ns = 0; }
        if (ne > dur) { ns -= (ne - dur); ne = dur; }
      } else if (mode === "left") {
        ns = Math.min(e0 - MIN, Math.max(0, s0 + dMs));
      } else {
        ne = Math.max(s0 + MIN, Math.min(dur, e0 + dMs));
      }
      patchLayerLocal(l.id, { start_ms: Math.round(ns), end_ms: Math.round(ne) });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const cur = filterLayersRef.current.find((x) => x.id === l.id);
      if (cur) api.patchFilterLayer(projectId, l.id, { start_ms: cur.start_ms, end_ms: cur.end_ms }).catch(() => {});
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  // ---- Caption tools: emphasis word highlighted across all captions ----
  function applyEmphasis() {
    const w = emphasisDraft.trim();
    saveCapSetting({ emphasis: w });
  }
  function clearEmphasis() {
    setEmphasisDraft("");
    saveCapSetting({ emphasis: "" });
  }
  function autoPickEmphasis() {
    const freq: Record<string, number> = {};
    cues.forEach((c) => (c.text || "").split(/\s+/).forEach((w) => {
      const k = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      if (k.length >= 4) freq[k] = (freq[k] || 0) + 1;
    }));
    let best = "", bestScore = 0;
    Object.entries(freq).forEach(([k, n]) => {
      const score = n * 10 + k.length;
      if (score > bestScore) { bestScore = score; best = k; }
    });
    if (best) { setEmphasisDraft(best); saveCapSetting({ emphasis: best }); }
  }
  async function uploadNewVideo(file: File) {
    setUpBusy(true); setUpName(file.name); setUpPct(0);
    try {
      const np = await api.uploadWithProgress(file, (p) => setUpPct(p));
      try { await api.transcribe(np.id, "ta-IN", "translit"); } catch {}
      window.location.hash = `#/project/${np.id}`;
    } catch (e: any) { alert("Upload failed: " + (e?.message || "")); }
    finally { setUpBusy(false); setUpName(""); }
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
  // per-part (Top line / Big word / Bottom line) caption-settings accessors.
  // Bottom line writes the flat keys the export + live preview consume; the
  // other parts write prefixed keys reflected in the live preview.
  const partPrefix = capPart === "bottom" ? "" : capPart + "_";
  function pget(base: string, dflt: any) {
    const v = (capSettings as any)[partPrefix + base];
    return v === undefined || v === null ? dflt : v;
  }
  function pset(base: string, val: any) { saveCapSetting({ [partPrefix + base]: val }); }
  function resetCapSettings() {
    setCapSettings({});
    api.setCaptionSettings(projectId, { font: "", bold: null, spacing: 0, glow: false,
      anim_enabled: true, anim: "", speed: 1, scope: "caption" }).catch(() => {});
  }
  async function runStock() {
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

  // Drag / trim a B-roll clip ON THE TIMELINE (move whole clip, or trim an edge).
  function startBrollClip(e: ReactMouseEvent, b: BrollClip, mode: "move" | "left" | "right") {
    e.preventDefault(); e.stopPropagation();
    setSelBroll(b.id); setSelOv(null); setSelImg(null); setRail("broll");
    const lane = (e.currentTarget as HTMLElement).closest(".ed-lane") as HTMLElement | null;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const startX = e.clientX;
    const s0 = b.start_ms, e0 = b.end_ms;
    const MIN = 300;
    const move = (ev: MouseEvent) => {
      const dMs = ((ev.clientX - startX) / rect.width) * dur;
      let ns = s0, ne = e0;
      if (mode === "move") {
        ns = s0 + dMs; ne = e0 + dMs;
        if (ns < 0) { ne -= ns; ns = 0; }
        if (ne > dur) { ns -= (ne - dur); ne = dur; }
      } else if (mode === "left") {
        ns = Math.min(e0 - MIN, Math.max(0, s0 + dMs));
      } else {
        ne = Math.max(s0 + MIN, Math.min(dur, e0 + dMs));
      }
      patchBrollLocal(b.id, { start_ms: Math.round(ns), end_ms: Math.round(ne) });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const cur = brollsRef.current.find((v) => v.id === b.id);
      if (cur) api.updateBroll(projectId, b.id, { start_ms: cur.start_ms, end_ms: cur.end_ms }).catch(() => {});
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
          <span className="ed-play-logo">{IcPlayS}</span>
        </div>
        <div className="ed-title">{proj.name}</div>
        <div className="ed-top-r">
          <button className="ed-hdr-ic" title="Keyboard shortcuts">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h0M10 10h0M14 10h0M18 10h0M6 14h0M18 14h0M9 14h6" /></svg>
          </button>
          <button className="ed-hdr-pill ed-hdr-help" title="How it works">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M9.6 9.2a2.4 2.4 0 1 1 3.2 2.2c-.6.3-.9.8-.9 1.4v.3" /><path d="M12 17h0" /></svg>
            <span>How it works</span>
          </button>
          <button className="ed-hdr-pill ed-hdr-report" title="Report an issue" onClick={() => setReportOpen(true)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V4M4 4h13l-2 4 2 4H4" /></svg>
            <span>Report</span>
          </button>
          <div className="ed-hdr-meta">
            <span className="ed-hdr-dur" title={`${(dur / 60000).toFixed(1)} of 5 minutes`}>
              <i /> {(dur / 60000).toFixed(1)} min
              <span className="ed-hdr-track" style={{ background: `linear-gradient(90deg, var(--accent) ${Math.min(100, (dur / 60000) / 5 * 100)}%, var(--border) ${Math.min(100, (dur / 60000) / 5 * 100)}%)` }} />
            </span>
            <span className="ed-hdr-size" title={`${proj.size_bytes ? Math.max(1, Math.round(proj.size_bytes / 1048576)) : 0} MB of 5.0 GB storage`}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><path d="M7 7.5h0M7 16.5h0" /></svg>
              {proj.size_bytes ? Math.max(1, Math.round(proj.size_bytes / 1048576)) : 0} MB / 5.0 GB
            </span>
          </div>
          <div className="ed-export-wrap">
            <button className="ed-export" onClick={() => setExpOpen((v) => !v)}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v10" /><path d="M8 9l4 4 4-4" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
              Export
            </button>
          </div>
        </div>
      </div>

      {upModal && (
        <div className="ed-modal-back" onClick={() => setUpModal(false)}>
          <div className="ml-upmodal" onClick={(e) => e.stopPropagation()}>
            <div className="ml-upmodal-h"><span>Upload media</span>
              <button className="ed-report-x" title="Close" onClick={() => setUpModal(false)}>×</button></div>
            <div className={"ml-dropzone" + (upDrag ? " drag" : "")}
              onDragOver={(e) => { e.preventDefault(); setUpDrag(true); }}
              onDragLeave={() => setUpDrag(false)}
              onDrop={(e) => { e.preventDefault(); setUpDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setUpFile(f); }}>
              <div className="ml-dropzone-ic">{IcTrayUp}</div>
              {upFile ? <p className="ml-dropzone-file">{upFile.name}</p> : <p>Drag and drop files here, or</p>}
              <button className="ml-browse" onClick={() => upInputRef.current?.click()}>browse files</button>
            </div>
            <div className="ml-upmodal-f">
              <button className="ml-cancel" onClick={() => setUpModal(false)}>Cancel</button>
              <button className="ml-upload" disabled={!upFile}
                onClick={() => { if (upFile) { const f = upFile; setUpModal(false); setUpFile(null); uploadNewVideo(f); } }}>Upload</button>
            </div>
          </div>
        </div>
      )}
      {reportOpen && (
        <div className="ed-modal-back" onClick={() => setReportOpen(false)}>
          <div className="ed-report" onClick={(e) => e.stopPropagation()}>
            <div className="ed-report-h">
              <span>Report an issue</span>
              <button className="ed-report-x" onClick={() => setReportOpen(false)}>×</button>
            </div>
            <p className="np-sub" style={{ margin: "0 0 12px" }}>Tell us what went wrong and we'll take a look.</p>
            <textarea className="ed-report-ta" value={reportText} onChange={(e) => setReportText(e.target.value)}
              placeholder="Describe the issue — what happened, what you expected…" />
            <div className="ed-report-f">
              <button className="secondary" onClick={() => setReportOpen(false)}>Cancel</button>
              <button className="ed-report-send" disabled={!reportText.trim()} onClick={sendReport}>Send report</button>
            </div>
          </div>
        </div>
      )}

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
                <div className={"ml-tab2" + (upTab === "import" ? " active" : "")} onClick={() => setUpTab("import")}>{IcTrayUp} Import</div>
                <div className={"ml-tab2" + (upTab === "export" ? " active" : "")} onClick={() => setUpTab("export")}>{IcTrayDown} Export</div>
              </div>
              <input ref={upInputRef} type="file" accept="video/*,audio/*" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setUpFile(f); e.currentTarget.value = ""; }} />
              {upTab === "import" ? (
                <>
                  <button className="ml-import" onClick={() => { setUpFile(null); setUpModal(true); }} disabled={upBusy}>
                    {IcTrayUp} Import
                  </button>
                  {upBusy && (
                    <div className="ml-uploading">
                      <div className="ml-uploading-h"><span className="ml-spin" aria-hidden /> UPLOADING</div>
                      <div className="ml-uploading-row"><span className="ml-uploading-name">{upName}</span><span className="ml-uploading-pct">{upPct}%</span></div>
                      <div className="ml-uploading-bar"><i style={{ width: upPct + "%" }} /></div>
                    </div>
                  )}
                  {myMedia.length === 0 && !upBusy ? (
                    <div className="ml-empty2">
                      <div className="ml-empty2-ic">{IcFileMedia}</div>
                      <p>No media yet. Click <span className="ml-link" onClick={() => { setUpFile(null); setUpModal(true); }}>Import</span> to add videos, images, or audio.</p>
                    </div>
                  ) : (
                    <div className="ed-up-list">
                      {myMedia.map((m) => (
                        <div key={m.id} className={"ed-up-item" + (m.id === projectId ? " active" : "")}
                          onClick={() => { if (m.id !== projectId) window.location.hash = `#/project/${m.id}`; }}>
                          <div className="ed-up-thumb">{IcFilm2}</div>
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
                  <button className="ml-import" onClick={() => setExpOpen(true)}>{IcTrayDown} Export this project</button>
                  {upExports.filter((x) => x.status === "ready").length === 0 ? (
                    <div className="ml-empty2">
                      <div className="ml-empty2-ic">{IcFilm2}</div>
                      <p>No exports yet. Render a video and it will appear here for download.</p>
                    </div>
                  ) : (
                    <div className="ed-up-list">
                      {upExports.filter((x) => x.status === "ready").map((x) => (
                        <a key={x.id} className="ed-up-item ml-exp-row" href={api.mediaUrl(x.download_url || x.url || "")} download>
                          <div className="ed-up-thumb">{IcTrayDown}</div>
                          <div className="ed-up-meta">
                            <div className="ed-up-name">{(proj.name || "export") + "." + x.format}</div>
                            <div className="np-sub">Ready — click to download</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
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
              {cues.length > 0 && (
                <div className="ed-captools-wrap">
                  <button className={"ed-captools-btn" + (capToolsOpen ? " open" : "")}
                    onClick={() => { setEmphasisDraft(capSettings.emphasis || ""); setCapToolsOpen((o) => !o); }}>
                    <span>⚒ Caption tools</span><span className="ed-ct-chev">⌄</span>
                  </button>
                  {capToolsOpen && (
                    <div className="ed-captools-pop">
                      <div className="ed-ct-sec">EMPHASIS</div>
                      <div className="np-sub">Highlights this word in all {cues.length} captions</div>
                      <div className="ed-ct-emph">
                        <input placeholder="Type a word, press Enter" value={emphasisDraft}
                          onChange={(e) => setEmphasisDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyEmphasis(); } }} />
                        <button onClick={applyEmphasis}>Apply</button>
                      </div>
                      {capSettings.emphasis ? (
                        <div className="ed-ct-cur">Emphasizing <b>{capSettings.emphasis}</b>
                          <button className="linkbtn" onClick={clearEmphasis}>clear</button></div>
                      ) : null}
                      <div className="ed-ct-sec">ACTIONS</div>
                      <div className="ed-ct-action" onClick={autoPickEmphasis}>
                        <div className="ed-ct-ic">{IcAI}</div>
                        <div><div className="ed-ct-a-title">Auto-pick emphasis</div>
                          <div className="np-sub">Pick the standout word — the one repeated most, or the longest.</div></div>
                      </div>
                      <div className="ed-ct-action" onClick={() => { if (!transcribing) { runTranscribe(); setCapToolsOpen(false); } }}>
                        <div className="ed-ct-ic">{IcRefresh}</div>
                        <div><div className="ed-ct-a-title">Regenerate captions</div>
                          <div className="np-sub">Create the captions again from the audio.</div></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
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
                  <button className="ed-bulk-del" onClick={bulkDelete}>{IcTrash} Delete selected</button>
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
                        <button title="Split at playhead" onClick={() => splitAt(c.idx)}>{IcSplit}</button>
                        <button title="Merge with next" onClick={() => mergeNext(c.idx)} disabled={c.idx >= cues.length - 1}>⤵</button>
                        <button title="Delete" className="del" onClick={() => deleteOne(c.idx)}>{IcTrash}</button>
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
                      onClick={() => { setSelOv(o.id); seek(o.start_ms + 50); }}>
                      <div className="ed-txt-row">
                        <div className="ed-txt-preview" style={{ color: o.color, fontWeight: o.bold ? 800 : 500 }}>{o.text || "(empty)"}</div>
                        <button className="ed-txt-x" title="Delete" onClick={(e) => { e.stopPropagation(); delText(o.id); }}>{IcTrash}</button>
                      </div>
                      <div className="np-sub">{fmtT(o.start_ms)} – {fmtT(o.end_ms)}</div>
                    </div>
                  ))}
                </div>
              )}
              {overlays.length > 0 && (
                <div className="np-sub" style={{ marginTop: 12, lineHeight: 1.5 }}>
                  Click a text on the video (or in the list) to edit its font, colour, animation, outline &amp; shadow in the <b>Text</b> panel on the right. Drag it on the video to reposition; delete it from the timeline or the toolbar 🗑.
                </div>
              )}
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
                <button className="ed-stock-go" onClick={runStock} disabled={stockBusy}>{stockBusy ? "…" : IcSearch}</button>
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
                {imgBusy ? "Uploading…" : <>{IcPlus} Upload image</>}
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
                    <button className="ed-bulk-del" style={{ width: "100%", marginTop: 12 }} onClick={() => delImg(im.id)}>{IcTrash} Delete image</button>
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
                <button className="ed-stock-go" onClick={runBrollStock} disabled={bvBusy}>{bvBusy ? "…" : IcSearch}</button>
              </div>
              {bvAdding && <div className="np-sub" style={{ marginBottom: 10 }}>Downloading clip…</div>}
              {bvRes.length > 0 && (
                <div className="ed-stock-grid ed-stock-grid-2">
                  {bvRes.map((r) => (
                    <div key={r.id} className="ed-vid-thumb" onClick={() => addBrollStock(r.url, r.duration)}>
                      <img src={r.thumb} loading="lazy" />
                      <span className="ed-vid-play">{IcPlayS}</span>
                      {r.duration ? <span className="ed-vid-dur">{r.duration}s</span> : null}
                    </div>
                  ))}
                </div>
              )}
              <input ref={brollInputRef} type="file" accept="video/*" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBroll(f); e.currentTarget.value = ""; }} />
              <button style={{ width: "100%" }} onClick={pickBroll} disabled={brollBusy}>
                {brollBusy ? "Uploading…" : <>{IcPlus} Upload B-roll clip</>}
              </button>
              {brolls.length === 0 ? (
                <div className="ed-cap-empty" style={{ paddingTop: 18 }}>No B-roll yet.</div>
              ) : (
                <div className="ed-txt-list">
                  {brolls.map((b) => (
                    <div key={b.id} className={"ed-txt-item" + (selBroll === b.id ? " active" : "")}
                      onClick={() => { setSelBroll(b.id); seek(b.start_ms); }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div className="ed-broll-badge">{IcFilm2}</div>
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
                    <button className="ed-bulk-del" style={{ width: "100%", marginTop: 12 }} onClick={() => delBroll(b.id)}>{IcTrash} Delete B-roll</button>
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
                <Dropdown value={lang} searchable placeholder="Select language"
                  options={LANGS.map(([v, l]) => ({ value: v, label: l }))}
                  onChange={setLang} />
                <div className="np-label" style={{ marginTop: 10 }}>Mode</div>
                <Dropdown value={mode} onChange={setMode} options={[
                  { value: "transcribe", label: "Native Script", sub: "Original language script" },
                  { value: "translit", label: "Romanized (Thanglish)", sub: "Latin script transliteration" },
                  { value: "codemix", label: "Code-mix", sub: "Mixed native + Latin" },
                  { value: "translate", label: "English Translation", sub: "Translated to English" },
                ]} />
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
              <div className="ed-az-head">
                <h3>Auto Zoom <span className="ed-az-beta">Beta</span></h3>
                <button className={"ed-az-toggle" + (zoomOn ? " on" : "")} role="switch" aria-checked={zoomOn}
                  title={zoomOn ? "Auto Zoom on" : "Auto Zoom off"} onClick={toggleZoomMaster}><i /></button>
              </div>
              <div className="ed-hint-box">Punch-in zooms that keep the edit lively. Detect them automatically or drop your own, then drag the dot on the preview to aim each one. They play live here and bake into the MP4.</div>

              <div className="ed-anim-lbl">HOW MANY</div>
              <div className="ed-seg-row">
                {(["fewer", "balanced", "more"] as const).map((d) => (
                  <div key={d} className={"ed-seg-btn" + (zoomDensity === d ? " active" : "")}
                    onClick={() => setZoomDensity(d)}>{d[0].toUpperCase() + d.slice(1)}</div>
                ))}
              </div>

              <button style={{ width: "100%", marginTop: 14 }} onClick={generateZoom} disabled={zoomBusy}>
                {zoomBusy ? (zoomProg || "Working…") : <>{IcAI} Auto-detect zooms</>}
              </button>
              <button className="secondary" style={{ width: "100%", marginTop: 8 }} onClick={addZoomHere}>+ Add a zoom</button>

              <div className="ed-az-listhd">
                <span>ZOOMS · {zooms.length}</span>
                {zooms.length > 0 && <button className="ed-az-clear" onClick={clearZoom}>Clear all</button>}
              </div>

              {zooms.length === 0 ? (
                <div className="ed-az-empty">
                  <div className="ed-az-empty-ic">{IcAI}</div>
                  No zooms yet. Auto-detect, or add one at the playhead.
                </div>
              ) : (
                <div className="ed-az-list">
                  {zooms.map((z) => {
                    const open = selZoomId === z.id;
                    const durMs = z.end_ms - z.start_ms;
                    return (
                      <div key={z.id} className={"ed-az-row" + (open ? " open" : "")}>
                        <div className="ed-az-rowhd" onClick={() => { setSelZoomId(open ? null : z.id); setZoomAdvOpen(false); if (!open) seek(z.start_ms); }}>
                          <button className="ed-az-play" title="Jump to zoom" onClick={(e) => { e.stopPropagation(); seek(z.start_ms); }}>
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                          </button>
                          <span className="ed-az-time">{fmtT(z.start_ms)}</span>
                          <span className={"ed-az-badge " + z.source}>{z.source === "ai" ? "AI" : "MANUAL"}</span>
                          <span className="ed-az-str">{z.strength[0].toUpperCase() + z.strength.slice(1)}</span>
                          <span className="ed-az-caret">{open ? "⌃" : "⌄"}</span>
                          <button className="ed-az-del" title="Delete zoom" onClick={(e) => { e.stopPropagation(); delZoom(z.id); }}>{IcTrash}</button>
                        </div>
                        {open && (
                          <div className="ed-az-body">
                            <div className="ed-az-flabel">Zoom strength</div>
                            <div className="ed-seg-row">
                              {(["subtle", "medium", "strong"] as const).map((st) => (
                                <div key={st} className={"ed-seg-btn" + (z.strength === st ? " active" : "")}
                                  onClick={() => setZoomStrength(z.id, st)}>{st[0].toUpperCase() + st.slice(1)}</div>
                              ))}
                            </div>

                            <div className="ed-cs-slabel" style={{ marginTop: 12 }}><span>Duration</span><span>{(durMs / 1000).toFixed(1)}s</span></div>
                            <input type="range" min={500} max={4000} step={100} value={durMs}
                              onChange={(e) => setZoomDuration(z.id, +e.target.value)} style={{ width: "100%" }} />

                            <div className="ed-az-speeds">
                              <div className="ed-az-speed">
                                <div className="ed-az-flabel">Speed in</div>
                                <div className="ed-seg-row">
                                  {["fast", "medium", "slow"].map((sp) => (
                                    <div key={sp} className={"ed-seg-btn" + (speedLabel(z.ease_in) === sp ? " active" : "")}
                                      onClick={() => setZoomSpeed(z.id, "ease_in", sp)}>{sp[0].toUpperCase() + sp.slice(1)}</div>
                                  ))}
                                </div>
                              </div>
                              <div className="ed-az-speed">
                                <div className="ed-az-flabel">Speed out</div>
                                <div className="ed-seg-row">
                                  {["fast", "medium", "slow"].map((sp) => (
                                    <div key={sp} className={"ed-seg-btn" + (speedLabel(z.ease_out) === sp ? " active" : "")}
                                      onClick={() => setZoomSpeed(z.id, "ease_out", sp)}>{sp[0].toUpperCase() + sp.slice(1)}</div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <button className="ed-az-adv" onClick={() => setZoomAdvOpen((v) => !v)}>
                              {zoomAdvOpen ? "⌃" : "⌄"} Advanced — motion curve
                            </button>
                            {zoomAdvOpen && (
                              <div className="ed-az-advbox">
                                Ease in {z.ease_in.toFixed(2)}s · ease out {z.ease_out.toFixed(2)}s · peak {zoomStrengthPct(z)}%.
                                The push accelerates over the ease-in and releases over the ease-out.
                              </div>
                            )}

                            <div className="ed-az-aimhint">Drag the orange dot on the preview to aim this zoom at your subject.</div>
                            <div className="ed-az-rowacts">
                              <button className="ed-az-revert" onClick={() => revertZoom(z.id)}>{IcUndo} Revert</button>
                              <button className="ed-az-done" onClick={() => setSelZoomId(null)}>Done</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {rail === "filters" && (
            <>
              <div className="ed-left-head"><h3>Filters</h3></div>
              <p className="np-sub" style={{ margin: "0 0 12px" }}>
                Tap a grade to drop it as a clip on the timeline, then drag the clip to move it and drag its edges to stretch when it applies. Fine-tune the selected clip with Adjust below — everything bakes into the MP4 export.
              </p>

              <div className={"ed-filt-card" + (curFilter === "none" ? " active" : "")} onClick={() => applyFilter("none")}>
                <div className="ed-filt-prev">
                  {filmFrame ? <img src={filmFrame} className="ed-filt-img" alt="" /> : <div className="ed-filt-none" />}
                </div>
                <div className="ed-style-lb">Original</div>
              </div>

              {filterGroups.map((g) => (
                <div key={g.name} className="ed-filt-group">
                  <div className="ed-filt-ghead">{g.name}<span>{g.sub}</span></div>
                  <div className="ed-style-grid">
                    {filterList.filter((f) => f.group === g.name).map((f) => (
                      <div key={f.id} className={"ed-style-card ed-filt-card2" + (curFilter === f.id ? " active" : "")} onClick={() => addFilterClip(f.id)}>
                        <div className="ed-filt-prev">
                          {filmFrame ? <img src={filmFrame} className="ed-filt-img" style={{ filter: FILTER_CSS[f.id] }} alt="" />
                                     : <div className={"ed-filt-fallback ed-filt-" + f.id} />}
                        </div>
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
                    <span className="ed-layer-swatch">{filmFrame ? <img src={filmFrame} className="ed-filt-img" style={{ filter: FILTER_CSS[l.name] }} alt="" /> : <span className={"ed-filt-prev ed-filt-" + l.name} />}</span>
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
                      <button className="secondary" style={{ width: "100%", marginTop: 12 }} onClick={() => canvasImgRef.current?.click()}>{IcPlus} Upload background image</button>
                      {canvas.image_url && <img src={canvas.image_url} style={{ width: "100%", borderRadius: 8, marginTop: 10, maxHeight: 120, objectFit: "cover" }} />}
                    </>
                  )}
                  {canvas.bg_type === "blur" && <div className="np-sub" style={{ marginTop: 10 }}>A blurred, zoomed copy of your video fills the background.</div>}
                  <button className="secondary" style={{ width: "100%", marginTop: 14 }} onClick={() => saveCanvas({ aspect: "original" })}>Reset to original</button>
                </>
              )}
            </>
          )}

        </div>

        {/* center preview */}
        <div className="ed-center">
          <div className={"ed-stage" + (clipSelected ? " sel" : "")} ref={stageRef}
            onClick={(e) => { if (!(e.target as HTMLElement).closest(".preview-wrap")) setClipSelected(false); }}>
            <div className={"ed-canvas-frame" + (canvas.aspect && canvas.aspect !== "original" ? " on" : "")}
              style={canvas.aspect && canvas.aspect !== "original" ? {
                aspectRatio: canvas.aspect.replace(":", "/"),
                background: canvas.bg_type === "image" && canvas.image_url ? `center/cover no-repeat url("${canvas.image_url}")`
                  : canvas.bg_type === "blur" ? "#0a0c13" : (canvas.color || "#000000"),
              } : undefined}>
            <VideoPreview ref={videoRef} src={mediaSrc} videoStyle={videoFxStyle} zoom={previewZoom} safeZone={safeZone} onSurfaceClick={() => { const next = !clipSelected; setClipSelected(next); if (next) setTopTab("video"); }}
              enhancedSrc={enhancedUrl || undefined} enhanceOn={!!enhancedUrl}
              contentZooms={contentZooms} contentZoomOn={contentZoomOn}
              cropOverlay={topTab === "video" && videofx.cropOpen ? (
                <div className="ed-crop-layer">
                  <div className="ed-crop-rect" style={{ top: videofx.cropT + "%", right: videofx.cropR + "%", bottom: videofx.cropB + "%", left: videofx.cropL + "%" }}>
                    <span className="ed-crop-h tl" onMouseDown={(e) => startCropDrag("tl", e)} />
                    <span className="ed-crop-h tr" onMouseDown={(e) => startCropDrag("tr", e)} />
                    <span className="ed-crop-h bl" onMouseDown={(e) => startCropDrag("bl", e)} />
                    <span className="ed-crop-h br" onMouseDown={(e) => startCropDrag("br", e)} />
                    <span className="ed-crop-e et" onMouseDown={(e) => startCropDrag("t", e)} />
                    <span className="ed-crop-e eb" onMouseDown={(e) => startCropDrag("b", e)} />
                    <span className="ed-crop-e el" onMouseDown={(e) => startCropDrag("l", e)} />
                    <span className="ed-crop-e er" onMouseDown={(e) => startCropDrag("r", e)} />
                  </div>
                </div>
              ) : null}
              controls={<>
                <button className="ed-mon-replace" onClick={() => {}}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v5h-5" /></svg>
                  Replace
                </button>
                <span className="ed-mon-h ed-mon-h-tl" /><span className="ed-mon-h ed-mon-h-tr" />
                <span className="ed-mon-h ed-mon-h-bl" /><span className="ed-mon-h ed-mon-h-br" />
                <span className="ed-mon-grip" aria-hidden><i /><i /><i /></span>
                <div className="ed-mon-tools">
                  <span className="ed-mon-tipwrap">
                    <button className={"ed-mon-ibtn" + (safeZone ? " on" : "")} onClick={() => setSafeZone((v) => !v)} aria-label="Safe zone">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="7.6" x2="12.01" y2="7.6" /></svg>
                    </button>
                    <span className="ed-mon-tipbox">Danger zone — show where the app's buttons and caption will cover your video</span>
                  </span>
                  <span className="ed-mon-div" />
                  <button className="ed-mon-ibtn" title="Zoom out" onClick={() => setPreviewZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
                  </button>
                  <button className="ed-mon-zoomlbl" title="Reset zoom" onClick={() => setPreviewZoom(1)}>{Math.round(previewZoom * 100)}%</button>
                  <button className="ed-mon-ibtn" title="Zoom in" onClick={() => setPreviewZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
                  </button>
                  <span className="ed-mon-div" />
                  <button className="ed-mon-ibtn" title="Fullscreen" onClick={toggleFullscreen}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
                  </button>
                </div>
              </>}
              frameOverlay={<>
                {!isHidden("captions") && movedWords.length > 0 && movedWords.map(({ i, w, wd }) => (
                  <div key={i}
                    className={"ed-wordmove" + (selWordSafe === i ? " sel" : "")}
                    style={{ left: wd.x + "%", top: wd.y + "%",
                      color: wd.color || effSettings.text_color || "#fff",
                      fontSize: Math.max(12, ((Number(wd.size) || Number(effSettings.size) || 64) / 64) * 22) + "px",
                      textShadow: wd.glow ? "0 0 8px currentColor, 0 0 3px #000" : "0 1px 2px rgba(0,0,0,.6)" }}
                    onMouseDown={(e) => startDragWord(e, i)}>{w}</div>
                ))}
                {!isHidden("text") && overlays.filter((o) => curMs >= o.start_ms && curMs < o.end_ms).map((o) => {
                  const ow = o.outline_width ?? 0, ss = o.shadow_size ?? 0;
                  return (
                  <div key={o.id + "-" + (o.anim || "none")} className={"ed-ovl anim-" + (o.anim || "none") + (selOv === o.id ? " sel" : "")}
                    style={{ left: o.x_pct + "%", top: o.y_pct + "%", color: o.color,
                             fontSize: Math.max(13, o.font_size * 0.26) + "px", fontWeight: o.bold ? 800 : 500,
                             WebkitTextStroke: ow > 0 ? `${(ow * 0.12).toFixed(2)}px ${o.outline_color || "#000000"}` : undefined,
                             textShadow: ss > 0 ? `${(ss * 0.5).toFixed(1)}px ${(ss * 0.5).toFixed(1)}px ${(ss * 0.7).toFixed(1)}px ${o.shadow_color || "#000000"}` : undefined,
                             background: o.bg || undefined, padding: o.bg ? "2px 10px" : undefined, borderRadius: o.bg ? "6px" : undefined }}
                    onMouseDown={(e) => startDrag(e, o)}
                    onClick={(e) => { e.stopPropagation(); setSelOv(o.id); }}>
                    {o.text}
                  </div>
                  );
                })}
                {!isHidden("images") && images.filter((im) => curMs >= im.start_ms && curMs < im.end_ms).map((im) => (
                  <img key={im.id} src={im.image_url} draggable={false}
                    className={"ed-imgovl" + (selImg === im.id ? " sel" : "")}
                    style={{ left: im.x_pct + "%", top: im.y_pct + "%", width: im.size_pct + "%" }}
                    onMouseDown={(e) => startDragImg(e, im)}
                    onClick={(e) => { e.stopPropagation(); setSelImg(im.id); setRail("images"); }} />
                ))}
                {!isHidden("broll") && brolls.filter((b) => curMs >= b.start_ms && curMs < b.end_ms).map((b) => (
                  (b.size_pct ?? 100) >= 90 ? (
                    <video key={b.id} src={b.video_url} muted autoPlay loop playsInline draggable={false}
                      className={"ed-broll-fill" + (selBroll === b.id ? " sel" : "")}
                      onClick={(e) => { e.stopPropagation(); setSelBroll(b.id); setSelOv(null); setRail("broll"); }} />
                  ) : (
                    <video key={b.id} src={b.video_url} muted autoPlay loop playsInline draggable={false}
                      className={"ed-imgovl" + (selBroll === b.id ? " sel" : "")}
                      style={{ left: b.x_pct + "%", top: b.y_pct + "%", width: b.size_pct + "%" }}
                      onMouseDown={(e) => startDragBroll(e, b)}
                      onClick={(e) => { e.stopPropagation(); setSelBroll(b.id); setRail("broll"); }} />
                  )
                ))}
                {rail === "zoom" && selZoom && (() => {
                  const half = 50 / Math.max(1.05, selZoom.scale);
                  const cx = selZoom.fx * 100, cy = selZoom.fy * 100;
                  return (
                    <div className="ed-zoomaim" aria-hidden={false}>
                      <div className="ed-zoomaim-rect"
                        style={{ left: (cx - half) + "%", top: (cy - half) + "%", width: (half * 2) + "%", height: (half * 2) + "%" }}>
                        <span className="ed-zoomaim-c tl" /><span className="ed-zoomaim-c tr" />
                        <span className="ed-zoomaim-c bl" /><span className="ed-zoomaim-c br" />
                      </div>
                      <button className="ed-zoomaim-dot" style={{ left: cx + "%", top: cy + "%" }}
                        title="Drag to aim the zoom" onMouseDown={(e) => startZoomAim(e, selZoom.id)} />
                    </div>
                  );
                })()}
              </>}
              overlay={activeCue && overlayText && !isHidden("captions") ? (
                <CaptionOverlay text={overlayText} styleId={effStyle} cue={activeCue} curMs={curMs} keyId={activeIdx} settings={effSettings} wordOverrides={activeWordOv} selWord={selWordSafe} />
              ) : null} />
            </div>
          </div>
          <div className="ed-mon-bar">
            <button className="ed-mon-tr" title="Previous caption" onClick={prevCap}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 6h2v12H7zM20 6v12l-9-6z" /></svg>
            </button>
            <button className="ed-mon-tr ed-mon-tr-play" title={playing ? "Pause" : "Play"} onClick={togglePlay}>
              {playing
                ? <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M7 5h4v14H7zM15 5h4v14h-4z" /></svg>
                : <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <button className="ed-mon-tr" title="Next caption" onClick={nextCap}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15 6h2v12h-2zM4 6l9 6-9 6z" /></svg>
            </button>
            <span className="ed-mon-time">{fmtT(curMs)} / {fmtT(dur)}</span>
          </div>
        </div>

        {/* right panel */}
        <div className="ed-right">
          {!expOpen && selOv && (() => {
            const o = overlays.find((v) => v.id === selOv);
            if (!o) return null;
            const swatches = ["#ffffff", "#000000", "#ffd21e", "#f97316", "#22c55e", "#22d3ee", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"];
            return (
              <div className="ed-rt-textovl">
                <div className="ed-rt-exp-head">
                  <span>Text</span>
                  <button className="ed-rt-exp-x" title="Close" onClick={() => setSelOv(null)}>✕</button>
                </div>
                <div className="ed-txtovl-tabs">
                  {([["content", "Content"], ["style", "Style"], ["anim", "Animation"], ["outline", "Outline"], ["shadow", "Shadow"]] as [string, string][]).map(([k, l]) => (
                    <div key={k} className={"ed-txtovl-tab" + (textTab === k ? " active" : "")} onClick={() => setTextTab(k as any)}>{l}</div>
                  ))}
                </div>
                <div className="ed-txtovl-body">
                  {textTab === "content" && (
                    <>
                      <div className="np-label">Text</div>
                      <textarea className="ed-txt-input" value={o.text} autoFocus
                        onChange={(e) => patchLocal(o.id, { text: e.target.value })}
                        onBlur={(e) => saveOverlay(o.id, { text: e.target.value })} />
                      <div className="ed-cs-slider" style={{ marginTop: 14 }}>
                        <div className="ed-cs-slabel"><span>Font size</span><span>{o.font_size}</span></div>
                        <input type="range" min={24} max={200} value={o.font_size}
                          onChange={(e) => patchLocal(o.id, { font_size: +e.target.value })}
                          onMouseUp={(e) => saveOverlay(o.id, { font_size: +(e.target as HTMLInputElement).value })} />
                      </div>
                      <label className="ed-setting" style={{ marginTop: 12 }}><span>Bold</span>
                        <input type="checkbox" checked={o.bold} onChange={(e) => saveOverlay(o.id, { bold: e.target.checked })} /></label>
                    </>
                  )}
                  {textTab === "style" && (
                    <>
                      <div className="np-label">Text colour</div>
                      <div className="ed-swatches">
                        {swatches.map((c) => (
                          <span key={c} className={"ed-swatch" + ((o.color || "").toLowerCase() === c ? " active" : "")}
                            style={{ background: c }} onClick={() => saveOverlay(o.id, { color: c })} />
                        ))}
                        <input type="color" className="ed-color-pick" value={o.color || "#ffffff"}
                          onChange={(e) => saveOverlay(o.id, { color: e.target.value })} />
                      </div>
                      <div className="np-label" style={{ marginTop: 16 }}>Background box</div>
                      <div className="ed-swatches">
                        <span className={"ed-swatch ed-swatch-none" + (!o.bg ? " active" : "")} onClick={() => saveOverlay(o.id, { bg: "" })} title="None">/</span>
                        {["#000000", "#ffffff", "#c6ff3a", "#ef4444"].map((c) => (
                          <span key={c} className={"ed-swatch" + ((o.bg || "").toLowerCase() === c ? " active" : "")}
                            style={{ background: c }} onClick={() => saveOverlay(o.id, { bg: c })} />
                        ))}
                      </div>
                    </>
                  )}
                  {textTab === "anim" && (
                    <>
                      <div className="np-label">Entrance animation</div>
                      <div className="ed-txtanim-grid">
                        {TXT_ANIMS.map(([k, l]) => (
                          <div key={k} className={"ed-txtanim-card" + ((o.anim || "none") === k ? " active" : "")}
                            onClick={() => saveOverlay(o.id, { anim: k })}>
                            <div className={"ed-txtanim-demo demo-" + k}>Aa</div>
                            <div className="ed-txtanim-lb">{l}</div>
                          </div>
                        ))}
                      </div>
                      <div className="np-sub" style={{ marginTop: 10 }}>Plays when the text appears — visible in preview &amp; burned into the export.</div>
                    </>
                  )}
                  {textTab === "outline" && (
                    <>
                      <div className="ed-vfx-row"><span>Outline colour</span>
                        <input type="color" value={o.outline_color || "#000000"} onChange={(e) => saveOverlay(o.id, { outline_color: e.target.value })} /></div>
                      <div className="ed-cs-slider" style={{ marginTop: 12 }}>
                        <div className="ed-cs-slabel"><span>Outline width</span><span>{o.outline_width ?? 3}</span></div>
                        <input type="range" min={0} max={12} value={o.outline_width ?? 3}
                          onChange={(e) => patchLocal(o.id, { outline_width: +e.target.value })}
                          onMouseUp={(e) => saveOverlay(o.id, { outline_width: +(e.target as HTMLInputElement).value })} />
                      </div>
                    </>
                  )}
                  {textTab === "shadow" && (
                    <>
                      <div className="ed-vfx-row"><span>Shadow colour</span>
                        <input type="color" value={o.shadow_color || "#000000"} onChange={(e) => saveOverlay(o.id, { shadow_color: e.target.value })} /></div>
                      <div className="ed-cs-slider" style={{ marginTop: 12 }}>
                        <div className="ed-cs-slabel"><span>Shadow size</span><span>{o.shadow_size ?? 1}</span></div>
                        <input type="range" min={0} max={12} value={o.shadow_size ?? 1}
                          onChange={(e) => patchLocal(o.id, { shadow_size: +e.target.value })}
                          onMouseUp={(e) => saveOverlay(o.id, { shadow_size: +(e.target as HTMLInputElement).value })} />
                      </div>
                    </>
                  )}

                  <div className="ed-txtovl-timing">
                    <button className="secondary" onClick={() => saveOverlay(o.id, { start_ms: Math.round(curMs) })}>Start at playhead</button>
                    <button className="secondary" onClick={() => saveOverlay(o.id, { end_ms: Math.max(o.start_ms + 300, Math.round(curMs)) })}>End at playhead</button>
                  </div>
                  <button className="ed-bulk-del" style={{ width: "100%", marginTop: 12 }} onClick={() => { const id = o.id; setSelOv(null); delText(id); toast("Text deleted"); }}>{IcTrash} Delete text</button>
                </div>
              </div>
            );
          })()}
          {expOpen && (
            <div className="ed-rt-export">
              <div className="ed-rt-exp-head">
                <span>Export</span>
                <button className="ed-rt-exp-x" onClick={() => setExpOpen(false)} title="Close">✕</button>
              </div>
              <div className="ed-exp">
                <div className="ed-exp-label">Export settings</div>

                <div className="ed-exp-field">
                  <label>Format</label>
                  <Dropdown value="mp4" onChange={() => {}} options={[{ value: "mp4", label: "MP4" }]} />
                </div>

                <div className="ed-exp-field">
                  <label>Resolution</label>
                  <Dropdown value={expRes} onChange={setExpRes} options={[
                    { value: "auto", label: "Auto (source)" },
                    { value: "1080", label: "1080p" },
                    { value: "720", label: "720p" },
                    { value: "480", label: "480p" },
                  ]} />
                </div>

                <div className="ed-exp-est">{estText}</div>

                <button className="ed-exp-go" onClick={() => doExport("mp4", expRes)}>{IcTrayDown} Export</button>

                <div className="ed-exp-sec">
                  <div className="ed-exp-sub">Subtitles</div>
                  <button className="secondary ed-exp-dltext" onClick={() => doExport("srt")}>{IcTrayDown} Download Text</button>
                </div>

                <div className="ed-exp-sec">
                  <button className="ed-exp-acc" onClick={() => setNleOpen((v) => !v)}>
                    <span>Export for Editor</span>
                    <span className="ed-exp-chev">{nleOpen ? "⌄" : "›"}</span>
                  </button>
                  {nleOpen && (
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
                  )}
                </div>

              </div>
            </div>
          )}
          <div className="ed-rt-tabs">
            <div className={"ed-rt-tab" + (topTab === "video" ? " active" : "")} onClick={() => setTopTab("video")}>Video</div>
            <div className={"ed-rt-tab" + (topTab === "audio" ? " active" : "")} onClick={() => setTopTab("audio")}>Audio</div>
            <div className={"ed-rt-tab" + (topTab === "text" ? " active" : "")} onClick={() => setTopTab("text")}>Text</div>
          </div>
          {topTab === "text" && (
            <>
            <div className="ed-rt-sub">
              {(["styles", "settings", "animation"] as const).map((t) => (
                <div key={t} className={"ed-rt-subtab" + (rightTab === t ? " active" : "")} onClick={() => setRightTab(t)}>
                  {t === "styles" ? "Styles" : t === "settings" ? "Caption settings" : "Animation"}
                </div>
              ))}
            </div>
            <button className="ed-ls-open" onClick={() => setLineStyleOpen(true)} title="Open the floating line styling panel">
              ⤢ Line styling panel
            </button>
            </>
          )}

          {(topTab === "video" || topTab === "audio") && !clipSelected && (
            <div className="ed-rt-body ed-noitem">
              <div className="ed-noitem-ic" aria-hidden>
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></svg>
              </div>
              <div className="ed-noitem-t">No item selected</div>
              <div className="np-sub" style={{ textAlign: "center", maxWidth: 220 }}>
                Click the video in the preview to edit its {topTab === "audio" ? "volume & audio" : "look, crop & animation"}.
              </div>
            </div>
          )}
          {topTab === "video" && clipSelected && (
            <div className="ed-rt-body ed-vfx">
              <div className="ed-anim-lbl">PLAYBACK</div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Speed</span><span>{playRate.toFixed(2)}x</span></div>
                <input type="range" min={0.25} max={2} step={0.05} value={playRate}
                  onChange={(e) => { const v = +e.target.value; setPlayRate(v); if (videoRef.current) videoRef.current.playbackRate = v; }} />
              </div>

              <div className="ed-anim-lbl" style={{ marginTop: 18 }}>LOOK</div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Opacity</span><span>{videofx.opacity}</span></div>
                <input type="range" min={0} max={100} step={1} value={videofx.opacity}
                  onChange={(e) => setFx({ opacity: +e.target.value })} />
              </div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Rounded corners</span><span>{videofx.radius}</span></div>
                <input type="range" min={0} max={100} step={1} value={videofx.radius}
                  onChange={(e) => setFx({ radius: +e.target.value })} />
                <div className="ed-cs-slabel" style={{ color: "var(--muted)" }}><span>% of the clip's shorter side</span></div>
              </div>
              <button className="ed-vfx-crop" onClick={() => setFx({ cropOpen: !videofx.cropOpen })}>{IcCrop} Crop this clip…</button>
              {videofx.cropOpen && (
                <div className="ed-vfx-cropbox">
                  {([["cropT","Top"],["cropR","Right"],["cropB","Bottom"],["cropL","Left"]] as [string,string][]).map(([k,l]) => (
                    <div className="ed-cs-slider" key={k}>
                      <div className="ed-cs-slabel"><span>{l}</span><span>{videofx[k]}%</span></div>
                      <input type="range" min={0} max={45} step={1} value={videofx[k]}
                        onChange={(e) => setFx({ [k]: +e.target.value })} />
                    </div>
                  ))}
                </div>
              )}

              <div className="ed-anim-lbl" style={{ marginTop: 18 }}>EFFECTS</div>
              <div className="ed-vfx-row">
                <span>Outline colour</span>
                <input type="color" value={videofx.outlineColor} onChange={(e) => setFx({ outlineColor: e.target.value })} />
              </div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Outline size</span><span>{videofx.outlineSize}</span></div>
                <input type="range" min={0} max={20} step={1} value={videofx.outlineSize}
                  onChange={(e) => setFx({ outlineSize: +e.target.value })} />
              </div>
              <div className="ed-vfx-row">
                <span>Shadow colour</span>
                <input type="color" value={videofx.shadowColor} onChange={(e) => setFx({ shadowColor: e.target.value })} />
              </div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Shadow left / right</span><span>{videofx.shadowX}</span></div>
                <input type="range" min={-40} max={40} step={1} value={videofx.shadowX}
                  onChange={(e) => setFx({ shadowX: +e.target.value })} />
              </div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Shadow up / down</span><span>{videofx.shadowY}</span></div>
                <input type="range" min={-40} max={40} step={1} value={videofx.shadowY}
                  onChange={(e) => setFx({ shadowY: +e.target.value })} />
              </div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Shadow blur</span><span>{videofx.shadowBlur}</span></div>
                <input type="range" min={0} max={40} step={1} value={videofx.shadowBlur}
                  onChange={(e) => setFx({ shadowBlur: +e.target.value })} />
              </div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Blur</span><span>{videofx.blur}</span></div>
                <input type="range" min={0} max={40} step={1} value={videofx.blur}
                  onChange={(e) => setFx({ blur: +e.target.value })} />
              </div>

              <div className="ed-anim-lbl" style={{ marginTop: 18 }}>ANIMATIONS</div>
              <div className="ed-vfx-animrow">
                <span className="ed-vfx-animrow-l">Animation</span>
                {(() => {
                  const field = animTab === "in" ? "animIn" : animTab === "loop" ? "animLoop" : "animOut";
                  const cards = animTab === "in" ? VFX_IN_CARDS : animTab === "loop" ? VFX_LOOP_CARDS : VFX_OUT_CARDS;
                  const cur = videofx[field] || "none";
                  const lbl = (cards.find((c: any) => c[0] === cur)?.[1]) || "None";
                  return (
                    <button className="ed-vfx-animdd" onClick={() => setAnimBoxOpen(true)}>
                      <span>{lbl}</span><span className="ed-vfx-animdd-cx">▾</span>
                    </button>
                  );
                })()}
              </div>

              <button className="secondary" style={{ width: "100%", marginTop: 14 }}
                onClick={() => setFx({ ...VFX_DEFAULT })}>{IcReset} Reset video effects</button>
            </div>
          )}
          {lineStyleOpen && topTab === "text" && (
            <div className="ed-animprops ed-linestyle" style={lineStylePos ? { left: lineStylePos.x, top: lineStylePos.y, right: "auto" } : undefined}>
              <div className="ed-animprops-hdr" onMouseDown={startLineStyleDrag}>
                <span className="ed-animprops-grip" aria-hidden>⋮⋮</span>
                <span className="ed-animprops-h">Line styling{activeIdx >= 0 ? " · caption " + (activeIdx + 1) : ""}</span>
                <button className="ed-animprops-x" title="Close" onClick={() => setLineStyleOpen(false)}>×</button>
              </div>
              <div className="ed-animprops-body ed-ls-body">
                <div className="ed-ls-sec">Preset {activeIdx >= 0 ? "for this caption" : "(all captions)"}</div>
                <div className="ed-ls-presets">
                  {lineStyles.slice(0, 16).map((st) => (
                    <div key={st.id} className={"ed-ls-preset" + (((capOvStyle || capStyle) === st.id) ? " active" : "")}
                      title={st.label} onClick={() => applyCaptionPreset(st.id)}>
                      <span className={"cap cap-" + st.id}>Aa</span>
                      <span className="ed-ls-preset-lb">{st.label}</span>
                    </div>
                  ))}
                </div>
                <div className="ed-ls-parts">
                  {([["top", "Top line"], ["big", "Big word"], ["bottom", "Bottom line"]] as [any, string][]).map(([k, l]) => (
                    <button key={k} className={capPart === k ? "active" : ""} onClick={() => setCapPart(k)}>{l}</button>
                  ))}
                </div>
                {(() => {
                  const isB = capPart === "bottom", isBig = capPart === "big";
                  const opKey = isB ? "opacity" : isBig ? "big_opacity" : "top_opacity";
                  const caseKey = isB ? "case" : isBig ? "big_case" : "top_case";
                  const sizeKey = isBig ? "big_size" : "size";
                  const colorKey = isBig ? "emph_color" : "text_color";
                  const opVal = (capSettings as any)[opKey] ?? 100;
                  const caseVal = (capSettings as any)[caseKey] || "";
                  const sizeVal = isBig ? (capSettings.big_size ?? (capSettings.size ?? 64)) : (capSettings.size ?? 64);
                  const colorVal = (capSettings as any)[colorKey] || (isBig ? "#ffd21e" : "#ffffff");
                  return (
                    <>
                      {isB && (
                        <div className="ed-ls-row"><span>Font</span>
                          <Dropdown value={capSettings.font || ""} searchable placeholder="Font"
                            options={CS_FONTS.map(([v, l]) => ({ value: v, label: l }))}
                            onChange={(v) => saveCapSetting({ font: v })} />
                        </div>
                      )}
                      {(isB || isBig) && (
                        <div className="ed-ls-slider">
                          <div className="ed-cs-slabel"><span>Size</span><span>{sizeVal}</span></div>
                          <input type="range" min={24} max={220} step={1} value={sizeVal}
                            onChange={(e) => setCapSettings((pr) => ({ ...pr, [sizeKey]: +e.target.value }))}
                            onMouseUp={(e) => saveCapSetting({ [sizeKey]: +(e.target as HTMLInputElement).value })} />
                        </div>
                      )}
                      {(isB || isBig) && (
                        <div className="ed-ls-row"><span>Colour</span>
                          <input type="color" value={colorVal} onChange={(e) => saveCapSetting({ [colorKey]: e.target.value })} />
                        </div>
                      )}
                      {isB && (
                        <div className="ed-ls-row"><span>Align</span>
                          <div className="ed-ls-seg">
                            {([["left", "L"], ["center", "C"], ["right", "R"]] as [string, string][]).map(([v, l]) => (
                              <button key={v} className={(capSettings.align || "center") === v ? "active" : ""} onClick={() => saveCapSetting({ align: v })}>{l}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="ed-ls-row"><span>Case</span>
                        <div className="ed-ls-seg">
                          {([["as_typed", "Aa"], ["upper", "AG"], ["lower", "ag"], ["title", "Ag"]] as [string, string][]).map(([v, l]) => (
                            <button key={v} className={caseVal === v ? "active" : ""} onClick={() => saveCapSetting({ [caseKey]: v })}>{l}</button>
                          ))}
                        </div>
                      </div>
                      <div className="ed-ls-slider">
                        <div className="ed-cs-slabel"><span>Opacity</span><span>{opVal}%</span></div>
                        <input type="range" min={0} max={100} step={1} value={opVal}
                          onChange={(e) => setCapSettings((pr) => ({ ...pr, [opKey]: +e.target.value }))}
                          onMouseUp={(e) => saveCapSetting({ [opKey]: +(e.target as HTMLInputElement).value })} />
                      </div>
                      {isBig && (
                        <label className="ed-ls-check"><input type="checkbox" checked={!!capSettings.big_glow} onChange={(e) => saveCapSetting({ big_glow: e.target.checked })} /> Glow</label>
                      )}
                    </>
                  );
                })()}
                <div className="ed-ls-foot">Changes apply as you make them.</div>
              </div>
            </div>
          )}
          {topTab === "video" && clipSelected && animBoxOpen && (
            <div className="ed-animprops" style={animBoxPos ? { left: animBoxPos.x, top: animBoxPos.y, right: "auto" } : undefined}>
              <div className="ed-animprops-hdr" onMouseDown={startAnimBoxDrag}>
                <span className="ed-animprops-grip" aria-hidden>⋮⋮</span>
                <span className="ed-animprops-h">Animations</span>
                <button className="ed-animprops-x" title="Close" aria-label="Close" onClick={() => setAnimBoxOpen(false)}>×</button>
              </div>
              <div className="ed-animprops-body">
                <div className="ed-vfx-anitabs">
                  {(["in", "loop", "out"] as const).map((t) => (
                    <div key={t} className={"ed-vfx-anitab" + (animTab === t ? " active" : "")} onClick={() => setAnimTab(t)}>
                      {t === "in" ? "In" : t === "loop" ? "Loop" : "Out"}
                    </div>
                  ))}
                </div>
                {(() => {
                  const cards = animTab === "in" ? VFX_IN_CARDS : animTab === "loop" ? VFX_LOOP_CARDS : VFX_OUT_CARDS;
                  const field = animTab === "in" ? "animIn" : animTab === "loop" ? "animLoop" : "animOut";
                  const cur = videofx[field] || "none";
                  return (
                    <div className="ed-vfx-grid">
                      {cards.map(([key, label, demo]: any) => (
                        <div key={key} className={"ed-vfx-card" + (key === "none" ? " none" : "") + (cur === key ? " active" : "")}
                          onClick={() => setFx({ [field]: key })}>
                          <div className="ed-vfx-stage">
                            <span className={"ed-vfx-chip " + (key === "none" ? "" : demo)}>{key === "none" ? "—" : "Aa"}</span>
                          </div>
                          <div className="ed-vfx-lb">{label}</div>
                          {cur === key && key !== "none" && <div className="ed-vfx-tick">✓</div>}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <div className="np-sub" style={{ marginTop: 8 }}>
                  {animTab === "in" ? "Plays once as the clip appears."
                    : animTab === "loop" ? "Plays continuously while the clip is on screen."
                    : "Plays once as the clip leaves."}
                </div>
              </div>
            </div>
          )}

          {topTab === "audio" && clipSelected && (
            <div className="ed-rt-body">
              <div className="ed-anim-lbl">VOLUME</div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Level</span><span>{Math.round(audioVol * 100)}%</span></div>
                <input type="range" min={0} max={2} step={0.05} value={audioVol}
                  onChange={(e) => { const v = +e.target.value; setAudioVol(v); if (videoRef.current) videoRef.current.volume = Math.min(1, v); }} />
                <div className="ed-cs-slabel" style={{ color: "var(--muted)" }}><span>mute</span><span>200%</span></div>
              </div>
              <div className="ed-audio-enh">
                <div className="ed-audio-enh-h"><span className="ed-audio-enh-ic" aria-hidden>{IcSpeaker}</span> Audio enhance</div>
                <div className="np-sub">Cleans background noise with AI — takes about 10 seconds.</div>
              </div>
              <div className="ed-cs-slider" style={{ marginTop: 14 }}>
                <div className="ed-cs-slabel"><span>Strength</span><span>{enhanceStrength}%</span></div>
                <input type="range" min={0} max={100} step={1} value={enhanceStrength}
                  onChange={(e) => { setEnhanceStrength(+e.target.value); setEnhancedUrl(null); setEnhanceAudio(false); }} />
                <div className="ed-cs-slabel" style={{ color: "var(--muted)" }}><span>subtle</span><span>aggressive</span></div>
              </div>
              <button className="ed-audio-apply" disabled={enhancing} onClick={applyAudioEnhance}>
                {enhancing ? (<><span className="ed-audio-spin" aria-hidden /> Cleaning background noise…</>)
                  : enhancedUrl ? "Re-apply" : "Apply"}
              </button>
              {enhancedUrl && !enhancing && (
                <div className="ed-audio-applied">
                  <span>✓ Cleaned audio applied — you'll hear it in the preview, and it's used on export.</span>
                  <button className="ed-audio-remove" onClick={() => { setEnhancedUrl(null); setEnhanceAudio(false); }}>Remove</button>
                </div>
              )}
              {enhanceErr && !enhancing && <div className="ed-audio-err">{enhanceErr}</div>}
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
                <div className="ed-sub2-icons">
                  <button className="ed-sub2-icon" title="How styles work" aria-label="Info" onClick={() => setInfoDismissed(false)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="7.6" x2="12.01" y2="7.6" /></svg>
                  </button>
                  <button className={"ed-sub2-icon" + (styleSearchOpen ? " on" : "")} title="Search styles" aria-label="Search"
                    onClick={() => { setStyleSearchOpen((v) => !v); if (styleSearchOpen) setStyleSearch(""); }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  </button>
                  <button className="ed-sub2-icon" title="Save current style" aria-label="Save style" onClick={saveCurrentStyle}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></svg>
                  </button>
                </div>
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
                  <div className="ed-style-scope">
                    <button className={styleScope === "all" ? "active" : ""} onClick={() => setStyleScope("all")}>All captions</button>
                    <button className={styleScope === "caption" ? "active" : ""} disabled={activeIdx < 0}
                      title={activeIdx < 0 ? "Select a caption on the timeline first" : "Style only the selected caption"}
                      onClick={() => setStyleScope("caption")}>This caption</button>
                  </div>
                  {styleScope === "caption" && activeIdx >= 0 && capOvStyle && (
                    <button className="ed-style-clearov" onClick={clearCaptionPreset}>↺ Use the video style for this caption</button>
                  )}
                  <div className="ed-preset-list">
                    {(stylesTab === "lines" ? lineStyles : wordStyles).filter((st) => st.label.toLowerCase().includes(styleSearch.toLowerCase())).map((st) => (
                      <div key={st.id} className={"ed-preset-card" + (activeStyleId === st.id ? " active" : "")} onClick={() => applyPreset(st.id)}>
                        <div className="ed-preset-name">{st.label}</div>
                        <div className="ed-preset-stage">
                          {stylesTab === "words" ? (
                            <span className={"cap cap-" + st.id} style={{ color: capSettings.text_color || undefined }}>
                              {["Welcome", "to", "the", "future", "of", "ceyonai", "editing"].map((w, i) => (
                                <span key={i} className={"capword" + ((cardTick % 7) === i ? " capword-on" : "")}
                                  style={(cardTick % 7) === i && capSettings.highlight_color ? { color: capSettings.highlight_color } : undefined}>{w}{i === 3 ? <br /> : " "}</span>
                              ))}
                            </span>
                          ) : (
                            <span className={"cap cap-" + st.id} key={st.id} style={{ color: capSettings.text_color || undefined }}>Welcome to the <span className="cap-emph" style={{ color: capSettings.highlight_color || undefined }}>future</span><br />of ceyonai editing</span>
                          )}
                        </div>
                        {activeStyleId === st.id && <div className="ed-showcase-check">✓</div>}
                      </div>
                    ))}
                  </div>
                  <div className="ed-swatches" style={{ marginTop: 14 }}>
                    {SWATCHES.map((sw) => (
                      <span key={sw.color} className={"ed-swatch" + (capSettings.text_color === sw.color ? " active" : "")}
                        style={{ background: sw.color }} title={sw.color} onClick={() => saveCapSetting({ text_color: sw.color })} />
                    ))}
                  </div>

                  <div className="ed-cust">
                    <button className="ed-cust-head" onClick={() => setCustomiseOpen((v) => !v)}>
                      <span>Customise</span><span className="ed-cust-chev">{customiseOpen ? "⌄" : "›"}</span>
                    </button>
                    {customiseOpen && (
                      <div className="ed-cust-body">
                        <div className="ed-cust-sec">Colours</div>
                        <div className="ed-cust-row">
                          <span>Text colour</span>
                          <label className="ed-color">
                            <input type="color" value={capSettings.text_color || "#ffffff"} onChange={(e) => saveCapSetting({ text_color: e.target.value })} />
                            <span>{(capSettings.text_color || "#ffffff").toUpperCase()}</span>
                          </label>
                        </div>
                        <div className="ed-cust-row">
                          <span>Highlight colour</span>
                          <label className="ed-color">
                            <input type="color" value={capSettings.highlight_color || "#ffe11a"} onChange={(e) => saveCapSetting({ highlight_color: e.target.value })} />
                            <span>{(capSettings.highlight_color || "#ffe11a").toUpperCase()}</span>
                          </label>
                        </div>
                        <div className="ed-cust-row">
                          <span>Word highlight box</span>
                          <div className="ed-hlbox">
                            <button className={"ed-hlbox-none" + (!capSettings.highlight_box ? " on" : "")} onClick={() => saveCapSetting({ highlight_box: "" })}>None</button>
                            <label className="ed-color"><input type="color" value={capSettings.highlight_box || "#7c3aed"} onChange={(e) => saveCapSetting({ highlight_box: e.target.value })} /></label>
                          </div>
                        </div>
                        <div className="ed-cust-sec" style={{ marginTop: 14 }}>Typography</div>
                        <div className="ed-cust-row col">
                          <span>Font</span>
                          <Dropdown value={capSettings.font || ""} onChange={(v) => saveCapSetting({ font: v })} options={[
                            { value: "", label: "Default" },
                            { value: "Anton", label: "Anton" },
                            { value: "Bebas Neue", label: "Bebas Neue" },
                            { value: "Poppins", label: "Poppins" },
                            { value: "Montserrat", label: "Montserrat" },
                            { value: "Pacifico", label: "Pacifico (script)" },
                            { value: "Arial Black", label: "Arial Black" },
                          ]} />
                        </div>
                        <div className="ed-cs-slider" style={{ marginTop: 12 }}>
                          <div className="ed-cs-slabel"><span>Size</span><span>{capSettings.size || 64}</span></div>
                          <input type="range" min={40} max={140} step={1} value={capSettings.size || 64}
                            onChange={(e) => saveCapSetting({ size: +e.target.value })} />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {stylesTab === "saved" && (
                <div className="ed-preset-list">
                  <button className="ed-addcap" onClick={saveCurrentStyle}>{IcPlus} Save current style</button>
                  {savedStyles.length === 0 ? (
                    <div className="ed-cap-empty" style={{ paddingTop: 16 }}>No saved styles yet.</div>
                  ) : (
                    savedStyles.filter((sv) => sv.name.toLowerCase().includes(styleSearch.toLowerCase())).map((sv) => (
                      <div key={sv.id} className="ed-preset-card" onClick={() => applySaved(sv)}>
                        <div className="ed-preset-name">{sv.name}
                          <button className="ed-preset-del" onClick={(e) => { e.stopPropagation(); delSaved(sv.id); }}>{IcTrash}</button>
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

          {topTab === "text" && rightTab === "settings" && (
            <div className="ed-rt-body">
              {/* ---- Paste to ---- */}
              <div className="ed-pasteto">
                <button className="ed-pasteto-copy" onClick={copyStyle} title="Copy this caption's style">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  Copy style
                </button>
                <select className="ed-pasteto-sel" value="" disabled={!styleClip}
                  onChange={(e) => { if (e.target.value) { pasteStyleTo(e.target.value as "caption" | "all"); e.target.value = ""; } }}>
                  <option value="">{styleClip ? "Paste to…" : "Copy first"}</option>
                  <option value="caption">This caption only</option>
                  <option value="all">All captions</option>
                </select>
              </div>
              {/* ---- TEXT ---- */}
              <div className="ed-cs-card">
                <div className="ed-cs-card-h">Text</div>
                <div className="np-label">Font</div>
                <Dropdown value={capSettings.font || ""} searchable placeholder="Search fonts"
                  options={CS_FONTS.map(([v, l]) => ({ value: v, label: l }))}
                  onChange={(v) => saveCapSetting({ font: v })} />
                <div className="ed-cs-slider" style={{ marginTop: 12 }}>
                  <div className="ed-cs-slabel"><span>Size</span><span>{capSettings.size ?? 64}</span></div>
                  <input type="range" min={24} max={200} step={1} value={capSettings.size ?? 64}
                    onChange={(e) => setCapSettings((pr) => ({ ...pr, size: +e.target.value }))}
                    onMouseUp={(e) => saveCapSetting({ size: +(e.target as HTMLInputElement).value })} />
                </div>
                <div className="ed-cs-row" style={{ marginTop: 12 }}><span>Weight</span>
                  <select value={String(capSettings.weight ?? (capSettings.bold === -1 ? 700 : 400))}
                    onChange={(e) => saveCapSetting({ weight: +e.target.value, bold: +e.target.value >= 600 ? -1 : 0 })}>
                    <option value="300">Light</option>
                    <option value="400">Regular</option>
                    <option value="500">Medium</option>
                    <option value="600">SemiBold</option>
                    <option value="700">Bold</option>
                    <option value="800">ExtraBold</option>
                    <option value="900">Black</option>
                  </select>
                </div>
                <div className="ed-cs-toggle-row"><span>Italic</span>
                  <label className="ed-switch">
                    <input type="checkbox" checked={!!capSettings.italic} onChange={(e) => saveCapSetting({ italic: e.target.checked })} />
                    <span className="ed-switch-track" />
                  </label>
                </div>
                <div className="ed-cs-toggle-row"><span>Underline</span>
                  <label className="ed-switch">
                    <input type="checkbox" checked={!!capSettings.underline} onChange={(e) => saveCapSetting({ underline: e.target.checked })} />
                    <span className="ed-switch-track" />
                  </label>
                </div>
                <div className="ed-cs-row" style={{ marginTop: 12 }}><span>Colour</span>
                  <label className="ed-color">
                    <input type="color" value={capSettings.text_color || "#ffffff"} onChange={(e) => saveCapSetting({ text_color: e.target.value })} />
                    <span>{(capSettings.text_color || "#ffffff").toUpperCase()}</span>
                  </label>
                </div>
                <div className="ed-cs-row" style={{ marginTop: 12 }}><span>Align</span>
                  <select value={capSettings.align || "center"} onChange={(e) => saveCapSetting({ align: e.target.value })}>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
                <div className="ed-cs-row" style={{ marginTop: 12 }}><span>Case</span>
                  <select value={capSettings.case || "as_typed"} onChange={(e) => saveCapSetting({ case: e.target.value })}>
                    <option value="as_typed">As typed</option>
                    <option value="upper">UPPERCASE</option>
                    <option value="lower">lowercase</option>
                    <option value="title">Title Case</option>
                  </select>
                </div>
                <div className="ed-cs-slider" style={{ marginTop: 12 }}>
                  <div className="ed-cs-slabel"><span>Opacity</span><span>{capSettings.opacity ?? 100}%</span></div>
                  <input type="range" min={0} max={100} step={1} value={capSettings.opacity ?? 100}
                    onChange={(e) => setCapSettings((pr) => ({ ...pr, opacity: +e.target.value }))}
                    onMouseUp={(e) => saveCapSetting({ opacity: +(e.target as HTMLInputElement).value })} />
                </div>
              </div>

              {/* ---- Background ---- */}
              <div className="ed-cs-toggle-row ed-cs-standalone"><span>Background</span>
                <label className="ed-switch">
                  <input type="checkbox" checked={!!capSettings.background} onChange={(e) => saveCapSetting({ background: e.target.checked })} />
                  <span className="ed-switch-track" />
                </label>
              </div>

              <div className="ed-cs-divider" />
              <div className="ed-anim-lbl">POSITION</div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Up / down</span><span>{capSettings.pos_v ?? 0}px</span></div>
                <input type="range" min={-200} max={200} step={2} value={capSettings.pos_v ?? 0}
                  onChange={(e) => setCapSettings((pr) => ({ ...pr, pos_v: +e.target.value }))}
                  onMouseUp={(e) => saveCapSetting({ pos_v: +(e.target as HTMLInputElement).value })} />
              </div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Left / right</span><span>{capSettings.pos_h ?? 0}px</span></div>
                <input type="range" min={-200} max={200} step={2} value={capSettings.pos_h ?? 0}
                  onChange={(e) => setCapSettings((pr) => ({ ...pr, pos_h: +e.target.value }))}
                  onMouseUp={(e) => saveCapSetting({ pos_h: +(e.target as HTMLInputElement).value })} />
              </div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Letter gap</span><span>{capSettings.letter_gap ?? 0}px</span></div>
                <input type="range" min={-6} max={30} step={0.5} value={capSettings.letter_gap ?? 0}
                  onChange={(e) => setCapSettings((pr) => ({ ...pr, letter_gap: +e.target.value }))}
                  onMouseUp={(e) => saveCapSetting({ letter_gap: +(e.target as HTMLInputElement).value })} />
              </div>
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Word gap</span><span>{capSettings.word_gap ?? 0}px</span></div>
                <input type="range" min={0} max={40} step={1} value={capSettings.word_gap ?? 0}
                  onChange={(e) => setCapSettings((pr) => ({ ...pr, word_gap: +e.target.value }))}
                  onMouseUp={(e) => saveCapSetting({ word_gap: +(e.target as HTMLInputElement).value })} />
              </div>

              <div className="ed-cs-divider" />
              <div className="ed-anim-lbl">EFFECTS</div>
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
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Thickness</span><span>{capSettings.outline_w ?? 3}px</span></div>
                <input type="range" min={0} max={12} step={1} value={capSettings.outline_w ?? 3}
                  onChange={(e) => setCapSettings((pr) => ({ ...pr, outline_w: +e.target.value }))}
                  onMouseUp={(e) => saveCapSetting({ outline_w: +(e.target as HTMLInputElement).value })} />
              </div>
              <div className="ed-anim-toggle" style={{ marginTop: 16 }}>
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
              <div className="ed-cs-slider">
                <div className="ed-cs-slabel"><span>Depth</span><span>{capSettings.shadow ?? 1}px</span></div>
                <input type="range" min={0} max={12} step={1} value={capSettings.shadow ?? 1}
                  onChange={(e) => setCapSettings((pr) => ({ ...pr, shadow: +e.target.value }))}
                  onMouseUp={(e) => saveCapSetting({ shadow: +(e.target as HTMLInputElement).value })} />
              </div>
              <div className="ed-anim-toggle" style={{ marginTop: 16 }}>
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

              <div className="ed-cs-divider" />
              <div className="ed-cs-card">
                <div className="ed-cs-card-h">Emphasized word</div>
                <div className="np-sub" style={{ marginTop: -2, marginBottom: 8 }}>How the highlighted word looks. Type the word to emphasize.</div>
                <input className="ed-style-search" style={{ marginBottom: 12 }} placeholder="Word to emphasize (e.g. free)"
                  value={capSettings.emphasis || ""} onChange={(e) => saveCapSetting({ emphasis: e.target.value })} />
                <div className="ed-cs-row"><span>Colour</span>
                  <label className="ed-color">
                    <input type="color" value={capSettings.emph_color || "#ff6900"} onChange={(e) => saveCapSetting({ emph_color: e.target.value })} />
                    <span>{(capSettings.emph_color || "#FF6900").toUpperCase()}</span>
                  </label>
                </div>
                <div className="ed-cs-slider" style={{ marginTop: 12 }}>
                  <div className="ed-cs-slabel"><span>Size</span><span>{capSettings.big_size ?? (capSettings.size ?? 64)}</span></div>
                  <input type="range" min={24} max={220} step={1} value={capSettings.big_size ?? (capSettings.size ?? 64)}
                    onChange={(e) => setCapSettings((pr) => ({ ...pr, big_size: +e.target.value }))}
                    onMouseUp={(e) => saveCapSetting({ big_size: +(e.target as HTMLInputElement).value })} />
                </div>
                <div className="ed-cs-toggle-row"><span>Glow</span>
                  <label className="ed-switch">
                    <input type="checkbox" checked={!!capSettings.big_glow} onChange={(e) => saveCapSetting({ big_glow: e.target.checked })} />
                    <span className="ed-switch-track" />
                  </label>
                </div>
              </div>

              <div className="ed-cs-divider" />
              <div className="ed-cs-card">
                <div className="ed-cs-card-h">Single words</div>
                <div className="np-sub" style={{ marginTop: -2, marginBottom: 10 }}>
                  {activeIdx < 0 ? "Play to a caption, then pick a word to give it its own colour, size or glow." : "Pick a word in this caption to give it its own colour, size or glow."}
                </div>
                {activeIdx >= 0 && activeWords.length > 0 && (
                  <div className="ed-words-chips">
                    {activeWords.map((w, i) => (
                      <button key={i} type="button"
                        className={"ed-word-chip" + (selWordSafe === i ? " sel" : "") + (activeWordOv[String(i)] ? " has" : "")}
                        onClick={() => setSelWord(selWordSafe === i ? -1 : i)}>{w}</button>
                    ))}
                  </div>
                )}
                {activeIdx >= 0 && selWordSafe >= 0 && (
                  <div className="ed-word-ctl">
                    <div className="ed-cs-row"><span>Colour</span>
                      <label className="ed-color">
                        <input type="color" value={selWordOv.color || "#ffe11a"} onChange={(e) => setWordOv(selWordSafe, { color: e.target.value })} />
                        <span>{(selWordOv.color || "#FFE11A").toUpperCase()}</span>
                      </label>
                    </div>
                    <div className="ed-cs-slider" style={{ marginTop: 12 }}>
                      <div className="ed-cs-slabel"><span>Size</span><span>{selWordOv.size ?? (effSettings.size ?? 64)}</span></div>
                      <input type="range" min={24} max={220} step={1} value={selWordOv.size ?? (effSettings.size ?? 64)}
                        onChange={(e) => { const v = +e.target.value; setWordOverrides((pr) => { const cm = { ...(pr[_cidx] || {}) }; cm[String(selWordSafe)] = { ...(cm[String(selWordSafe)] || {}), size: v }; return { ...pr, [_cidx]: cm }; }); }}
                        onMouseUp={(e) => api.setWordOverride(projectId, activeIdx, selWordSafe, { size: +(e.target as HTMLInputElement).value }).catch(() => {})} />
                    </div>
                    <div className="ed-cs-toggle-row"><span>Glow</span>
                      <label className="ed-switch">
                        <input type="checkbox" checked={!!selWordOv.glow} onChange={(e) => setWordOv(selWordSafe, { glow: e.target.checked })} />
                        <span className="ed-switch-track" />
                      </label>
                    </div>
                    <div className="ed-cs-slabel" style={{ marginTop: 14, color: "var(--muted)" }}><span>MOVE ON VIDEO</span><span /></div>
                    {(selWordOv.x == null || selWordOv.y == null) ? (
                      <button className="ed-addcap" style={{ marginTop: 6 }} onClick={() => setWordOv(selWordSafe, { x: 50, y: 78 })}>Lift word out &amp; place</button>
                    ) : (
                      <>
                        <div className="ed-cs-slider" style={{ marginTop: 6 }}>
                          <div className="ed-cs-slabel"><span>X</span><span>{Math.round(selWordOv.x)}%</span></div>
                          <input type="range" min={0} max={100} step={1} value={Math.round(selWordOv.x)}
                            onChange={(e) => { const v = +e.target.value; setWordOverrides((pr) => { const cm = { ...(pr[_cidx] || {}) }; cm[String(selWordSafe)] = { ...(cm[String(selWordSafe)] || {}), x: v }; return { ...pr, [_cidx]: cm }; }); }}
                            onMouseUp={(e) => api.setWordOverride(projectId, activeIdx, selWordSafe, { x: +(e.target as HTMLInputElement).value }).catch(() => {})} />
                        </div>
                        <div className="ed-cs-slider">
                          <div className="ed-cs-slabel"><span>Y</span><span>{Math.round(selWordOv.y)}%</span></div>
                          <input type="range" min={0} max={100} step={1} value={Math.round(selWordOv.y)}
                            onChange={(e) => { const v = +e.target.value; setWordOverrides((pr) => { const cm = { ...(pr[_cidx] || {}) }; cm[String(selWordSafe)] = { ...(cm[String(selWordSafe)] || {}), y: v }; return { ...pr, [_cidx]: cm }; }); }}
                            onMouseUp={(e) => api.setWordOverride(projectId, activeIdx, selWordSafe, { y: +(e.target as HTMLInputElement).value }).catch(() => {})} />
                        </div>
                        <div className="np-sub" style={{ marginTop: 4 }}>Or just drag the word on the video.</div>
                        <button className="ed-addcap" style={{ marginTop: 8 }} onClick={() => setWordOv(selWordSafe, { x: null, y: null })}>Bring back inline</button>
                      </>
                    )}
                    <button className="ed-addcap" style={{ marginTop: 12 }} onClick={() => { clearWordOv(selWordSafe); setSelWord(-1); }}>Reset this word</button>
                  </div>
                )}
              </div>

              <div className="ed-cs-divider" />
              <div className="ed-anim-lbl">TRANSCRIPTION</div>
              <label className="ed-setting">
                <span>Show romanized (Thanglish)</span>
                <input type="checkbox" checked={showTranslit} onChange={(e) => setShowTranslit(e.target.checked)} />
              </label>
              <div className="np-label" style={{ marginTop: 14 }}>Language</div>
              <Dropdown value={lang} searchable placeholder="Select language"
                options={LANGS.map(([v, l]) => ({ value: v, label: l }))}
                onChange={setLang} />
              <button style={{ width: "100%", marginTop: 12 }} onClick={runTranscribe} disabled={busy || transcribing}>
                {transcribing ? "Transcribing…" : "Re-transcribe"}
              </button>

              <button className="ed-addcap" style={{ marginTop: 16 }} onClick={resetCapSettings}>Reset caption settings</button>
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
                  {([["caption", "Caption"], ["line", "Line"], ["word", "Word"]] as [string, string][]).map(([v, l]) => {
                    const sc = capSettings.scope || "caption";
                    const grp = sc === "line" ? "line" : sc === "single" ? "word" : "caption";
                    return (
                      <div key={v} className={"ed-seg-btn" + (grp === v ? " active" : "")}
                        onClick={() => saveCapSetting({ scope: v === "line" ? "line" : v === "word" ? "single" : (capSettings.cap_mode === "each_word" ? "word" : "caption") })}>{l}</div>
                    );
                  })}
                </div>
                {((capSettings.scope || "caption") === "caption" || capSettings.scope === "word") && (
                  <div className="ed-seg-row" style={{ marginTop: 8, maxWidth: 280 }}>
                    {([["each_word", "Each word"], ["block", "As one block"]] as [string, string][]).map(([v, l]) => {
                      const isEach = (capSettings.scope || "caption") === "word";
                      const active = (v === "each_word") === isEach;
                      return (
                        <div key={v} className={"ed-seg-btn" + (active ? " active" : "")}
                          onClick={() => saveCapSetting({ scope: v === "each_word" ? "word" : "caption", cap_mode: v })}>{l}</div>
                      );
                    })}
                  </div>
                )}
                <div className="np-sub" style={{ marginTop: 8 }}>
                  {(() => {
                    const sc = capSettings.scope || "caption";
                    return sc === "single" ? "Only the emphasised word animates \u2014 set it in Caption settings \u2192 Emphasized word."
                      : sc === "line" ? "Each line animates in separately."
                      : sc === "word" ? "Each word pops in on its own, right when it's spoken."
                      : "The whole caption animates in as one block.";
                  })()}
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

                <button className="secondary" style={{ width: "100%", marginTop: 14 }} onClick={resetCapSettings}>{IcReset} Reset to defaults</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== bottom timeline ===== */}
      <div className="ed-timeline">
        {tlToast && <div className="ed-tl-toast">{tlToast}</div>}
        <div className="ed-toolbar">
          <div className="ed-tb-group">
            <button className="ed-tb-btn" title="Undo" onClick={undo} disabled={undoStack.length === 0}>{IcUndo}</button>
            <button className="ed-tb-btn" title="Redo" onClick={redo} disabled={redoStack.length === 0}>{IcRedo}</button>
            <button className="ed-tb-btn" title="Delete selected caption" onClick={deleteAction}>{IcTrash}</button>
            <button className="ed-tb-btn" title="Jump to start" onClick={() => seek(0)}>{IcStart}</button>
            <span className="ed-tb-sep" />
            <button className="ed-tb-btn wide" title="Split caption at playhead" onClick={splitAction}>{IcSplit} Split</button>
            <button className="ed-tb-btn wide" title="Duplicate caption" onClick={duplicateAction}>{IcDup} Duplicate</button>
            <div className="ed-tb-aiwrap">
              <button className="ed-tb-btn wide" title="AI tools" onClick={() => setAiMenu((v) => !v)}>{IcAI} AI tools ▾</button>
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
            <button className="ed-tb-btn" title="Add text overlay" onClick={() => { setRail("texts"); addText(); }}>{IcTextTool}</button>
            <button className="ed-tb-btn" title="Toggle caption density" onClick={() => setDensity((d) => d === "roomy" ? "compact" : "roomy")}>{IcRows}</button>
          </div>

          <div className="ed-tb-center">
            <button className="ed-tb-btn" title="Previous caption" onClick={prevCap}>{IcPrev}</button>
            <button className="ed-tl-play" onClick={togglePlay}>{playing ? IcPause : IcPlay}</button>
            <button className="ed-tb-btn" title="Next caption" onClick={nextCap}>{IcNext}</button>
            <span className="muted ed-tb-time">{fmtT(curMs)} / {fmtT(dur)}</span>
          </div>

          <div className="ed-tb-group">
            <button className="ed-tb-btn" title="Zoom out timeline" onClick={() => setTlZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>{IcZoomOut}</button>
            <input type="range" min={0.5} max={4} step={0.25} value={tlZoom} className="ed-tb-zoom"
              onChange={(e) => setTlZoom(+e.target.value)} />
            <button className="ed-tb-btn" title="Zoom in timeline" onClick={() => setTlZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>{IcZoomIn}</button>
            <button className="ed-tb-btn" title="Fullscreen preview" onClick={toggleFullscreen}>{IcFull}</button>
            <span className="ed-tb-sep" />
            <span className="ed-tb-sel">Select</span>
            <button className={"ed-tb-selbtn" + (tlFilter === "all" ? " on" : "")} onClick={() => { setTlFilter("all"); setSelected(new Set(cues.map((c) => c.idx))); }}>All</button>
            <button className={"ed-tb-selbtn" + (tlFilter === "videos" ? " on" : "")} onClick={() => { setTlFilter("videos"); setSelected(new Set()); }}>Videos</button>
            <button className={"ed-tb-selbtn" + (tlFilter === "captions" ? " on" : "")} onClick={() => { setTlFilter("captions"); setSelected(new Set(cues.map((c) => c.idx))); }}>Captions</button>
          </div>
        </div>
        <div className="ed-tl-body">
          <div className="ed-tl-gutter">
            <div className="ed-th-ruler" />
            {trackHead("captions")}
            {overlays.length > 0 && trackHead("text")}
            {images.length > 0 && trackHead("images")}
            {brolls.length > 0 && trackHead("broll")}
            {filterLayers.length > 0 && trackHead("filters")}
            {trackHead("media", true)}
          </div>
          <div className="ed-tl2" ref={tl2Ref}>
          <div className="ed-tl2-inner" style={{ width: TLW }}>
            <div className="ed-ph" style={{ left: `${(curMs / dur) * 100}%` }}><span className="ed-ph-knob" /></div>
            <div className="ed-tl2-ruler" onClick={scrub}>
              {tlTicks.map((t) => (
                <span key={t} className="ed-tick" style={{ left: `${(t / dur) * 100}%` }}>{fmtT(t)}</span>
              ))}
            </div>

            <div className={"ed-lane" + (isHidden("captions") ? " lane-off" : "") + (isLocked("captions") ? " lane-lock" : "") + (tlFilter === "videos" ? " tl-dim" : "")} onClick={scrub}>
              {cues.map((c) => {
                const w = ((c.end_ms - c.start_ms) / dur) * 100;
                return (
                <div key={c.idx} className={"ed-tl-pill" + (c.idx === activeIdx ? " active" : "") + (selected.has(c.idx) ? " sel" : "")}
                  style={{ left: `${(c.start_ms / dur) * 100}%`, width: `${Math.max(w, 2.4)}%` }}
                  title={c.text}
                  onClick={(e) => { e.stopPropagation(); setSelected(new Set([c.idx])); setSelSeg(null); setRail("captions"); seek(c.start_ms); }}>
                  <span className="ed-tl-pill-t">{(showTranslit && c.translit_text ? c.translit_text : c.text)}</span>
                </div>
                );
              })}
            </div>

            {overlays.length > 0 && (
              <div className={"ed-lane" + (isHidden("text") ? " lane-off" : "") + (isLocked("text") ? " lane-lock" : "") + (tlFilter === "videos" ? " tl-dim" : "")} onClick={scrub}>
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
              <div className={"ed-lane" + (isHidden("images") ? " lane-off" : "") + (isLocked("images") ? " lane-lock" : "") + (tlFilter === "captions" ? " tl-dim" : "")} onClick={scrub}>
                {images.map((im) => (
                  <div key={im.id} className={"ed-tl-block ed-tl-img" + (selImg === im.id ? " sel" : "")}
                    style={{ left: `${(im.start_ms / dur) * 100}%`, width: `${Math.max(((im.end_ms - im.start_ms) / dur) * 100, 1.2)}%` }}
                    onClick={(e) => { e.stopPropagation(); setSelImg(im.id); setRail("images"); seek(im.start_ms); }}>{IcImageS}</div>
                ))}
              </div>
            )}

            {brolls.length > 0 && (
              <div className={"ed-lane" + (isHidden("broll") ? " lane-off" : "") + (isLocked("broll") ? " lane-lock" : "") + (tlFilter === "captions" ? " tl-dim" : "")} onClick={scrub}>
                {brolls.map((b) => (
                  <div key={b.id} className={"ed-tl-block ed-tl-broll ed-tl-clip" + (selBroll === b.id ? " sel" : "")}
                    style={{ left: `${(b.start_ms / dur) * 100}%`, width: `${Math.max(((b.end_ms - b.start_ms) / dur) * 100, 1.2)}%` }}
                    title="Drag to move · drag the edges to trim"
                    onMouseDown={(e) => startBrollClip(e, b, "move")}
                    onClick={(e) => { e.stopPropagation(); setSelBroll(b.id); setRail("broll"); }}>
                    <span className="ed-clip-h l" onMouseDown={(e) => startBrollClip(e, b, "left")} />
                    <span className="ed-clip-lb">{IcFilm2} {fmtT(b.end_ms - b.start_ms)}</span>
                    <span className="ed-clip-h r" onMouseDown={(e) => startBrollClip(e, b, "right")} />
                  </div>
                ))}
              </div>
            )}

            {filterLayers.length > 0 && (
              <div className={"ed-lane" + (isHidden("filters") ? " lane-off" : "") + (isLocked("filters") ? " lane-lock" : "") + (tlFilter === "captions" ? " tl-dim" : "")} onClick={scrub}>
                {filterLayers.map((l) => (
                  <div key={l.id} className={"ed-tl-block ed-tl-filter ed-tl-clip" + (selLayer === l.id ? " sel" : "")}
                    style={{ left: `${(l.start_ms / dur) * 100}%`, width: `${Math.max(((l.end_ms - l.start_ms) / dur) * 100, 1.2)}%` }}
                    title="Drag to move \u00b7 drag the edges to stretch"
                    onMouseDown={(e) => startFilterClip(e, l, "move")}
                    onClick={(e) => { e.stopPropagation(); setRail("filters"); selectLayer(l.id); }}>
                    <span className="ed-clip-h l" onMouseDown={(e) => startFilterClip(e, l, "left")} />
                    <span className="ed-clip-lb">{IcHalf} {gradeLabel(l.name)}</span>
                    <span className="ed-clip-h r" onMouseDown={(e) => startFilterClip(e, l, "right")} />
                  </div>
                ))}
              </div>
            )}

            <div className={"ed-lane ed-lane-media" + (isHidden("media") ? " lane-off" : "") + (isLocked("media") ? " lane-lock" : "") + (tlFilter === "captions" ? " tl-dim" : "")} onClick={scrub}>
              <div className="ed-media-clip">
                <div className="ed-media-name">{proj.source_filename || "video"} · {fmtT(dur)}</div>
                <Filmstrip src={mediaSrc} count={14} />
                <div className="ed-media-wave"><Waveform mediaEl={mediaEl} /></div>
                <div className="ed-seg-layer">
                  {segBounds.slice(0, -1).map((s0, i) => {
                    const e0 = segBounds[i + 1];
                    const removed = cutEdits.find((c) => c.start_ms <= s0 + 60 && c.end_ms >= e0 - 60);
                    return (
                      <div key={i} className={"ed-seg" + (selSeg === i ? " sel" : "") + (removed ? " removed" : "")}
                        style={{ left: `${(s0 / dur) * 100}%`, width: `${((e0 - s0) / dur) * 100}%` }}
                        title={removed ? "Removed segment — will be cut from the export" : "Click to select this segment"}
                        onClick={(ev) => { ev.stopPropagation(); setSelSeg(selSeg === i ? null : i); setSelected(new Set()); seek(s0 + 40); }}>
                        {(e0 - s0) / dur > 0.07 && <span className="ed-seg-lb">{fmtT(e0 - s0)}</span>}
                        {(() => {
                          const mine = dupEdits.filter((d) => d.start_ms >= s0 - 60 && d.end_ms <= e0 + 60);
                          return mine.length > 0 && !removed ? (
                            <button className="ed-seg-dup" title={"Plays \u00d7" + (mine.length + 1) + " in the export — click to remove one copy"}
                              onClick={(ev) => { ev.stopPropagation(); removeDup(mine[mine.length - 1]); }}>
                              {"\u00d7" + (mine.length + 1)}
                            </button>
                          ) : null;
                        })()}
                        {removed && (
                          <button className="ed-seg-restore" title="Restore this segment"
                            onClick={(ev) => { ev.stopPropagation(); restoreCut(removed.id); }}>{IcReset} Restore</button>
                        )}
                      </div>
                    );
                  })}
                  {videoCuts.map((c2, i) => (
                    <span key={"cut" + i} className="ed-seg-cutmark" style={{ left: `${(c2 / dur) * 100}%` }}
                      title="Split point — double-click to remove"
                      onDoubleClick={(ev) => { ev.stopPropagation(); saveVideoCuts(videoCuts.filter((x) => x !== c2)); toast("Split point removed"); }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
      {expJob && expJob.open && (
        <div className="ex-modal-bg" role="dialog" aria-modal="true">
          <div className="ex-modal">
            {expJob.status === "rendering" && (
              <>
                <div className="ex-title">Export is happening</div>
                <div className="ex-sub">Relax — we'll chime when it's ready.</div>
                <div className="ex-prog"><div className="ex-prog-fill" style={{ width: `${Math.round(expJob.pct)}%` }} /></div>
                <div className="ex-prog-row"><span>Rendering… {Math.round(expJob.pct)}%</span><span>{expJob.pct < 45 ? "a moment…" : "under a minute left"}</span></div>
                <div className="ex-note">Keep this tab open — you can switch tabs and keep working. We'll chime the moment your video is ready.</div>
                <div className="ex-btns">
                  <button className="ex-b hide" onClick={() => setExpJob((j) => (j ? { ...j, open: false } : j))}>Hide — keep exporting</button>
                  <button className="ex-b cancel" onClick={() => { if (progRef.current) window.clearInterval(progRef.current); setExpJob(null); }}>Cancel export</button>
                </div>
              </>
            )}
            {expJob.status === "ready" && (
              <>
                <div className="ex-title">Export <em>ready</em></div>
                <div className="ex-sub">Your {expJob.fmt.toUpperCase()} is ready.</div>
                <a className="ex-b go" href={api.mediaUrl(expJob.downloadUrl || expJob.url || "")} download>{IcTrayDown} Download</a>
                <a className="ex-b open" href={expJob.url ? api.mediaUrl(expJob.url) : "#"} target="_blank" rel="noreferrer">{IcExternal} Open in new tab</a>
                <button className="ex-b close" onClick={() => setExpJob(null)}>Close</button>
              </>
            )}
            {expJob.status === "error" && (
              <>
                <div className="ex-title">Export failed</div>
                <div className="ex-sub err">{expJob.error}</div>
                <button className="ex-b go" onClick={() => doExport(expJob.fmt, expRes)}>Try again</button>
                <button className="ex-b close" onClick={() => setExpJob(null)}>Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
