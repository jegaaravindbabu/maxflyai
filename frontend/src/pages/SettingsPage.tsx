import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth, authEnabled } from "../auth/AuthContext";

export function SettingsPage() {
  const { email, signOut } = useAuth();
  const [me, setMe] = useState<any>(null);
  useEffect(() => { api.billingMe().then(setMe).catch(() => {}); }, []);
  return (
    <div className="main-inner">
      <h2 style={{ marginTop: 0 }}>Settings</h2>
      <div className="card">
        <div className="settings-row"><span className="muted">Account</span><span>{email || "Guest (auth off)"}</span></div>
        <div className="settings-row"><span className="muted">Plan</span><span>{me?.label || "Free"}</span></div>
        <div className="settings-row"><span className="muted">Minutes this month</span>
          <span>{me ? `${me.minutes_used} / ${me.minutes_cap}` : "…"}</span></div>
        <div className="settings-row"><span className="muted">Max resolution</span>
          <span>{me ? (me.max_res >= 2160 ? "4K" : me.max_res + "p") : "…"}</span></div>
        <div className="settings-row" style={{ borderBottom: "none" }}>
          <span className="muted">Language default</span><span>Tamil (ta-IN)</span></div>
      </div>
      {authEnabled && email && (
        <button className="secondary" style={{ marginTop: 16 }} onClick={() => signOut()}>Sign out</button>
      )}
    </div>
  );
}
