import { describe, expect, it } from "vitest";
import { legacyRecommendation, nextAction, type NextActionInput } from "./next-action";

const NOW = new Date("2026-10-07T12:00:00Z"); // Wednesday

const base = (overrides: Partial<NextActionInput> = {}): NextActionInput => ({
  priority: "hot",
  status: "qualified",
  hasBuyer: true,
  hasTrigger: true,
  nextStep: null,
  lastTouch: null,
  replyClassification: null,
  sequenceActive: false,
  now: NOW,
  quietAfterBusinessDays: 4,
  ...overrides,
});

describe("nextAction", () => {
  it("falls back to the verdict when nothing has happened", () => {
    expect(nextAction(base()).text).toBe("Reach out now, while the trigger is fresh.");
    expect(nextAction(base({ hasBuyer: false })).text).toBe(
      "Identify a decision maker before reaching out.",
    );
  });

  it("keeps the four legacy cases exactly", () => {
    expect(legacyRecommendation("ignore", true, true)).toBe("No action — this one is out of scope.");
    expect(legacyRecommendation("watch", true, true)).toBe("Keep monitoring — no reason to contact today.");
    expect(legacyRecommendation("warm", true, true)).toBe(
      "Research the current approach before contacting.",
    );
    expect(legacyRecommendation("hot", true, false)).toBe(
      "Reach out — the fit is strong, though no dated trigger is on file yet.",
    );
  });

  it("never says 'reach out' to somebody who is waiting on us", () => {
    const r = nextAction(
      base({
        status: "replied",
        lastTouch: { direction: "inbound", channel: "email", at: "2026-10-05T10:00:00Z" },
        replyClassification: "positive",
      }),
    );
    expect(r.text).toMatch(/replied positively/);
    expect(r.inputs).toContain("They replied 2 days ago");
    expect(r.text).not.toMatch(/Reach out/);
  });

  it("puts a person's own next step first", () => {
    const r = nextAction(
      base({
        nextStep: { text: "Send the security brief", dueAt: "2026-10-09T09:00:00Z" },
        lastTouch: { direction: "inbound", channel: "email", at: "2026-10-06T10:00:00Z" },
      }),
    );
    expect(r.text).toBe("Next: Send the security brief — due 9 Oct.");
  });

  it("flags an overdue next step", () => {
    const r = nextAction(base({ nextStep: { text: "Call back", dueAt: "2026-10-03T09:00:00Z" } }));
    expect(r.text).toBe("Overdue: Call back");
    expect(r.tone).toBe("warning");
  });

  it("says a touch has gone quiet only after the business-day threshold", () => {
    const quiet = nextAction(
      base({ status: "contacted", lastTouch: { direction: "outbound", channel: "linkedin", at: "2026-09-30T09:00:00Z" } }),
    );
    expect(quiet.text).toMatch(/No reply 5 business days after your LinkedIn message/);

    const waiting = nextAction(
      base({ status: "contacted", lastTouch: { direction: "outbound", channel: "email", at: "2026-10-06T09:00:00Z" } }),
    );
    expect(waiting.text).toMatch(/Waiting on them/);
  });

  it("defers to an active sequence", () => {
    const r = nextAction(
      base({
        status: "contacted",
        sequenceActive: true,
        lastTouch: { direction: "outbound", channel: "email", at: "2026-09-01T09:00:00Z" },
      }),
    );
    expect(r.text).toMatch(/sequence is following up/);
  });

  it("asks for a next step at meeting and proposal stage", () => {
    expect(nextAction(base({ status: "meeting" })).text).toMatch(/Set a next step/);
  });

  it("closes the loop on won and lost", () => {
    expect(nextAction(base({ status: "won" })).tone).toBe("success");
    expect(nextAction(base({ status: "lost" })).text).toMatch(/Closed/);
  });
});
