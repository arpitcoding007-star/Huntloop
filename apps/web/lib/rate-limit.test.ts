import { describe, expect, it } from "vitest";
import { rateLimitMessage, refusal, type RateLimitDecision } from "./rate-limit";

/**
 * The distinction UI-06 exists to preserve.
 *
 * There are two ways a model call gets refused by the limiter, and they are
 * not the same event:
 *
 *   exhausted      the user has done this too often. Their doing, and it
 *                  passes with time.
 *   unenforceable  the limiter could not run at all. A deployment fault —
 *                  neither their doing nor something they can wait out.
 *
 * The first version tagged both as rate limits, which put a misconfiguration
 * under a heading reading "Too many requests" with a retry time that never
 * arrives: blaming the user for our mistake and telling them to wait for
 * something that is not coming. These tests hold the two apart.
 */

const exhausted: RateLimitDecision = {
  allowed: false,
  remaining: 0,
  resetAt: new Date(Date.now() + 20 * 60_000),
  reason: "exhausted",
};

const unenforceable: RateLimitDecision = {
  allowed: false,
  remaining: 0,
  resetAt: null,
  unenforced: true,
  reason: "unenforceable",
};

describe("refusal()", () => {
  it("tags an exhausted budget as a rate limit, with a retry time", () => {
    const result = refusal(exhausted);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ kind: "rate_limited" });
    if ("retryAt" in result) {
      expect(result.retryAt).toBe(exhausted.resetAt!.toISOString());
    }
  });

  it("does NOT tag an unenforceable limiter as a rate limit", () => {
    // The whole of UI-06. If this ever starts returning kind: "rate_limited",
    // the screen renders `RateLimited` — "Too many requests" — for what is
    // actually a broken deployment.
    const result = refusal(unenforceable);
    expect(result.ok).toBe(false);
    expect("kind" in result).toBe(false);
  });

  it("crosses the Server Action boundary as a string, not a Date", () => {
    // A Date does not survive the boundary with one unambiguous
    // representation on both sides; an ISO string does.
    const result = refusal(exhausted);
    if ("retryAt" in result) expect(typeof result.retryAt).toBe("string");
  });
});

describe("rateLimitMessage()", () => {
  it("names when, not just no", () => {
    const message = rateLimitMessage(exhausted);
    expect(message).toMatch(/\d+ minutes?/);
  });

  it("never rounds a live window down to zero minutes", () => {
    // "Try again in 0 minutes" reads as broken. The floor is 1.
    const almostOver: RateLimitDecision = {
      ...exhausted,
      resetAt: new Date(Date.now() + 900),
    };
    expect(rateLimitMessage(almostOver)).toMatch(/1 minute\b/);
    expect(rateLimitMessage(almostOver)).not.toMatch(/\b0 minutes/);
  });

  it("tells an unenforceable caller nothing about why", () => {
    /*
     * "This server has an AI key but no database" is a map of what to attack:
     * it says there is no auth, no metering and no limit. The user gets an
     * apology; the operator gets the detail, in Sentry.
     */
    const message = rateLimitMessage(unenforceable);
    expect(message).not.toMatch(/database|key|config|limit|Supabase|env/i);
    expect(message).toMatch(/nothing you did/i);
  });

  it("does not blame the user for a deployment fault", () => {
    expect(rateLimitMessage(unenforceable)).not.toMatch(/too many|you've (made|reached)/i);
  });
});
