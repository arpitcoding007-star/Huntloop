import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-01, held down by a test.
 *
 * The finding: `resolveRecorder` resolved the caller's org and, on failure,
 * returned a null recorder while **letting the model call proceed**. Because
 * `organizations` is behind RLS, "no row" does not mean "no such org" — it
 * means *this caller is not a member of it*. Server Actions are public POST
 * endpoints, so any caller naming an org slug they did not belong to got a
 * real `claude-opus-5` call at `high` effort with `web_fetch` enabled, billed
 * to us and recorded against nothing.
 *
 * It is fixed, and `audit.mjs` `SEC-SPEND` greps for the guard. But a grep
 * cannot tell a correct guard from a subtly wrong one — `if (resolved.ok)`
 * with the branches swapped still matches. This asserts the behaviour:
 *
 *   1. every wrapper returns a refusal, and
 *   2. `runTask` is never reached.
 *
 * (2) is the half that actually costs money, and it is the half a
 * returns-the-right-shape test would miss.
 *
 * `runTask` is stubbed with a spy that throws. Not only for assertion — it
 * also means a regression fails as a test error rather than as an outbound
 * request to api.anthropic.com from someone's laptop.
 */

const REFUSAL = /No organisation .* is available to you\./;

/**
 * Stands in for a tenant client that resolves no org for this caller.
 *
 * `rpc` is here even though a correct wrapper never reaches it: it is the rate
 * limiter, it sits on every one of these paths just after the guard, and
 * omitting it would make a removed guard fail with `db.rpc is not a function`.
 * That is still a failing test, but it names the fake rather than the fault.
 * With it present, a regression fails on the assertion that matters.
 */
const dbResolvingNothing = {
  from: () => ({
    select: () => ({
      eq: () => ({
        // What Supabase returns for "no rows, and that is not an error" —
        // which is the same response for "no such org" and "not yours". That
        // ambiguity is the entire finding.
        maybeSingle: async () => ({ data: null, error: null }),
        limit: async () => ({ data: [], error: null }),
        order: () => ({
          limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    }),
  }),
  rpc: async () => ({
    data: [{ allowed: true, remaining: 99, reset_at: new Date().toISOString() }],
    error: null,
  }),
};

const runTask = vi.fn(() => {
  throw new Error(
    "runTask was called after the org could not be resolved — this is SEC-01",
  );
});

vi.mock("../data/source", () => ({
  resolveDataSource: async () => ({ db: dbResolvingNothing, source: "live" }),
  isDatabaseConfigured: () => true,
  getDb: async () => dbResolvingNothing,
  isSchemaApplied: async () => true,
  load: async (_live: unknown, fallback: () => unknown) => ({
    data: fallback(),
    source: "live",
  }),
}));

vi.mock("@huntloop/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@huntloop/ai")>()),
  // Forced on, so the wrappers take the live branch rather than short-
  // circuiting to their worked examples. Without this the test would pass on
  // any machine with no ANTHROPIC_API_KEY while proving nothing.
  isAiConfigured: () => true,
  runTask,
}));

beforeEach(() => {
  runTask.mockClear();
});

describe("a model call that cannot be attributed to the caller's org", () => {
  it("is refused by qualify()", async () => {
    const { qualify } = await import("./qualify");
    const outcome = await qualify("not-my-org", "https://alphio.ai");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(REFUSAL);
    expect(runTask).not.toHaveBeenCalled();
  });

  it("is refused by research()", async () => {
    const { research } = await import("./research");
    const outcome = await research("not-my-org", "https://alphio.ai");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(REFUSAL);
    expect(runTask).not.toHaveBeenCalled();
  });

  it("is refused by recommend()", async () => {
    const { recommend } = await import("./sources");
    const outcome = await recommend("not-my-org", {
      sells: "Custody permissioning for autonomous financial agents.",
      segments: ["Seed-stage AI infrastructure companies"],
      sizes: ["10-50"],
      regions: ["Europe"],
      triggers: ["Raised a round"],
      exclusions: [],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(REFUSAL);
    expect(runTask).not.toHaveBeenCalled();
  });

  it("is refused by whyNow()", async () => {
    const { whyNow } = await import("./why-now");
    const outcome = await whyNow("not-my-org", {
      companyName: "Alphio AI",
      canonicalDomain: "alphio.ai",
      priority: "hot",
      evidence: [
        {
          claim: "Closed a $12M Series A.",
          kind: "fact",
          confidence: "high",
          sourceUrl: "https://alphio.ai/blog",
          excerpt: "We raised $12M.",
        },
      ],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(REFUSAL);
    expect(runTask).not.toHaveBeenCalled();
  });

  it("says the same thing whether the org is missing or merely not yours", () => {
    /*
     * Not a behavioural assertion so much as a guard on the copy.
     *
     * `resolveRecorder` cannot distinguish the two cases — RLS makes them
     * identical — and if a future version ever could, it must still refuse to
     * say which. A message like "that org exists but you're not a member"
     * turns a slug guess into a customer-list oracle, which is the same
     * reasoning behind returning 404 rather than 403 in the org layout.
     */
    const message = "No organisation “acme” is available to you.";
    expect(message).not.toMatch(/not a member|no access|exists|permission/i);
  });
});
