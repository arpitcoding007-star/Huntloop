import { describe, expect, it } from "vitest";
import { conversationTurns } from "./conversation-turns";

describe("conversationTurns", () => {
  const rows = conversationTurns({ orgId: "o", conversationId: "c" }, "Why now?", {
    content: "A round closed.",
    citations: [{ ref: "a" }],
    actions: [],
  });

  it("gives both rows the same columns, so no column is sent as null", () => {
    expect(Object.keys(rows[0]!).sort()).toEqual(Object.keys(rows[1]!).sort());
  });

  it("leaves the question's lists empty and the answer's as given", () => {
    expect(rows[0]).toMatchObject({ role: "user", content: "Why now?", citations: [], actions: [] });
    expect(rows[1]).toMatchObject({ role: "assistant", content: "A round closed.", citations: [{ ref: "a" }] });
  });
});
