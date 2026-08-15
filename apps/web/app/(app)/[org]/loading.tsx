import { LoadingSkeleton } from "@huntloop/ui";

/**
 * Route-level loading state for every `/[org]/*` screen.
 *
 * Before this, navigating to a server-rendered page showed the *previous*
 * page until the new one resolved — Next holds the old UI in place while a
 * Server Component streams, so a slow loader looked like a click that did
 * nothing (audit UI-05). Components for this existed; no route used them.
 *
 * One file at the `[org]` segment rather than four near-identical ones. Next
 * resolves the nearest `loading.tsx` up the tree, so this covers dashboard,
 * analyze, sources, and anything added later — a new screen gets a loading
 * state without anyone remembering to add one. `opportunities` overrides it
 * where the shape is different enough to be worth matching.
 *
 * The geometry mirrors the real pages' container (`max-w-[1600px]`, the same
 * padding) so content lands where the skeleton was instead of jumping.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8 lg:px-8">
      {/* Header block: title, then the subtitle line under it. */}
      <div className="flex flex-col gap-2">
        <div
          aria-hidden
          className="h-9 w-64 animate-pulse rounded-md bg-surface motion-reduce:animate-none"
        />
        <div
          aria-hidden
          className="h-4 w-96 max-w-full animate-pulse rounded-md bg-surface motion-reduce:animate-none"
        />
      </div>

      {/* The single `role="status"` lives here, on the body. The header blocks
          above are aria-hidden, so the page announces "Loading…" once rather
          than once per placeholder. */}
      <LoadingSkeleton className="mt-8" rows={6} rowHeight={72} />
    </div>
  );
}
