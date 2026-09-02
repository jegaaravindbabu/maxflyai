import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Project } from "../types";

const AUDIO_EXT = ["mp3", "wav", "m4a", "aac", "ogg", "flac"];

function kind(p: Project): "video" | "audio" {
  const ext = (p.source_filename || p.name || "").split(".").pop()?.toLowerCase() || "";
  return AUDIO_EXT.includes(ext) ? "audio" : "video";
}

function fmtDur(ms?: number | null) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function fmtSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1073741824).toFixed(1) + " GB";
  if (bytes >= 1024 * 1024) return Math.round(bytes / 1048576) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

function timeAgo(iso?: string | null) {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MediaLibraryPage({ onNewProject }: { onNewProject: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"All" | "Video" | "Audio">("All");
  const [storageGb, setStorageGb] = useState(5);
  const [selectMode, setSelectMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = () => api.listProjects().then(setProjects).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { api.billingMe().then((b) => setStorageGb(b.storage_gb || 5)).catch(() => {}); }, []);

  const videos = projects.filter((p) => kind(p) === "video").length;
  const audios = projects.length - videos;
  const usedBytes = projects.reduce((a, p) => a + (p.size_bytes || 0), 0);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return projects.filter((p) => {
      if (filter === "Video" && kind(p) !== "video") return false;
      if (filter === "Audio" && kind(p) !== "audio") return false;
      if (t && !(p.name || "").toLowerCase().includes(t)) return false;
      return true;
    });
  }, [projects, q, filter]);

  function toggle(id: string) {
    setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectMode() { setSelectMode((v) => !v); setSel(new Set()); }
  async function deleteSelected() {
    if (sel.size === 0) return;
    if (!window.confirm(`Delete ${sel.size} item${sel.size > 1 ? "s" : ""}? This removes the project too.`)) return;
    setBusy(true);
    try {
      for (const id of sel) { try { await api.deleteProject(id); } catch {} }
      setSel(new Set()); setSelectMode(false); await load();
    } finally { setBusy(false); }
  }

  return (
    <div className="main-inner">
      <div className="pp-head">
        <div>
          <h1 className="pp-title">Media Library</h1>
          <p className="pp-sub">All uploaded videos and audio files from your projects</p>
        </div>
        <div className="pp-actions">
          {selectMode && sel.size > 0 && (
            <button className="secondary danger" onClick={deleteSelected} disabled={busy}>
              {busy ? "Deleting…" : `Delete (${sel.size})`}
            </button>
          )}
          <button className="secondary" onClick={toggleSelectMode}>{selectMode ? "Done" : "☑ Select"}</button>
          <span className="ml-storage">{fmtSize(usedBytes) || "0 MB"} / {storageGb.toFixed(1)} GB</span>
        </div>
      </div>

      <div className="tabs" style={{ marginTop: 6 }}>
        <div className="tab active" style={{ cursor: "default" }}>{projects.length} files</div>
        <div className="tab" style={{ cursor: "default" }}>{videos} videos</div>
        {audios > 0 && <div className="tab" style={{ cursor: "default" }}>{audios} audio</div>}
      </div>

      <div className="pp-search">
        <span className="pp-search-ic">⌕</span>
        <input type="text" placeholder="Search media…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="ml-filter">
        {(["All", "Video", "Audio"] as const).map((f) => (
          <div key={f} className={"seg" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>{f}</div>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="ic" style={{ fontSize: 30 }}>▤</div>
          <h3>{projects.length === 0 ? "No media yet" : "No matches"}</h3>
          <p>{projects.length === 0
            ? "Every video or audio you upload is available here across your projects."
            : "Try a different search or filter."}</p>
          {projects.length === 0 && <button onClick={onNewProject}>+ New Project</button>}
        </div>
      ) : (
        <div className="proj-grid">
          {filtered.map((p) => {
            const k = kind(p);
            const selected = sel.has(p.id);
            const act = () => { if (selectMode) toggle(p.id); else window.location.hash = `#/project/${p.id}`; };
            return (
              <div key={p.id} className={"proj-card card" + (selectMode ? " selectable" : "") + (selected ? " selected" : "")}>
                <div className="proj-thumb" onClick={act}>
                  <span className="ml-badge">{k === "audio" ? "AUDIO" : "VIDEO"}</span>
                  <span className="proj-play">{k === "audio" ? "♪" : "▶"}</span>
                  {(p.size_bytes || p.duration_ms) ? <span className="proj-subs">{fmtSize(p.size_bytes) || fmtDur(p.duration_ms)}</span> : null}
                  {selectMode && <span className={"proj-check" + (selected ? " on" : "")}>{selected ? "✓" : ""}</span>}
                </div>
                <div className="proj-meta">
                  <div className="proj-info" onClick={act}>
                    <div className="proj-name">{p.name}</div>
                    <div className="proj-time">{timeAgo(p.created_at)}</div>
                  </div>
                  <a className="ml-open" href={`#/project/${p.id}`}>⇱ Open</a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
