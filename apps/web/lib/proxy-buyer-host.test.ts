import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../proxy";

/** The buyer domain through the real proxy (DN-73), with no database configured. */
beforeEach(() => {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "VERCEL_ENV"]) vi.stubEnv(k, "");
  vi.stubEnv("HUNTLOOP_EXCHANGE", "on");
  vi.stubEnv("HUNTLOOP_BUYER_HOST", "buy.example");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://huntloop.example");
});
afterEach(() => vi.unstubAllEnvs());
const get = (host: string, path: string) => proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));

describe("the buyer domain in the proxy", () => {
  it("shows /find at its home page, with the content security policy", async () => {
    const res = await get("buy.example", "/");
    expect(new URL(res.headers.get("x-middleware-rewrite")!).pathname).toBe("/find");
    expect([...res.headers.keys()].some((k) => k.startsWith("content-security-policy"))).toBe(true);
  });
  it("sends the seller pages to the main domain, without the query", async () => {
    const res = await get("buy.example", "/discover?d=acme.com");
    expect(res.headers.get("location")).toBe("https://huntloop.example/discover");
  });
  it("leaves every other page, and the main domain, alone", async () => {
    expect((await get("buy.example", "/signup")).headers.get("x-middleware-next")).toBe("1");
    expect((await get("huntloop.example", "/")).headers.get("x-middleware-rewrite")).toBeNull();
    expect((await get("huntloop.example", "/for/agencies")).headers.get("location")).toBeNull();
  });
});
