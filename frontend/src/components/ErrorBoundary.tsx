import React from "react";
import * as Sentry from "@sentry/react";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * App-wide crash guard. A render/runtime error anywhere in the tree shows a
 * friendly fallback (and a reload) instead of a blank white screen, and reports
 * the error to Sentry when VITE_SENTRY_DSN is configured.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      Sentry.captureException(error, {
        extra: { componentStack: info.componentStack },
      });
    } catch {
      /* Sentry not initialised — ignore */
    }
    // eslint-disable-next-line no-console
    console.error("ceyonai crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#080a12",
            color: "#eef1fb",
            fontFamily: "Inter, system-ui, sans-serif",
            padding: 24,
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: 460 }}>
            <div
              style={{
                fontFamily: "'Space Grotesk', Inter, sans-serif",
                fontSize: 22,
                fontWeight: 700,
                marginBottom: 10,
              }}
            >
              Something went wrong
            </div>
            <p style={{ color: "#98a2c8", lineHeight: 1.5, marginBottom: 20 }}>
              The editor hit an unexpected error. Your project is safe — reloading
              usually fixes it. If it keeps happening, let us know.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "linear-gradient(100deg,#8b6bff,#22d3ee)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "10px 20px",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
