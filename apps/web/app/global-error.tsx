"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * The boundary of last resort — fires when the root layout itself throws.
 *
 * It has to render its own `<html>` and `<body>`, because the layout that
 * normally provides them is the thing that failed. That also means none of the
 * app's CSS is guaranteed to be present, so the styling here is inline and
 * deliberately crude: this file cannot depend on @huntloop/ui, on Tailwind
 * having loaded, or on the token variables existing.
 *
 * The colours are the canvas/text tokens hard-coded. Duplicating them is worth
 * it for a file whose entire job is to work when nothing else did.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // If the root layout threw, this is the only report that will be made.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        {/*
         * This page can't reach tokens.css or `data-theme` — it replaces the
         * root layout that would normally provide both, and its whole job is
         * to work when nothing else did (see the file comment above). It
         * follows the OS preference directly instead: a plain media query,
         * no script, no nonce, `!important` to win over the inline `style`
         * attributes below. It does not honor an in-app System/Light/Dark
         * override, which is an acceptable gap for a last-resort screen that
         * intentionally depends on nothing else in the app.
         */}
        <style
          dangerouslySetInnerHTML={{
            __html: `@media (prefers-color-scheme: light) {
  .hl-global-error { background:#f3f1ea!important; color:#1c1a15!important; }
  .hl-global-error-muted { color:#666154!important; }
  .hl-global-error-btn { color:#1c1a15!important; background:#ffffff!important; border-color:#ddd7c6!important; }
}`,
          }}
        />
      </head>
      <body
        className="hl-global-error"
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#171717",
          color: "#ededed",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "3rem 1.5rem",
        }}
      >
        <div style={{ maxWidth: "24rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "15px", fontWeight: 600, margin: 0 }}>
            Huntloop failed to start
          </h1>
          <p
            className="hl-global-error-muted"
            style={{
              fontSize: "13px",
              lineHeight: 1.5,
              color: "#949494",
              marginTop: "0.5rem",
            }}
          >
            Something went wrong before the page could render. Nothing was
            changed.
          </p>
          {error.digest && (
            <p
              className="hl-global-error-muted"
              style={{
                fontSize: "11px",
                fontFamily: "ui-monospace, monospace",
                color: "#949494",
                marginTop: "0.75rem",
                wordBreak: "break-all",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            className="hl-global-error-btn"
            style={{
              marginTop: "1.5rem",
              height: "2rem",
              padding: "0 0.75rem",
              fontSize: "13px",
              color: "#ededed",
              background: "#1f1f1f",
              border: "1px solid #343434",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
