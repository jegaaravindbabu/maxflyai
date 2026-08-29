import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Project } from "../types";
import { useAuth } from "../auth/AuthContext";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function HomePage({ onNewProject }: { onNewProject: () => void }) {
  const { email } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tab, setTab] = useState<"Projects" | "Media" | "Exports">("Projects");
  const [plan, setPlan] = useState("Free");

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => {});
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

      <h2 className="section-title">Recent Projects</h2>
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
          {projects.map((p) => (
            <a key={p.id} href={`#/project/${p.id}`} className="proj-card card">
              <div className="thumb">▶</div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                <span className={"badge " + p.status}>{p.status}</span>
                {p.duration_ms ? ` · ${Math.round(p.duration_ms / 1000)}s` : ""}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
