"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonVariant } from "@huntloop/ui";
import { RefreshCw } from "lucide-react";

/**
 * Refresh, which now refreshes.
 *
 * Four of these rendered across the app with no handler at all (audit UX-04).
 * The fix is one line of behaviour, and it lives in a client component because
 * the screens that need it — the Command Center in particular — are async
 * Server Components and cannot hold an event handler.
 *
 * `router.refresh()` rather than `location.reload()`: it re-runs the server
 * component and repaints with fresh rows while keeping client state — the
 * filter you have set, the rows you have selected, your scroll position. A
 * full reload throws all three away, which on the opportunity list means the
 * refresh button undoes the triage you just did.
 *
 * The transition is what makes the pending state truthful. Without it the
 * button reports "done" the moment the request is dispatched, which for a
 * server round trip is the one moment it is certainly not done.
 */
export function RefreshButton({
  variant = "ghost",
  children,
}: {
  variant?: ButtonVariant;
  /** Omit for the icon-only form, which then needs the aria-label below. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [refreshing, start] = useTransition();

  return (
    <Button
      icon={RefreshCw}
      variant={variant}
      disabled={refreshing}
      aria-label={children ? undefined : "Refresh"}
      onClick={() => start(() => router.refresh())}
    >
      {children}
    </Button>
  );
}
