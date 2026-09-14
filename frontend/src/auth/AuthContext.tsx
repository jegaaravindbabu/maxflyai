import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, authEnabled } from "./supabase";
import { setAuthToken } from "../api/client";

interface AuthState {
  session: Session | null;
  email: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  session: null, email: null, loading: true, signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthToken(data.session?.access_token ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setAuthToken(s?.access_token ?? null);
      // After a successful sign-in (incl. the Google OAuth redirect, which returns
      // to the site root or with a token fragment), land the user inside the app.
      if (event === "SIGNED_IN") {
        const h = window.location.hash;
        if (h === "" || h === "#" || h === "#/" || h === "#/login" ||
            h.startsWith("#access_token") || h.startsWith("#error")) {
          window.location.hash = "#/app";
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    // Clear the local session first so logout is deterministic even if the
    // network revoke call fails; then send the user to the public landing.
    try { await supabase?.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
    setSession(null);
    setAuthToken(null);
    window.location.hash = "#/";
  };

  return (
    <Ctx.Provider value={{ session, email: session?.user?.email ?? null, loading, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
export { authEnabled };
