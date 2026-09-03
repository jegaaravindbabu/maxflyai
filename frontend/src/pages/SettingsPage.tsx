import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth, authEnabled } from "../auth/AuthContext";

function usePref(key: string, dflt: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try { const s = localStorage.getItem(key); return s === null ? dflt : s === "1"; } catch { return dflt; }
  });
  const set = (nv: boolean) => { setV(nv); try { localStorage.setItem(key, nv ? "1" : "0"); } catch {} };
  return [v, set];
}

function Switch({ on, onChange, disabled }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      className={"sw" + (on ? " on" : "")}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!on)}
      aria-pressed={on}
    >
      <span className="sw-knob" />
    </button>
  );
}

function memberSince(): string {
  let iso: string | null = null;
  try {
    iso = localStorage.getItem("maxfly:member_since");
    if (!iso) { iso = new Date().toISOString(); localStorage.setItem("maxfly:member_since", iso); }
  } catch {}
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function SettingsPage() {
  const { email, signOut } = useAuth();
  const [me, setMe] = useState<any>(null);
  useEffect(() => { api.billingMe().then(setMe).catch(() => {}); }, []);

  const [autoPreset, setAutoPreset] = usePref("maxfly:pref:autoPreset", true);
  const [sounds, setSounds] = usePref("maxfly:pref:sounds", true);
  const [scopeWarn, setScopeWarn] = usePref("maxfly:pref:scopeWarn", true);

  const mail = email || "guest@maxfly.ai";
  const name = email ? email.split("@")[0].replace(/[._-]+/g, " ") : "Creator";
  const planLabel = me?.label || "Free Plan";
  const since = memberSince();

  return (
    <div className="main-inner">
      <h1 className="pp-title">Settings</h1>
      <p className="pp-sub" style={{ marginBottom: 20 }}>Manage your account and preferences</p>

      <div className="set-card">
        <div className="set-label">PROFILE</div>
        <div className="set-profile">
          <div className="set-avatar">{name.charAt(0).toUpperCase()}</div>
          <div>
            <div className="set-name">{name}</div>
            <div className="set-mail">{mail}</div>
            <span className="set-plan">{planLabel}</span>
          </div>
        </div>
      </div>

      <div className="set-card">
        <div className="set-label">APPEARANCE</div>
        <div className="set-row">
          <div className="set-row-l">
            <span className="set-ic">☾</span>
            <div>
              <div className="set-row-title">Dark Mode</div>
              <div className="set-row-sub">Always on</div>
            </div>
          </div>
          <Switch on={true} disabled />
        </div>
      </div>

      <div className="set-card">
        <div className="set-label">EDITOR PREFERENCES</div>
        <div className="set-row">
          <div>
            <div className="set-row-title">Auto-apply caption preset</div>
            <div className="set-row-sub">Apply your default caption style automatically on first caption generation.</div>
          </div>
          <Switch on={autoPreset} onChange={setAutoPreset} />
        </div>
        <div className="set-row">
          <div>
            <div className="set-row-title">Play notification sounds</div>
            <div className="set-row-sub">Play a chime when uploads, captions, silence, or retake detection finishes.</div>
          </div>
          <Switch on={sounds} onChange={setSounds} />
        </div>
        <div className="set-row">
          <div>
            <div className="set-row-title">Show scope warning for Silence &amp; Retake Remover</div>
            <div className="set-row-sub">Warn when a single clip is selected so detection doesn't accidentally skip the rest of the timeline.</div>
          </div>
          <Switch on={scopeWarn} onChange={setScopeWarn} />
        </div>
      </div>

      <div className="set-card">
        <div className="set-label">ACCOUNT</div>
        <div className="set-row">
          <div className="set-row-title">Member since</div>
          <div className="set-row-val">{since}</div>
        </div>
        <div className="set-row">
          <div className="set-row-title">Subscription</div>
          <span className="set-tier">{me?.plan && me.plan !== "free" ? planLabel : "Free Tier"}</span>
        </div>
        <div className="set-row">
          <div className="set-row-title">Minutes this month</div>
          <div className="set-row-val">{me ? `${me.minutes_used} / ${me.minutes_cap} min` : "…"}</div>
        </div>
      </div>

      {authEnabled && email && (
        <button className="secondary" style={{ marginTop: 16 }} onClick={() => signOut()}>Sign out</button>
      )}
    </div>
  );
}
