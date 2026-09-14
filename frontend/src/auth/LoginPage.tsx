import { useState } from "react";
import { IPlayFill } from "../components/icons";
import { supabase } from "./supabase";

// decorative, on-brand: the languages ceyonai captions, drifting in the bg
const CHIPS = [
  { t: "தமிழ்", x: "8%", y: "18%", d: "0s" },
  { t: "Thanglish", x: "78%", y: "12%", d: "1.6s" },
  { t: "हिंदी", x: "14%", y: "72%", d: "3.1s" },
  { t: "తెలుగు", x: "84%", y: "66%", d: "2.2s" },
  { t: "മലയാളം", x: "70%", y: "84%", d: "4.2s" },
  { t: "ಕನ್ನಡ", x: "22%", y: "40%", d: "5s" },
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
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: "select_account" },
      },
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
  function switchMode(m: "in" | "up") { setMode(m); setErr(null); setMsg(null); }

  return (
    <div className="lg-wrap">
      <div className="lg-bg" aria-hidden="true">
        <span className="lg-orb lg-o1" />
        <span className="lg-orb lg-o2" />
        <span className="lg-orb lg-o3" />
        <div className="lg-grid" />
        {CHIPS.map((c) => (
          <span key={c.t} className="lg-chip" style={{ left: c.x, top: c.y, animationDelay: c.d }}>
            <i className="lg-chip-dot" />{c.t}
          </span>
        ))}
      </div>

      <div className="lg-card">
        <div className="lg-brand">
          <span className="lg-mark">{IPlayFill}</span>
          <span className="lg-word">ceyon<span>ai</span></span>
        </div>

        <div className="lg-tabs" data-mode={mode}>
          <span className="lg-tab-ind" style={{ transform: isIn ? "translateX(0)" : "translateX(100%)" }} />
          <button type="button" className={"lg-tab" + (isIn ? " on" : "")} onClick={() => switchMode("in")}>Sign in</button>
          <button type="button" className={"lg-tab" + (!isIn ? " on" : "")} onClick={() => switchMode("up")}>Sign up</button>
        </div>

        <h1 className="lg-title">{isIn ? "Welcome back" : "Create your account"}</h1>
        <p className="lg-sub">
          {isIn ? "Pick up where you left off." : "Start captioning in minutes —"}{" "}
          {isIn ? "" : "no card needed."}
        </p>

        <button className="lg-google" onClick={google} type="button">
          <span className="lg-g">G</span> Continue with Google
        </button>

        <div className="lg-or"><span>or use your email</span></div>

        <form onSubmit={submit} className="lg-form">
          <div className="lg-field">
            <label>Email</label>
            <input type="email" placeholder="you@example.com" value={email} required
              onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="lg-field">
            <div className="lg-field-top">
              <label>Password</label>
              {isIn && (
                <button type="button" className="lg-forgot" onClick={forgot} disabled={busy}>
                  Forgot?
                </button>
              )}
            </div>
            <input type="password" placeholder={isIn ? "Your password" : "At least 6 characters"} value={password}
              required minLength={6} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <button type="submit" className="lg-submit" disabled={busy}>
            {busy ? "Please wait…" : isIn ? "Sign in" : "Create account"}
          </button>
        </form>

        {err && <p className="lg-err">{err}</p>}
        {msg && <p className="lg-msg">{msg}</p>}

        <p className="lg-terms">
          By continuing you agree to our Terms &amp; Privacy Policy.
        </p>
      </div>
    </div>
  );
}
