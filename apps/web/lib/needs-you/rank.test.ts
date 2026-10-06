import { describe, expect, it } from "vitest";
import {
  businessDaysBetween,
  isQuiet,
  rank,
  type AttentionCandidate,
  type RankOptions,
} from "./rank";

/**
 * The rules behind "Needs you". Each one is a claim the product makes about
 * what matters, so each one is pinned here.
 */

// A Wednesday, so weekend arithmetic is exercised in both directions.
const NOW = new Date("2026-10-07T12:00:00Z");
const ME = "11111111-1111-1111-1111-111111111111";
const THEM = "22222222-2222-2222-2222-222222222222";

const options = (overrides: Partial<RankOptions> = {}): RankOptions => ({
  now: NOW,
  snoozed: new Set(),
  filter: "everyone",
  userId: ME,
  quietAfterBusinessDays: 4,
  ...overrides,
});

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000).toISOString();

const item = (overrides: Partial<AttentionCandidate> & Pick<AttentionCandidate, "kind">): AttentionCandidate => ({
  key: `${overrides.kind}:${overrides.opportunityId ?? overrides.title ?? "x"}`,
  title: "Acme",
  href: "/org/opportunities/x",
  ...overrides,
});

describe("businessDaysBetween", () => {
  it("skips weekends", () => {
    // Friday → next Monday is one business day.
    expect(businessDaysBetween(new Date("2026-10-02T09:00:00Z"), new Date("2026-10-05T09:00:00Z"))).toBe(1);
    // Wednesday → Wednesday a week later is five.
    expect(businessDaysBetween(new Date("2026-09-30T09:00:00Z"), NOW)).toBe(5);
  });

  it("is zero for the same day and for the past", () => {
    expect(businessDaysBetween(NOW, NOW)).toBe(0);
    expect(businessDaysBetween(NOW, new Date("2026-10-01T00:00:00Z"))).toBe(0);
  });
});

describe("isQuiet", () => {
  it("is quiet only after the configured business days", () => {
    expect(isQuiet("2026-10-02T09:00:00Z", NOW, 4)).toBe(false); // Fri → Wed = 3
    expect(isQuiet("2026-10-01T09:00:00Z", NOW, 4)).toBe(true); // Thu → Wed = 4
  });
});

describe("rank", () => {
  it("puts a waiting reply above everything else", () => {
    const ranked = rank(
      [
        item({ kind: "quiet", opportunityId: "a", title: "Quiet Co", at: daysAgo(9), priority: "hot" }),
        item({ kind: "reply", opportunityId: "b", title: "Reply Co", at: daysAgo(0), priority: "watch" }),
        item({ kind: "failing-sources", title: "Sources", count: 3 }),
      ],
      options(),
    );
    expect(ranked[0]!.kind).toBe("reply");
    expect(ranked.at(-1)!.kind).toBe("failing-sources");
  });

  it("ranks a positive reply above a neutral one", () => {
    const ranked = rank(
      [
        item({ kind: "reply", opportunityId: "a", title: "Neutral", classification: "neutral", at: daysAgo(1) }),
        item({ kind: "reply", opportunityId: "b", title: "Positive", classification: "positive", at: daysAgo(1) }),
      ],
      options(),
    );
    expect(ranked.map((r) => r.title)).toEqual(["Positive", "Neutral"]);
    expect(ranked[0]!.label).toBe("Positive reply");
  });

  it("never surfaces an out-of-office or a bounce as a reply", () => {
    const ranked = rank(
      [
        item({ kind: "reply", opportunityId: "a", classification: "out_of_office" }),
        item({ kind: "reply", opportunityId: "b", classification: "bounce" }),
        item({ kind: "reply", opportunityId: "c", classification: "unsubscribe" }),
      ],
      options(),
    );
    expect(ranked).toHaveLength(0);
  });

  it("tells a wrong-person reply to find the right person", () => {
    const [r] = rank([item({ kind: "reply", opportunityId: "a", classification: "wrong_person" })], options());
    expect(r!.actionLabel).toBe("Find the right person");
  });

  it("drops what this person snoozed", () => {
    const ranked = rank(
      [item({ kind: "quiet", key: "quiet:a", opportunityId: "a", at: daysAgo(8) })],
      options({ snoozed: new Set(["quiet:a"]) }),
    );
    expect(ranked).toHaveLength(0);
  });

  it("filters by owner, but always shows workspace items", () => {
    const candidates = [
      item({ kind: "next-step", opportunityId: "a", title: "Mine", ownerId: ME, at: daysAgo(1) }),
      item({ kind: "next-step", opportunityId: "b", title: "Theirs", ownerId: THEM, at: daysAgo(1) }),
      item({ kind: "next-step", opportunityId: "c", title: "Nobody's", ownerId: null, at: daysAgo(1) }),
      item({ kind: "learning", title: "Learning", count: 2 }),
    ];
    expect(rank(candidates, options({ filter: "mine" })).map((r) => r.title).sort()).toEqual(["Learning", "Mine"]);
    expect(rank(candidates, options({ filter: "unassigned" })).map((r) => r.title).sort()).toEqual([
      "Learning",
      "Nobody's",
    ]);
    expect(rank(candidates, options({ filter: "everyone" }))).toHaveLength(4);
  });

  it("keeps one item per opportunity — its strongest", () => {
    const ranked = rank(
      [
        item({ kind: "late-stage", key: "late-stage:a", opportunityId: "a", stage: "meeting" }),
        item({ kind: "reply", key: "reply:a", opportunityId: "a", at: daysAgo(1) }),
      ],
      options(),
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.kind).toBe("reply");
  });

  it("never folds a draft awaiting approval into another item", () => {
    const ranked = rank(
      [
        item({ kind: "reply", key: "reply:t1", opportunityId: "a", at: daysAgo(1) }),
        item({ kind: "approval", key: "approval:m1", opportunityId: "a", at: daysAgo(0) }),
      ],
      options(),
    );
    expect(ranked.map((r) => r.kind).sort()).toEqual(["approval", "reply"]);
  });

  it("weights value: a HOT follow-up outranks a WATCH one of the same age", () => {
    const ranked = rank(
      [
        item({ kind: "quiet", opportunityId: "a", title: "Watch", priority: "watch", at: daysAgo(7) }),
        item({ kind: "quiet", opportunityId: "b", title: "Hot", priority: "hot", at: daysAgo(7) }),
      ],
      options(),
    );
    expect(ranked[0]!.title).toBe("Hot");
  });

  it("explains every item with the inputs that put it there", () => {
    const [due] = rank(
      [item({ kind: "next-step", opportunityId: "a", nextStep: "Send pricing", at: daysAgo(3) })],
      options(),
    );
    expect(due!.why).toContain("Send pricing");
    expect(due!.why).toContain("3 days ago");
    expect(due!.label).toBe("Overdue");

    const [quiet] = rank(
      [item({ kind: "quiet", opportunityId: "b", channel: "linkedin", at: "2026-09-30T09:00:00Z" })],
      options(),
    );
    expect(quiet!.why).toContain("LinkedIn");
    expect(quiet!.why).toContain("5 business days");
    expect(quiet!.why).toContain("No sequence");
  });

  it("is deterministic for equal scores", () => {
    const candidates = [
      item({ kind: "approval", opportunityId: "b", title: "Bravo", at: daysAgo(1) }),
      item({ kind: "approval", opportunityId: "a", title: "Alpha", at: daysAgo(1) }),
    ];
    expect(rank(candidates, options()).map((r) => r.title)).toEqual(["Alpha", "Bravo"]);
  });
});
