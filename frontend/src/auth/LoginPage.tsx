import { useState } from "react";
import { supabase } from "./supabase";

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

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div className="brand" style={{ fontSize: 26, marginBottom: 4 }}>maxfly<span>.ai</span></div>
        <p className="muted" style={{ marginTop: 0 }}>
          {mode === "in" ? "Sign in to your account" : "Create your account"}
        </p>

        <button className="secondary auth-google" onClick={google} type="button">
          Continue with Google
        </button>
        <div className="auth-or"><span>or</span></div>

        <form onSubmit={submit} className="auth-form">
          <input type="email" placeholder="Email" value={email} required
            onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" value={password} required
            minLength={6} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" disabled={busy}>
            {busy ? "…" : mode === "in" ? "Sign in" : "Sign up"}
          </button>
        </form>

        {err && <p className="auth-err">{err}</p>}
        {msg && <p className="auth-msg">{msg}</p>}

        <p className="muted auth-switch">
          {mode === "in" ? "Don't have an account? " : "Already have an account? "}
          <button className="linkbtn" onClick={() => { setMode(mode === "in" ? "up" : "in"); setErr(null); setMsg(null); }}>
            {mode === "in" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
