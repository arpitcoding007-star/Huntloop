import { describe, expect, it } from "vitest";
import {
  STALLED_AFTER_SECONDS,
  heartbeatBlocksHealth,
  heartbeatState,
  queueBlocksHealth,
  queueState,
} from "./queue-health";

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

describe("heartbeatState", () => {
  it("a recent sweep is ok, up to and including the threshold", () => {
    expect(heartbeatState(0)).toBe("ok");
    expect(heartbeatState(STALLED_AFTER_SECONDS)).toBe("ok");
  });

  it("is late once the last sweep is older than the threshold", () => {
    expect(heartbeatState(STALLED_AFTER_SECONDS + 1)).toBe("late");
  });

  it("a database that has never been swept says so", () => {
    expect(heartbeatState("never")).toBe("never");
  });

  it("an unreadable heartbeat is unknown, never ok", () => {
    expect(heartbeatState(null)).toBe("unknown");
    expect(heartbeatState(Number.NaN)).toBe("unknown");
  });
});

describe("heartbeatBlocksHealth", () => {
  it("only ok and unchecked pass", () => {
    expect(heartbeatBlocksHealth("ok")).toBe(false);
    expect(heartbeatBlocksHealth("unchecked")).toBe(false);
    expect(heartbeatBlocksHealth("late")).toBe(true);
    expect(heartbeatBlocksHealth("never")).toBe(true);
    expect(heartbeatBlocksHealth("unknown")).toBe(true);
  });
});
