"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { ErrorState } from "@huntloop/ui";

/**
 * Error boundary for a workspace screen.
 *
 * Without it a failing page fell through to `app/error.tsx`, which replaces
 * the whole document — sidebar included — so one broken screen (a dashboard
 * whose loader threw) left no navigation at all: not to another section, not
 * to the home page. Here, inside the org layout, the shell stays up and the
 * failure is confined to the content area. A failure in the layout itself
 * still reaches the root boundary, which is the only place that can catch it.
 *
 * `digest` only, as in the root boundary: Next strips server error messages
 * in production, and the digest joins this to the server-side log entry.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-12">
      <ErrorState
        description="This screen failed to load. Nothing was changed."
        detail={error.digest ? `Reference: ${error.digest}` : undefined}
        onRetry={reset}
      />
      <Link
        href="/"
        className="hl-focusable rounded-sm text-[13px] text-fg-muted underline underline-offset-2 hover:text-fg"
      >
        Go to the home page
      </Link>
    </div>
  );
}
