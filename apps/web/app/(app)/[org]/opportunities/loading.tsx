import { LoadingSkeleton } from "@huntloop/ui";

/**
 * Overrides the `[org]` skeleton for the list, where the real content is a
 * filter bar above a 44px-row table rather than a stack of cards.
 *
 * `rowHeight={44}` is not decorative — it is `DataTable`'s row height. A
 * skeleton whose rows are a different height than the content replacing them
 * reflows the page at exactly the moment the user starts reading it, which is
 * worse than no skeleton.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8 lg:px-8">
      <div className="flex flex-col gap-2">
        <div
          aria-hidden
          className="h-9 w-56 animate-pulse rounded-md bg-surface motion-reduce:animate-none"
        />
        <div
          aria-hidden
          className="h-4 w-80 max-w-full animate-pulse rounded-md bg-surface motion-reduce:animate-none"
        />
      </div>

      {/* Filter bar. */}
      <div
        aria-hidden
        className="mt-6 h-9 w-full max-w-md animate-pulse rounded-md bg-surface motion-reduce:animate-none"
      />

      <LoadingSkeleton className="mt-4" rows={10} rowHeight={44} />
    </div>
  );
}
