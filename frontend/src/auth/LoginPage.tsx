import { useState } from "react";
import { supabase } from "./supabase";

const FEATURES = [
  { ic: "⚡", title: "Lightning Fast", sub: "Generate subtitles in seconds with AI" },
  { ic: "🌐", title: "Multi-Language", sub: "Support for Tamil, Thanglish & English" },
  { ic: "🎨", title: "Custom Styling", sub: "Beautiful presets & animations" },
];

export function LoginPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Check your email to confirm your account, then sign in.");
      }
    } catch (e: any) {
      setErr(e.message || "Something went wrong");
    } finally { setBusy(false); }
  }

  async function google() {
    await supabase?.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  async function forgot() {
    if (!supabase) return;
    if (!email) { setErr("Enter your email above first, then tap Forgot password."); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setMsg("Password reset link sent — check your email.");
    } catch (e: any) {
      setErr(e.message || "Couldn't send reset email");
    } finally { setBusy(false); }
  }

  const isIn = mode === "in";

  return (
    <div className="auth-split">
      <div className="auth-left">
        <div className="auth-logo">
          <span className="auth-logo-mark">▶▶</span>
          <span className="auth-wordmark">maxfly<span>.ai</span></span>
        </div>
        <p className="auth-tagline">
          Transform your videos with AI-powered subtitle generation.
          Fast, accurate, and beautifully styled.
        </p>
        <div className="auth-feats">
          {FEATURES.map((f) => (
            <div className="auth-feat" key={f.title}>
              <span className="auth-feat-ic">{f.ic}</span>
              <div>
                <div className="auth-feat-title">{f.title}</div>
                <div className="auth-feat-sub">{f.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-formcard">
          <h1 className="auth-welcome">{isIn ? "Welcome Back" : "Create Account"}</h1>
          <p className="auth-welcome-sub">
            {isIn ? "Sign in to continue to " : "Sign up to get started with "}
            <span className="brand-inline">maxfly<span>.ai</span></span>
          </p>

          <button className="auth-google-btn" onClick={google} type="button">
            <span className="g-ic">G</span> Continue with Google
          </button>

          <div className="auth-divider"><span>OR CONTINUE WITH EMAIL</span></div>

          <form onSubmit={submit} className="auth-form2">
            <label className="auth-label">Email Address</label>
            <input type="email" placeholder="you@example.com" value={email} required
              onChange={(e) => setEmail(e.target.value)} />

            <label className="auth-label">Password</label>
            <input type="password" placeholder="Enter your password" value={password} required
              minLength={6} onChange={(e) => setPassword(e.target.value)} />

            {isIn && (
              <button type="button" className="auth-forgot linkbtn" onClick={forgot} disabled={busy}>
                Forgot password?
              </button>
            )}

            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? "…" : isIn ? "Sign In" : "Sign Up"}
            </button>
          </form>

          {err && <p className="auth-err">{err}</p>}
          {msg && <p className="auth-msg">{msg}</p>}

          <p className="auth-switch2">
            {isIn ? "Don't have an account? " : "Already have an account? "}
            <button className="linkbtn" onClick={() => { setMode(isIn ? "up" : "in"); setErr(null); setMsg(null); }}>
              {isIn ? "Sign up" : "Sign in"}
            </button>
          </p>

          <p className="auth-terms">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  );
}
