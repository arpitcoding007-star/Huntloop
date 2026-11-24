import { describe, expect, it } from "vitest";
import { likePattern } from "./record-search";

describe("likePattern", () => {
  it("wraps plain text", () => expect(likePattern("Acme")).toBe("%Acme%"));
  it("escapes wildcards, so 100% finds 100% and not everything", () => {
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b\\c")).toBe("%a\\_b\\\\c%");
  });
});
