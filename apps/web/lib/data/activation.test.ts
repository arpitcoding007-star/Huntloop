import { describe, expect, it } from "vitest";
import { summarizeActivation, type ActivationRow } from "./activation";

/**
 * The activation summary (ANL-301): which step the workspace is on, the 7-day
 * activation rule from 0054, and rates that read "not measured" (null) rather
 * than 0% when nothing was sent or drafted.
 */

const base: ActivationRow = {
  signedUpAt: "2026-11-01T10:00:00.000Z",
  onboardingCompletedAt: null,
  firstWarmAt: null,
  firstSendAt: null,
  firstReplyAt: null,
  firstMeetingAt: null,
  sent30d: 0,
  replies30d: 0,
  drafts30d: 0,
  draftsRejected30d: 0,
  meetings30d: 0,
};

describe("summarizeActivation", () => {
  it("points a brand-new workspace at its first warm opportunity", () => {
    const s = summarizeActivation(base, "acme");
    expect(s.current).toBe("warm");
    expect(s.activated).toBe(false);
    expect(s.steps.find((x) => x.key === "warm")?.href).toBe("/acme/opportunities");
  });

  it("does not report a 0% reply rate when nothing was sent", () => {
    const s = summarizeActivation(base, "acme");
    expect(s.replyRate30d).toBeNull();
    expect(s.rejectionRate30d).toBeNull();
  });

  it("counts a first send on day 6 as activated, and day 7 as not", () => {
    const day6 = summarizeActivation({ ...base, firstWarmAt: base.signedUpAt, firstSendAt: "2026-11-07T09:00:00.000Z" }, "acme");
    const day7 = summarizeActivation({ ...base, firstWarmAt: base.signedUpAt, firstSendAt: "2026-11-08T10:00:00.000Z" }, "acme");
    expect(day6.activated).toBe(true);
    expect(day6.steps.find((x) => x.key === "send")?.daysFromSignup).toBe(5);
    expect(day7.activated).toBe(false);
  });

  it("computes 30-day rates from their own denominators", () => {
    const s = summarizeActivation({ ...base, sent30d: 40, replies30d: 6, drafts30d: 20, draftsRejected30d: 5 }, "acme");
    expect(s.replyRate30d).toBeCloseTo(0.15);
    expect(s.rejectionRate30d).toBeCloseTo(0.25);
  });

  it("has no current step once every step has happened", () => {
    const s = summarizeActivation(
      {
        ...base,
        firstWarmAt: "2026-11-01T11:00:00.000Z",
        firstSendAt: "2026-11-02T10:00:00.000Z",
        firstReplyAt: "2026-11-04T10:00:00.000Z",
        firstMeetingAt: "2026-11-09T10:00:00.000Z",
      },
      "acme",
    );
    expect(s.current).toBeNull();
    expect(s.steps.find((x) => x.key === "meeting")?.daysFromSignup).toBe(8);
  });
});
