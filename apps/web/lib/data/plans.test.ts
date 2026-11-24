import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./source", () => ({ load: vi.fn() }));

const { listPublicPlans } = await import("./plans");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("listPublicPlans", () => {
  it("is cached, carries no session, and keeps catalogue order", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit & { next?: { revalidate?: number } }) =>
      Response.json([
        { id: "scale", name: "Scale", price_cents: 29900, limits: {} },
        { id: "free", name: "Free", price_cents: 0, limits: { seats: 3 } },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const plans = await listPublicPlans();
    expect(plans.map((p) => [p.id, p.limits.seats])).toEqual([["free", 3], ["scale", null]]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://db.test/rest/v1/plans?select=id,name,price_cents,limits");
    expect(init.next?.revalidate).toBe(300);
    expect(new Headers(init.headers).get("cookie")).toBeNull();
  });

  it("shows the seeded catalogue when the database fails, hangs or is empty", async () => {
    for (const answer of [
      async () => new Response("", { status: 500 }),
      async () => { throw new TypeError("fetch failed"); },
      async () => Response.json([]),
    ]) {
      vi.stubGlobal("fetch", vi.fn(answer));
      expect((await listPublicPlans()).map((p) => p.id)).toEqual(["free", "growth", "scale"]);
    }
  });

  it("asks nothing when no database is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await listPublicPlans()).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
  });
});
