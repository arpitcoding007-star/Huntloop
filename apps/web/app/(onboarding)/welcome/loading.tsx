import { LoadingSkeleton } from "@huntloop/ui";

/**
 * Onboarding runs website → product → ICP → sources, and the product step
 * awaits a model call that reads several pages. The step components handle
 * their own pending state once mounted; this covers the gap before that —
 * navigation between steps, where the server is resolving the next segment.
 *
 * Narrower container than the app shell, matching the onboarding layout: these
 * steps are a single centred column, not a dashboard.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="flex flex-col gap-2">
        <div
          aria-hidden
          className="h-8 w-72 max-w-full animate-pulse rounded-md bg-surface motion-reduce:animate-none"
        />
        <div
          aria-hidden
          className="h-4 w-full animate-pulse rounded-md bg-surface motion-reduce:animate-none"
        />
      </div>

      <LoadingSkeleton className="mt-8" rows={4} rowHeight={56} />
    </div>
  );
}
