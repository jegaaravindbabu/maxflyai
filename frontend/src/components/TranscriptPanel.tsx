import { useState } from "react";
import type { Cue } from "../types";

interface Props {
  cues: Cue[];
  activeIdx: number;
  showTranslit: boolean;
  onSeek: (ms: number) => void;
  onEdit: (idx: number, text: string) => void;
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function TranscriptPanel({ cues, activeIdx, showTranslit, onSeek, onEdit }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  if (cues.length === 0) {
    return <p className="muted">No captions yet — run transcription.</p>;
  }

  return (
    <div className="transcript">
      {cues.map((c) => {
        const active = c.idx === activeIdx;
        return (
          <div
            key={c.idx}
            className={"cue" + (active ? " active" : "")}
            onClick={() => onSeek(c.start_ms)}
          >
            <div className="time">{fmt(c.start_ms)} → {fmt(c.end_ms)}</div>
            {editing === c.idx ? (
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => { onEdit(c.idx, draft); setEditing(null); }}
                style={{ width: "100%", background: "#12141c", color: "inherit",
                  border: "1px solid var(--accent)", borderRadius: 6, padding: 6 }}
              />
            ) : (
              <div
                className="txt"
                onDoubleClick={(e) => { e.stopPropagation(); setEditing(c.idx); setDraft(c.text); }}
                title="Double-click to edit"
              >
                {c.text}
              </div>
            )}
            {showTranslit && c.translit_text && (
              <div className="translit">{c.translit_text}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
