import { useEffect, useState } from "react";
import { api } from "../api/client";

interface Me { plan: string; label: string; minutes_cap: number; minutes_used: number;
  minutes_left: number; max_res: number; storage_gb: number; provider: string; }

interface Plan {
  id: string; name: string; price: string; per?: string; eff?: string; gst?: string; total?: string;
  minutes: string; rate?: string; feats: string[]; cta: string; badge?: string;
}

const PLANS: Plan[] = [
  { id: "free", name: "FREE", price: "₹0", per: "/forever", minutes: "15 min / month", cta: "Current plan",
    feats: ["Captions + translate preview", "720p export · ceyonai watermark", "MP4 export only",
      "1 GB storage · files kept 7 days"] },
  { id: "day", name: "DAY PASS", price: "₹59", per: "/day", minutes: "45 min · 24-hour access", cta: "Buy day pass", badge: "NEW",
    feats: ["Full access for 24 hours", "1080p / 4K · no watermark", "Every export format",
      "2 GB working storage"] },
  { id: "monthly", name: "MONTHLY", price: "₹499", per: "/month", minutes: "300 min / month", cta: "Go Monthly", badge: "MOST POPULAR",
    feats: ["Everything unlocked", "1080p / 4K · all caption styles", "All formats + translate export",
      "Priority processing · 30 GB storage"] },
  { id: "q3", name: "3 MONTHS", price: "₹1,199", per: "/3 mo", eff: "₹400/mo · save 20%", minutes: "900 min / 3 months", cta: "Get 3 months",
    feats: ["Everything in Monthly", "Lower locked-in rate", "Priority processing", "30 GB storage"] },
  { id: "h6", name: "6 MONTHS", price: "₹2,199", per: "/6 mo", eff: "₹366/mo · save 27%", minutes: "1800 min / 6 months", cta: "Get 6 months",
    feats: ["Everything in Monthly", "Priority support", "Best for steady creators", "30 GB storage"] },
  { id: "y1", name: "1 YEAR", price: "₹3,999", per: "/year", eff: "₹333/mo · save 33%", minutes: "3600 min / 1 year", cta: "Get 1 year", badge: "BEST VALUE",
    feats: ["Everything in Monthly", "Lowest effective price", "Priority support", "30 GB storage"] },
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
              {p.eff ? (
                <div className="pr-gst"><span className="pr-eff-badge">{p.eff}</span></div>
              ) : <div className="pr-gst muted">{p.id === "free" ? "Always free" : "Full access"}</div>}
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
        <p className="muted">Out of minutes or storage? Buy a one-time add-on without touching your plan. +18% GST added at checkout. Available on any paid plan.</p>
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
