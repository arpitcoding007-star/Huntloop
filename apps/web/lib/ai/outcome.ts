/**
 * The failure half of every AI wrapper's return type.
 *
 * These wrappers deliberately return failures rather than throwing: "the model
 * declined", "you have no ICP yet", and "you've hit the limit" are all
 * *answers*, and a screen has to render each of them differently. An exception
 * would flatten all three into the error boundary.
 *
 * `kind` is what lets a screen tell them apart. Without it, a rate limit and a
 * genuine failure arrive as the same string, and the UI shows a "Try again"
 * button for something that will not succeed for another forty minutes.
 */
export interface AiFailure {
  ok: false;
  error: string;
  /**
   * Set only for a rate-limit refusal. Absent means an ordinary failure —
   * which is the common case, so the field is optional rather than a
   * discriminant every construction site has to fill in.
   */
  kind?: "rate_limited";
  /**
   * When the caller may retry, ISO-8601. Only meaningful alongside
   * `kind === "rate_limited"`, and null even then when the window is unknown.
   *
   * A string, not a Date: this crosses a Server Action boundary, and a string
   * has one unambiguous representation on both sides of it.
   */
  retryAt?: string | null;
}

/**
 * The failure, flattened into the shape Server Actions hand to their screens.
 *
 * `rateLimited` is an object rather than a bare `retryAt` because the retry
 * time can legitimately be null — the window is unknown when the limiter
 * itself could not run. Presence of the key is the signal; its contents are
 * detail. A bare nullable field would conflate "not a rate limit" with "a rate
 * limit whose reset time we don't know", and those want different screens.
 */
export interface FailureState {
  error: string;
  rateLimited?: { retryAt: string | null };
}

/**
 * Shared by all four actions so the mapping exists once.
 *
 * Four copies of a three-line ternary is how one of them ends up dropping
 * `retryAt` and nobody notices, because the error string still renders.
 */
export function toFailureState(failure: AiFailure): FailureState {
  return failure.kind === "rate_limited"
    ? { error: failure.error, rateLimited: { retryAt: failure.retryAt ?? null } }
    : { error: failure.error };
}
