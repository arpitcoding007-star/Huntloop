import { describe, expect, it } from "vitest";
import { budgetRefusal, withinAiBudget } from "./budget";

/* B-06: the request path refuses when the allowance cannot be read. */

function db(response: { data: unknown; error: unknown }) {
  return { rpc: async () => response } as never;
}

describe("withinAiBudget", () => {
  it("refuses when the quota check errors", async () => {
    const decision = await withinAiBudget(db({ data: null, error: { message: "boom" } }), "org");
    expect(decision.allowed).toBe(false);
    expect(budgetRefusal(decision).error).toMatch(/could not be checked/);
  });

  it("refuses when the quota check returns nothing", async () => {
    expect((await withinAiBudget(db({ data: [], error: null }), "org")).allowed).toBe(false);
  });

  it("allows under the limit", async () => {
    const decision = await withinAiBudget(db({ data: [{ allowed: true, used: 3, quota: 100 }], error: null }), "org");
    expect(decision).toMatchObject({ allowed: true, used: 3, quota: 100 });
  });

  it("names the figures when over the limit", async () => {
    const decision = await withinAiBudget(db({ data: [{ allowed: false, used: 100, quota: 100 }], error: null }), "org");
    expect(budgetRefusal(decision).error).toMatch(/100 of its 100/);
  });
});
