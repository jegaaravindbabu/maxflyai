import { useState } from "react";
import { api } from "../api/client";

const SUPPORT_EMAIL = "support@ceyonai.com";

export function ReportProblemModal({ onClose, projectId }: { onClose: () => void; projectId?: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setBusy(true); setErr(null);
    try {
      await api.submitReport(t, projectId);
      setSent(true);
      setTimeout(onClose, 1200);
    } catch {
      // fall back to the user's mail client if the API is unreachable
      setErr("Couldn't send it from here — opening your email app instead.");
      window.open(
        "mailto:" + SUPPORT_EMAIL +
        "?subject=" + encodeURIComponent("ceyonai report") +
        "&body=" + encodeURIComponent(t),
        "_blank",
      );
    } finally { setBusy(false); }
  }

  return (
    <div className="ed-modal-back" onClick={onClose}>
      <div className="ed-report" onClick={(e) => e.stopPropagation()}>
        <div className="ed-report-h">
          <span>Report an issue</span>
          <button className="ed-report-x" onClick={onClose}>×</button>
        </div>
        {sent ? (
          <p className="np-sub" style={{ margin: "8px 0 4px" }}>Thanks — your report was sent. We'll take a look.</p>
        ) : (
          <>
            <p className="np-sub" style={{ margin: "0 0 12px" }}>Tell us what went wrong and we'll take a look.</p>
            <textarea className="ed-report-ta" value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Describe the issue — what happened, what you expected…" />
            {err && <div style={{ color: "#f59e9e", fontSize: 13, marginTop: 8 }}>{err}</div>}
            <div className="ed-report-f">
              <button className="secondary" onClick={onClose}>Cancel</button>
              <button className="ed-report-send" disabled={!text.trim() || busy} onClick={send}>{busy ? "Sending…" : "Send report"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
