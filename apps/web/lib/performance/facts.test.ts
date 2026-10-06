import { describe, expect, it } from "vitest";
import { computePerformance, windowsFor } from "./compute";
import { performanceFacts } from "./facts";

const NOW = new Date("2026-10-07T12:00:00Z");

describe("performance facts", () => {
  it("states an empty period in words, not as 'no of 0'", () => {
    const { window, previous } = windowsFor("30d", NOW);
    const p = computePerformance({
      opportunities: [],
      touches: [],
      outcomes: [],
      window,
      previous,
      spend: { current: { aiCents: 0, providerCredits: 0 }, previous: { aiCents: 0, providerCredits: 0 } },
      ownerNames: new Map(),
      competitorNames: new Map(),
      now: NOW,
    });
    const facts = performanceFacts(p);
    expect(facts.map((f) => f.text).join(" ")).not.toMatch(/no of/);
    expect(facts.some((f) => /No company was first contacted/.test(f.text))).toBe(true);
    // Ids are sequential and unique — the closed set the narrative may cite.
    expect(facts.map((f) => f.id)).toEqual(facts.map((_, i) => `f${i + 1}`));
    // Insights lead.
    expect(facts[0]!.text).toMatch(/Not enough outreach/);
  });
});
