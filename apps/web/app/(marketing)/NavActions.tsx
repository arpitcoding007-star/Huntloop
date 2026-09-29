import Link from "next/link";
import { Button } from "@huntloop/ui";
import { continueTarget, type Destination } from "../../lib/data/destination";

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
  const next = continueTarget(destination);
  if (next) {
    return (
      <Button variant="primary" size={size} href={next.href} linkComponent={Link}>
        {next.label}
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

