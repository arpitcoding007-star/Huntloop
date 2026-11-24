import { describe, expect, it } from "vitest";
import { asksAboutRequests, requestRecords } from "./request-records";

const card = {
  matchId: "m1", needId: "n1", offeringTitle: "H200 cards", categoryPath: "Hardware › GPUs", level: 3 as const,
  quantityBand: "100–999", budgetBand: null, place: "Europe", timeline: null,
  summary: "SECRET WORDS", mustHaves: "SECRET MUST", unit: "SECRET UNIT", score: null, computedAt: "2026-11-24T00:00:00Z",
};

describe("open requests, for the assistant", () => {
  it.each(["What open needs match us?", "any buyers looking for GPUs", "which requests fit", "show exchange matches"])("reads cards for %s", (q) =>
    expect(asksAboutRequests(q)).toBe(true));
  it.each(["where am I losing deals?", "what should I focus on today?", "which hot accounts has nobody touched?"])("but not for %s", (q) =>
    expect(asksAboutRequests(q)).toBe(false));
  it("carries bands and never the buyer's words, even at level 3", () => {
    const [r] = requestRecords([card]);
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(r!.facts).toContain("budget not stated");
    expect(r!.facts).toContain("fit: too little is known to score");
  });
  it("is bounded", () => expect(requestRecords(Array(50).fill(card))).toHaveLength(10));
});
