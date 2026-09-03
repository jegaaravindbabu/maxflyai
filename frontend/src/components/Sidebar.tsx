import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth, authEnabled } from "../auth/AuthContext";

interface Props { route: string; onNewProject: () => void; }

const NAV = [
  { id: "#/", ic: "⌂", label: "Home" },
  { id: "#/projects", ic: "▦", label: "Projects" },
  { id: "#/media", ic: "▤", label: "Media Library" },
  { id: "#/billing", ic: "◈", label: "Pricing" },
  { id: "#/settings", ic: "⚙", label: "Settings" },
];

export function Sidebar({ route, onNewProject }: Props) {
  const { email, signOut } = useAuth();
  const [use_, setUse] = useState<{ plan: string; label: string; minutes_used: number;
    minutes_cap: number; storage_gb: number } | null>(null);

  useEffect(() => { api.billingMe().then(setUse).catch(() => {}); }, [route]);

  const minPct = use_ ? Math.min(100, (use_.minutes_used / use_.minutes_cap) * 100) : 0;
  const name = (email ? email.split("@")[0] : "Guest");

  return (
    <aside className="sidebar">
      <div className="sb-logo">
        <div className="mark">▶</div>
        <div className="name">maxfly<span>.ai</span></div>
      </div>

      <button className="sb-new" onClick={onNewProject}><span>+ New Project</span></button>
      <div className="sb-promo">🎁 Have an influencer code?</div>

      <nav className="sb-nav">
        {NAV.map((n) => (
          <a key={n.id} href={n.id}
             className={"sb-item" + (route === n.id || (n.id === "#/" && route === "#/") ? " active" : "")}>
            <span className="ic">{n.ic}</span><span>{n.label}</span>
          </a>
        ))}
      </nav>

      <div className="sb-spacer" />

      <div className="sb-sub">
        <a className="sb-item"><span className="ic">💬</span><span>Assistants</span></a>
        <a className="sb-item" href="mailto:support@maxfly.ai"><span className="ic">⚑</span><span>Report a Problem</span></a>
      </div>

      <div className="sb-usage">
        <div className="lbl">USAGE</div>
        <div className="usage-row"><span>Minutes</span>
          <span className="v">{use_ ? `${use_.minutes_used} / ${use_.minutes_cap} min` : "…"}</span></div>
        <div className="usage-mini"><div style={{ width: minPct + "%" }} /></div>
        <div className="usage-row"><span>Storage</span>
          <span className="v">{use_ ? `0 / ${use_.storage_gb}.0 GB` : "…"}</span></div>
        <div className="usage-mini"><div style={{ width: "0%" }} /></div>
        <a href="#/billing"><button className="sb-new" style={{ marginTop: 4 }}><span>★ Increase limits</span></button></a>
      </div>

      <div className="sb-account">
        <div className="sb-avatar">{name[0]?.toUpperCase() || "G"}</div>
        <div className="who">{name}<br /><small>{use_?.label || "Free"} Plan</small></div>
      </div>
      {authEnabled && email && (
        <button className="sb-signout" onClick={() => signOut()}>
          <span className="ic">⏏</span><span>Sign out</span>
        </button>
      )}
    </aside>
  );
}
