import { describe, expect, it } from "vitest";
import { outcomeOf } from "./outcome";

/* Wednesday, so business-day arithmetic is not crossing a weekend by accident. */
const NOW = new Date("2026-10-07T12:00:00Z");

describe("outcomeOf", () => {
  const touch = { opportunityId: "o1", occurredAt: "2026-10-05T09:00:00Z" };

  it("counts an answer after the touch, on any channel, as a reply", () => {
    expect(outcomeOf(touch, new Map([["o1", ["2026-10-06T10:00:00Z"]]]), NOW, 4)).toBe("replied");
  });

  it("does not count an answer that came before the touch", () => {
    expect(outcomeOf(touch, new Map([["o1", ["2026-10-01T10:00:00Z"]]]), NOW, 4)).toBe("waiting");
  });

  it("does not count another account's answer", () => {
    expect(outcomeOf(touch, new Map([["o2", ["2026-10-06T10:00:00Z"]]]), NOW, 4)).toBe("waiting");
  });

  it("calls it no response once the quiet period has passed", () => {
    const old = { opportunityId: "o1", occurredAt: "2026-09-28T09:00:00Z" };
    expect(outcomeOf(old, new Map(), NOW, 4)).toBe("no-response");
    expect(outcomeOf(touch, new Map(), NOW, 2)).toBe("no-response");
    expect(outcomeOf(touch, new Map(), NOW, 3)).toBe("waiting");
  });
});
