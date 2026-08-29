import { useEffect, useRef, useState } from "react";
import { api } from "./api/client";
import { AuthProvider, useAuth, authEnabled } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./pages/HomePage";
import { EditorPage } from "./pages/EditorPage";
import { BillingPage } from "./pages/BillingPage";
import { SettingsPage } from "./pages/SettingsPage";

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function MediaPlaceholder() {
  return (
    <div className="main-inner">
      <h2 style={{ marginTop: 0 }}>Media Library</h2>
      <div className="empty"><div className="ic" style={{ fontSize: 30 }}>▤</div>
        <h3>Your uploads live here</h3>
        <p>Every video you upload is available across your projects.</p></div>
    </div>
  );
}

function Shell() {
  const hash = useHashRoute();
  const match = hash.match(/^#\/project\/(.+)$/);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const openUpload = () => inputRef.current?.click();
  async function handleFile(file: File) {
    setUploading(true);
    try {
      const p = await api.upload(file);
      window.location.hash = `#/project/${p.id}`;
    } catch (e: any) {
      alert("Upload failed: " + e.message);
    } finally { setUploading(false); }
  }

  let content;
  if (match) content = <EditorPage projectId={match[1]} />;
  else if (hash === "#/billing") content = <BillingPage />;
  else if (hash === "#/settings") content = <SettingsPage />;
  else if (hash === "#/media") content = <MediaPlaceholder />;
  else content = <HomePage onNewProject={openUpload} />;

  return (
    <div className="shell">
      <Sidebar route={hash} onNewProject={openUpload} />
      <main className="main">
        {uploading && <div className="uploading-bar">Uploading…</div>}
        {content}
      </main>
      <input ref={inputRef} type="file" accept="video/*,audio/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
    </div>
  );
}

function Gate() {
  const { session, loading } = useAuth();
  if (!authEnabled) return <Shell />;
  if (loading) return <div style={{ padding: 24 }} className="muted">Loading…</div>;
  if (!session) return <LoginPage />;
  return <Shell />;
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
