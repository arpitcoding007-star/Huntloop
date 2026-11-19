import { describe, expect, it } from "vitest";
import { STALLED_AFTER_SECONDS, queueBlocksHealth, queueState } from "./queue-health";

describe("queueState", () => {
  it("an empty queue is ok", () => {
    expect(queueState(0)).toBe("ok");
  });

  it("is ok up to and including the threshold", () => {
    expect(queueState(STALLED_AFTER_SECONDS)).toBe("ok");
  });

  it("is stalled once the oldest due job has waited past it", () => {
    expect(queueState(STALLED_AFTER_SECONDS + 1)).toBe("stalled");
  });

  it("an unreadable queue is unknown, never ok", () => {
    expect(queueState(null)).toBe("unknown");
    expect(queueState(Number.NaN)).toBe("unknown");
  });
});

describe("queueBlocksHealth", () => {
  it("stalled and unknown fail the check; ok and unchecked do not", () => {
    expect(queueBlocksHealth("stalled")).toBe(true);
    expect(queueBlocksHealth("unknown")).toBe(true);
    expect(queueBlocksHealth("ok")).toBe(false);
    expect(queueBlocksHealth("unchecked")).toBe(false);
  });
});
