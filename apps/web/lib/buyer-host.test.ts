import { afterEach, describe, expect, it, vi } from "vitest";
import { authOrigin, isBuyerHost } from "./buyer-host";

const main = new URL("https://huntloop.example");
afterEach(() => vi.unstubAllEnvs());
const on = (host = "buy.example") => {
  vi.stubEnv("HUNTLOOP_EXCHANGE", "on");
  vi.stubEnv("HUNTLOOP_BUYER_HOST", host);
};

describe("the buyer domain", () => {
  it("is off until it is named and the Exchange is on", () => {
    vi.stubEnv("HUNTLOOP_BUYER_HOST", "buy.example");
    vi.stubEnv("HUNTLOOP_EXCHANGE", "");
    expect(isBuyerHost("buy.example")).toBe(false);
    vi.stubEnv("HUNTLOOP_EXCHANGE", "on");
    expect(isBuyerHost("buy.example")).toBe(true);
    vi.stubEnv("HUNTLOOP_BUYER_HOST", "");
    expect(isBuyerHost("")).toBe(false);
  });
  it("matches the whole host and nothing that contains it", () => {
    on();
    expect(isBuyerHost("BUY.example")).toBe(true);
    for (const h of ["buy.example.evil.test", "evil-buy.example", "buy.example:81", null]) expect(isBuyerHost(h)).toBe(false);
  });
  it("sends a sign-in back to the host it started on, and never to a forged one", () => {
    on();
    expect(authOrigin("buy.example", main).href).toBe("https://buy.example/");
    expect(authOrigin("evil.test", main).href).toBe(main.href);
  });
  it("ignores a setting that is not a hostname", () => {
    on("buy.example/path");
    expect(isBuyerHost("buy.example/path")).toBe(false);
  });
});
