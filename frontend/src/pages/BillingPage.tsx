import { useEffect, useState } from "react";
import { api } from "../api/client";

interface Me { plan: string; label: string; minutes_cap: number; minutes_used: number;
  minutes_left: number; max_res: number; storage_gb: number; provider: string; }

interface Plan {
  id: string; name: string; price: string; per?: string; gst?: string; total?: string;
  minutes: string; rate?: string; feats: string[]; cta: string; badge?: string;
}

const PLANS: Plan[] = [
  { id: "free", name: "FREE", price: "Free", minutes: "5 Minutes / Month", cta: "Current plan",
    feats: ["5 GB cloud storage", "Files auto-delete after 7 days", "Transcribe + Romanize + Translate",
      "Max Export: 720p", "1 export / month (max 1 minute)", "No watermark"] },
  { id: "daily", name: "DAILY PASS", price: "₹89", per: "/day", gst: "₹16.02", total: "₹105.02/day",
    minutes: "10 Minutes (24-hour access)", cta: "Buy Pass", badge: "NEW",
    feats: ["5 GB storage (files kept 7 days)", "Silence + Retake remover", "Audio + Video enhancement",
      "NLE export (Premiere / DaVinci / FCP)", "SRT / VTT / TXT export", "Max Export: 4K"] },
  { id: "starter", name: "STARTER", price: "₹399", per: "/month", gst: "₹71.82", total: "₹470.82/month",
    minutes: "25 Minutes / Month", cta: "Get Starter",
    feats: ["10 GB cloud storage (permanent)", "Audio enhancement included", "SRT / VTT / TXT export",
      "Max Export: 1080p", "Transcribe + Romanize + Translate"] },
  { id: "creator", name: "CREATOR", price: "₹799", per: "/month", gst: "₹143.82", total: "₹942.82/month",
    minutes: "80 Minutes / Month", rate: "₹9.99 / MIN", cta: "Get Creator", badge: "MOST POPULAR",
    feats: ["30 GB cloud storage (permanent)", "Silence + Retake remover", "Audio + Video enhancement",
      "NLE export (Premiere / DaVinci / FCP)", "Custom fonts & presets", "Priority AI processing", "Max Export: 4K"] },
  { id: "pro", name: "PRO", price: "₹2,499", per: "/month", gst: "₹449.82", total: "₹2,948.82/month",
    minutes: "250 Minutes / Month", rate: "₹10.00 / MIN", cta: "Get Pro",
    feats: ["100 GB cloud storage (permanent)", "Everything in Creator", "Priority AI processing",
      "Team workspace — 5 seats included", "Max Export: 4K"] },
];

const TOPUP_MIN: [string, string][] = [["+5", "₹50"], ["+10", "₹100"], ["+25", "₹250"], ["+50", "₹500"], ["+100", "₹1000"]];
const TOPUP_GB: [string, string][] = [["+10", "₹30"], ["+25", "₹75"], ["+50", "₹150"], ["+100", "₹300"], ["+200", "₹600"]];

export function BillingPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () => api.billingMe().then(setMe).catch(() => {});
  useEffect(() => { load(); }, []);

  async function choose(id: string) {
    if (id === "free") return;
    setBusy(id); setNote(null);
    try {
      const r = await api.billingCheckout(id);
      if (r.mode === "razorpay" && r.order_id) setNote("Razorpay checkout would open here (order " + r.order_id + ").");
      else { setNote(r.message || `Switched to ${id}.`); await load(); }
    } catch (e: any) { setNote("This plan isn't wired to checkout yet — " + (e?.message || "coming soon") + "."); }
    finally { setBusy(null); }
  }

  const pct = me ? Math.min(100, Math.round((me.minutes_used / Math.max(1, me.minutes_cap)) * 100)) : 0;
  const currentId = me?.plan || "free";

  return (
    <div className="main-inner">
      <div className="pr-hero">
        <div className="pr-eyebrow">PRICING</div>
        <h1 className="pr-title">Choose your plan</h1>
        <p className="pr-sub">AI-powered editing built for Indian language creators</p>
      </div>

      {me && (
        <div className="pr-usage">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div><strong>{me.label}</strong> plan</div>
            <div className="muted">{me.minutes_used} / {me.minutes_cap} min this month · {me.storage_gb} GB storage</div>
          </div>
          <div className="usagebar"><div className="usagefill" style={{ width: pct + "%" }} /></div>
        </div>
      )}

      {note && <p className="auth-msg">{note}</p>}

      <div className="pr-grid">
        {PLANS.map((p) => {
          const current = currentId === p.id;
          return (
            <div key={p.id} className={"pr-card" + (p.badge === "MOST POPULAR" ? " popular" : "") + (current ? " current" : "")}>
              {p.badge && <div className={"pr-badge" + (p.badge === "MOST POPULAR" ? " pop" : "")}>{p.badge}</div>}
              <div className="pr-name">{p.name}</div>
              <div className="pr-price">{p.price}{p.per && <span className="pr-per">{p.per}</span>}</div>
              {p.gst ? (
                <div className="pr-gst">+ 18% GST {p.gst}<br /><span className="muted">Total {p.total}</span></div>
              ) : <div className="pr-gst muted">Always free</div>}
              <div className="pr-mins">{p.minutes}{p.rate && <span className="pr-rate"> · {p.rate}</span>}</div>
              <ul className="pr-feats">
                {p.feats.map((f) => <li key={f}>{f}</li>)}
              </ul>
              <button className={"pr-cta" + (p.badge === "MOST POPULAR" ? " pop" : "")}
                disabled={busy === p.id || (current && p.id === "free")}
                onClick={() => choose(p.id)}>
                {current ? "Current plan" : busy === p.id ? "…" : p.cta}
              </button>
            </div>
          );
        })}
      </div>

      <div className="pr-topup">
        <h2>Top up anytime</h2>
        <p className="muted">Out of minutes or storage? Buy a one-time add-on without touching your plan. +18% GST added at checkout. Available on Starter, Creator, and Pro.</p>
        <div className="pr-topup-grid">
          <div className="pr-topup-card">
            <div className="pr-topup-head">EXTRA MINUTES <span className="muted">₹10 / MIN</span></div>
            <p className="np-sub">Adds to your monthly transcription minutes, used after your plan minutes are exhausted.</p>
            <div className="pr-chips">
              {TOPUP_MIN.map(([q, pr]) => (
                <div key={q} className="pr-chip" onClick={() => setNote(`Add-on ${q} minutes (${pr}) — checkout coming soon.`)}>
                  <div className="pr-chip-q">{q} MIN</div><div className="pr-chip-p">{pr}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="pr-topup-card">
            <div className="pr-topup-head">EXTRA STORAGE <span className="muted">₹3 / GB / MO</span></div>
            <p className="np-sub">Permanent extra cloud storage stacked on top of your plan quota.</p>
            <div className="pr-chips">
              {TOPUP_GB.map(([q, pr]) => (
                <div key={q} className="pr-chip" onClick={() => setNote(`Add-on ${q} GB (${pr}) — checkout coming soon.`)}>
                  <div className="pr-chip-q">{q} GB</div><div className="pr-chip-p">{pr}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
