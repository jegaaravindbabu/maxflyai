// Editor preferences (Settings page). Stored in localStorage as "1"/"0",
// default ON, matching usePref in SettingsPage.
const KEYS = {
  autoPreset: "ceyonai:pref:autoPreset",
  sounds: "ceyonai:pref:sounds",
  scopeWarn: "ceyonai:pref:scopeWarn",
} as const;

export function prefOn(name: keyof typeof KEYS, dflt = true): boolean {
  try {
    const s = localStorage.getItem(KEYS[name]);
    return s === null ? dflt : s === "1";
  } catch { return dflt; }
}

// The user's default caption preset, remembered whenever they change style.
const DEFAULT_PRESET_KEY = "ceyonai:defaultPreset";
export function getDefaultPreset(): string | null {
  try { return localStorage.getItem(DEFAULT_PRESET_KEY); } catch { return null; }
}
export function setDefaultPreset(id: string): void {
  try { if (id) localStorage.setItem(DEFAULT_PRESET_KEY, id); } catch {}
}

// Short, pleasant completion chime via WebAudio (no asset). Gated on the pref.
let _ctx: AudioContext | null = null;
export function chime(): void {
  if (!prefOn("sounds")) return;
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AC) return;
    _ctx = _ctx || new AC();
    const ctx = _ctx;
    const now = ctx.currentTime;
    // two soft notes (C6 -> E6)
    [ [1046.5, 0], [1318.5, 0.12] ].forEach(([f, t]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f as number;
      o.connect(g); g.connect(ctx.destination);
      const s = now + (t as number);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.14, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.22);
      o.start(s); o.stop(s + 0.24);
    });
  } catch { /* ignore */ }
}
