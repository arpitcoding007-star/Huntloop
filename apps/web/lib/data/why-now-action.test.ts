import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `refreshWhyNowAction` (TRUST-301, migration 0054), against a stand-in
 * database and a stand-in `whyNow`.
 *
 * What is under test is the action's own decisions: the evidence comes from
 * the database (never the page), only a live answer is saved, the save is
 * scoped to the caller's workspace, and it carries the moment it was written.
 */

const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OPP = "11111111-1111-4111-8111-111111111111";

interface Recorded {
  table: string;
  verb: string;
  payload?: unknown;
  filters: [string, unknown][];
}

let calls: Recorded[] = [];
let responses: Record<string, { data: unknown; error: { message: string } | null }> = {};

function fakeDb() {
  return {
    from(table: string) {
      const record: Recorded = { table, verb: "select", filters: [] };
      calls.push(record);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "order", "limit", "maybeSingle", "single"]) {
        chain[m] = (...args: unknown[]) => {
          if (m === "eq") record.filters.push([String(args[0]), args[1]]);
          return chain;
        };
      }
      chain.update = (v: unknown) => {
        record.verb = "update";
        record.payload = v;
        return chain;
      };
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(responses[`${record.verb}:${table}`] ?? { data: null, error: null }).then(resolve);
      return chain;
    },
  };
}

const whyNowMock = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../ai/why-now", () => ({ whyNow: (...args: unknown[]) => whyNowMock(...args) }));
vi.mock("./org", async (importActual) => {
  const actual = await importActual<typeof import("./org")>();
  return {
    ...actual,
    mutate: (_org: string, _caller: string, run: (ctx: unknown) => unknown) =>
      run({ db: fakeDb(), orgId: ORG_ID, viewer: { kind: "member", orgId: ORG_ID, role: "member" } }),
  };
});

const load = () => import("../../app/(app)/[org]/opportunities/[id]/actions");

const opportunity = {
  id: OPP,
  priority: "hot",
  companies: { name: "Alphio AI", canonical_domain: "alphio.ai" },
};
const evidenceRows = [
  { claim: "Raised a Series A in March 2026", kind: "fact", confidence: "high", source_url: "https://alphio.ai/news", excerpt: null },
];
const live = {
  ok: true,
  result: {
    source: "live",
    metered: true,
    whyNow: {
      hasReason: true,
      reason: "Raised a Series A in March 2026 to fund institutional onboarding.",
      urgency: "this_quarter",
      confidence: "medium",
      basedOn: ["Raised a Series A in March 2026"],
    },
  },
};

beforeEach(() => {
  calls = [];
  responses = {};
  whyNowMock.mockReset();
});

describe("refreshWhyNowAction", () => {
  it("reasons from the evidence in the database and saves the answer with its date", async () => {
    responses["select:opportunities"] = { data: opportunity, error: null };
    responses["select:evidence"] = { data: evidenceRows, error: null };
    responses["update:opportunities"] = { data: [{ id: OPP }], error: null };
    whyNowMock.mockResolvedValue(live);

    const { refreshWhyNowAction } = await load();
    const before = Date.now();
    const result = await refreshWhyNowAction("acme", OPP);

    expect(result.ok).toBe(true);
    const request = whyNowMock.mock.calls[0]?.[1] as { evidence: { claim: string }[]; companyName: string };
    expect(request.companyName).toBe("Alphio AI");
    expect(request.evidence.map((e) => e.claim)).toEqual(["Raised a Series A in March 2026"]);

    const update = calls.find((c) => c.verb === "update" && c.table === "opportunities");
    const payload = update?.payload as { why_now: string; why_now_written_at: string };
    expect(payload.why_now).toBe(live.result.whyNow.reason);
    expect(Date.parse(payload.why_now_written_at)).toBeGreaterThanOrEqual(before);
    expect(update?.filters).toContainEqual(["org_id", ORG_ID]);
    expect(update?.filters).toContainEqual(["id", OPP]);
  });

  it("does not save the worked example when no model is configured", async () => {
    responses["select:opportunities"] = { data: opportunity, error: null };
    responses["select:evidence"] = { data: evidenceRows, error: null };
    whyNowMock.mockResolvedValue({ ...live, result: { ...live.result, source: "unconfigured", metered: false } });

    const { refreshWhyNowAction } = await load();
    const result = await refreshWhyNowAction("acme", OPP);

    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.verb === "update")).toBe(false);
  });

  it("saves nothing when the model run fails", async () => {
    responses["select:opportunities"] = { data: opportunity, error: null };
    responses["select:evidence"] = { data: [], error: null };
    whyNowMock.mockResolvedValue({ ok: false, error: "Over this month's AI allowance." });

    const { refreshWhyNowAction } = await load();
    const result = await refreshWhyNowAction("acme", OPP);

    expect(result).toMatchObject({ ok: false, error: "Over this month's AI allowance." });
    expect(calls.some((c) => c.verb === "update")).toBe(false);
  });

  it("refuses an opportunity that is not in this workspace", async () => {
    responses["select:opportunities"] = { data: null, error: null };

    const { refreshWhyNowAction } = await load();
    const result = await refreshWhyNowAction("acme", OPP);

    expect(result.ok).toBe(false);
    expect(whyNowMock).not.toHaveBeenCalled();
  });

  it("refuses a malformed id before touching anything", async () => {
    const { refreshWhyNowAction } = await load();
    const result = await refreshWhyNowAction("acme", "not-a-uuid");

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
