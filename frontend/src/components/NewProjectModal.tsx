import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Project } from "../types";

const LANGS: { code: string; label: string }[] = [
  { code: "ta-IN", label: "Tamil" },
  { code: "hi-IN", label: "Hindi" },
  { code: "te-IN", label: "Telugu" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "kn-IN", label: "Kannada" },
  { code: "en-IN", label: "English" },
];

const OUTPUT_MODES: { value: string; label: string }[] = [
  { value: "translit", label: "Romanized (Transliterated)" },
  { value: "transcribe", label: "Native script" },
];

function fmtSize(bytes: number) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(0) + " KB";
}
function fmtDur(ms?: number | null) {
  if (!ms) return "0:00";
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

type Status = "uploading" | "done" | "error";
interface Item {
  key: string;
  file: File;
  status: Status;
  progress: number;
  project?: Project;
  error?: string;
}

let counter = 0;

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const [lang, setLang] = useState("ta-IN");
  const [outputMode, setOutputMode] = useState("translit");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [layout, setLayout] = useState<"single" | "double">("single");
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    api.billingMe().then((m) => setMinutesLeft(m.minutes_left)).catch(() => {});
  }, []);

  function patch(key: string, p: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));
  }

  function addFiles(files: FileList | File[] | null | undefined) {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const key = `f${++counter}`;
      setItems((prev) => [...prev, { key, file, status: "uploading", progress: 0 }]);
      api
        .uploadWithProgress(file, (pct) => patch(key, { progress: pct }))
        .then((project) => patch(key, { status: "done", progress: 100, project }))
        .catch((e: any) => patch(key, { status: "error", error: e?.message || "Upload failed" }));
    });
  }

  function remove(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  const done = items.filter((it) => it.status === "done" && it.project);
  const anyUploading = items.some((it) => it.status === "uploading");
  const ready = done.length > 0 && !anyUploading;

  async function generate() {
    if (!ready) return;
    setGenerating(true);
    try {
      for (const it of done) {
        const id = it.project!.id;
        try {
          localStorage.setItem(`maxfly:proj:${id}`, JSON.stringify({ layout, outputMode, lang }));
        } catch {}
        try { await api.transcribe(id, lang, outputMode); } catch {}
      }
      window.location.hash = `#/project/${done[0].project!.id}`;
      onClose();
    } finally {
      setGenerating(false);
    }
  }

  function minRemaining(durationMs?: number | null) {
    const fileMin = (durationMs || 0) / 60000;
    if (minutesLeft == null) return null;
    return Math.max(0, minutesLeft - fileMin);
  }

  return (
    <div className="np-overlay" onClick={onClose}>
      <div className="np-modal" onClick={(e) => e.stopPropagation()}>
        <div className="np-head">
          <div className="np-head-l">
            <div className="np-plus">+</div>
            <div>
              <h2>New Project</h2>
              <p>Upload video &amp; configure subtitles</p>
            </div>
          </div>
          <button className="np-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="np-body">
          <div className="np-left">
            {items.length === 0 ? (
              <div
                className={"np-drop" + (drag ? " drag" : "")}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
                onClick={() => inputRef.current?.click()}
              >
                <div className="np-drop-ic">⤒</div>
                <div className="np-drop-title">Drag and drop video or audio files</div>
                <div className="np-sub">MP4, MOV, WebM, MP3, WAV · Max 10 min · 1GB per file</div>
                <button className="np-browse" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
                  Browse Files
                </button>
              </div>
            ) : (
              <div className="np-files card">
                {items.map((it) => (
                  <div className="np-filecard" key={it.key}>
                    <div className="np-filerow">
                      <div className="np-thumb">🎬</div>
                      <div className="np-fileinfo">
                        <div className="np-fname">{it.file.name}</div>
                        <div className="np-sub">{fmtSize(it.file.size)}{it.project?.duration_ms ? " · " + fmtDur(it.project.duration_ms) : ""}</div>
                      </div>
                      <div className="np-filestatus">
                        {it.status === "done" && <span className="np-ok">✓ Uploaded</span>}
                        {it.status === "uploading" && <span className="np-up">{it.progress}%</span>}
                        {it.status === "error" && <span className="np-fail">Failed</span>}
                        <button className="np-remove" onClick={() => remove(it.key)} aria-label="Remove">×</button>
                      </div>
                    </div>
                    <div className="np-bar">
                      <div className={"np-bar-fill" + (it.status === "error" ? " err" : "")} style={{ width: it.progress + "%" }} />
                    </div>
                    {it.status === "error" ? (
                      <div className="np-filestats err-text">{it.error}</div>
                    ) : (
                      <div className="np-filestats">
                        <span>Duration: {fmtDur(it.project?.duration_ms)}</span>
                        <span>Size: {fmtSize(it.file.size)}</span>
                        <span>{it.status === "uploading" ? "Uploading…" : minRemaining(it.project?.duration_ms) != null ? minRemaining(it.project?.duration_ms)!.toFixed(1) + " min remaining" : "Ready"}</span>
                      </div>
                    )}
                  </div>
                ))}
                <div className="np-addmore" onClick={() => inputRef.current?.click()}>+ Add more</div>
              </div>
            )}
            <input
              ref={inputRef} type="file" accept="video/*,audio/*" hidden multiple
              onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }}
            />
          </div>

          <div className="np-settings">
            <div className="np-settings-head">🌐 <span>Language Settings</span></div>
            <label className="np-label">🔊 Speaker's language</label>
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <label className="np-label" style={{ marginTop: 14 }}>🅰 Output mode</label>
            <select value={outputMode} onChange={(e) => setOutputMode(e.target.value)}>
              {OUTPUT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div className="np-prefs">
          <div className="np-prefs-head" onClick={() => setPrefsOpen((v) => !v)}>
            <span>Captioning Preferences</span>
            <span className={"np-chev" + (prefsOpen ? " open" : "")}>⌄</span>
          </div>
          {prefsOpen && (
            <div className="np-prefs-body">
              <p className="np-sub">Choose how captions are laid out on screen. You can fine-tune styling in the editor after upload.</p>
            </div>
          )}
        </div>

        <div className="np-toggle-wrap">
          <div className="np-toggle">
            <div className={"np-seg" + (layout === "single" ? " active" : "")} onClick={() => setLayout("single")}>Single Word</div>
            <div className={"np-seg" + (layout === "double" ? " active" : "")} onClick={() => setLayout("double")}>Double Line</div>
          </div>
        </div>

        <div className="np-foot">
          <div className="np-foot-status">
            <span className={"np-dot" + (ready ? " on" : "")} />
            {anyUploading ? "Uploading…" : done.length > 0 ? `${done.length} file${done.length > 1 ? "s" : ""} · Ready to generate` : "Add a file to start"}
          </div>
          <button className="np-generate" onClick={generate} disabled={!ready || generating}>
            {generating ? "Generating…" : "Generate subtitle"}
          </button>
        </div>
      </div>
    </div>
  );
}
