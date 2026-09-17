import { useState } from "react";
import { ICeyonMark } from "../components/icons";
import { supabase } from "./supabase";

// Reached from a password-recovery email link: Supabase establishes a temporary
// recovery session and fires PASSWORD_RECOVERY, and AuthContext routes here.
// The user sets a new password via updateUser, then continues into the app.
export function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (password.length < 6) { setErr("Use at least 6 characters."); return; }
    if (password !== confirm) { setErr("The two passwords don't match."); return; }
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => { window.location.hash = "#/app"; }, 1200);
    } catch (e: any) {
      setErr(e.message || "Couldn't update your password. Request a new reset link and try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="lg-wrap">
      <div className="lg-bg" aria-hidden="true">
        <span className="lg-orb lg-o1" />
        <span className="lg-orb lg-o2" />
        <span className="lg-orb lg-o3" />
        <div className="lg-grid" />
      </div>

      <div className="lg-card">
        <div className="lg-brand">
          <span className="lg-mark">{ICeyonMark}</span>
          <span className="lg-word">ceyon<span>ai</span></span>
        </div>

        <h1 className="lg-title">Set a new password</h1>
        <p className="lg-sub">Choose a new password for your account.</p>

        {done ? (
          <div className="lg-msg">Password updated — taking you to your projects…</div>
        ) : (
          <form onSubmit={submit} className="lg-form">
            <div className="lg-field">
              <label>New password</label>
              <input type="password" placeholder="At least 6 characters" value={password} autoFocus
                required minLength={6} autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="lg-field">
              <label>Confirm password</label>
              <input type="password" placeholder="Re-enter your new password" value={confirm}
                required minLength={6} autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {err && <div className="lg-err">{err}</div>}
            <button type="submit" className="lg-submit" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}

        <button type="button" className="lg-forgot" style={{ marginTop: 14 }}
          onClick={() => { window.location.hash = "#/login"; }}>Back to sign in</button>
      </div>
    </div>
  );
}
