import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || "";
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// Auth is on only when configured AND explicitly enabled (mirrors backend AUTH_ENABLED).
export const authEnabled =
  !!url && !!anon && import.meta.env.VITE_AUTH_ENABLED === "true";

export const supabase: SupabaseClient | null =
  authEnabled ? createClient(url, anon) : null;
