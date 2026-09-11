import { useState } from "react";
import { Dropdown } from "./Dropdown";

interface Props {
  languages: [string, string][];
  initialLang: string;
  initialMode: string;
  hasCaptions: boolean;
  currentLangLabel?: string;
  onClose: () => void;
  onRun: (lang: string, mode: string, prefs: {
    max_chars: number; min_dur_secs: number; gap_frames: number; layout: string;
  }) => Promise<void> | void;
}

const STYLES: { id: string; title: string; sub: string; sample: string }[] = [
  { id: "transcribe", title: "Native script", sub: "Original language, its own script", sample: "வணக்கம்" },
  { id: "translit", title: "Romanized (Thanglish)", sub: "Native words in Latin letters", sample: "vanakkam" },
  { id: "codemix", title: "Code-mix", sub: "Natural mix of native + English", sample: "vanakkam, welcome" },
  { id: "translate", title: "English translation", sub: "Everything translated to English", sample: "hello, welcome" },
  { id: "verbatim", title: "Verbatim", sub: "Every word — keeps um / uh (pair with the filler remover)", sample: "um… hello" },
];

const LENGTHS: { id: string; label: string; chars: number }[] = [
  { id: "compact", label: "Compact", chars: 28 },
  { id: "balanced", label: "Balanced", chars: 42 },
  { id: "roomy", label: "Roomy", chars: 58 },
];

// A friendlier re-transcribe experience: pick the language, the output style,
// and how the captions are chunked — then rebuild them in one click.
export function TranscribeModal({ languages, initialLang, initialMode, hasCaptions, currentLangLabel, onClose, onRun }: Props) {
  const [lang, setLang] = useState(initialLang);
  const [style, setStyle] = useState(initialMode || "transcribe");
  const [length, setLength] = useState("balanced");
  const [layout, setLayout] = useState<"double" | "single">("double");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const chars = LENGTHS.find((l) => l.id === length)?.chars ?? 42;
    try {
      await onRun(lang, style, { max_chars: chars, min_dur_secs: 0.8, gap_frames: 0, layout });
      onClose();
    } catch { setBusy(false); }
  }

  return (
    <div className="ed-modal-scrim" onClick={onClose}>
      <div className="ed-txmodal" onClick={(e) => e.stopPropagation()}>
        <div className="ed-silmodal-hd">
          <div className="ed-silmodal-t">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" /><path d="M21 3v5h-5" /></svg>
            {hasCaptions ? "Re-transcribe captions" : "Transcribe captions"}
          </div>
          <div className="ed-silmodal-sub">Rebuild the captions from the audio in the language and style you choose.{currentLangLabel ? ` Currently: ${currentLangLabel}.` : ""}</div>
          <button className="ed-silmodal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="ed-silmodal-body">
          <div className="ed-tx-lbl">Spoken language</div>
          <Dropdown value={lang} searchable placeholder="Select language"
            options={languages.map(([v, l]) => ({ value: v, label: l }))} onChange={setLang} />

          <div className="ed-tx-lbl" style={{ marginTop: 16 }}>Output style</div>
          <div className="ed-tx-styles">
            {STYLES.map((s) => (
              <button key={s.id} className={"ed-tx-style" + (style === s.id ? " active" : "")} onClick={() => setStyle(s.id)}>
                <div className="ed-tx-style-t">{s.title}</div>
                <div className="ed-tx-style-s">{s.sub}</div>
                <div className="ed-tx-style-ex">{s.sample}</div>
              </button>
            ))}
          </div>

          <div className="ed-tx-grid">
            <div>
              <div className="ed-tx-lbl">Caption length</div>
              <div className="ed-seg-row">
                {LENGTHS.map((l) => (
                  <div key={l.id} className={"ed-seg-btn" + (length === l.id ? " active" : "")} onClick={() => setLength(l.id)}>{l.label}</div>
                ))}
              </div>
            </div>
            <div>
              <div className="ed-tx-lbl">Caption layout</div>
              <div className="ed-seg-row">
                <div className={"ed-seg-btn" + (layout === "double" ? " active" : "")} onClick={() => setLayout("double")}>Phrase lines</div>
                <div className={"ed-seg-btn" + (layout === "single" ? " active" : "")} onClick={() => setLayout("single")}>One word</div>
              </div>
            </div>
          </div>

          {hasCaptions && (
            <div className="ed-tx-warn">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              Re-transcribing rebuilds every caption from scratch — caption text edits are replaced. Your styling presets are kept.
            </div>
          )}
        </div>

        <div className="ed-silmodal-ft">
          <button className="ed-sil-cancel" onClick={onClose}>Cancel</button>
          <button className="ed-sil-apply" disabled={busy} onClick={run}>
            {busy ? "Starting…" : (hasCaptions ? "Re-transcribe" : "Transcribe")}
          </button>
        </div>
      </div>
    </div>
  );
}
