import { describe, expect, it } from "vitest";
import {
  MIN_SEGMENT,
  computePerformance,
  goalProgress,
  median,
  sourceLabel,
  twoProportionZ,
  weekStart,
  wilson,
  windowsFor,
  type PerfInput,
  type PerfOpportunity,
  type PerfOutcome,
  type PerfTouch,
} from "./compute";

/**
 * The definitions behind the Performance screen. If one of these changes, the
 * numbers on the screen change meaning — so each is pinned.
 */

const NOW = new Date("2026-10-07T12:00:00Z");
const { window, previous } = windowsFor("30d", NOW);
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000).toISOString();

let seq = 0;
const opp = (o: Partial<PerfOpportunity> = {}): PerfOpportunity => ({
  id: `o${++seq}`,
  company: `Company ${seq}`,
  firstSeenAt: day(40),
  priority: "warm",
  status: "contacted",
  ownerId: null,
  via: "scan",
  triggerType: null,
  ...o,
});
const touch = (t: Partial<PerfTouch> & Pick<PerfTouch, "opportunityId">): PerfTouch => ({
  kind: "email_sent",
  channel: "email",
  direction: "outbound",
  occurredAt: day(10),
  actorId: null,
  ...t,
});

const input = (over: Partial<PerfInput>): PerfInput => ({
  opportunities: [],
  touches: [],
  outcomes: [],
  window,
  previous,
  spend: { current: { aiCents: 0, providerCredits: 0 }, previous: { aiCents: 0, providerCredits: 0 } },
  ownerNames: new Map(),
  competitorNames: new Map(),
  now: NOW,
  ...over,
});

describe("statistics", () => {
  it("wilson brackets the observed rate and stays inside 0..1", () => {
    const [lo, hi] = wilson(5, 20)!;
    expect(lo).toBeLessThan(0.25);
    expect(hi).toBeGreaterThan(0.25);
    expect(wilson(0, 10)![0]).toBe(0);
    expect(wilson(0, 0)).toBeNull();
  });

  it("twoProportionZ is signed and null without data", () => {
    expect(twoProportionZ(30, 100, 10, 100)!).toBeGreaterThan(1.96);
    expect(twoProportionZ(10, 100, 30, 100)!).toBeLessThan(-1.96);
    expect(twoProportionZ(1, 0, 1, 10)).toBeNull();
  });

  it("median handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("the cohort", () => {
  it("counts a company once, in the period of its FIRST outbound touch", () => {
    const early = opp();
    const fresh = opp();
    const p = computePerformance(
      input({
        opportunities: [early, fresh],
        touches: [
          // First contacted before the window, touched again inside it: not in this cohort.
          touch({ opportunityId: early.id, occurredAt: day(45) }),
          touch({ opportunityId: early.id, occurredAt: day(5) }),
          touch({ opportunityId: fresh.id, occurredAt: day(10) }),
          touch({ opportunityId: fresh.id, occurredAt: day(8) }),
        ],
      }),
    );
    expect(p.cohort.contacted).toBe(1);
    expect(p.previousCohort.contacted).toBe(1);
  });

  it("counts a reply only after the first outbound touch, on any channel", () => {
    const a = opp();
    const b = opp();
    const p = computePerformance(
      input({
        opportunities: [a, b],
        touches: [
          touch({ opportunityId: a.id, occurredAt: day(10), channel: "linkedin", kind: "message" }),
          touch({ opportunityId: a.id, occurredAt: day(7), direction: "inbound", channel: "linkedin", kind: "message" }),
          // b replied *before* we reached out (inbound lead) — not a reply to outreach.
          touch({ opportunityId: b.id, occurredAt: day(12), direction: "inbound", kind: "email_received" }),
          touch({ opportunityId: b.id, occurredAt: day(10) }),
        ],
      }),
    );
    expect(p.cohort.replied).toBe(1);
    expect(p.cohort.replyRate).toBe(0.5);
    expect(p.cohort.medianDaysToReply).toBe(3);
  });

  it("counts meetings from outcomes or logged meetings after first contact", () => {
    const a = opp();
    const b = opp();
    const outcomes: PerfOutcome[] = [
      { opportunityId: a.id, kind: "meeting", occurredAt: day(2), reasonCategory: null, competitorId: null },
    ];
    const p = computePerformance(
      input({
        opportunities: [a, b],
        touches: [
          touch({ opportunityId: a.id, occurredAt: day(9) }),
          touch({ opportunityId: b.id, occurredAt: day(9) }),
          touch({ opportunityId: b.id, occurredAt: day(4), kind: "meeting", channel: "meeting" }),
        ],
        outcomes,
      }),
    );
    expect(p.cohort.meetings).toBe(2);
    expect(p.cohort.medianDaysToMeeting).toBe(6);
  });
});

describe("insights", () => {
  it("says there is not enough data rather than inventing a trend", () => {
    const a = opp();
    const p = computePerformance(input({ opportunities: [a], touches: [touch({ opportunityId: a.id })] }));
    expect(p.insights.map((i) => i.id)).toContain("too-small");
    expect(p.insights.some((i) => i.tone === "strength")).toBe(false);
  });

  it("names a channel only when its interval clears the rest", () => {
    const opportunities: PerfOpportunity[] = [];
    const touches: PerfTouch[] = [];
    // 20 LinkedIn first touches, 12 replies; 40 email, 2 replies.
    for (let i = 0; i < 20; i++) {
      const o = opp();
      opportunities.push(o);
      touches.push(touch({ opportunityId: o.id, channel: "linkedin", kind: "message", occurredAt: day(20) }));
      if (i < 12) touches.push(touch({ opportunityId: o.id, direction: "inbound", channel: "linkedin", kind: "message", occurredAt: day(18) }));
    }
    for (let i = 0; i < 40; i++) {
      const o = opp();
      opportunities.push(o);
      touches.push(touch({ opportunityId: o.id, occurredAt: day(20) }));
      if (i < 2) touches.push(touch({ opportunityId: o.id, direction: "inbound", kind: "email_received", occurredAt: day(15) }));
    }
    const p = computePerformance(input({ opportunities, touches }));
    const strength = p.insights.find((i) => i.id === "channel:linkedin:better");
    expect(strength?.headline).toMatch(/LinkedIn first touches get replies more often: 60% against 5%/);
    expect(strength?.basis).toMatch(/12 of 20 replied, against 2 of 40/);
    expect(p.insights.find((i) => i.id === "channel:email:worse")).toBeTruthy();
  });

  it("does not compare a group smaller than the minimum", () => {
    const opportunities: PerfOpportunity[] = [];
    const touches: PerfTouch[] = [];
    for (let i = 0; i < MIN_SEGMENT - 1; i++) {
      const o = opp();
      opportunities.push(o);
      touches.push(touch({ opportunityId: o.id, channel: "linkedin", kind: "message" }));
      touches.push(touch({ opportunityId: o.id, direction: "inbound", channel: "linkedin", kind: "message", occurredAt: day(5) }));
    }
    for (let i = 0; i < 30; i++) {
      const o = opp();
      opportunities.push(o);
      touches.push(touch({ opportunityId: o.id }));
    }
    const p = computePerformance(input({ opportunities, touches }));
    expect(p.insights.some((i) => i.id.startsWith("channel:linkedin"))).toBe(false);
  });

  it("reports the dominant loss reason, and points missing capability at demand", () => {
    const outcomes: PerfOutcome[] = [];
    for (let i = 0; i < 4; i++)
      outcomes.push({ opportunityId: `x${i}`, kind: "lost", occurredAt: day(3), reasonCategory: "missing_capability", competitorId: null });
    outcomes.push({ opportunityId: "y", kind: "disqualified", occurredAt: day(3), reasonCategory: "no_budget", competitorId: null });
    const p = computePerformance(input({ outcomes }));
    const insight = p.insights.find((i) => i.id === "top-loss-reason");
    expect(insight?.headline).toMatch(/needed something you do not offer/);
    expect(insight?.basis).toBe("4 of 5 lost or ruled-out opportunities gave that reason.");
  });

  it("flags late-stage deals with no recent activity", () => {
    const a = opp({ status: "proposal", company: "Stalled Co" });
    const p = computePerformance(input({ opportunities: [a], touches: [touch({ opportunityId: a.id, occurredAt: day(20) })] }));
    expect(p.stalled).toEqual([{ id: a.id, company: "Stalled Co", stage: "proposal", idleDays: 20 }]);
    expect(p.insights.find((i) => i.id === "stalled")?.basis).toContain("Stalled Co (20 days)");
  });
});

describe("funnel and cost", () => {
  it("counts events inside the window and divides spend honestly", () => {
    const found = opp({ firstSeenAt: day(3), priority: "hot" });
    const old = opp({ firstSeenAt: day(60) });
    const p = computePerformance(
      input({
        opportunities: [found, old],
        outcomes: [{ opportunityId: found.id, kind: "meeting", occurredAt: day(1), reasonCategory: null, competitorId: null }],
        spend: { current: { aiCents: 500, providerCredits: 12 }, previous: { aiCents: 0, providerCredits: 0 } },
      }),
    );
    expect(p.funnel.discovered).toBe(1);
    expect(p.funnel.qualified).toBe(1);
    expect(p.funnel.meetings).toBe(1);
    expect(p.cost.perQualifiedCents).toBe(500);
    expect(p.cost.perMeetingCents).toBe(500);
    const empty = computePerformance(input({}));
    expect(empty.cost.perMeetingCents).toBeNull();
  });
});

describe("goals and periods", () => {
  it("week starts on Monday", () => {
    expect(weekStart(NOW).toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("counts my outbound touches this week and meetings on my accounts this month", () => {
    const mine = opp({ ownerId: "me" });
    const theirs = opp({ ownerId: "them" });
    const g = goalProgress(
      {
        opportunities: [mine, theirs],
        touches: [
          touch({ opportunityId: mine.id, actorId: "me", occurredAt: "2026-10-06T09:00:00Z" }),
          touch({ opportunityId: mine.id, actorId: "me", occurredAt: "2026-10-02T09:00:00Z" }), // last week
          touch({ opportunityId: theirs.id, actorId: "them", occurredAt: "2026-10-06T09:00:00Z" }),
        ],
        outcomes: [
          { opportunityId: mine.id, kind: "meeting", occurredAt: "2026-10-03T09:00:00Z", reasonCategory: null, competitorId: null },
          { opportunityId: theirs.id, kind: "meeting", occurredAt: "2026-10-03T09:00:00Z", reasonCategory: null, competitorId: null },
        ],
      },
      "me",
      NOW,
    );
    expect(g.touchesThisWeek).toBe(1);
    expect(g.meetingsThisMonth).toBe(1);
  });

  it("previous window is the same length, immediately before", () => {
    const w = windowsFor("last-month", NOW);
    expect(w.window.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(w.window.to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(w.previous.to.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("labels sources in a person's words", () => {
    expect(sourceLabel("provider:apollo")).toBe("Apollo search");
    expect(sourceLabel("scan")).toBe("Source scans");
    expect(sourceLabel(null)).toBe("Added or analyzed by hand");
  });
});
