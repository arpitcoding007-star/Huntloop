import Link from "next/link";
import { Button } from "@huntloop/ui";
import type { Destination } from "../../lib/data/destination";

/**
 * The right-hand side of a marketing header, for whoever is reading it.
 *
 * The content pages used to redirect a signed-in visitor into the app on
 * arrival, which made the site's own use-case and comparison pages unreadable
 * to anybody with an account — including from links on the landing page. They
 * render for everyone now; what changes for a signed-in visitor is this: one
 * way back into their work instead of a sign-in link they do not need.
 */
export function NavActions({
  destination,
  size = "sm",
}: {
  destination: Destination;
  size?: "sm" | "lg";
}) {
  if (isSignedIn(destination)) {
    return (
      <Button variant="primary" size={size} href={destination.path} linkComponent={Link}>
        Open workspace
      </Button>
    );
  }

  return (
    <>
      <Link
        href="/login"
        className="hl-focusable rounded-sm px-3 py-1.5 text-[13px] text-fg-secondary hover:text-fg"
      >
        Sign in
      </Link>
      <Button variant="primary" size={size} href="/signup" linkComponent={Link}>
        Start free
      </Button>
    </>
  );
}

/** Signed in with somewhere to go — not anonymous, and not the no-database demo. */
export function isSignedIn(destination: Destination): boolean {
  return destination.kind !== "anonymous" && destination.kind !== "demo";
}

/**
 * Where the logo on a marketing page points. Plain `/` sends a signed-in
 * visitor to their workspace, so for them it carries `?home=1`, which the
 * landing page honours.
 */
export function homeHref(destination: Destination): string {
  return isSignedIn(destination) ? "/?home=1" : "/";
}
