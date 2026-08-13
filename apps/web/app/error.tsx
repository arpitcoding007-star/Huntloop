"use client";

import { useEffect } from "react";
import { ErrorState } from "@huntloop/ui";

/**
 * Route-level error boundary.
 *
 * Without this file an unhandled render error takes the whole app to Next's
 * default error screen, which in production says only "Application error".
 * That is a bad default here specifically: `lib/data/source.ts` and
 * `lib/data/opportunities.ts` *deliberately* throw rather than silently
 * falling back to fixtures — a configured deployment that quietly degraded to
 * demo data would show invented pipeline numbers as though they were real.
 * Throwing is the right behaviour, so the throw needs somewhere to land.
 *
 * `digest` is shown, not the message. Next replaces server-side error messages
 * with a digest hash in production precisely so that a database error string
 * cannot reach the browser; rendering `error.message` would print whatever
 * survived, which on a server error is the part we don't control.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Until Sentry is wired up (see .env.example, SENTRY_DSN) this is the only
    // record that the boundary fired.
    console.error("Unhandled error in route:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <ErrorState
        description="This screen failed to load. Nothing was changed."
        detail={error.digest ? `Reference: ${error.digest}` : undefined}
        onRetry={reset}
      />
    </div>
  );
}
