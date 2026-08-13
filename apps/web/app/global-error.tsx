"use client";

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
  return (
    <html lang="en">
      <body
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
