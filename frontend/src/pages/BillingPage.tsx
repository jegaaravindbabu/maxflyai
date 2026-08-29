import { useEffect, useState } from "react";
import { api } from "../api/client";

interface Me { plan: string; label: string; minutes_cap: number; minutes_used: number;
  minutes_left: number; max_res: number; storage_gb: number; provider: string; }
interface Plan { id: string; label: string; minutes: number; storage_gb: number;
  max_res: number; price_inr: number; }

export function BillingPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () => api.billingMe().then(setMe).catch(() => {});
  useEffect(() => { load(); api.billingPlans().then((r) => setPlans(r.plans)).catch(() => {}); }, []);

  async function upgrade(plan: string) {
    setBusy(plan); setNote(null);
    try {
      const r = await api.billingCheckout(plan);
      if (r.mode === "razorpay" && r.order_id) {
        setNote("Razorpay checkout would open here (order " + r.order_id + ").");
      } else {
        setNote(r.message || `Switched to ${plan}.`);
        await load();
      }
    } catch (e: any) {
      setNote("Failed: " + e.message);
    } finally { setBusy(null); }
  }

  const pct = me ? Math.min(100, Math.round((me.minutes_used / me.minutes_cap) * 100)) : 0;
  const resLabel = (r: number) => (r >= 2160 ? "4K" : r + "p");

  return (
    <div>
      <a href="#/" className="linkbtn">← Back</a>
      <h2 style={{ margin: "10px 0 4px" }}>Plans & usage</h2>
      {me && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div><strong>{me.label}</strong> plan <span className="muted">({me.provider} billing)</span></div>
            <div className="muted">{me.minutes_used} / {me.minutes_cap} min this month</div>
          </div>
          <div className="usagebar"><div className="usagefill" style={{ width: pct + "%" }} /></div>
          <div className="hint">{me.minutes_left} minutes left · up to {resLabel(me.max_res)} · {me.storage_gb} GB storage</div>
        </div>
      )}

      {note && <p className="auth-msg">{note}</p>}

      <div className="plan-grid">
        {plans.map((p) => {
          const current = me?.plan === p.id;
          return (
            <div key={p.id} className={"card plan" + (current ? " current" : "")}>
              <div className="plan-name">{p.label}</div>
              <div className="plan-price">{p.price_inr === 0 ? "Free" : `₹${p.price_inr}`}
                {p.price_inr > 0 && <span className="muted">/mo</span>}</div>
              <ul className="plan-feats">
                <li>{p.minutes} min / month</li>
                <li>{p.storage_gb} GB storage</li>
                <li>up to {resLabel(p.max_res)}</li>
                <li>watermark-free</li>
              </ul>
              <button disabled={current || busy === p.id} onClick={() => upgrade(p.id)}
                className={current ? "secondary" : ""}>
                {current ? "Current plan" : busy === p.id ? "…" : p.price_inr === 0 ? "Downgrade" : "Upgrade"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        Prices are placeholders. Payments run in mock mode until a Razorpay key is added — upgrades apply instantly for testing.
      </p>
    </div>
  );
}
