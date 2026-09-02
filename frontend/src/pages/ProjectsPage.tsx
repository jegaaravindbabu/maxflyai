import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Project } from "../types";
import { ProjectCard } from "./HomePage";

export function ProjectsPage({ onNewProject }: { onNewProject: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [q, setQ] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = () => api.listProjects().then(setProjects).catch(() => {});
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return projects;
    return projects.filter((p) => (p.name || "").toLowerCase().includes(t));
  }, [projects, q]);

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSel(new Set());
  }

  async function deleteSelected() {
    if (sel.size === 0) return;
    if (!window.confirm(`Delete ${sel.size} project${sel.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      for (const id of sel) {
        try { await api.deleteProject(id); } catch {}
      }
      setSel(new Set());
      setSelectMode(false);
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div className="main-inner">
      <div className="pp-head">
        <div>
          <h1 className="pp-title">Projects</h1>
          <p className="pp-sub">{projects.length} {projects.length === 1 ? "project" : "projects"}</p>
        </div>
        <div className="pp-actions">
          {selectMode && sel.size > 0 && (
            <button className="secondary danger" onClick={deleteSelected} disabled={busy}>
              {busy ? "Deleting…" : `Delete (${sel.size})`}
            </button>
          )}
          <button className="secondary" onClick={toggleSelectMode}>
            {selectMode ? "Done" : "☑ Select"}
          </button>
          <button className="big-btn" onClick={onNewProject}>+ New Project</button>
        </div>
      </div>

      <div className="pp-search">
        <span className="pp-search-ic">⌕</span>
        <input
          type="text"
          placeholder="Search projects…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="ic" style={{ fontSize: 30 }}>▦</div>
          <h3>{projects.length === 0 ? "No projects yet" : "No matches"}</h3>
          <p>
            {projects.length === 0
              ? "Upload a video to generate AI-powered subtitles in seconds."
              : "Try a different search term."}
          </p>
          {projects.length === 0 && <button onClick={onNewProject}>+ Create First Project</button>}
        </div>
      ) : (
        <div className="proj-grid">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              p={p}
              onChanged={load}
              selectable={selectMode}
              selected={sel.has(p.id)}
              onToggleSelect={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
