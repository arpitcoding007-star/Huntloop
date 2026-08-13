import { EmptyState } from "@huntloop/ui";
import { SearchX } from "lucide-react";

/**
 * The 404.
 *
 * Worth writing rather than inheriting Next's default, because `notFound()` is
 * not only reached by a mistyped URL here. `app/(app)/[org]/layout.tsx` calls
 * it deliberately when the caller is not a member of the org in the path —
 * a 404 rather than a 403, so that guessing a slug cannot be used to learn
 * which companies are Huntloop customers.
 *
 * That makes this page load-bearing for a security decision, and the copy has
 * to hold the line the layout took: it must read the same for "no such org"
 * and "not your org". Anything more specific — "you may not have access",
 * "ask an admin for an invite" — would hand back exactly the distinction the
 * 404 was chosen to withhold.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <EmptyState
        icon={SearchX}
        title="Not found"
        description="There is nothing at this address."
        action={
          <a
            href="/"
            className="hl-focusable inline-flex h-8 items-center rounded-md border border-line bg-surface px-3 text-[13px] text-fg-secondary transition-colors duration-[120ms] hover:border-line-strong hover:text-fg"
          >
            Go back
          </a>
        }
      />
    </div>
  );
}

export const metadata = { title: "Not found" };
