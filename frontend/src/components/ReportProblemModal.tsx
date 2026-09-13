import { useState } from "react";

const SUPPORT_EMAIL = "aravindbabu6969@gmail.com";

export function ReportProblemModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");

  function send() {
    const body = encodeURIComponent(text.trim());
    window.open(
      "mailto:" + SUPPORT_EMAIL +
      "?subject=" + encodeURIComponent("ceyonai report") +
      "&body=" + body,
      "_blank",
    );
    onClose();
  }

  return (
    <div className="ed-modal-back" onClick={onClose}>
      <div className="ed-report" onClick={(e) => e.stopPropagation()}>
        <div className="ed-report-h">
          <span>Report an issue</span>
          <button className="ed-report-x" onClick={onClose}>×</button>
        </div>
        <p className="np-sub" style={{ margin: "0 0 12px" }}>Tell us what went wrong and we'll take a look.</p>
        <textarea className="ed-report-ta" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Describe the issue — what happened, what you expected…" />
        <div className="ed-report-f">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="ed-report-send" disabled={!text.trim()} onClick={send}>Send report</button>
        </div>
      </div>
    </div>
  );
}
