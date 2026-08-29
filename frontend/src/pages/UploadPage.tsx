import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Project } from "../types";

export function UploadPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => api.listProjects().then(setProjects).catch(() => {});
  useEffect(() => { load(); }, []);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const p = await api.upload(file);
      window.location.hash = `#/project/${p.id}`;
    } catch (e: any) {
      alert("Upload failed: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        className={"dropzone card" + (drag ? " drag" : "")}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault(); setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <h2 style={{ margin: "0 0 6px" }}>
          {busy ? "Uploading…" : "Drop a video to caption"}
        </h2>
        <p className="muted">MP4, MOV, WebM, or audio. We extract audio and transcribe with Sarvam Saaras.</p>
        <input
          ref={inputRef} type="file" accept="video/*,audio/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      <h3 style={{ marginTop: 26 }}>Your projects</h3>
      {projects.length === 0 && <p className="muted">No projects yet.</p>}
      <div className="proj-list">
        {projects.map((p) => (
          <a key={p.id} className="proj-item card" href={`#/project/${p.id}`}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {p.duration_ms ? Math.round(p.duration_ms / 1000) + "s" : ""}
              </div>
            </div>
            <span className={"badge " + p.status}>{p.status}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
