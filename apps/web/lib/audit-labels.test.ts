import { describe, expect, it } from "vitest";
import { AUDIT_ACTION_LABELS, describeAuditAction } from "./audit-labels";

describe("activity log labels", () => {
  it("gives every recorded action a sentence, not its raw name", () => {
    for (const [action, label] of Object.entries(AUDIT_ACTION_LABELS)) {
      expect(label).not.toBe(action);
      expect(label.length).toBeGreaterThan(3);
      expect(describeAuditAction(action)).toBe(label);
    }
  });

  it("labels the erasure that SQL writes directly", () => {
    expect(describeAuditAction("contact.erased")).toBe("Erased a person's data");
  });

  it("shows an unknown action as written rather than dropping it", () => {
    expect(describeAuditAction("something.new")).toBe("something.new");
  });
});
