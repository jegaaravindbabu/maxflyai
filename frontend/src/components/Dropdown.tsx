import { useEffect, useRef, useState } from "react";

export interface DDOption { value: string; label: string; sub?: string; }

/** Clean custom dropdown: searchable list + optional per-option subtitle.
 *  Shared by the New Project modal and the editor AI Tools picker. */
export function Dropdown({ value, options, onChange, searchable, placeholder }: {
  value: string;
  options: DDOption[];
  onChange: (v: string) => void;
  searchable?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const cur = options.find((o) => o.value === value);
  const shown = searchable && q.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
    : options;
  return (
    <div className={"np-dd" + (open ? " open" : "")} ref={wrapRef}>
      <button type="button" className="np-dd-trigger" onClick={() => setOpen((v) => !v)}>
        <span>{cur ? cur.label : (placeholder || "Select…")}</span>
        <span className="np-dd-chev">⌄</span>
      </button>
      {open && (
        <div className="np-dd-panel">
          {searchable && (
            <div className="np-dd-search">
              <span>⌕</span>
              <input autoFocus placeholder="Search language…" value={q}
                onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <div className="np-dd-list">
            {shown.map((o) => (
              <div key={o.value} className={"np-dd-opt" + (o.value === value ? " sel" : "")}
                onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}>
                <div className="np-dd-opt-main">
                  <span className="np-dd-opt-label">{o.label}</span>
                  {o.sub && <span className="np-dd-opt-sub">{o.sub}</span>}
                </div>
                {o.value === value && <span className="np-dd-check">✓</span>}
              </div>
            ))}
            {shown.length === 0 && <div className="np-dd-empty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
