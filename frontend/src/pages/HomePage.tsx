import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Project } from "../types";
import { useAuth } from "../auth/AuthContext";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function timeAgo(iso?: string | null) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ProjectCard({ p, onChanged, selectable = false, selected = false, onToggleSelect }: {
  p: Project; onChanged: () => void;
  selectable?: boolean; selected?: boolean; onToggleSelect?: (id: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const on = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [menu]);

  function open() { window.location.hash = `#/project/${p.id}`; }
  function primary() { if (selectable) onToggleSelect?.(p.id); else open(); }

  async function rename() {
    setMenu(false);
    const name = window.prompt("Rename project", p.name);
    if (name && name.trim() && name.trim() !== p.name) {
      await api.renameProject(p.id, name.trim());
      onChanged();
    }
  }
  async function duplicate() {
    setMenu(false);
    setAction("Duplicating…");
    try { await api.duplicateProject(p.id); onChanged(); } finally { setAction(null); }
  }
  async function del() {
    setMenu(false);
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    setAction("Deleting…");
    try { await api.deleteProject(p.id); onChanged(); } catch { setAction(null); }
  }
  async function exportAndDownload(fmt: string) {
    setMenu(false);
    setAction(fmt === "mp4" ? "Exporting MP4…" : "Preparing SRT…");
    try {
      const r = await api.exportSub(p.id, fmt, true, true, "classic", false);
      const eid = r.export_id;
      for (let i = 0; i < 160; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        const list = await api.listExports(p.id);
        const row = list.find((x) => x.id === eid);
        if (row && row.status !== "processing") {
          if (row.status === "ready" && row.url) window.open(api.mediaUrl(row.url), "_blank");
          else alert(fmt.toUpperCase() + " export failed.");
          return;
        }
      }
      alert("Export timed out — try from the editor.");
    } finally { setAction(null); }
  }

  const subs = p.sub_count ?? 0;

  return (
    <div className={"proj-card card" + (selectable ? " selectable" : "") + (selected ? " selected" : "")} ref={wrapRef}>
      <div className="proj-thumb" onClick={primary}>
        <span className="proj-play">▶</span>
        {subs > 0 && <span className="proj-subs">{subs} subs</span>}
        {selectable && <span className={"proj-check" + (selected ? " on" : "")}>{selected ? "✓" : ""}</span>}
        {action && <div className="proj-action">{action}</div>}
      </div>
      <div className="proj-meta">
        <div className="proj-info" onClick={primary}>
          <div className="proj-name">{p.name}</div>
          <div className="proj-time">{timeAgo(p.created_at)}</div>
        </div>
        <div className="proj-menu-wrap">
          <button className="proj-dots" onClick={() => setMenu((v) => !v)} aria-label="Options">⋮</button>
          {menu && (
            <div className="proj-menu">
              <div className="pm-item" onClick={open}>▦ Edit</div>
              <div className="pm-item" onClick={rename}>✎ Rename</div>
              <div className="pm-item" onClick={duplicate}>⧉ Duplicate</div>
              <div className="pm-item" onClick={() => exportAndDownload("mp4")}>⬇ Export Mp4</div>
              <div className="pm-item" onClick={() => exportAndDownload("srt")}>▤ Download SRT</div>
              <div className="pm-item danger" onClick={del}>🗑 Delete</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function HomePage({ onNewProject }: { onNewProject: () => void }) {
  const { email } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tab, setTab] = useState<"Projects" | "Media" | "Exports">("Projects");
  const [plan, setPlan] = useState("Free");

  const load = () => api.listProjects().then(setProjects).catch(() => {});
  useEffect(() => {
    load();
    api.billingMe().then((m) => setPlan(m.label)).catch(() => {});
  }, []);

  const name = email ? email.split("@")[0] : "creator";

  return (
    <div className="main-inner">
      <div className="hero">
        <div>
          <div className="plan-tag">{plan.toUpperCase()} PLAN</div>
          <h1>{greeting()}, <em>{name}</em></h1>
          <p>Create AI-powered captions & subtitles for your videos in seconds</p>
        </div>
        <button className="big-btn" onClick={onNewProject}>+ New Project</button>
      </div>

      <div className="section-head">
        <h2 className="section-title">
          Recent Projects
          {projects.length > 0 && <span className="section-count">{projects.length}</span>}
        </h2>
        <a className="view-all" href="#/projects">View All ›</a>
      </div>
      <div className="tabs">
        {(["Projects", "Media", "Exports"] as const).map((t) => (
          <div key={t} className={"tab" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>{t}</div>
        ))}
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <div className="ic" style={{ fontSize: 30 }}>▦</div>
          <h3>No projects yet</h3>
          <p>Upload a video to generate AI-powered subtitles in seconds.</p>
          <button onClick={onNewProject}>+ Create First Project</button>
        </div>
      ) : (
        <div className="proj-grid">
          {projects.map((p) => <ProjectCard key={p.id} p={p} onChanged={load} />)}
        </div>
      )}
    </div>
  );
}
