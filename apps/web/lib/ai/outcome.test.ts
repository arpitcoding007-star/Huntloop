import { describe, expect, it, vi } from "vitest";
import { publicAiError } from "./outcome";

function sdkError(name: string, status?: number, message = 'req_011 {"type":"error","error":{"type":"x"}}') {
  const e = new Error(message) as Error & { status?: number };
  e.name = name;
  if (status !== undefined) e.status = status;
  return e;
}

describe("publicAiError", () => {
  it("passes our own errors through", () => {
    expect(publicAiError(new Error("A finding is missing its source URL."), "Failed.")).toBe(
      "A finding is missing its source URL.",
    );
  });

  it("never shows the SDK's raw text", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [name, status] of [
      ["AuthenticationError", 401],
      ["RateLimitError", 429],
      ["InternalServerError", 529],
      ["APIConnectionError", undefined],
      ["APIConnectionTimeoutError", undefined],
      ["BadRequestError", 400],
    ] as const) {
      const shown = publicAiError(sdkError(name, status), "Failed.");
      expect(shown).not.toContain("req_011");
      expect(shown).not.toContain("{");
    }
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("names the cause a person can act on", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(publicAiError(sdkError("AuthenticationError", 401), "Failed.")).toMatch(/key/);
    expect(publicAiError(sdkError("RateLimitError", 429), "Failed.")).toMatch(/minute/);
    expect(publicAiError(sdkError("BadRequestError", 400), "Failed.")).toBe("Failed.");
    spy.mockRestore();
  });

  it("uses the fallback for a non-error", () => {
    expect(publicAiError("boom", "Failed.")).toBe("Failed.");
  });
});
